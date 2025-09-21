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
from google.genai.types import (
    AudioTranscriptionConfig,
    Blob,
    Content,
    Part,
    PrebuiltVoiceConfig,
    SpeechConfig,
    VoiceConfig,
)
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
from dotenv import load_dotenv

load_dotenv()

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
if GEMINI_API_KEY:
    genai.configure(api_key=GEMINI_API_KEY)
    image_model = genai.GenerativeModel("gemini-1.5-flash")

# Agent registry
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
    selected_agent = get_agent(agent_type)
    session_id = str(uuid.uuid4())
    runner = InMemoryRunner(app_name=APP_NAME, agent=selected_agent)
    session = await runner.session_service.create_session(app_name=APP_NAME, user_id=session_id)
    modality = "AUDIO" if is_audio else "TEXT"
    run_config = RunConfig(response_modalities=[modality])
    live_request_queue = LiveRequestQueue()
    live_events = runner.run_live(session=session, live_request_queue=live_request_queue, run_config=run_config)
    initial_content = Content(role="user", parts=[Part.from_text(text=prompt)])
    live_request_queue.send_content(content=initial_content)
    return live_events, live_request_queue


async def check_interview_completeness(
    user_id: str, conversation_history: List[Dict[str, str]]
) -> Dict[str, Any]:
    """Check if the interview has gathered enough information using the reviewer agent."""
    conversation_str = "\n".join(
        [f"{msg['role'].upper()}: {msg['content']}" for msg in conversation_history]
    )
    
    try:
        runner = InMemoryRunner(app_name=APP_NAME, agent=reviewer_agent)
        session = await runner.session_service.create_session(
            app_name=APP_NAME,
            user_id=f"reviewer_{user_id}_{uuid.uuid4().hex[:8]}"
        )
        user_content = types.Content(
            role='user', 
            parts=[types.Part(text=conversation_str)]
        )
        
        full_response = ""
        async for event in runner.run_async(
            user_id=session.user_id,
            session_id=session.session_id,
            new_message=user_content
        ):
            if event.is_final_response() and event.content and event.content.parts:
                full_response = event.content.parts[0].text
                break
        
        cleaned_response = full_response.strip()
        if cleaned_response.startswith("```json"):
            cleaned_response = cleaned_response.replace("```json", "").replace("```", "").strip()
        
        response_data = json.loads(cleaned_response)

        if response_data.get("is_complete"):
            personal_info_data = {
                "bio": response_data.get("bio", ""),
                "goal": response_data.get("goal", ""),
                "location": response_data.get("location", ""),
                "interests": response_data.get("interests", ""),
                "skills": response_data.get("skills", ""),
                "title": response_data.get("title", ""),
            }
            return {"is_complete": True, "personal_info_data": personal_info_data}
        else:
            suggested_questions = response_data.get("suggested_questions", [])
            if suggested_questions:
                await send_followup_questions_to_interviewer(user_id, suggested_questions)
            
            return {
                "is_complete": False, 
                "reason": response_data.get("reason", "Unknown"),
                "suggested_questions": suggested_questions
            }

    except json.JSONDecodeError as e:
        return {"error": "Failed to decode JSON from reviewer agent", "raw_response": full_response}
    except Exception as e:
        return {"error": f"An unexpected error occurred: {e}"}


async def send_followup_questions_to_interviewer(user_id: str, suggested_questions: List[str]):
    """Send follow-up questions to the interviewer agent to continue the conversation."""
    if user_id not in active_sessions:
        return
    
    live_request_queue, message_count = active_sessions[user_id]
    
    questions_text = "\n".join([f"- {q}" for q in suggested_questions])
    guidance_prompt = f"""
The reviewer has identified that more information is needed. Please ask one of these follow-up questions:

{questions_text}

Choose the most appropriate question and ask it naturally.
"""
    
    guidance_content = Content(role="user", parts=[Part.from_text(text=guidance_prompt)])
    live_request_queue.send_content(content=guidance_content)
    active_sessions[user_id] = (live_request_queue, message_count + 1)


