import asyncio
import io
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
from models.requests import AddNodeRequest, AddPersonalInformationRequest, InterviewCompletenessRequest, UpdateNodeRequest, UpdatePersonalInformationRequest
from psycopg2.extras import RealDictCursor
from pydantic import BaseModel

# Load environment variables from .env file
load_dotenv()

# Initialize FastAPI app
app = FastAPI(title="STEM Connect API", description="A FastAPI backend for STEM Connect application", version="1.0.0", docs_url="/docs", redoc_url="/redoc")

# Initialize postgres database connection
DATABASE_URL = os.getenv("DATABASE_URL")
db = psycopg2.connect(DATABASE_URL)

# ADK will handle AI configuration internally

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
    return {
        "user_id": user_id, 
        "session_exists": user_id in adk.active_sessions, 
        "initial_message_sent": user_id in adk.initial_message_sent,
        "active_sessions": list(adk.active_sessions.keys()), 
        "initial_messages_sent": list(adk.initial_message_sent.keys()),
        "total_sessions": len(adk.active_sessions)
    }


@app.delete("/adk/session/{user_id}")
async def cleanup_session(user_id: str):
    """Manually cleanup a session."""
    try:
        if user_id in adk.active_sessions:
            live_request_queue, _, _ = adk.active_sessions[user_id]
            live_request_queue.close()
            del adk.active_sessions[user_id]
        
        # Also clear initial message tracking
        if user_id in adk.initial_message_sent:
            del adk.initial_message_sent[user_id]
            
        return {
            "message": f"Session {user_id} cleaned up", 
            "active_sessions": list(adk.active_sessions.keys()),
            "initial_messages_sent": list(adk.initial_message_sent.keys())
        }
    except Exception as e:
        return {"error": f"Failed to cleanup session: {str(e)}"}


@app.post("/adk/check-completeness")
async def check_interview_completeness_endpoint(request: InterviewCompletenessRequest):
    """
    Endpoint to check for interview completeness and upsert personal information.
    """
    print(f"[COMPLETENESS] Received request for user: {request.user_id}")
    print(f"[COMPLETENESS] Conversation history length: {len(request.conversation_history)}")
    print(f"[COMPLETENESS] Sample conversation: {request.conversation_history[:2] if request.conversation_history else 'Empty'}")

    result = await adk.check_interview_completeness(request.user_id, request.conversation_history)
    if result.get("is_complete"):
        personal_info_data = result.get("personal_info_data")
        if personal_info_data:
            try:
                with db.cursor() as cursor:
                    # First, check if a record already exists for this user
                    cursor.execute(
                        """
                        SELECT id FROM "stem-connect_personal_information"
                        WHERE "userId" = %s
                        """,
                        (request.user_id,),
                    )
                    existing_record = cursor.fetchone()

                    if existing_record:
                        # If it exists, UPDATE it
                        cursor.execute(
                            """
                            UPDATE "stem-connect_personal_information"
                            SET bio = %(bio)s,
                                goal = %(goal)s,
                                location = %(location)s,
                                interests = %(interests)s,
                                skills = %(skills)s,
                                title = %(title)s,
                                summary = %(summary)s,
                                background = %(background)s,
                                aspirations = %(aspirations)s,
                                "values" = %(values)s,
                                challenges = %(challenges)s
                            WHERE "userId" = %(user_id)s
                            """,
                            {**personal_info_data, "user_id": request.user_id},
                        )
                        print(f"[DB] Updated personal information for user {request.user_id}")
                    else:
                        # If it doesn't exist, INSERT a new record
                        # Get user's name from the user table to satisfy NOT NULL constraint
                        cursor.execute('SELECT name FROM "stem-connect_user" WHERE id = %s', (request.user_id,))
                        user_record = cursor.fetchone()
                        user_name = user_record[0] if user_record else "New User"

                        new_id = str(uuid.uuid4())

                        cursor.execute(
                            """
                            INSERT INTO "stem-connect_personal_information"
                            (id, "userId", name, bio, goal, location, interests, skills, title, summary, background, aspirations, "values", challenges)
                            VALUES (%(id)s, %(user_id)s, %(name)s, %(bio)s, %(goal)s, %(location)s, %(interests)s, %(skills)s, %(title)s, %(summary)s, %(background)s, %(aspirations)s, %(values)s, %(challenges)s)
                            """,
                            {"id": new_id, "user_id": request.user_id, "name": user_name, **personal_info_data},
                        )
                        print(f"[DB] Created personal information for user {request.user_id}")
                    db.commit()
            except Exception as e:
                db.rollback()
                raise HTTPException(status_code=500, detail=f"Failed to save personal information: {e}")
    return result


