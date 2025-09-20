"""
ADK (Agent Development Kit) module for STEM Connect.

This module provides Google ADK integration for the life path simulation app,
including agent session management and communication handlers.
"""

from .adk import AGENT_MAP, APP_NAME, active_sessions, agent_to_client_sse, create_one_time_session, generate_node_response, get_agent, get_available_agents, send_message_to_agent, start_agent_session
from .interviewer import AGENT_INSTRUCTION as INTERVIEWER_INSTRUCTION
from .interviewer import InterviewerAgent
from .interviewer import agent as interviewer_agent
from .node_maker import AGENT_INSTRUCTION as NODE_MAKER_INSTRUCTION
from .node_maker import NodeMakerAgent
from .node_maker import agent as node_maker_agent

__all__ = [
    # Main ADK functions
    "start_agent_session",
    "agent_to_client_sse",
    "send_message_to_agent",
    "active_sessions",
    "APP_NAME",
    # One-time session functions (no chat history)
    "create_one_time_session",
    "generate_node_response",
    # Agent management
    "AGENT_MAP",
    "get_agent",
    "get_available_agents",
    # Interviewer Agent
    "InterviewerAgent",
    "interviewer_agent",
    "INTERVIEWER_INSTRUCTION",
    # Node Maker Agent
    "NodeMakerAgent",
    "node_maker_agent",
    "NODE_MAKER_INSTRUCTION",
]