async def get_or_create_session(user_id: str, is_audio: bool = False, force_new: bool = False) -> Tuple[AsyncGenerator, LiveRequestQueue, bool]:
    """Gets existing session or creates new one."""
    if user_id in active_sessions and not force_new:
        old_queue, message_count = active_sessions[user_id]
        return None, old_queue, False
    
    if user_id in active_sessions:
        old_queue, _ = active_sessions[user_id]
        old_queue.close()
        del active_sessions[user_id]

    runner = InMemoryRunner(app_name=APP_NAME, agent=interviewer_agent)
    session = await runner.session_service.create_session(app_name=APP_NAME, user_id=user_id)
    modality = "AUDIO" if is_audio else "TEXT"
    
    speech_config = None
    if is_audio:
        speech_config = SpeechConfig(
            voice_config=VoiceConfig(
                prebuilt_voice_config=PrebuiltVoiceConfig(voice_name="Aoede")
            )
        )
    
    run_config = RunConfig(
        streaming_mode=StreamingMode.BIDI if is_audio else StreamingMode.SSE,
        response_modalities=[modality],
        speech_config=speech_config,
        output_audio_transcription=AudioTranscriptionConfig() if is_audio else None,
        input_audio_transcription=AudioTranscriptionConfig() if is_audio else None,
    )
    
    live_request_queue = LiveRequestQueue()
    live_events = runner.run_live(
        session=session,
        live_request_queue=live_request_queue,
        run_config=run_config,
    )
    active_sessions[user_id] = (live_request_queue, 0)
    return live_events, live_request_queue, True


async def start_agent_session(user_id: str, is_audio: bool = False) -> Tuple[AsyncGenerator, LiveRequestQueue]:
    """Starts an agent session for a given user."""
    live_events, live_request_queue, is_new = await get_or_create_session(user_id, is_audio, force_new=True)
    
    message_count = active_sessions.get(user_id, (None, 0))[1]
    should_send_initial = is_new and message_count == 0
    
    if should_send_initial:
        initial_prompt = "Hello! Please introduce yourself and start the interview."
        if is_audio:
            initial_prompt += " The user will be speaking to you via voice."
        
        initial_content = Content(role="user", parts=[Part.from_text(text=initial_prompt)])
        live_request_queue.send_content(content=initial_content)

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
    events_config = []
    for i in range(num_nodes):
        event_time = time_in_months if time_in_months > 0 else random.randint(1, 24)
        event_positivity = positivity if positivity >= 0 else random.randint(0, 100)
        events_config.append({"time_months": event_time, "positivity": event_positivity})

    try:
        context_parts = []
        if prior_nodes:
            context_parts.append("Life story so far:")
            for i, node in enumerate(prior_nodes):
                if hasattr(node, "name"):
                    node_name = node.name
                    node_desc = node.description
                else:
                    node_name = node.get("name", node.get("id", f"Node {i + 1}"))
                    node_desc = node.get("description", f"Life event: {node_name}")
                context_parts.append(f"{i + 1}. {node_name}: {node_desc}")
        context_str = "\n".join(context_parts) if context_parts else "Starting a new life journey."

        # Build prompt details
        positivity_guidance = ""
        if positivity >= 0:
            if positivity <= 30: positivity_guidance = "All events should be challenging."
            elif positivity <= 70: positivity_guidance = "All events should be neutral or mixed."
            else: positivity_guidance = "All events should be positive."
        else: positivity_guidance = "Mix positive, neutral, and challenging events."
        time_guidance = f"All events should occur around {time_in_months} months from now." if time_in_months > 0 else "Events can occur at different timeframes (1-24 months)."
        node_type_guidance = f"The events should be related to: {node_type}" if node_type else ""

        adk_prompt = f"{context_str}\n\nGenerate {num_nodes} different realistic life events. Make each unique.\n\n{time_guidance}\n{positivity_guidance}\n{node_type_guidance}\n\nUser's context: {prompt}"
        response_text = await generate_node_response(adk_prompt, "node_maker_agent")

        try:
            start_idx = response_text.find("[")
            end_idx = response_text.rfind("]") + 1
            if start_idx >= 0 and end_idx > start_idx:
                json_str = response_text[start_idx:end_idx]
                events = json.loads(json_str)
                if len(events) >= num_nodes:
                    selected_events = events[:num_nodes]
                    image_tasks = [generate_event_image(user_id=user_id, event_name=event["name"], event_description=event["description"]) for event in selected_events]
                    image_results = await asyncio.gather(*image_tasks, return_exceptions=True)
                    for i, (event, result) in enumerate(zip(selected_events, image_results)):
                        if isinstance(result, Exception):
                            event["image_name"] = ""
                            event["image_url"] = ""
                        else:
                            image_filename, signed_url = result
                            event["image_name"] = image_filename
                            event["image_url"] = signed_url
                    return selected_events
        except (json.JSONDecodeError, ValueError) as e:
            pass # Fallback below
    except Exception as e:
        pass # Fallback below
    
    # Fallback
    return [{"name": f"Event {i + 1}", "title": f"Life Event {i + 1}", "description": "A significant life event.", "type": "fallback", "time_months": events_config[i]["time_months"], "positivity_score": events_config[i]["positivity"]} for i in range(num_nodes)]

