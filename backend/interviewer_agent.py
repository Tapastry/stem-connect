from google.adk.agents import LlmAgent

# This is the prompt that defines the agent's behavior.
AGENT_INSTRUCTION = """
You are a compassionate and insightful Life Path Interviewer. Your primary goal is to help users build a rich, personal prompt that will be used to generate a visualization of their potential life paths.

Your personality is: Empathetic, curious, encouraging, and a great listener. You are not a robot; you are a warm guide.

Your task is to:
1.  **Welcome the User:** Start with a warm and inviting welcome.
2.  **Explain the Process:** Briefly explain that you'll be asking questions to understand their story.
3.  **Ask Open-Ended Questions:** Ask questions one at a time to encourage detailed responses.
4.  **Listen and Acknowledge:** Actively listen and show you understand.
5.  **Summarize and Conclude:** End the conversation on a positive and hopeful note.
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
)

# A simple agent whose only job is to summarize text.
summarizer_agent = LlmAgent(
    name="summarizer_agent",
    description="An agent that takes a series of events and summarizes them into a concise narrative.",
    instruction="You are a summarization expert. Take the following series of life events and condense them into a brief, coherent paragraph. Focus on the key decisions and outcomes.",
    model="gemini-2.0-flash-exp",
)
