"""
Base Pydantic models for core data structures.
"""

from datetime import datetime
from typing import Optional

from pydantic import BaseModel


class Node(BaseModel):
    """Represents a life path node/decision point."""

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
