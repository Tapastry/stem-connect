#!/bin/bash

# Start the backend API server using the existing start_api.sh script
echo "Starting backend API server with start_api.sh..."
cd /app/backend
./start_api.sh &
BACKEND_PID=$!

# Wait for backend to be fully ready
echo "Waiting for backend to be ready..."
sleep 10

# Check if backend is responding
until curl -f http://127.0.0.1:8000/docs > /dev/null 2>&1; do
    echo "Backend not ready yet, waiting 2 more seconds..."
    sleep 2
done
echo "Backend is ready!"

# Start the frontend server
echo "Starting frontend server..."
cd /app
npm start &
FRONTEND_PID=$!

# Function to handle shutdown
cleanup() {
    echo "Shutting down services..."
    kill $BACKEND_PID $FRONTEND_PID
    wait
    exit 0
}

# Trap signals for graceful shutdown
trap cleanup SIGTERM SIGINT

# Wait for both processes
wait $BACKEND_PID $FRONTEND_PID