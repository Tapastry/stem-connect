import os
import uuid
from dataclasses import Field
from datetime import datetime
from typing import Dict, List, Optional

# this might need to be changed to 'import adk' btw
from . import adk
import psycopg2
import uvicorn
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel

# Load environment variables from .env file
load_dotenv()

# Initialize FastAPI app
app = FastAPI(title="STEM Connect API", description="A FastAPI backend for STEM Connect application", version="1.0.0", docs_url="/docs", redoc_url="/redoc")

# CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],  # Next.js default ports
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security
security = HTTPBearer()

nodes_db: Dict[str, dict] = {}


# Pydantic models
class Node(BaseModel):
    id: Optional[str] = None
    name: str
    title: Optional[str] = None
    type: str
    imageName: Optional[str] = None
    time: Optional[str] = None
    description: Optional[str] = None
    createdAt: Optional[datetime] = None
    userId: str


class Link(BaseModel):
    id: Optional[str] = None
    source: str
    target: str
    userId: str


class PersonalInformation(BaseModel):
    id: Optional[str] = None
    age: Optional[int] = None
    gender: Optional[str] = None
    location: Optional[str] = None
    interests: Optional[str] = None
    skills: Optional[str] = None
    name: str
    title: Optional[str] = None
    goal: Optional[str] = None
    bio: Optional[str] = None
    imageName: Optional[str] = None
    userId: str


class AddNodeRequest(BaseModel):
    root: Node
    num_nodes: int
    edge_in_month: int
    type: str
    agent_type: Optional[str]


class AddPersonalInformationRequest(BaseModel):
    personalInformation: PersonalInformation


class UpdatePersonalInformationRequest(BaseModel):
    id: str
    personalInformation: PersonalInformation


class NodeRequest(BaseModel):
    id: Optional[str] = None
    user_id: str
    agent_type: str = "interviewer_agent"
    attached_nodes_ids: Optional[List[str]] = []
    prompt_override: Optional[str] = None  # Allow custom prompts if needed


class NodeResponse(BaseModel):
    id: str
    prompt: str
    output: str
    attached_node_ids: List[str]


# ADK Agent Endpoints
@app.get("/adk/events/{user_id}")
async def adk_events_endpoint(user_id: str, is_audio: str = "false"):
    """SSE endpoint for agent-to-client communication."""
    live_events, live_request_queue = await adk.start_agent_session(user_id, is_audio == "true")

    def cleanup():
        live_request_queue.close()
        if user_id in adk.active_sessions:
            del adk.active_sessions[user_id]
        print(f"Client #{user_id} disconnected from SSE")

    async def event_generator():
        try:
            async for data in adk.agent_to_client_sse(live_events):
                yield data
        except Exception as e:
            print(f"Error in SSE stream: {e}")
        finally:
            cleanup()

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "Access-Control-Allow-Origin": "*",
        },
    )


@app.post("/adk/send/{user_id}")
async def adk_send_message_endpoint(user_id: str, request: Request):
    """HTTP endpoint for client-to-agent communication."""
    try:
        message = await request.json()
        mime_type = message["mime_type"]
        data = message["data"]

        adk.send_message_to_agent(user_id, mime_type, data)
        return {"status": "sent"}

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Generate a Node with ADK, Insert to database, and return the node
@app.post("/api/add-node")
async def add_node(request: AddNodeRequest):
    try:
        # Create a prompt for node generation based on the root node and parameters
        prompt = f"""
        Generate {request.num_nodes} life path decisions/scenarios based on this root node:
        
        Root Node: {request.root.name}
        Description: {request.root.description or "No description provided"}
        Type: {request.type}
        Time frame: {request.edge_in_month} months
        
        Generate realistic life path options that branch from this point, considering the time frame and type specified.
        Each option should be a distinct choice or scenario that could realistically happen.
        """

        # Use the new one-time session to generate nodes without chat history
        generated_response = await adk.generate_node_response(prompt, request.agent_type)

        # TODO: Parse the response and create actual nodes
        # TODO: Insert nodes into database
        # TODO: Return structured node data

        return {"message": "Node generation completed", "generated_content": generated_response, "root_node": request.root.dict(), "parameters": {"num_nodes": request.num_nodes, "edge_in_month": request.edge_in_month, "type": request.type}}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Node generation failed: {str(e)}")


