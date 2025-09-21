#!/bin/bash

# Start the backend API server using the existing start_api.sh script
echo "Starting backend API server with start_api.sh..."
cd /app/backend
./start_api.sh &
BACKEND_PID=$!

# Wait a moment for backend to start
sleep 5

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