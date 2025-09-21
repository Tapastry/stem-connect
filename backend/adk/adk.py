import asyncio
import base64
import io
import json
import mimetypes
import os
import random
import uuid
from datetime import datetime, timedelta
from typing import Any, AsyncGenerator, Dict, List, Tuple

import google.generativeai as genai
from google import genai as google_genai
from google.adk.agents import LiveRequestQueue
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import InMemoryRunner
from google.genai import types
from google.genai.types import AudioTranscriptionConfig, Blob, Content, Part, PrebuiltVoiceConfig, SpeechConfig, VoiceConfig
from minio import Minio
from minio.error import S3Error

from .interviewer import agent as interviewer_agent
from .node_maker import agent as node_maker_agent
from .reviewer import reviewer_agent

active_sessions: Dict[str, Tuple[LiveRequestQueue, int]] = {}  # Now stores (queue, message_count)

APP_NAME = "Stem-Connect ADK Integration"

# Initialize MinIO client
MINIO_ENDPOINT = os.getenv("MINIO_ENDPOINT", "localhost:9000")
MINIO_ACCESS_KEY = os.getenv("MINIO_ACCESS_KEY", "admin")
MINIO_SECRET_KEY = os.getenv("MINIO_SECRET_KEY", "password123")
MINIO_SECURE = os.getenv("MINIO_SECURE", "false").lower() == "true"

minio_client = Minio(
    MINIO_ENDPOINT,
    access_key=MINIO_ACCESS_KEY,
    secret_key=MINIO_SECRET_KEY,
    secure=MINIO_SECURE,
)

# Initialize Gemini for image generation
# Load environment variables
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
print(f"🔑 [IMAGE GEN] GEMINI_API_KEY loaded: {'Yes' if GEMINI_API_KEY else 'No'}")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    image_model = genai.GenerativeModel("gemini-2.5-flash")
    print(f"✅ [IMAGE GEN] Gemini configured successfully")

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
        json_start = response_text.find("{")
        json_end = response_text.rfind("}") + 1
        if json_start != -1 and json_end > json_start:
            json_str = response_text[json_start:json_end]
            return json.loads(json_str)
    except:
        # If parsing fails, return a default response
        return {"is_complete": False, "completeness_score": 0.0, "reason": "Unable to parse completeness check"}


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


