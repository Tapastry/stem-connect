import base64
import json
import uuid
from typing import AsyncGenerator, Dict, Tuple, Any

from google.adk.agents import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import InMemoryRunner
from google.genai import types
from google.genai.types import Blob, Content, Part, SpeechConfig, VoiceConfig, PrebuiltVoiceConfig, AudioTranscriptionConfig

from .interviewer import agent as interviewer_agent
from .node_maker import agent as node_maker_agent
from .reviewer import reviewer_agent

active_sessions: Dict[str, Tuple[LiveRequestQueue, int]] = {}  # Now stores (queue, message_count)

APP_NAME = "Stem-Connect ADK Integration"

# Agent registry - map of agent names to agent instances
AGENT_MAP = {
    "interviewer_agent": interviewer_agent,
    "node_maker_agent": node_maker_agent,
    "reviewer_agent": reviewer_agent,
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


async def check_interview_completeness(user_id: str, conversation_history: str) -> Dict[str, Any]:
    """
    Check if the interview has gathered enough information using the reviewer agent.
    
    Returns a dictionary with completeness assessment.
    """
    prompt = f"""
    Please analyze this interview conversation and determine if sufficient information has been gathered.
    Return your assessment in JSON format.
    
    Conversation History:
    {conversation_history}
    """
    
    runner = InMemoryRunner(app_name=APP_NAME, agent=reviewer_agent)
    response = await runner.run_one_shot(prompt=prompt)
    
    # Try to parse the JSON response
    try:
        import json
        # Find JSON in the response (it might be wrapped in text)
        response_text = response.output
        json_start = response_text.find('{')
        json_end = response_text.rfind('}') + 1
        if json_start != -1 and json_end > json_start:
            json_str = response_text[json_start:json_end]
            return json.loads(json_str)
    except:
        # If parsing fails, return a default response
        return {
            "is_complete": False,
            "completeness_score": 0.0,
            "reason": "Unable to parse completeness check"
        }


async def get_or_create_session(user_id: str, is_audio: bool = False, force_new: bool = False) -> Tuple[AsyncGenerator, LiveRequestQueue, bool]:
    """Gets existing session or creates new one. Returns (events, queue, is_new_session)"""
    
    # Check if session already exists and we don't want to force a new one
    if user_id in active_sessions and not force_new:
        print(f"Reusing existing session for user: {user_id}")
        old_queue, message_count = active_sessions[user_id]
        # For existing sessions, we need to create a new event stream but keep the queue
        return None, old_queue, False
    
    # Close existing session if it exists
    if user_id in active_sessions:
        old_queue, _ = active_sessions[user_id]
        old_queue.close()
        del active_sessions[user_id]
        print(f"Closed existing session for user: {user_id}")

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

    # response modality and speech configuration
    modality = "AUDIO" if is_audio else "TEXT"
    
    # Configure speech for voice responses
    speech_config = None
    if is_audio:
        speech_config = SpeechConfig(
            voice_config=VoiceConfig(
                prebuilt_voice_config=PrebuiltVoiceConfig(
                    voice_name="Aoede"  # A pleasant, natural-sounding voice
                )
            )
        )
    
    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI if is_audio else StreamingMode.SSE,
        response_modalities=[modality],
        speech_config=speech_config,
        output_audio_transcription=AudioTranscriptionConfig() if is_audio else None,
        input_audio_transcription=AudioTranscriptionConfig() if is_audio else None,
        # Removed session_resumption to prevent duplicate messages during reconnection
        # session_resumption=types.SessionResumptionConfig(),
    )
    
    print(f"🔧 RunConfig created - streaming_mode: {run_config.streaming_mode}, session_resumption: disabled")

    live_request_queue = LiveRequestQueue()

    # Start the agent session
    live_events = runner.run_live(
        session=session,
        live_request_queue=live_request_queue,
        run_config=run_config,
    )

    # Store the request queue and message count for this user
    active_sessions[user_id] = (live_request_queue, 0)
    print(f"ADK session started for user: {user_id} with audio={'enabled' if is_audio else 'disabled'}")
    print(f"Active sessions after creation: {list(active_sessions.keys())}")

    return live_events, live_request_queue, True


