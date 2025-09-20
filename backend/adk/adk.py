import base64
import json
import uuid
from typing import AsyncGenerator, Dict, Tuple

from google.adk.agents import LiveRequestQueue
from google.adk.agents.run_config import RunConfig
from google.adk.runners import InMemoryRunner
from google.genai import types
from google.genai.types import Blob, Content, Part

from .interviewer import agent as interviewer_agent
from .node_maker import agent as node_maker_agent

active_sessions: Dict[str, LiveRequestQueue] = {}

APP_NAME = "Stem-Connect ADK Integration"

# Agent registry - map of agent names to agent instances
AGENT_MAP = {
    "interviewer_agent": interviewer_agent,
    "node_maker_agent": node_maker_agent,
}


def get_agent(agent_type: str = "interviewer_agent"):
    """Get an agent by type from the agent registry."""
    if agent_type not in AGENT_MAP:
        available_agents = list(AGENT_MAP.keys())
        raise ValueError(f"Agent type '{agent_type}' not found. Available agents: {available_agents}")
    return AGENT_MAP[agent_type]


def get_available_agents() -> list:
    """Get a list of all available agent types."""
    return list(AGENT_MAP.keys())


async def create_one_time_session(prompt: str, agent_type: str = "interviewer_agent", is_audio: bool = False) -> Tuple[AsyncGenerator, LiveRequestQueue]:
    """Creates a one-time session for generating nodes without chat history."""

    # Get the specified agent
    selected_agent = get_agent(agent_type)

    # Generate a unique session ID for this one-time request
    session_id = str(uuid.uuid4())

    # Create a Runner
    runner = InMemoryRunner(
        app_name=APP_NAME,
        agent=selected_agent,
    )

    # Create a fresh session with unique ID
    session = await runner.session_service.create_session(
        app_name=APP_NAME,
        user_id=session_id,
    )

    # response modality
    modality = "AUDIO" if is_audio else "TEXT"
    run_config = RunConfig(
        response_modalities=[modality],
        # No session resumption - each request is independent
    )

    live_request_queue = LiveRequestQueue()

    # Start the agent session
    live_events = runner.run_live(
        session=session,
        live_request_queue=live_request_queue,
        run_config=run_config,
    )

    print(f"One-time ADK session created: {session_id} with agent: {agent_type}")

    # Send the provided prompt directly
    initial_content = Content(role="user", parts=[Part.from_text(text=prompt)])
    live_request_queue.send_content(content=initial_content)
    print(f"[PROMPT SENT TO AGENT ({agent_type})]: {prompt[:100]}...")

    return live_events, live_request_queue


async def start_agent_session(user_id: str, is_audio: bool = False) -> Tuple[AsyncGenerator, LiveRequestQueue]:
    """Starts an agent session for a given user (legacy method for backward compatibility)."""

    # Create a Runner
    runner = InMemoryRunner(
        app_name=APP_NAME,
        agent=interviewer_agent,
    )

    # session maker
    session = await runner.session_service.create_session(
        app_name=APP_NAME,
        user_id=user_id,
    )

    # response modality
    modality = "AUDIO" if is_audio else "TEXT"
    run_config = RunConfig(
        response_modalities=[modality],
        session_resumption=types.SessionResumptionConfig(),
    )

    live_request_queue = LiveRequestQueue()

    # Start the agent session
    live_events = runner.run_live(
        session=session,
        live_request_queue=live_request_queue,
        run_config=run_config,
    )

    # Store the request queue for this user to send messages to the agent later
    active_sessions[user_id] = live_request_queue
    print(f"ADK session started for user: {user_id}")

    # Send an initial prompt to the agent to start the conversation
    initial_content = Content(role="user", parts=[Part.from_text(text="Hello! Please introduce yourself and start the interview.")])
    live_request_queue.send_content(content=initial_content)
    print(f"[INITIAL PROMPT SENT TO AGENT]")

    return live_events, live_request_queue


async def generate_node_response(prompt: str, agent_name: str = "interviewer_agent") -> str:
    """Runs a one-time prompt against a specified agent without maintaining chat history."""
    agent_to_use = AGENT_MAP.get(agent_name)
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
        # If the turn is complete or interrupted, send a status update
        if event.turn_complete or event.interrupted:
            message = {
                "turn_complete": event.turn_complete,
                "interrupted": event.interrupted,
            }
            yield f"data: {json.dumps(message)}\n\n"
            print(f"[AGENT TO CLIENT]: {message}")
            continue

        # Extract the first part of the content
        part: Part = event.content and event.content.parts and event.content.parts[0]
        if not part:
            continue

        # Handle audio data
        is_audio = part.inline_data and part.inline_data.mime_type.startswith("audio/pcm")
        if is_audio:
            audio_data = part.inline_data.data if part.inline_data else None
            if audio_data:
                message = {
                    "mime_type": "audio/pcm",
                    "data": base64.b64encode(audio_data).decode("ascii"),
                }
                yield f"data: {json.dumps(message)}\n\n"
                print(f"[AGENT TO CLIENT]: audio/pcm: {len(audio_data)} bytes.")
                continue

        # Handle partial text data
        if part.text and event.partial:
            message = {"mime_type": "text/plain", "data": part.text}
            yield f"data: {json.dumps(message)}\n\n"
            print(f"[AGENT TO CLIENT]: text/plain: {message}")


async def generate_node_response(prompt: str, agent_type: str = "interviewer_agent") -> str:
    """
    Generates a single response for node creation without maintaining session history.
    Returns the generated text response.
    """
    live_events, live_request_queue = await create_one_time_session(prompt, agent_type)

    response_text = ""

    try:
        async for event in live_events:
            # Extract text from the event
            part = event.content and event.content.parts and event.content.parts[0]
            if part and part.text and not event.partial:
                response_text += part.text

            # If the turn is complete, break
            if event.turn_complete:
                break

    except Exception as e:
        print(f"Error in node generation: {e}")
        raise
    finally:
        # Clean up the session
        live_request_queue.close()

    return response_text.strip()


def send_message_to_agent(user_id: str, mime_type: str, data: str):
    """Sends a message from the client to the agent."""
    live_request_queue = active_sessions.get(user_id)
    if not live_request_queue:
        raise ValueError("Session not found for user")

    if mime_type == "text/plain":
        content = Content(role="user", parts=[Part.from_text(text=data)])
        live_request_queue.send_content(content=content)
        print(f"[CLIENT TO AGENT]: {data}")
    elif mime_type == "audio/pcm":
        decoded_data = base64.b64decode(data)
        live_request_queue.send_realtime(Blob(data=decoded_data, mime_type=mime_type))
        print(f"[CLIENT TO AGENT]: audio/pcm: {len(decoded_data)} bytes")
    else:
        raise ValueError(f"Mime type not supported: {mime_type}")