@app.post("/api/save-personal-info")
async def save_personal_info_endpoint(request: dict):
    """
    Endpoint to save personal information extracted from the interview.
    """
    user_id = request.get("user_id")
    personal_info = request.get("personal_info", {})

    print(f"[SAVE PERSONAL INFO] Received data for user: {user_id}")
    print(f"[SAVE PERSONAL INFO] Data: {personal_info}")

    try:
        with db.cursor() as cursor:
            # First, check if a record already exists for this user
            cursor.execute(
                """
                SELECT id FROM "stem-connect_personal_information"
                WHERE "userId" = %s
                """,
                (user_id,),
            )
            existing_record = cursor.fetchone()

            if existing_record:
                # If it exists, UPDATE it
                        cursor.execute(
                            """
                            UPDATE "stem-connect_personal_information"
                            SET name = %(name)s,
                                gender = %(gender)s,
                                bio = %(bio)s,
                                goal = %(goal)s,
                                location = %(location)s,
                                interests = %(interests)s,
                                skills = %(skills)s,
                                title = %(title)s,
                                summary = %(summary)s,
                                background = %(background)s,
                                aspirations = %(aspirations)s,
                                "values" = %(values)s,
                                challenges = %(challenges)s
                            WHERE "userId" = %(user_id)s
                            """,
                            {**personal_info, "user_id": user_id},
                        )
                        print(f"[DB] Updated personal information for user {user_id}")
            else:
                # If it doesn't exist, INSERT a new record
                # Get user's name from the user table to satisfy NOT NULL constraint
                cursor.execute('SELECT name FROM "stem-connect_user" WHERE id = %s', (user_id,))
                user_record = cursor.fetchone()
                user_name = user_record[0] if user_record else "New User"

                new_id = str(uuid.uuid4())

                cursor.execute(
                    """
                    INSERT INTO "stem-connect_personal_information"
                    (id, "userId", name, gender, bio, goal, location, interests, skills, title, summary, background, aspirations, "values", challenges)
                    VALUES (%(id)s, %(user_id)s, %(name)s, %(gender)s, %(bio)s, %(goal)s, %(location)s, %(interests)s, %(skills)s, %(title)s, %(summary)s, %(background)s, %(aspirations)s, %(values)s, %(challenges)s)
                    """,
                    {"id": new_id, "user_id": user_id, "name": personal_info.get("name", user_name), **personal_info},
                )
                print(f"[DB] Created personal information for user {user_id}")
            db.commit()

        return {"message": "Personal information saved successfully"}

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to save personal information: {e}")


