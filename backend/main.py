import asyncio
import json
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
    print(f"🚨 [ENDPOINT DEBUG] /adk/events/{user_id} called with is_audio={is_audio}")
    live_events, live_request_queue = await adk.start_agent_session(user_id, is_audio == "true")

    def cleanup():
        live_request_queue.close()
        if user_id in adk.active_sessions:
            del adk.active_sessions[user_id]
        print(f"Client #{user_id} disconnected from SSE, active sessions: {list(adk.active_sessions.keys())}")

    async def event_generator():
        try:
            async for data in adk.agent_to_client_sse(live_events):
                yield data
        except Exception as e:
            print(f"Error in SSE stream: {e}")
        finally:
            # Don't cleanup immediately - let the session persist for bidirectional communication
            print(f"SSE stream ended for {user_id}, session will remain active for message sending")
            # Note: Session cleanup will happen when user switches modes or refreshes

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
    """HTTP endpoint for client-to-agent communication with audio support."""
    try:
        message = await request.json()
        mime_type = message["mime_type"]
        data = message["data"]

        session_info = adk.send_message_to_agent(user_id, mime_type, data)

        return {"status": "sent", "message_count": session_info["message_count"], "should_check_completeness": session_info["should_check_completeness"]}

    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/adk/session-status/{user_id}")
async def get_session_status(user_id: str):
    """Check if a session exists for a user (for debugging)."""
    return {"user_id": user_id, "session_exists": user_id in adk.active_sessions, "active_sessions": list(adk.active_sessions.keys()), "total_sessions": len(adk.active_sessions)}


@app.delete("/adk/session/{user_id}")
async def cleanup_session(user_id: str):
    """Manually cleanup a session."""
    if user_id in adk.active_sessions:
        live_request_queue, _ = adk.active_sessions[user_id]
        live_request_queue.close()
        del adk.active_sessions[user_id]
        return {"message": f"Session {user_id} cleaned up", "active_sessions": list(adk.active_sessions.keys())}
    else:
        return {"message": f"No session found for {user_id}", "active_sessions": list(adk.active_sessions.keys())}


@app.post("/adk/check-completeness/{user_id}")
async def check_interview_completeness_endpoint(user_id: str, request: Request):
    """Check if the interview has gathered sufficient information."""
    try:
        body = await request.json()
        conversation_history = body.get("conversation_history", "")

        if not conversation_history:
            raise HTTPException(status_code=400, detail="Conversation history is required")

        completeness_result = await adk.check_interview_completeness(user_id, conversation_history)

        return {"status": "checked", **completeness_result}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# Generate a Node with ADK, Insert to database, and return the node
@app.post("/api/add-node")
async def add_node(request: AddNodeRequest):
    try:
        # get prior nodes
        prior_nodes = request.previous_nodes
        return_nodes = []
        links = []

        for i in range(request.num_nodes):
            name = f"Node {len(prior_nodes) + i + 1}"
            description = f"This is a description of node {len(prior_nodes) + i + 1}"
            type = "node"
            image_name = "node.png"
            time = str(request.time_in_months) + " months"
            title = "Node Title" + str(len(prior_nodes) + i + 1)
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
                links.append(Link(id=link_id, source=clicked_node.id, target=new_node.id, timeInMonths=request.time_in_months, userId=request.user_id))

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
                        INSERT INTO "stem-connect_link" (id, source, target, "timeInMonths", "userId") 
                        VALUES (%s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING
                    """,
                        (link.id, link.source, link.target, link.timeInMonths, link.userId),
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
                SELECT id, source, target, "timeInMonths", "userId"
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


# Delete a node and cascade delete unreachable nodes
@app.delete("/api/delete-node/{user_id}/{node_id}")
async def delete_node(user_id: str, node_id: str):
    """Delete a node and all nodes that become unreachable from 'Now'."""
    try:
        # Check if they are trying to delete the "You" node
        if node_id == "You":
            raise HTTPException(status_code=400, detail="Cannot delete the 'You' node")

        with db.cursor(cursor_factory=RealDictCursor) as cursor:
            # First, check if the node exists and belongs to the user
            cursor.execute(
                """
                SELECT id FROM "stem-connect_node" 
                WHERE id = %s AND "userId" = %s
            """,
                (node_id, user_id),
            )

            if not cursor.fetchone():
                raise HTTPException(status_code=404, detail=f"Node {node_id} not found for user {user_id}")

            # Don't allow deletion of the root "Now" node
            if node_id == "Now":
                raise HTTPException(status_code=400, detail="Cannot delete the root 'Now' node")

            # Get all nodes and links for the user
            cursor.execute(
                """
                SELECT id FROM "stem-connect_node" WHERE "userId" = %s
            """,
                (user_id,),
            )
            all_nodes = {row["id"] for row in cursor.fetchall()}

            cursor.execute(
                """
                SELECT source, target FROM "stem-connect_link" WHERE "userId" = %s
            """,
                (user_id,),
            )
            all_links = [(row["source"], row["target"]) for row in cursor.fetchall()]

            # Find all nodes reachable from "Now" after removing the target node
            reachable_nodes = set()

            def dfs_from_now(current_node):
                if current_node in reachable_nodes or current_node == node_id:
                    return
                reachable_nodes.add(current_node)

                # Follow all outgoing links from this node
                for source, target in all_links:
                    if source == current_node and target != node_id:
                        dfs_from_now(target)

            # Start DFS from "Now" node
            if "Now" in all_nodes:
                dfs_from_now("Now")

            # Find nodes that will become unreachable
            unreachable_nodes = all_nodes - reachable_nodes
            # Remove the target node from unreachable (it's being explicitly deleted)
            unreachable_nodes.discard(node_id)
            nodes_to_delete = {node_id} | unreachable_nodes

            print(f"Deleting node {node_id} and {len(unreachable_nodes)} unreachable nodes: {unreachable_nodes}")

            # Delete all links involving any of the nodes to be deleted
            for node in nodes_to_delete:
                cursor.execute(
                    """
                    DELETE FROM "stem-connect_link" 
                    WHERE ("userId" = %s) AND (source = %s OR target = %s)
                """,
                    (user_id, node, node),
                )

            # Delete all the nodes
            for node in nodes_to_delete:
                cursor.execute(
                    """
                    DELETE FROM "stem-connect_node" 
                    WHERE id = %s AND "userId" = %s
                """,
                    (node, user_id),
                )

            db.commit()

            return {"deleted_node": node_id, "cascade_deleted": list(unreachable_nodes), "total_deleted": len(nodes_to_delete), "remaining_nodes": len(all_nodes) - len(nodes_to_delete)}

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete node: {str(e)}")
