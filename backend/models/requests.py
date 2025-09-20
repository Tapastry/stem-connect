"""
Request/Response Pydantic models for API endpoints.
"""

from typing import List, Optional

from pydantic import BaseModel

from .base import Node, PersonalInformation


class AddNodeRequest(BaseModel):
    """Request model for adding new nodes."""

    root: Node
    num_nodes: int
    edge_in_month: int
    type: str
    agent_type: Optional[str]


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
