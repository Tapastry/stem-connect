# Stem-Connect Backend Quick Start

This guide provides the essential commands to get the backend server running.

### 1. Environment Setup & Dependencies

```bash
# From the project root, create and activate a virtual environment
python3 -m venv backend/venv
source backend/venv/bin/activate

# Install required packages
pip install -r backend/requirements.txt
```

### 2. Configure API Key

Create a file named `.env` in the project's root directory (`stem-connect/.env`) and add your Google AI API key.

```env
GOOGLE_API_KEY="YOUR_GEMINI_API_KEY_HERE"
```

### 3. Start Services

```bash
# Start the PostgreSQL database in the background
docker-compose up -d

# Run the backend server (from the project root)
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```

### 4. Test the Agent

Once the server is running, open a **new terminal** and use this command to test the connection to the interview agent:

```bash
curl -H "Content-Type: application/json" http://localhost:8000/adk/events/123
```

You should see the agent's welcome message stream to your terminal.

### 5. testing the branching logic

You can test the context-aware branching by creating a few nodes in sequence.

**Create the root node:**

```bash
curl -X POST http://localhost:8000/api/nodes \\
-H "Content-Type: application/json" \\
-d '{
    "id": "node-a",
    "user_id": "user-test-summarize",
    "attached_nodes_ids": [],
    "prompt_override": "Generate a starting scenario: A young artist decides to move to a bustling city to pursue their dream."
}'
```

**Create a second node branching from the first:**

```bash
curl -X POST http://localhost:8000/api/nodes \\
-H "Content-Type: application/json" \\
-d '{
    "id": "node-b",
    "user_id": "user-test-summarize",
    "attached_nodes_ids": ["node-a"]
}'
```

**Create a third node to trigger summarization:**

```bash
curl -X POST http://localhost:8000/api/nodes \\
-H "Content-Type: application/json" \\
-d '{
    "id": "node-c",
    "user_id": "user-test-summarize",
    "attached_nodes_ids": ["node-b"]
}'
```