# Generate a Node with AI, Insert to database, and return the node
@app.post("/api/add-node")
async def add_node(request: AddNodeRequest):
    try:
        # get prior nodes
        prior_nodes = request.previous_nodes
        return_nodes = []
        links = []

        # Convert links to dict format for time calculation
        current_links = []
        with db.cursor(cursor_factory=RealDictCursor) as cursor:
            cursor.execute(
                """
                SELECT source, target, "timeInMonths" FROM "stem-connect_link" WHERE "userId" = %s
            """,
                (request.user_id,),
            )
            current_links = [dict(row) for row in cursor.fetchall()]

        # Generate all nodes at once with ADK for diversity
        ai_events = await adk.generate_life_events_with_adk(
            prior_nodes,
            request.prompt,
            request.node_type,
            request.time_in_months,
            request.positivity,
            request.num_nodes,
            request.user_id,
            highlight_path=[node.id for node in prior_nodes],  # Convert to list of IDs
            all_links=current_links,
        )

        for i, ai_content in enumerate(ai_events):
            created_at = datetime.now()
            user_id = request.user_id

            # Create readable ID from AI-generated name (max 3-4 words)
            name_words = ai_content["name"].split()[:3]  # Take first 3 words max
            readable_id = " ".join(name_words)

            # Add suffix if ID already exists to ensure uniqueness
            base_id = readable_id
            counter = 1
            while any(node.id == readable_id for node in return_nodes):
                readable_id = f"{base_id} {counter}"
                counter += 1

            # Use AI-generated time if available, otherwise use request time or random
            event_time_months = ai_content.get("time_months", request.time_in_months if request.time_in_months > 0 else random.randint(1, 24))
            event_positivity = ai_content.get("positivity_score", request.positivity if request.positivity >= 0 else random.randint(0, 100))

            new_node = Node(id=readable_id, name=ai_content["name"], description=ai_content["description"], type=ai_content["type"], image_name=ai_content.get("image_name", ""), image_url=ai_content.get("image_url", ""), timeInMonths=event_time_months, title=ai_content["title"], created_at=created_at, user_id=user_id)
            return_nodes.append(new_node)

        # create links from the clicked node to all new nodes
        if request.clicked_node_id:
            # Find the clicked node in prior_nodes to get its full data
            clicked_node = next((node for node in prior_nodes if node.id == request.clicked_node_id), None)

            if not clicked_node:
                # If clicked node not in path, create a minimal node representation
                clicked_node = Node(id=request.clicked_node_id, name=request.clicked_node_id, description=f"Life event: {request.clicked_node_id}", type="life-event", image_name="", image_url="", timeInMonths=1, title=request.clicked_node_id, created_at=datetime.now(), user_id=request.user_id)

            # First, ensure the clicked node exists in the database
            with db.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO "stem-connect_node" (id, name, title, type, "imageName", "imageUrl", "timeInMonths", description, "createdAt", "userId") 
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (id) DO NOTHING
                """,
                    (clicked_node.id, clicked_node.name, clicked_node.title, clicked_node.type, clicked_node.image_name, clicked_node.image_url, clicked_node.timeInMonths, clicked_node.description, clicked_node.created_at, clicked_node.user_id),
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
                        INSERT INTO "stem-connect_node" (id, name, title, type, "imageName", "imageUrl", "timeInMonths", description, "createdAt", "userId") 
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING
                    """,
                        (node.id, node.name, node.title, node.type, node.image_name, node.image_url, node.timeInMonths, node.description, node.created_at, node.user_id),
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
                SELECT id, name, title, type, "imageName", "imageUrl", "timeInMonths", description, "createdAt", "userId"
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
    """Create a 'Now' node for the user if it doesn't already exist."""
    try:
        with db.cursor() as cursor:
            # Check if the user already has a "Now" node (could be "Now" or "Now-{user_id}")
            cursor.execute(
                """
                SELECT id FROM "stem-connect_node" 
                WHERE (id = %s OR id = %s) AND "userId" = %s
                """,
                ("Now", f"Now-{user_id}", user_id),
            )

            existing_node = cursor.fetchone()

            if not existing_node:
                # Create a unique node ID for this user's "Now" node
                unique_node_id = f"Now-{user_id}"

                # Insert the "Now" node for this specific user
                cursor.execute(
                    """
                    INSERT INTO "stem-connect_node" (id, name, title, type, "imageName", "imageUrl", "timeInMonths", description, "createdAt", "userId") 
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    (unique_node_id, "Now", "Your Current Position in Life", "self", "", "", 0, "This represents your current position in life", datetime.now(), user_id),
                )
                db.commit()

                return {"message": "Now node created", "node_id": unique_node_id, "user_id": user_id, "created": True}
            else:
                return {"message": "Now node already exists", "node_id": "Now", "user_id": user_id, "created": False}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to instantiate user node: {str(e)}")


# Delete a node and cascade delete unreachable nodes
@app.delete("/api/delete-node/{user_id}/{node_id}")
async def delete_node(user_id: str, node_id: str):
    """Delete a node and all nodes that become unreachable from 'Now'."""
    try:
        # Check if they are trying to delete the "Now" node
        if node_id == "Now" or node_id.startswith("Now-"):
            raise HTTPException(status_code=400, detail="Cannot delete the 'Now' node")

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

            # Start DFS from "Now" node (could be "Now" or "Now-{user_id}")
            now_node = None
            for node in all_nodes:
                if node == "Now" or node.startswith("Now-"):
                    now_node = node
                    break

            if now_node:
                dfs_from_now(now_node)

            # Find nodes that will become unreachable
            unreachable_nodes = all_nodes - reachable_nodes
            # Remove the target node from unreachable (it's being explicitly deleted)
            unreachable_nodes.discard(node_id)
            nodes_to_delete = {node_id} | unreachable_nodes

            print(f"Deleting node {node_id} and {len(unreachable_nodes)} unreachable nodes: {unreachable_nodes}")

            # Get image names for nodes to be deleted before deleting from database
            node_images_to_delete = []
            for node in nodes_to_delete:
                cursor.execute(
                    """
                    SELECT "imageName" FROM "stem-connect_node" 
                    WHERE id = %s AND "userId" = %s AND "imageName" IS NOT NULL AND "imageName" != ''
                """,
                    (node, user_id),
                )
                result = cursor.fetchone()
                if result and result["imageName"]:
                    node_images_to_delete.append(result["imageName"])

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

            # Delete images from MinIO after successful database deletion
            deleted_images = []
            if node_images_to_delete:
                print(f"Deleting {len(node_images_to_delete)} images from MinIO")
                for image_name in node_images_to_delete:
                    try:
                        adk.minio_client.remove_object("node-images", image_name)
                        deleted_images.append(image_name)
                        print(f"Deleted image: {image_name}")
                    except Exception as e:
                        print(f"Failed to delete image {image_name}: {e}")

            return {"deleted_node": node_id, "cascade_deleted": list(unreachable_nodes), "total_deleted": len(nodes_to_delete), "remaining_nodes": len(all_nodes) - len(nodes_to_delete), "deleted_images": deleted_images}

    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete node: {str(e)}")


# Check if user image exists in MinIO
@app.get("/api/user-image-exists/{user_id}")
async def check_user_image_exists(user_id: str):
    """Check if user has uploaded an image to MinIO."""
    try:
        print(f"Checking user image for: {user_id}")

        # Check if user-images bucket exists
        bucket_name = "user-images"
        try:
            bucket_exists = adk.minio_client.bucket_exists(bucket_name)
            print(f"Bucket '{bucket_name}' exists: {bucket_exists}")
        except Exception as e:
            print(f"Error checking bucket: {e}")
            return {"exists": False, "message": f"Error checking bucket: {str(e)}"}

        if not bucket_exists:
            return {"exists": False, "message": "User images bucket does not exist"}

        # Check if user's image exists
        user_image_name = f"{user_id}.png"
        print(f"Looking for image: {user_image_name}")

        try:
            stat = adk.minio_client.stat_object(bucket_name, user_image_name)
            print(f"Found image: {user_image_name}, size: {stat.size}")
            return {"exists": True, "image_name": user_image_name}
        except Exception as e:
            print(f"Image not found: {e}")
            return {"exists": False, "message": f"No image found for user {user_id}"}

    except Exception as e:
        print(f"Error in check_user_image_exists: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to check user image: {str(e)}")


# Upload user image to MinIO
@app.post("/api/upload-user-image/{user_id}")
async def upload_user_image(user_id: str, request: Request):
    """Upload and store user image in MinIO with proper naming."""
    try:
        # Get the uploaded file data
        form_data = await request.form()
        uploaded_file = form_data.get("image")

        if not uploaded_file:
            raise HTTPException(status_code=400, detail="No image file provided")

        # Read the file data
        file_data = await uploaded_file.read()

        # Ensure user-images bucket exists
        bucket_name = "user-images"
        try:
            if not adk.minio_client.bucket_exists(bucket_name):
                print(f"Creating bucket: {bucket_name}")
                adk.minio_client.make_bucket(bucket_name)
                print(f"Bucket created: {bucket_name}")
            else:
                print(f"Bucket exists: {bucket_name}")
        except Exception as e:
            print(f"Error with bucket '{bucket_name}': {e}")
            raise HTTPException(status_code=500, detail=f"MinIO bucket error: {str(e)}")

        # Upload with standardized name
        user_image_name = f"{user_id}.png"

        try:
            print(f"Uploading image: {user_image_name} ({len(file_data)} bytes)")

            # Check if image already exists and remove it first to ensure overwrite
            try:
                adk.minio_client.stat_object(bucket_name, user_image_name)
                print(f"Removing existing image: {user_image_name}")
                adk.minio_client.remove_object(bucket_name, user_image_name)
            except:
                print(f"No existing image to remove: {user_image_name}")

            data_stream = io.BytesIO(file_data)
            adk.minio_client.put_object(bucket_name, user_image_name, data_stream, length=len(file_data), content_type="image/png")

            print(f"User image uploaded: {bucket_name}/{user_image_name}")
            return {"success": True, "message": f"Image uploaded successfully as {user_image_name}", "image_name": user_image_name}

        except Exception as e:
            print(f"Upload failed for {user_image_name}: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to upload to MinIO: {str(e)}")

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to upload user image: {str(e)}")
