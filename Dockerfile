# Multi-stage build for Inspectre on Raspberry Pi
FROM node:20-slim AS frontend-builder

WORKDIR /app/frontend

# Copy frontend files
COPY frontend/package*.json ./
RUN npm install && \
    chmod -R +x node_modules/.bin

COPY frontend/ ./
RUN node node_modules/vite/bin/vite.js build

# Build Electron (we'll use a base image that supports ARM)
FROM node:20-slim AS electron-builder

WORKDIR /app/frontend

COPY frontend/package*.json ./
RUN npm install && \
    chmod -R +x node_modules/.bin

COPY frontend/ ./
COPY --from=frontend-builder /app/frontend/build ./build

# Install Electron build dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    make \
    g++ \
    xz-utils \
    && rm -rf /var/lib/apt/lists/*

# Build Electron for Linux ARM64
RUN node node_modules/vite/bin/vite.js build && \
    chmod +x node_modules/app-builder-bin/linux/arm64/app-builder 2>/dev/null || true && \
    chmod -R +x node_modules/.bin && \
    node node_modules/electron-builder/cli.js --linux --arm64

# Python backend stage
FROM python:3.11-slim AS backend

WORKDIR /app

# Install system dependencies for OpenCV and ChromaDB
RUN apt-get update && apt-get install -y \
    libopencv-dev \
    python3-opencv \
    libgl1 \
    libglib2.0-0 \
    curl \
    ffmpeg \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy application code
COPY app/ ./app/
COPY run.py .
COPY env_template.txt .

# Final stage - combine everything
FROM python:3.11-slim

WORKDIR /app

# Install runtime dependencies
RUN apt-get update && apt-get install -y \
    libopencv-dev \
    python3-opencv \
    libgl1 \
    libglib2.0-0 \
    curl \
    ffmpeg \
    xvfb \
    libnss3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*

# Copy Python dependencies from backend stage
COPY --from=backend /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=backend /usr/local/bin /usr/local/bin

# Copy application code
COPY --from=backend /app/app ./app
COPY --from=backend /app/run.py .
COPY --from=backend /app/env_template.txt .

# Copy Electron app
COPY --from=electron-builder /app/frontend/dist-electron/linux-arm64-unpacked ./electron-app

# Create directories for data
RUN mkdir -p recordings chroma_db logs

# Create launcher script
RUN echo '#!/bin/bash\n\
set -e\n\
\n\
echo "🚀 Starting Inspectre backend..."\n\
python /app/run.py &\n\
BACKEND_PID=$!\n\
\n\
echo "⏳ Waiting for backend to start..."\n\
for i in {1..30}; do\n\
    if curl -s http://localhost:8000/health > /dev/null 2>&1; then\n\
        echo "✅ Backend is ready!"\n\
        break\n\
    fi\n\
    if [ $i -eq 30 ]; then\n\
        echo "❌ Backend failed to start"\n\
        kill $BACKEND_PID 2>/dev/null || true\n\
        exit 1\n\
    fi\n\
    sleep 1\n\
done\n\
\n\
echo "🚀 Starting Inspectre frontend..."\n\
export DISPLAY=:99\n\
Xvfb :99 -screen 0 1024x768x24 > /dev/null 2>&1 &\n\
XVFB_PID=$!\n\
sleep 2\n\
\n\
cd /app/electron-app\n\
./inspectre &\n\
ELECTRON_PID=$!\n\
\n\
cleanup() {\n\
    echo "🛑 Shutting down Inspectre..."\n\
    [ ! -z "$ELECTRON_PID" ] && kill $ELECTRON_PID 2>/dev/null || true\n\
    [ ! -z "$BACKEND_PID" ] && kill $BACKEND_PID 2>/dev/null || true\n\
    [ ! -z "$XVFB_PID" ] && kill $XVFB_PID 2>/dev/null || true\n\
    exit 0\n\
}\n\
\n\
trap cleanup SIGINT SIGTERM\n\
wait $ELECTRON_PID\n\
cleanup\n\
' > /app/start.sh && chmod +x /app/start.sh

# Set environment variables
ENV PYTHONUNBUFFERED=1
ENV DISPLAY=:99

# Expose backend port
EXPOSE 8000

# Default command
CMD ["/app/start.sh"]
