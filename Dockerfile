# Multi-stage build for Next.js frontend + Python backend
FROM node:18-alpine AS frontend-builder

# Accept build args from Coolify
ARG AUTH_SECRET
ARG AUTH_URL
ARG BACKEND_URL
ARG DATABASE_URL
ARG GEMINI_API_KEY
ARG GOOGLE_API_KEY
ARG GOOGLE_CLIENT_ID
ARG GOOGLE_CLIENT_SECRET
ARG MINIO_ACCESS_KEY
ARG MINIO_ENDPOINT
ARG MINIO_PORT
ARG MINIO_SECRET_KEY
ARG NEXTAUTH_URL

# Convert build args to environment variables
ENV AUTH_SECRET=$AUTH_SECRET
ENV AUTH_URL=$AUTH_URL
ENV BACKEND_URL=$BACKEND_URL
ENV DATABASE_URL=$DATABASE_URL
ENV GEMINI_API_KEY=$GEMINI_API_KEY
ENV GOOGLE_API_KEY=$GOOGLE_API_KEY
ENV GOOGLE_CLIENT_ID=$GOOGLE_CLIENT_ID
ENV GOOGLE_CLIENT_SECRET=$GOOGLE_CLIENT_SECRET
ENV MINIO_ACCESS_KEY=$MINIO_ACCESS_KEY
ENV MINIO_ENDPOINT=$MINIO_ENDPOINT
ENV MINIO_PORT=$MINIO_PORT
ENV MINIO_SECRET_KEY=$MINIO_SECRET_KEY
ENV NEXTAUTH_URL=$NEXTAUTH_URL

# Set working directory for frontend
WORKDIR /app

# Copy frontend package files
COPY package*.json pnpm-lock.yaml ./
COPY components.json tsconfig.json next.config.js postcss.config.js prettier.config.js eslint.config.js ./

# Install pnpm and dependencies
RUN npm install -g pnpm
RUN pnpm install

# Copy frontend source
COPY src ./src
COPY public ./public

# Build the frontend with npm run build
RUN npm run build

# Production stage with Python + Node
FROM python:3.10-slim

# Install Node.js and system dependencies
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pnpm \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Create Python virtual environment
RUN python -m venv venv

# Copy backend files and start_api.sh script
COPY backend ./backend

# Copy frontend build from builder stage
COPY --from=frontend-builder /app/.next ./.next
COPY --from=frontend-builder /app/public ./public
COPY --from=frontend-builder /app/package*.json ./
COPY --from=frontend-builder /app/pnpm-lock.yaml ./
COPY --from=frontend-builder /app/node_modules ./node_modules

# Copy frontend source files needed for runtime
COPY src ./src
COPY next.config.js tsconfig.json ./

# Copy the startup script that uses start_api.sh
COPY start-services.sh ./
RUN chmod +x start-services.sh
RUN chmod +x backend/start_api.sh

# Expose ports
EXPOSE 3000 8000

# Start both services
CMD ["./start-services.sh"]