def get_permanent_image_url(bucket_name: str, object_name: str) -> str:
    """Generate a permanent signed URL for MinIO object."""
    try:
        return minio_client.presigned_get_object(bucket_name=bucket_name, object_name=object_name, expires=timedelta(days=7))
    except S3Error:
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


async def agent_to_client_sse(
    live_events: AsyncGenerator
) -> AsyncGenerator[str, None]:
    """Yields Server-Sent Events from the agent's live events."""
    completion_trigger = "[COMPLETION_SUGGESTED]"
    async for event in live_events:
        if event.turn_complete or event.interrupted:
            message = {"turn_complete": event.turn_complete, "interrupted": event.interrupted}
            yield f"data: {json.dumps(message)}\n\n"
            continue

        part: Part = event.content and event.content.parts and event.content.parts[0]
        if not part:
            continue

        is_audio = part.inline_data and part.inline_data.mime_type.startswith("audio/pcm")
        if is_audio:
            audio_data = part.inline_data.data if part.inline_data else None
            if audio_data:
                sample_count = len(audio_data) // 2
                message = {
                    "mime_type": "audio/pcm",
                    "data": base64.b64encode(audio_data).decode("ascii"),
                    "sample_rate": 24000,
                }
                yield f"data: {json.dumps(message)}\n\n"
                continue

        if part.text:
            cleaned_text = part.text
            completeness_suggested = False
            
            if completion_trigger in cleaned_text:
                cleaned_text = cleaned_text.replace(completion_trigger, "").strip()
                completeness_suggested = True

            if cleaned_text:
                message = {"mime_type": "text/plain", "data": cleaned_text}
                yield f"data: {json.dumps(message)}\n\n"

            if completeness_suggested:
                yield f"data: {json.dumps({'completeness_suggested': True})}\n\n"
        
        function_calls = event.get_function_calls() if hasattr(event, 'get_function_calls') else []
        if function_calls:
            for call in function_calls:
                if call.name == "check_interview_completeness":
                    args = call.args
                    
                    summary_text = (
                        f"A {args.get('user_title', 'person')} based in {args.get('user_location', 'an unknown location')}. "
                        f"Background: {args.get('background_info', 'Not provided')}. "
                        f"Aspirations: {args.get('aspirations_info', 'Not provided')}. "
                        f"Values: {args.get('values_info', 'Not provided')}. "
                        f"Challenges: {args.get('challenges_info', 'Not provided')}."
                    ).strip()
                    
                    personal_info_data = {
                        "summary": summary_text,
                        "background": args.get("background_info", ""),
                        "aspirations": args.get("aspirations_info", ""),
                        "values": args.get("values_info", ""),
                        "challenges": args.get("challenges_info", ""),
                        "bio": summary_text,
                        "goal": args.get("aspirations_info", ""),
                        "location": args.get("user_location", ""),
                        "interests": args.get("user_skills", ""),
                        "skills": args.get("user_skills", ""),
                        "title": args.get("user_title", ""),
                    }
                    
                    yield f"data: {json.dumps({'interview_complete': True, 'personal_info_data': personal_info_data})}\n\n"


def send_message_to_agent(user_id: str, mime_type: str, data: str) -> Dict[str, Any]:
    """Sends a message from the client to the agent."""
    session_data = active_sessions.get(user_id)
    if not session_data:
        raise ValueError(f"Session not found for user {user_id}.")
    
    live_request_queue, message_count = session_data

    if mime_type == "text/plain":
        content = Content(role="user", parts=[Part.from_text(text=data)])
        live_request_queue.send_content(content=content)
        message_count += 1
    elif mime_type == "audio/pcm":
        decoded_data = base64.b64decode(data)
        live_request_queue.send_realtime(Blob(data=decoded_data, mime_type=mime_type))
        message_count += 1
    else:
        raise ValueError(f"Mime type not supported: {mime_type}")
    
    active_sessions[user_id] = (live_request_queue, message_count)
    
    return {
        "message_count": message_count,
        "should_check_completeness": message_count >= 8 and message_count % 2 == 0,
    }
