"""
Request/Response Pydantic models for API endpoints.
"""

from typing import List, Optional, Dict

from pydantic import BaseModel

from .base import Node, PersonalInformation


class AddNodeRequest(BaseModel):
    """Request model for adding new nodes."""

    user_id: str
    previous_nodes: List[Node]
    clicked_node_id: str
    prompt: str
    num_nodes: int
    time_in_months: int
    node_type: str
    positivity: int


class AddPersonalInformationRequest(BaseModel):
    """Request model for adding personal information."""

    personalInformation: PersonalInformation


class UpdatePersonalInformationRequest(BaseModel):
    """Request model for updating personal information."""

    id: str
    personalInformation: PersonalInformation


class NodeRequest(BaseModel):
    """Request model for node operations."""

    id: Optional[str] = None
    user_id: str
    agent_type: str = "interviewer_agent"
    attached_nodes_ids: Optional[List[str]] = []
    prompt_override: Optional[str] = None  # Allow custom prompts if needed


class NodeResponse(BaseModel):
    """Response model for node operations."""

    id: str
    prompt: str
    output: str
    attached_node_ids: List[str]


class UpdateNodeRequest(BaseModel):
    label: Optional[str] = None
    notes: Optional[str] = None
    completed: Optional[bool] = None


class InterviewCompletenessRequest(BaseModel):
    user_id: str
    conversation_history: List[Dict[str, str]]