@app.post("/api/nodes", response_model=NodeResponse)
async def create_node_with_context(request: NodeRequest):
    """Create a new node with context from all previous nodes in the life path."""
    node_id = request.id if request.id else str(uuid.uuid4())

    # --- Start of new recursive context gathering ---
    full_path_outputs = []
    processed_nodes = set()

    def gather_context_recursively(node_id):
        if node_id in nodes_db and node_id not in processed_nodes:
            processed_nodes.add(node_id)
            node_data = nodes_db[node_id]
            for parent_id in node_data.get("attached_node_ids", []):
                gather_context_recursively(parent_id)
            if node_data.get("output"):
                full_path_outputs.append(node_data['output'])

    for parent_id in request.attached_nodes_ids:
        gather_context_recursively(parent_id)
    # --- End of new recursive context gathering ---

    # --- Start of Summarization Logic ---
    context_string = ""
    if not full_path_outputs:
        context_string = "This is the first event of the story."
    elif len(full_path_outputs) == 1:
        # If there's only one parent, just use its full text
        context_string = f"This story starts with the following event:\\n{full_path_outputs[0]}"
    else:
        # For longer histories, use the summarization strategy
        root_node_text = full_path_outputs[0]
        immediate_parent_text = full_path_outputs[-1]
        nodes_to_summarize = full_path_outputs[1:-1]

        summary_of_middle = ""
        if nodes_to_summarize:
            summary_of_middle = await adk.summarize_path_history(nodes_to_summarize)
        
        context_string = f"""
        Here is the story so far:
        The story began with this event: "{root_node_text}"
        Then, a summary of what happened next is: "{summary_of_middle}"
        The most recent event was: "{immediate_parent_text}"
        """
    # --- End of Summarization Logic ---

    # Use custom prompt if provided, otherwise use default
    prompt = request.prompt_override if request.prompt_override else f"""
    Given the life story context below, generate the next realistic life scenario or decision point that could follow.
    
    Context:
    {context_string}
    
    Your task is to create the *next* logical event.
    """
    
    try:
        # Generate the response using the specified agent
        output = await adk.generate_node_response(prompt, request.agent_type)
        
        # Store the node in our database
        nodes_db[node_id] = {
            "id": node_id,
            "user_id": request.user_id,
            "prompt": prompt,
            "output": output,
            "attached_node_ids": request.attached_nodes_ids,
            "agent_type": request.agent_type,
            "created_at": datetime.now().isoformat()
        }
        
        return NodeResponse(
            id=node_id,
            prompt=prompt,
            output=output,
            attached_node_ids=request.attached_nodes_ids
        )
    
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create node: {str(e)}")


# Add user information gathered on interview screen to database
@app.post("/api/add-personal-information")
async def add_personal_information(request: AddPersonalInformationRequest):
    # add personal information to database
    return {"message": "Personal information added successfully (placeholder)"}


# Update user information gathered on interview screen to database
@app.put("/api/update-personal-information")
async def update_personal_information(request: UpdatePersonalInformationRequest):
    # update personal information in database
    return {"message": "Personal information updated successfully (placeholder)"}


# Get user information gathered on interview screen from database
@app.get("/api/personal-information/{user_id}")
async def get_personal_information(user_id: str):
    # get personal information for user
    return {"message": f"Personal information for user {user_id} (placeholder)"}


# Get all nodes for user from database
@app.get("/api/nodes/{user_id}")
async def get_nodes(user_id: str):
    """Get all nodes for a specific user."""
    user_nodes = {
        node_id: node_data 
        for node_id, node_data in nodes_db.items() 
        if node_data.get("user_id") == user_id
    }
    return {
        "user_id": user_id,
        "nodes": user_nodes,
        "total": len(user_nodes)
    }


# Get all links for user from database
@app.get("/api/links/{user_id}")
async def get_links(user_id: str):
    # get all links for user
    return {"message": f"Links for user {user_id} (placeholder)"}


# Get a specific node by ID
@app.get("/api/node/{node_id}")
async def get_node(node_id: str):
    """Get a specific node by its ID."""
    if node_id not in nodes_db:
        raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
    
    return nodes_db[node_id]


# Get the full path history for a node
@app.get("/api/node/{node_id}/path")
async def get_node_path(node_id: str):
    """Get the complete path history leading to this node."""
    if node_id not in nodes_db:
        raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
    
    path = []
    current_node = nodes_db[node_id]
    
    # Build the path by traversing backwards through attached nodes
    def build_path(node_data):
        path.append({
            "id": node_data["id"],
            "output": node_data["output"],
            "created_at": node_data.get("created_at")
        })
        
        # Recursively add parent nodes
        for parent_id in node_data.get("attached_node_ids", []):
            if parent_id in nodes_db:
                build_path(nodes_db[parent_id])
    
    build_path(current_node)
    
    # Reverse to get chronological order
    path.reverse()
    
    return {
        "node_id": node_id,
        "path": path,
        "depth": len(path)
    }


# Delete a node and optionally its descendants
@app.delete("/api/node/{node_id}")
async def delete_node(node_id: str, delete_descendants: bool = False):
    """Delete a node and optionally all nodes that branch from it."""
    if node_id not in nodes_db:
        raise HTTPException(status_code=404, detail=f"Node {node_id} not found")
    
    deleted_nodes = [node_id]
    
    if delete_descendants:
        # Find all descendant nodes
        def find_descendants(parent_id):
            for nid, node_data in nodes_db.items():
                if parent_id in node_data.get("attached_node_ids", []):
                    deleted_nodes.append(nid)
                    find_descendants(nid)  # Recursively find children
        
        find_descendants(node_id)
    
    # Delete all identified nodes
    for nid in deleted_nodes:
        del nodes_db[nid]
    
    return {
        "deleted": deleted_nodes,
        "count": len(deleted_nodes)
    }


# Get available AI agents
@app.get("/api/agents")
async def get_available_agents():
    """Get a list of all available AI agents."""
    try:
        agents = adk.get_available_agents()
        return {"agents": agents, "default": "interviewer_agent", "total": len(agents)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get agents: {str(e)}")
