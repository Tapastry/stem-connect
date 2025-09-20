import base64
import json
from typing import Dict, Tuple, AsyncGenerator

from google.adk.agents import LiveRequestQueue
from google.adk.agents.run_config import RunConfig
from google.adk.runners import InMemoryRunner
from google.genai import types
from google.genai.types import Blob, Content, Part

from .interviewer_agent import agent as interviewer_agent

active_sessions: Dict[str, LiveRequestQueue] = {}

APP_NAME = "Stem-Connect ADK Integration"


async def start_agent_session(
    user_id: str, is_audio: bool = False
) -> Tuple[AsyncGenerator, LiveRequestQueue]:
    """Starts an agent session for a given user."""

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
        part: Part = (
            event.content and event.content.parts and event.content.parts[0]
        )
        if not part:
            continue

        # Handle audio data
        is_audio = part.inline_data and part.inline_data.mime_type.startswith(
            "audio/pcm"
        )
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
        live_request_queue.send_realtime(
            Blob(data=decoded_data, mime_type=mime_type)
        )
        print(f"[CLIENT TO AGENT]: audio/pcm: {len(decoded_data)} bytes")
    else:
        raise ValueError(f"Mime type not supported: {mime_type}")
