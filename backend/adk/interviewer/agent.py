from google.adk.agents import LlmAgent
import json
from typing import Dict, Any

# Function tool for the interviewer to check completeness
def check_interview_completeness(
    background_info: str,
    aspirations_info: str, 
    values_info: str,
    challenges_info: str,
    user_location: str = "",
    user_skills: str = "",
    user_title: str = ""
) -> dict:
    """
    Call this function when you believe you have gathered enough information about the user's life story.
    
    Args:
        background_info: Summary of the user's background, upbringing, and life experiences
        aspirations_info: Summary of the user's goals, dreams, and future aspirations  
        values_info: Summary of the user's core values and principles
        challenges_info: Summary of the current challenges or obstacles they face
        user_location: The user's current location (city, state)
        user_skills: Comma-separated list of the user's skills
        user_title: The user's current job title or role
        
    Returns:
        dict: Confirmation that the interview data has been processed
    """
    # This will trigger the completion process
    return {
        "status": "complete",
        "message": "Interview data has been captured and will be processed for visualization."
    }

# This is the prompt that defines the interviewer agent's behavior
AGENT_INSTRUCTION = """
You are a friendly and empathetic interviewer conducting a "life path interview." 
Your goal is to have a natural, voice-based conversation to understand the user's story.

- Start by introducing yourself and explaining the purpose of the interview.
- Ask open-ended questions about their background, aspirations, values, and challenges.
- Listen attentively and acknowledge their responses before moving on.
- Maintain a warm and encouraging tone.
- Keep your responses concise and conversational.

The key areas you need to cover are:
- Background: Where they grew up, education, life experiences
- Aspirations: Goals, dreams, future plans
- Values: Core principles that guide their decisions  
- Challenges: Current obstacles or difficulties they face
- Location: Where they currently live/work
- Skills: Their abilities and expertise
- Title: Their current job or role

**CRITICAL INSTRUCTION**: 
Once you have gathered information about ALL the key areas listed above (background, aspirations, values, challenges, location, skills, and title), you MUST call the `check_interview_completeness` function tool to finalize the interview.

Before ending the conversation with phrases like "That concludes our interview" or "I have gathered enough information", ALWAYS call the function tool FIRST.

To call the tool, extract and summarize the key information:
- background_info: Summarize their background and life experiences
- aspirations_info: Summarize their goals and future plans
- values_info: Summarize their core values
- challenges_info: Summarize their current challenges
- user_location: Their current city and state
- user_skills: Comma-separated list of their skills
- user_title: Their current job title or role

DO NOT say goodbye or conclude the interview without calling this function!
"""


class InterviewerAgent(LlmAgent):
    """An agent designed to interview the user about their life path."""

    def __init__(self, **kwargs):
        super().__init__(
            instruction=AGENT_INSTRUCTION,
            **kwargs,
        )


# Instantiate the agent so we can import it elsewhere.
agent = InterviewerAgent(
    name="interviewer_agent",
    description="A compassionate agent that interviews users to build a personal prompt for life path visualization.",
    model="gemini-2.0-flash-exp",
    tools=[check_interview_completeness],  # Add the completion tool
)

# A simple agent whose only job is to summarize text.
summarizer_agent = LlmAgent(
    name="summarizer_agent",
    description="An agent that takes a series of events and summarizes them into a concise narrative.",
    instruction="You are a summarization expert. Take the following series of life events and condense them into a brief, coherent paragraph. Focus on the key decisions and outcomes.",
    model="gemini-2.0-flash-exp",
)
