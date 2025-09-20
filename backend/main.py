import os
import uuid
from dataclasses import Field
from datetime import datetime
from typing import List, Optional

import uvicorn
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

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


class AddPersonalInformationRequest(BaseModel):
    personalInformation: PersonalInformation


class UpdatePersonalInformationRequest(BaseModel):
    id: str
    personalInformation: PersonalInformation


# Generate a Node with ADK, Insert to database, and return the node
@app.post("/api/add-node")
async def add_node(request: AddNodeRequest):
    # add nodes to database
    return {"message": "Node added successfully"}

# Add user information gathered on interview screen to database
@app.post("/api/add-personal-information")
async def add_personal_information(request: AddPersonalInformationRequest):
    # add personal information to database
    return {"message": "Personal information added successfully"}

# Update user information gathered on interview screen to database
@app.put("/api/update-personal-information")
async def update_personal_information(request: UpdatePersonalInformationRequest):
    # update personal information in database
    return {"message": "Personal information updated successfully"}

# Get user information gathered on interview screen from database
@app.get("/api/personal-information/{user_id}")
async def get_personal_information(user_id: str):
    # get personal information for user
    return {"message": f"Personal information for user {user_id}"}

# Get all nodes for user from database
@app.get("/api/nodes/{user_id}")
async def get_nodes(user_id: str):
    # get all nodes for user
    return {"message": f"Nodes for user {user_id}"}

# Get all links for user from database
@app.get("/api/links/{user_id}")
async def get_links(user_id: str):
    # get all links for user
    return {"message": f"Links for user {user_id}"}