async def generate_life_events_with_adk(prior_nodes: List, prompt: str, node_type: str, time_in_months: int, positivity: int, num_nodes: int, user_id: str) -> List[dict]:
    """Generate life events using the node_maker agent through ADK."""

    # Handle random values for each event (define outside try block)
    events_config = []
    for i in range(num_nodes):
        event_time = time_in_months if time_in_months > 0 else random.randint(1, 24)
        event_positivity = positivity if positivity >= 0 else random.randint(0, 100)
        events_config.append({"time_months": event_time, "positivity": event_positivity})

    try:
        # Build context from prior nodes
        context_parts = []
        if prior_nodes:
            context_parts.append("Life story so far:")
            for i, node in enumerate(prior_nodes):
                # Handle both Pydantic models and dict objects
                if hasattr(node, "name"):
                    node_name = node.name
                    node_desc = node.description
                else:
                    node_name = node.get("name", node.get("id", f"Node {i + 1}"))
                    node_desc = node.get("description", f"Life event: {node_name}")
                context_parts.append(f"{i + 1}. {node_name}: {node_desc}")

        # Build the prompt
        context_str = "\n".join(context_parts) if context_parts else "Starting a new life journey."

        positivity_guidance = ""
        if positivity >= 0:
            if positivity <= 30:
                positivity_guidance = "All events should be challenging or difficult."
            elif positivity <= 70:
                positivity_guidance = "All events should be neutral or mixed."
            else:
                positivity_guidance = "All events should be positive and favorable."
        else:
            positivity_guidance = "Mix positive, neutral, and challenging events for variety."

        time_guidance = ""
        if time_in_months > 0:
            time_guidance = f"All events should occur around {time_in_months} months from now."
        else:
            time_guidance = "Events can occur at different timeframes (1-24 months) for variety."

        node_type_guidance = f"The events should be related to: {node_type}" if node_type else ""

        adk_prompt = f"""
        {context_str}
        
        Generate {num_nodes} different realistic life events. Make each event unique and diverse - they should represent different possible paths or choices.
        
        {time_guidance}
        {positivity_guidance}
        {node_type_guidance}
        
        User's additional context: {prompt}
        """

        # Use the node_maker agent through ADK
        response_text = await generate_node_response(adk_prompt, "node_maker_agent")

        # Try to parse JSON from the response
        try:
            # Extract JSON array from the response text
            start_idx = response_text.find("[")
            end_idx = response_text.rfind("]") + 1
            if start_idx >= 0 and end_idx > start_idx:
                json_str = response_text[start_idx:end_idx]
                events = json.loads(json_str)
                # Ensure we have the right number of events and generate images
                if len(events) >= num_nodes:
                    selected_events = events[:num_nodes]
                    # Generate images for all events in parallel
                    print(f"🖼️ Starting PARALLEL image generation for {len(selected_events)} events for user {user_id}")

                    # Create parallel tasks for image generation
                    image_tasks = []
                    for event in selected_events:
                        task = generate_event_image(
                            user_id=user_id,
                            event_name=event["name"],
                            event_description=event["description"],
                        )
                        image_tasks.append(task)

                    # Execute all image generation tasks in parallel
                    print(f"⚡ [IMAGE GEN] Running {len(image_tasks)} image generation tasks in parallel...")
                    image_results = await asyncio.gather(*image_tasks, return_exceptions=True)

                    # Process results and assign to events
                    for i, (event, result) in enumerate(zip(selected_events, image_results)):
                        if isinstance(result, Exception):
                            print(f"❌ Failed to generate image for {event['name']}: {result}")
                            event["image_name"] = ""
                            event["image_url"] = ""
                        else:
                            image_filename, signed_url = result
                            event["image_name"] = image_filename
                            event["image_url"] = signed_url
                            print(f"✅ Image generated for {event['name']}: {image_filename}")

                    print(f"🎉 [IMAGE GEN] Parallel image generation completed for {len(selected_events)} events")
                    return selected_events
                else:
                    # Pad with fallback events if not enough generated
                    while len(events) < num_nodes:
                        event_idx = len(events)
                        events.append(
                            {
                                "name": f"Event {event_idx + 1}",
                                "title": f"Generated Life Event {event_idx + 1}",
                                "description": f"A life event that occurs {events_config[event_idx]['time_months']} months from now.",
                                "type": "generated",
                                "time_months": events_config[event_idx]["time_months"],
                                "positivity_score": events_config[event_idx]["positivity"],
                            }
                        )
                    return events
            else:
                raise ValueError("No JSON array found in response")
        except (json.JSONDecodeError, ValueError) as e:
            print(f"Failed to parse ADK response as JSON: {e}")
            print(f"ADK Response: {response_text}")
            # Fallback to generating multiple basic events
            return [
                {
                    "name": f"ADK Event {i + 1}",
                    "title": f"ADK Generated Event {i + 1}",
                    "description": f"Part of ADK response: {response_text[i * 50 : (i + 1) * 50]}..." if i * 50 < len(response_text) else f"Generated event {i + 1}",
                    "type": "adk-generated",
                    "time_months": events_config[i]["time_months"],
                    "positivity_score": events_config[i]["positivity"],
                }
                for i in range(num_nodes)
            ]

    except Exception as e:
        print(f"ADK generation error: {e}")
        # Fallback to basic generation
        return [
            {"name": f"Event {i + 1}", "title": f"Life Event {i + 1}", "description": f"A significant life event occurring {events_config[i]['time_months']} months from the current situation.", "type": "fallback", "time_months": events_config[i]["time_months"], "positivity_score": events_config[i]["positivity"]}
            for i in range(num_nodes)
        ]