async def start_agent_session(user_id: str, is_audio: bool = False) -> Tuple[AsyncGenerator, LiveRequestQueue]:
    """Starts an agent session for a given user (legacy method for backward compatibility)."""
    print(f"🚨 [SESSION DEBUG] start_agent_session called for user: {user_id}, is_audio: {is_audio}")
    print(f"🚨 [SESSION DEBUG] Current active sessions: {list(active_sessions.keys())}")
    
    live_events, live_request_queue, is_new = await get_or_create_session(user_id, is_audio, force_new=True)
    
    print(f"🚨 [SESSION DEBUG] Session creation result - is_new: {is_new}")
    
    # Only send initial prompt if this is truly a new conversation
    message_count = active_sessions.get(user_id, (None, 0))[1]
    should_send_initial = is_new and message_count == 0
    
    print(f"🚨 [SESSION DEBUG] Should send initial prompt: {should_send_initial} (is_new: {is_new}, message_count: {message_count})")
    
    if should_send_initial:
        # Send an initial prompt to the agent to start the conversation
        initial_prompt = "Hello! Please introduce yourself and start the interview."
        if is_audio:
            initial_prompt += " The user will be speaking to you via voice."
        
        initial_content = Content(role="user", parts=[Part.from_text(text=initial_prompt)])
        live_request_queue.send_content(content=initial_content)
        print(f"🚨 [SESSION DEBUG] INITIAL PROMPT SENT TO AGENT - this will cause 'Hi there!' message")
    else:
        print(f"🚨 [SESSION DEBUG] No initial prompt sent - conversation already started")

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
                # Debug audio data
                print(f"[AUDIO DEBUG] Raw audio data: {len(audio_data)} bytes")
                
                # According to ADK docs, Gemini Live API outputs 24kHz 16-bit PCM
                sample_count = len(audio_data) // 2  # 16-bit = 2 bytes per sample
                duration_ms = (sample_count / 24000) * 1000  # 24kHz sample rate
                print(f"[AUDIO DEBUG] Samples: {sample_count}, Duration: {duration_ms:.1f}ms @ 24kHz")
                
                message = {
                    "mime_type": "audio/pcm",
                    "data": base64.b64encode(audio_data).decode("ascii"),
                    "sample_rate": 24000,  # Add sample rate info
                    "sample_count": sample_count,
                    "duration_ms": round(duration_ms, 1)
                }
                yield f"data: {json.dumps(message)}\n\n"
                print(f"[AGENT TO CLIENT]: audio/pcm: {len(audio_data)} bytes, {sample_count} samples @ 24kHz")
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


def send_message_to_agent(user_id: str, mime_type: str, data: str) -> Dict[str, Any]:
    """
    Sends a message from the client to the agent.
    Returns info about the session including message count.
    """
    print(f"[SEND MESSAGE] User: {user_id}, Type: {mime_type}, Active sessions: {list(active_sessions.keys())}")
    
    session_data = active_sessions.get(user_id)
    if not session_data:
        print(f"[ERROR] Session not found for user {user_id}. Active sessions: {list(active_sessions.keys())}")
        raise ValueError(f"Session not found for user {user_id}. Please refresh and try again.")
    
    live_request_queue, message_count = session_data

    if mime_type == "text/plain":
        content = Content(role="user", parts=[Part.from_text(text=data)])
        live_request_queue.send_content(content=content)
        message_count += 1
        print(f"[CLIENT TO AGENT]: {data}")
    elif mime_type == "audio/pcm":
        decoded_data = base64.b64decode(data)
        
        # Debug input audio
        sample_count = len(decoded_data) // 2  # 16-bit = 2 bytes per sample
        duration_ms = (sample_count / 16000) * 1000  # Input is 16kHz
        print(f"[AUDIO DEBUG] Input audio: {len(decoded_data)} bytes, {sample_count} samples @ 16kHz, {duration_ms:.1f}ms")
        
        live_request_queue.send_realtime(Blob(data=decoded_data, mime_type=mime_type))
        message_count += 1
        print(f"[CLIENT TO AGENT]: audio/pcm: {len(decoded_data)} bytes")
    else:
        raise ValueError(f"Mime type not supported: {mime_type}")
    
    # Update the session with new message count
    active_sessions[user_id] = (live_request_queue, message_count)
    
    return {
        "message_count": message_count,
        "should_check_completeness": message_count >= 8 and message_count % 2 == 0  # Check every 2 messages after 8
    }
