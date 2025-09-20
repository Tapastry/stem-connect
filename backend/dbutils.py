from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class PersonalInformationSchema(BaseModel):
    id: str
    name: str
    title: Optional[str] = None
    goal: Optional[str] = None
    interests: Optional[str] = None
    skills: Optional[str] = None
    bio: Optional[str] = None
    imageName: Optional[str] = None
    userId: str


class NodeSchema(BaseModel):
    id: str
    name: str
    title: Optional[str] = None
    type: str
    imageName: Optional[str] = None
    time: Optional[str] = None
    description: Optional[str] = None
    createdAt: datetime
    userId: str


class LinkSchema(BaseModel):
    id: str
    source: str
    target: str
    userId: str

import psycopg2
from psycopg2.extras import RealDictCursor
from typing import Optional, List
from datetime import datetime

DATABASE_URL = "dbname=mydb user=myuser password=mypass host=localhost port=5432"


def get_connection():
    return psycopg2.connect(DATABASE_URL, cursor_factory=RealDictCursor)

