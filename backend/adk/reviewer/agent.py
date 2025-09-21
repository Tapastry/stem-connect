from google.adk.agents import LlmAgent
from typing import List, Dict, Any

# This is the prompt that defines the reviewer agent's behavior
REVIEWER_INSTRUCTION = f"""
You are a helpful assistant that analyzes an interview conversation and extracts key information to populate a user's profile.

Based on the conversation, determine if enough information has been gathered to understand the user's life story. You need to have a good sense of their **background, aspirations, values, and current challenges.**

If the information is sufficient, respond with a JSON object containing the extracted information. The JSON object should have the following fields, populated with relevant data from the conversation:
- "is_complete": true
- "bio": "A 2-3 sentence summary of the user's background, values, and story. This should be a well-written, narrative bio."
- "goal": "A summary of the user's primary goals and aspirations."
- "location": "The user's current or most relevant location (city, state)."
- "interests": "A comma-separated list of keywords representing the user's interests."
- "skills": "A comma-separated list of keywords representing the user's skills."
- "title": "The user's current professional title or role (e.g., 'Software Engineer')."

If the information is NOT sufficient, respond with a JSON object with "is_complete" set to false, a "reason" explaining what is missing, and "suggested_questions" - an array of 1-3 specific follow-up questions the interviewer should ask. For example:
{{
  "is_complete": false,
  "reason": "The conversation has not yet explored the user's goals and aspirations.",
  "suggested_questions": [
    "What are your biggest goals or dreams for the future?",
    "Where do you see yourself in 5 years?",
    "What would success look like to you?"
  ]
}}

Do not add any extra text or explanations outside of the JSON object in your response.
"""


def check_interview_completeness(conversation_history: str) -> Dict[str, Any]:
    """
    Tool function to check if the interview has gathered sufficient information.
    
    Args:
        conversation_history: The full conversation history between interviewer and user
        
    Returns:
        A dictionary with completeness assessment including:
        - is_complete: Whether the interview has enough information
        - completeness_score: A score from 0-1 indicating completeness
        - areas_covered: List of topics successfully covered
        - missing_areas: List of topics that still need exploration
        - reason: Explanation of the assessment
    """
    # This will be called by the agent and the agent's LLM will do the actual analysis
    # The function signature is what the agent uses to understand what tool to use
    return {
        "is_complete": False,
        "completeness_score": 0.0,
        "areas_covered": [],
        "missing_areas": [],
        "reason": "Analysis pending"
    }


class ReviewerAgent(LlmAgent):
    """An agent designed to review interview completeness and determine when to finish."""
    
    def __init__(self, **kwargs):
        super().__init__(
            instruction=REVIEWER_INSTRUCTION,
            **kwargs,
        )


# Instantiate the agent so we can import it elsewhere
reviewer_agent = ReviewerAgent(
    name="reviewer_agent",
    description="An agent that reviews interview conversations to determine completeness",
    model="gemini-2.0-flash-exp",
)
