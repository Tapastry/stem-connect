import os
import random
import string
import uuid
from dataclasses import Field
from datetime import datetime
from typing import Dict, List, Optional

import adk
import psycopg2
import uvicorn
from dotenv import load_dotenv
from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from models import AddNodeRequest, AddPersonalInformationRequest, Link, Node, NodeRequest, NodeResponse, UpdatePersonalInformationRequest
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel

# Load environment variables from .env file
load_dotenv()

# Initialize FastAPI app
app = FastAPI(title="STEM Connect API", description="A FastAPI backend for STEM Connect application", version="1.0.0", docs_url="/docs", redoc_url="/redoc")

# Initialize postgres database connection
DATABASE_URL = os.getenv("DATABASE_URL")
db = psycopg2.connect(DATABASE_URL)

# /**
#  * APP INFORMATION
#  */

# // link to user object
# export const personalInformation = createTable("personal_information", (d) => ({
#   id: d.varchar({ length: 255 }).notNull().primaryKey(),
#   age: d.integer(),
#   gender: d.varchar({ length: 255 }),
#   location: d.varchar({ length: 255 }),
#   interests: d.text(),
#   skills: d.text(),
#   name: d.varchar({ length: 255 }).notNull(),
#   title: d.varchar({ length: 255 }),
#   goal: d.text(),
#   bio: d.text(),
#   imageName: d.varchar({ length: 255 }),
#   userId: d
#     .varchar({ length: 255 })
#     .notNull()
#     .references(() => users.id),
# }));

# export const nodes = createTable("node", (d) => ({
#   id: d.varchar({ length: 255 }).notNull().primaryKey(),
#   name: d.varchar({ length: 255 }).notNull(),
#   title: d.varchar({ length: 255 }),
#   type: d.varchar({ length: 255 }).notNull(),
#   imageName: d.varchar({ length: 255 }),
#   time: d.text(),
#   description: d.text(),
#   createdAt: d
#     .timestamp({ mode: "date", withTimezone: true })
#     .notNull()
#     .default(sql`CURRENT_TIMESTAMP`),
#   userId: d
#     .varchar({ length: 255 })
#     .notNull()
#     .references(() => users.id),
# }));

# export const nodesRelations = relations(nodes, ({ many }) => ({
#   links: many(links),
# }));

# export const links = createTable("link", (d) => ({
#   id: d.varchar({ length: 255 }).notNull().primaryKey(),
#   source: d
#     .varchar({ length: 255 })
#     .notNull()
#     .references(() => nodes.id),
#   target: d
#     .varchar({ length: 255 })
#     .notNull()
#     .references(() => nodes.id),
#   userId: d
#     .varchar({ length: 255 })
#     .notNull()
#     .references(() => users.id),
# }));


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


# MOCK - Generate a node programatically to test the frontend
@app.post("/api/add-node")
async def add_node(request: AddNodeRequest):
    try:
        # get prior nodes
        prior_nodes = request.previous_nodes
        return_nodes = []
        links = []

        for i in range(request.num_nodes):
            name = f"Node {i + 1}"
            description = f"This is a description of node {i + 1}"
            type = "node"
            image_name = "node.png"
            time = "1 month"
            title = "Node Title"
            created_at = datetime.now()
            user_id = request.user_id
            # Create unique ID using timestamp and random string to avoid duplicates
            unique_id = f"{datetime.now().strftime('%Y%m%d%H%M%S')}-{random.choice(string.ascii_letters)}{random.choice(string.ascii_letters)}-{i}"
            new_node = Node(id=unique_id, name=name, description=description, type=type, image_name=image_name, time=time, title=title, created_at=created_at, user_id=user_id)
            return_nodes.append(new_node)

        # create links from the clicked node to all new nodes
        if request.clicked_node_id:
            # Find the clicked node in prior_nodes to get its full data
            clicked_node = next((node for node in prior_nodes if node.id == request.clicked_node_id), None)

            if not clicked_node:
                # If clicked node not in path, create a minimal node representation
                clicked_node = Node(id=request.clicked_node_id, name=request.clicked_node_id, description=f"Life event: {request.clicked_node_id}", type="life-event", image_name="", time=datetime.now().isoformat(), title=request.clicked_node_id, created_at=datetime.now(), user_id=request.user_id)

            # First, ensure the clicked node exists in the database
            with db.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO "stem-connect_node" (id, name, title, type, "imageName", time, description, "createdAt", "userId") 
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO NOTHING
                    """,
                    (clicked_node.id, clicked_node.name, clicked_node.title, clicked_node.type, clicked_node.image_name, clicked_node.time, clicked_node.description, clicked_node.created_at, clicked_node.user_id),
                )
                db.commit()

            # Now create links from clicked node to new nodes
            for new_node in return_nodes:
                link_id = f"{clicked_node.id}-{new_node.id}-{request.user_id}"
                links.append(Link(id=link_id, source=clicked_node.id, target=new_node.id, userId=request.user_id))

        # add the nodes to the database
        try:
            with db.cursor() as cursor:
                for node in return_nodes:
                    cursor.execute(
                        """
                        INSERT INTO "stem-connect_node" (id, name, title, type, "imageName", time, description, "createdAt", "userId") 
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING
                    """,
                        (node.id, node.name, node.title, node.type, node.image_name, node.time, node.description, node.created_at, node.user_id),
                    )

                # add the links to the database
                for link in links:
                    cursor.execute(
                        """
                        INSERT INTO "stem-connect_link" (id, source, target, "userId") 
                        VALUES (%s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING
                    """,
                        (link.id, link.source, link.target, link.userId),
                    )

                db.commit()
        except Exception as db_error:
            db.rollback()
            raise db_error

        return return_nodes

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Node generation failed: {str(e)}")


# Get all nodes and links for a user
@app.get("/api/get-graph/{user_id}")
async def get_graph(user_id: str):
    """Get all nodes and links for a specific user."""
    try:
        with db.cursor(cursor_factory=RealDictCursor) as cursor:
            # Get all nodes for the user
            cursor.execute(
                """
                SELECT id, name, title, type, "imageName", time, description, "createdAt", "userId"
                FROM "stem-connect_node" 
                WHERE "userId" = %s
                ORDER BY "createdAt"
            """,
                (user_id,),
            )
            nodes_data = cursor.fetchall()

            # Get all links for the user
            cursor.execute(
                """
                SELECT id, source, target, "userId"
                FROM "stem-connect_link" 
                WHERE "userId" = %s
            """,
                (user_id,),
            )
            links_data = cursor.fetchall()

            return {"user_id": user_id, "nodes": [dict(node) for node in nodes_data], "links": [dict(link) for link in links_data], "total_nodes": len(nodes_data), "total_links": len(links_data)}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to get graph data: {str(e)}")


# Instantiate a "You" node for a user if it doesn't exist
@app.post("/api/instantiate/{user_id}")
async def instantiate_user_node(user_id: str):
    """Create a 'You' node at origin (0,0,0) if it doesn't already exist."""
    try:
        with db.cursor() as cursor:
            # Try to insert the "You" node, ignore if it already exists
            cursor.execute(
                """
                INSERT INTO "stem-connect_node" (id, name, title, type, "imageName", time, description, "createdAt", "userId") 
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (id) DO NOTHING
                """,
                ("Now", "Now", "Your Current Position in Life", "self", "", "Present", "This represents your current position in life", datetime.now(), user_id),
            )
            db.commit()

            return {"message": "You node instantiated", "node_id": "You", "user_id": user_id}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to instantiate user node: {str(e)}")
