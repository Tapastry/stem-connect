"""
Node Maker Agent Module.

This module contains the node maker agent for generating life path scenarios and decision nodes.
"""

from .agent import AGENT_INSTRUCTION, NodeMakerAgent, agent

__all__ = [
    "NodeMakerAgent",
    "agent",
    "AGENT_INSTRUCTION",
]
