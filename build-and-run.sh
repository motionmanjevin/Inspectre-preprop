#!/bin/bash
# Build and run Inspectre on Raspberry Pi

set -e

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🐳 Building Inspectre Docker image...${NC}"
echo "This may take 20-30 minutes on Raspberry Pi..."
docker-compose build

echo ""
echo -e "${GREEN}✅ Build complete!${NC}"
echo ""
echo -e "${BLUE}🚀 Starting Inspectre...${NC}"
echo "Press Ctrl+C to stop"
echo ""

docker-compose up
