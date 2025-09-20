from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import uuid


class PersonalInformation(BaseModel):
    """Represents a user's professional profile information."""

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
    createdAt: datetime = datetime.now()
    updatedAt: datetime = datetime.now()


# Models for the chat interaction
class ChatMessage(BaseModel):
    """Represents a single message in the chat history."""
    role: str  # "user" or "agent"
    content: str

class InterviewState(BaseModel):
    """Represents the current state of the interview conversation."""
    userId: str
    history: List[ChatMessage] = []
    collected_data: PersonalInformation
