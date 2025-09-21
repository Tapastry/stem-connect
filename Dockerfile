# Multi-stage build for Next.js frontend + Python backend
FROM node:18-alpine AS frontend-builder

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

# Build the frontend
RUN pnpm build

# Production stage with Python + Node
FROM python:3.10-slim

# Install Node.js in the Python container
RUN apt-get update && apt-get install -y \
    curl \
    && curl -fsSL https://deb.nodesource.com/setup_18.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g pnpm \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy backend requirements and install Python dependencies
COPY backend/requirements.txt ./backend/
RUN pip install --no-cache-dir -r backend/requirements.txt

# Copy backend source
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

# Copy the startup script
COPY start-services.sh ./
RUN chmod +x start-services.sh

# Expose ports
EXPOSE 3000 8000

# Start both services
CMD ["./start-services.sh"]