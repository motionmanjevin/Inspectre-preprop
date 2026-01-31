#!/bin/bash
# Start backend in Docker, Electron natively on Raspberry Pi
# This is simpler and more reliable than running Electron in Docker

set -e

# Colors
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}🐳 Starting backend in Docker...${NC}"
docker-compose -f docker-compose.backend-only.yml up -d

echo -e "${BLUE}⏳ Waiting for backend to start...${NC}"
for i in {1..30}; do
    if curl -s http://localhost:8000/health > /dev/null 2>&1; then
        echo -e "${GREEN}✅ Backend is ready!${NC}"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Backend failed to start"
        docker-compose -f docker-compose.backend-only.yml logs
        exit 1
    fi
    sleep 1
done

echo -e "${BLUE}🚀 Starting Electron frontend...${NC}"
cd frontend
npm run electron:dev

# Cleanup on exit
trap "docker-compose -f docker-compose.backend-only.yml down" EXIT
