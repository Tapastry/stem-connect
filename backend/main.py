import os
from datetime import datetime
from typing import List, Optional

import uvicorn
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel

# Initialize FastAPI app
app = FastAPI(title="STEM Connect API", description="A FastAPI backend for STEM Connect application", version="1.0.0", docs_url="/docs", redoc_url="/redoc")

# CORS middleware for frontend communication
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],  # Next.js default ports
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security
security = HTTPBearer()


# Pydantic models
class UserResponse(BaseModel):
    id: str
    name: str
    email: str
    created_at: datetime


class PostCreate(BaseModel):
    title: str
    content: str
    author_id: str


class PostResponse(BaseModel):
    id: str
    title: str
    content: str
    author_id: str
    created_at: datetime


class HealthResponse(BaseModel):
    status: str
    timestamp: datetime
    version: str


# In-memory storage (replace with database in production)
users_db = {}
posts_db = {}
post_counter = 0


# Dependency to get current user (mock implementation)
async def get_current_user(credentials: HTTPAuthorizationCredentials = Depends(security)):
    # In a real app, you'd validate the JWT token here
    # For now, we'll just return a mock user
    if not credentials:
        raise HTTPException(status_code=401, detail="Not authenticated")

    # Mock user data - replace with actual JWT validation
    return {"id": "user_123", "name": "John Doe", "email": "john@example.com"}


# Root endpoint
@app.get("/", response_model=dict)
async def root():
    return {"message": "Welcome to STEM Connect API", "docs": "/docs", "health": "/health"}


# Health check endpoint
@app.get("/health", response_model=HealthResponse)
async def health_check():
    return HealthResponse(status="healthy", timestamp=datetime.now(), version="1.0.0")


# User endpoints
@app.get("/users/me", response_model=UserResponse)
async def get_current_user_info(current_user: dict = Depends(get_current_user)):
    return UserResponse(id=current_user["id"], name=current_user["name"], email=current_user["email"], created_at=datetime.now())


# Post endpoints
@app.get("/posts", response_model=List[PostResponse])
async def get_posts(skip: int = 0, limit: int = 10):
    """Get all posts with pagination"""
    posts = list(posts_db.values())[skip : skip + limit]
    return posts


@app.post("/posts", response_model=PostResponse)
async def create_post(post: PostCreate, current_user: dict = Depends(get_current_user)):
    """Create a new post"""
    global post_counter
    post_counter += 1

    new_post = PostResponse(id=f"post_{post_counter}", title=post.title, content=post.content, author_id=post.author_id, created_at=datetime.now())

    posts_db[new_post.id] = new_post
    return new_post


@app.get("/posts/{post_id}", response_model=PostResponse)
async def get_post(post_id: str):
    """Get a specific post by ID"""
    if post_id not in posts_db:
        raise HTTPException(status_code=404, detail="Post not found")
    return posts_db[post_id]


@app.delete("/posts/{post_id}")
async def delete_post(post_id: str, current_user: dict = Depends(get_current_user)):
    """Delete a post (only by author)"""
    if post_id not in posts_db:
        raise HTTPException(status_code=404, detail="Post not found")

    post = posts_db[post_id]
    if post.author_id != current_user["id"]:
        raise HTTPException(status_code=403, detail="Not authorized to delete this post")

    del posts_db[post_id]
    return {"message": "Post deleted successfully"}


# STEM-specific endpoints
@app.get("/stem/topics")
async def get_stem_topics():
    """Get available STEM topics"""
    return {"topics": ["Mathematics", "Physics", "Chemistry", "Biology", "Computer Science", "Engineering", "Data Science", "Artificial Intelligence", "Robotics", "Environmental Science"]}


@app.get("/stem/resources")
async def get_stem_resources(topic: Optional[str] = None):
    """Get STEM learning resources"""
    resources = {
        "Mathematics": [{"name": "Khan Academy Math", "url": "https://khanacademy.org/math", "type": "course"}, {"name": "3Blue1Brown", "url": "https://3blue1brown.com", "type": "video"}],
        "Computer Science": [{"name": "freeCodeCamp", "url": "https://freecodecamp.org", "type": "course"}, {"name": "LeetCode", "url": "https://leetcode.com", "type": "practice"}],
        "Physics": [{"name": "MIT OpenCourseWare", "url": "https://ocw.mit.edu", "type": "course"}, {"name": "Physics Girl", "url": "https://youtube.com/physicsgirl", "type": "video"}],
    }

    if topic and topic in resources:
        return {"topic": topic, "resources": resources[topic]}

    return {"resources": resources}


# Error handlers
@app.exception_handler(404)
async def not_found_handler(request, exc):
    return {"error": "Not found", "message": "The requested resource was not found"}


@app.exception_handler(500)
async def internal_error_handler(request, exc):
    return {"error": "Internal server error", "message": "Something went wrong"}


# Run the application
if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(
        "main:app",
        host="0.0.0.0",
        port=port,
        reload=True,  # Enable auto-reload for development
        log_level="info",
    )
