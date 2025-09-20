"""
Base Pydantic models for core data structures.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class Node(BaseModel):
    """Represents a life path node/decision point."""

    id: str
    name: str
    description: str
    type: str
    image_name: str
    time: str
    title: str
    created_at: datetime
    user_id: str


class Link(BaseModel):
    """Represents a connection between two nodes."""

    id: Optional[str] = None
    source: str
    target: str
    userId: str


class PersonalInformation(BaseModel):
    """Represents user's personal information and profile."""

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
