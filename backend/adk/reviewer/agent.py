from google.adk.agents import LlmAgent
from typing import List, Dict, Any

# This is the prompt that defines the reviewer agent's behavior
REVIEWER_INSTRUCTION = """
You are an Interview Completeness Reviewer. Your role is to analyze interview conversations and determine if sufficient information has been gathered to create a meaningful life path visualization.

Your task is to:
1. **Analyze the conversation history** to determine completeness
2. **Check for key information areas** that should be covered
3. **Return a structured assessment** of the interview state

Key areas to check for a complete interview:
- Personal background (childhood, family, education basics)
- Current situation (work/studies, relationships, living situation)
- Goals and aspirations (short-term and long-term)
- Values and what matters most to the person
- Major life decisions or crossroads they're facing
- Challenges or obstacles they're dealing with
- At least 3-5 meaningful life events or experiences

IMPORTANT: Return your assessment in the following JSON format:
{
  "is_complete": boolean,
  "completeness_score": float (0.0 to 1.0),
  "areas_covered": ["list", "of", "covered", "areas"],
  "missing_areas": ["list", "of", "missing", "areas"],
  "reason": "Brief explanation of your assessment",
  "suggested_next_questions": ["optional", "follow-up", "questions"] 
}

Be reasonable - you don't need exhaustive detail on every area, but should have enough substance to create a meaningful visualization of their life path.
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
