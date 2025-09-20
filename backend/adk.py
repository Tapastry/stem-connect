import base64
import json
from typing import Dict, Tuple, AsyncGenerator

from google.adk.agents import LiveRequestQueue
from google.adk.agents.run_config import RunConfig
from google.adk.runners import InMemoryRunner
from google.genai import types
from google.genai.types import Blob, Content, Part

from .interviewer_agent import agent as interviewer_agent
from .interviewer_agent import summarizer_agent

# A dictionary to store all available agents
AVAILABLE_AGENTS = {
    "interviewer_agent": interviewer_agent,
    "summarizer_agent": summarizer_agent,
}

# A dictionary to store active agent sessions
active_sessions: Dict[str, LiveRequestQueue] = {}

APP_NAME = "Stem-Connect ADK Integration"


async def start_agent_session(
    user_id: str, is_audio: bool = False
) -> Tuple[AsyncGenerator, LiveRequestQueue]:
    """Starts a chat session with the main interviewer agent."""
    runner = InMemoryRunner(app_name=APP_NAME, agent=interviewer_agent)
    session = await runner.session_service.create_session(app_name=APP_NAME, user_id=user_id)
    modality = "AUDIO" if is_audio else "TEXT"
    run_config = RunConfig(
        response_modalities=[modality],
        session_resumption=types.SessionResumptionConfig(),
    )
    live_request_queue = LiveRequestQueue()
    live_events = runner.run_live(
        session=session,
        live_request_queue=live_request_queue,
        run_config=run_config,
    )
    active_sessions[user_id] = live_request_queue
    print(f"ADK session started for user: {user_id}")
    # Send an initial prompt to start the conversation
    initial_content = Content(role="user", parts=[Part.from_text(text="Hello! Please introduce yourself and start the interview.")])
    live_request_queue.send_content(content=initial_content)
    return live_events, live_request_queue


async def generate_node_response(prompt: str, agent_name: str = "interviewer_agent") -> str:
    """Runs a one-time prompt against a specified agent without maintaining chat history."""
    agent_to_use = AVAILABLE_AGENTS.get(agent_name)
    if not agent_to_use:
        raise ValueError(f"Agent '{agent_name}' not found.")
        
    runner = InMemoryRunner(app_name=APP_NAME, agent=agent_to_use)
    response = await runner.run_one_shot(prompt=prompt)
    return response.output


async def summarize_path_history(history: list[str]) -> str:
    """Uses the summarizer agent to condense a list of historical events."""
    if not history:
        return ""
    
    prompt = "Please summarize the following life events into a short paragraph:\\n\\n" + "\\n".join(history)
    summary = await generate_node_response(prompt, agent_name="summarizer_agent")
    return summary


async def agent_to_client_sse(live_events: AsyncGenerator):
    """Yields Server-Sent Events from the agent's live events."""
    async for event in live_events:
        if event.turn_complete or event.interrupted:
            message = {"turn_complete": event.turn_complete, "interrupted": event.interrupted}
            yield f"data: {json.dumps(message)}\n\n"
            continue
        part: Part = event.content and event.content.parts and event.content.parts[0]
        if not part:
            continue
        if part.text:
            message = {"mime_type": "text/plain", "data": part.text}
            yield f"data: {json.dumps(message)}\n\n"


def send_message_to_agent(user_id: str, mime_type: str, data: str):
    """Sends a message from the client to the agent."""
    live_request_queue = active_sessions.get(user_id)
    if not live_request_queue:
        raise ValueError("Session not found for user")
    if mime_type == "text/plain":
        content = Content(role="user", parts=[Part.from_text(text=data)])
        live_request_queue.send_content(content=content)
    else:
        raise ValueError(f"Mime type not supported: {mime_type}")


def get_available_agents():
    """Returns a list of available agent names."""
    return list(AVAILABLE_AGENTS.keys())
