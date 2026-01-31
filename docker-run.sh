#!/bin/bash
# Run Inspectre in Docker without docker-compose

set -e

IMAGE_NAME="inspectre:latest"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Build if image doesn't exist
if ! docker image inspect $IMAGE_NAME > /dev/null 2>&1; then
    echo -e "${BLUE}🐳 Building Docker image...${NC}"
    docker build -t $IMAGE_NAME .
fi

echo -e "${GREEN}🚀 Starting Inspectre...${NC}"
docker run -it --rm \
    --name inspectre \
    -p 8000:8000 \
    -v "$(pwd)/recordings:/app/recordings" \
    -v "$(pwd)/chroma_db:/app/chroma_db" \
    -v "$(pwd)/logs:/app/logs" \
    -v "$(pwd)/.env:/app/.env:ro" \
    --device /dev/video0:/dev/video0 \
    --network host \
    $IMAGE_NAME
