# Use Python 3.10 (matching your local environment)
FROM python:3.10-slim

# Install system dependencies required for psycopg2, google-adk, and other packages
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    libpq-dev \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory inside the container
WORKDIR /app

# Copy in your requirements file
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application code
COPY . .

# Create a non-root user for security
RUN useradd --create-home --shell /bin/bash app \
    && chown -R app:app /app
USER app

# Expose FastAPI's default port
EXPOSE 8000

# Start the FastAPI app with Uvicorn (without --reload for production)
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