def get_permanent_image_url(bucket_name: str, object_name: str) -> str:
    """Generate a permanent signed URL for MinIO object (7 days expiry)."""
    try:
        # Generate a presigned URL that expires in 7 days
        url = minio_client.presigned_get_object(bucket_name=bucket_name, object_name=object_name, expires=timedelta(days=7))
        print(f"🔗 [MINIO] Generated signed URL for {bucket_name}/{object_name}")
        return url
    except S3Error as e:
        print(f"❌ [MINIO] Error generating signed URL: {e}")
        return ""


async def generate_event_image(user_id: str, event_name: str, event_description: str) -> tuple[str, str]:
    """Generate an image for a life event using user's base image as context with Nano Banana."""
    print(f"🖼️ [IMAGE GEN] Starting image generation for event: {event_name}, user: {user_id}")
    try:
        # Ensure buckets exist
        user_bucket = "user-images"
        node_bucket = "node-images"

        for bucket in [user_bucket, node_bucket]:
            try:
                if not minio_client.bucket_exists(bucket):
                    minio_client.make_bucket(bucket)
            except S3Error as e:
                print(f"Error checking/creating bucket {bucket}: {e}")

        # Get user's base image from MinIO
        user_image_name = f"{user_id}.png"
        user_image_data = None

        print(f"🔍 [IMAGE GEN] Looking for base image: {user_bucket}/{user_image_name}")
        try:
            response = minio_client.get_object(user_bucket, user_image_name)
            user_image_data = response.read()
            print(f"✅ [IMAGE GEN] Retrieved base image for user {user_id}: {len(user_image_data)} bytes")
        except S3Error as e:
            print(f"❌ [IMAGE GEN] No base image found for user {user_id}: {e}")
            print(f"🔄 [IMAGE GEN] Will generate image without base image context")

        # Create image prompt based on event
        image_prompt = f"""
        Using this person's image as reference, create a realistic, professional SQUARE image representing this life event: {event_name}
        
        Context: {event_description}
        
        Style: Photorealistic, warm lighting, inspiring and hopeful mood
        Focus: Show this person experiencing or achieving this life milestone
        Composition: Square aspect ratio (1:1), clean, modern, with good depth of field
        Include: Elements that represent the specific life event while maintaining the person's appearance
        
        Make it suitable for a professional life journey visualization. The image must be square format.
        """

        if GEMINI_API_KEY:
            print(f"🤖 [IMAGE GEN] GEMINI_API_KEY found, proceeding with image generation")

            # Initialize Google GenAI client for image generation
            client = google_genai.Client(api_key=GEMINI_API_KEY)

            model = "gemini-2.5-flash-image-preview"
            print(f"📱 [IMAGE GEN] Using model: {model}")

            # Create content with user image as context + text prompt (if base image exists)
            parts = []
            if user_image_data:
                print(f"🖼️ [IMAGE GEN] Adding user base image as context")
                parts.append(
                    types.Part.from_bytes(
                        mime_type="image/png",
                        data=user_image_data,
                    )
                )
            else:
                print(f"⚠️ [IMAGE GEN] No base image, generating without user context")

            parts.append(types.Part.from_text(text=image_prompt))

            contents = [
                types.Content(
                    role="user",
                    parts=parts,
                ),
            ]

            print(f"📝 [IMAGE GEN] Prompt: {image_prompt[:100]}...")
            generate_content_config = types.GenerateContentConfig(
                response_modalities=[
                    "IMAGE",
                    "TEXT",
                ],
            )

            print(f"🚀 [IMAGE GEN] Starting Nano Banana generation for {event_name}...")

            # Generate image using Nano Banana (run in executor for true async)
            def _generate_image_sync():
                chunk_count = 0
                for chunk in client.models.generate_content_stream(
                    model=model,
                    contents=contents,
                    config=generate_content_config,
                ):
                    chunk_count += 1
                    print(f"📦 [IMAGE GEN] Received chunk {chunk_count}")

                    if chunk.candidates is None or chunk.candidates[0].content is None or chunk.candidates[0].content.parts is None:
                        print(f"⚠️ [IMAGE GEN] Chunk {chunk_count} has no content, skipping")
                        continue

                    # Check for image data
                    part = chunk.candidates[0].content.parts[0]
                    if part.inline_data and part.inline_data.data:
                        print(f"🎉 [IMAGE GEN] Found image data in chunk {chunk_count}!")
                        return part.inline_data
                    else:
                        # Handle text response (if any)
                        if hasattr(chunk, "text") and chunk.text:
                            print(f"💬 [IMAGE GEN] Text response: {chunk.text}")
                        else:
                            print(f"🔍 [IMAGE GEN] Chunk {chunk_count} has no image or text data")

                print(f"❌ [IMAGE GEN] No image data received for {event_name} after {chunk_count} chunks")
                return None

            # Run the synchronous generation in a thread pool
            import concurrent.futures

            loop = asyncio.get_event_loop()

            with concurrent.futures.ThreadPoolExecutor() as executor:
                inline_data = await loop.run_in_executor(executor, _generate_image_sync)

            if inline_data:
                data_buffer = inline_data.data
                file_extension = mimetypes.guess_extension(inline_data.mime_type) or ".png"
                print(f"📊 [IMAGE GEN] Image data: {len(data_buffer)} bytes, type: {inline_data.mime_type}")

                # Create filename: {node-name}-{user-id}.png
                safe_event_name = event_name.replace(" ", "-").replace("/", "-").lower()
                image_filename = f"{safe_event_name}-{user_id}{file_extension}"
                print(f"📁 [IMAGE GEN] Target filename: {image_filename}")

                # Upload to MinIO
                try:
                    data_stream = io.BytesIO(data_buffer)
                    minio_client.put_object(node_bucket, image_filename, data_stream, length=len(data_buffer), content_type=inline_data.mime_type)
                    print(f"✅ [IMAGE GEN] Image uploaded to MinIO: {node_bucket}/{image_filename}")

                    # Generate permanent signed URL
                    signed_url = get_permanent_image_url(node_bucket, image_filename)
                    return image_filename, signed_url
                except S3Error as e:
                    print(f"❌ [IMAGE GEN] Error uploading image to MinIO: {e}")
                    return "", ""
            else:
                print(f"❌ [IMAGE GEN] No image data received from Nano Banana for {event_name}")
                return "", ""
        else:
            if not GEMINI_API_KEY:
                print("❌ [IMAGE GEN] No GEMINI_API_KEY found, skipping image generation")
            else:
                print("❌ [IMAGE GEN] No user image data and GEMINI_API_KEY found")
            return "", ""

    except Exception as e:
        print(f"💥 [IMAGE GEN] Error generating image for event {event_name}: {e}")
        import traceback

        traceback.print_exc()
        return "", ""


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
                    "duration_ms": round(duration_ms, 1),
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

        # Validate minimum audio duration to prevent agent confusion
        MIN_DURATION_MS = 800  # Minimum 800ms to match frontend validation
        if duration_ms < MIN_DURATION_MS:
            print(f"[AUDIO WARNING] Audio too short ({duration_ms:.1f}ms < {MIN_DURATION_MS}ms) - cut-off speech like 'hel-' may confuse agent")
            # Still send it, but log the warning

        live_request_queue.send_realtime(Blob(data=decoded_data, mime_type=mime_type))
        message_count += 1
        print(f"[CLIENT TO AGENT]: audio/pcm: {len(decoded_data)} bytes")
    else:
        raise ValueError(f"Mime type not supported: {mime_type}")

    # Update the session with new message count
    active_sessions[user_id] = (live_request_queue, message_count)

    return {
        "message_count": message_count,
        "should_check_completeness": message_count >= 8 and message_count % 2 == 0,  # Check every 2 messages after 8
    }
