# Docker Setup for Inspectre on Raspberry Pi

This guide explains how to build and run Inspectre using Docker on Raspberry Pi.

## Prerequisites

### On Raspberry Pi:

1. **Install Docker:**
```bash
# Install Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
sudo usermod -aG docker $USER

# Install Docker Compose (plugin version)
sudo apt-get update
sudo apt-get install docker-compose-plugin

# Log out and back in for group changes to take effect
```

2. **Verify Installation:**
```bash
docker --version
docker compose version
```

## Setup Instructions

### 1. Transfer Project to Raspberry Pi

From your Windows machine, transfer the project:

```bash
# Using SCP (replace with your Pi's IP)
scp -r Inspectre pi@raspberrypi.local:/home/pi/

# Or use a USB drive, or clone from git
```

### 2. Configure Environment

On Raspberry Pi:

```bash
cd ~/Inspectre

# Copy environment template
cp env_template.txt .env

# Edit with your settings
nano .env
```

Make sure to set:
- `QWEN_API_KEY` - Your Alibaba Cloud API key
- `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` - Cloudflare R2 credentials
- `R2_BUCKET_NAME` - Your R2 bucket name
- `R2_PUBLIC_URL_BASE` - Your R2 public URL base

### 3. Build and Run

#### Option A: Using Docker Compose (Recommended)

```bash
# Make script executable
chmod +x build-and-run.sh

# Build and run
./build-and-run.sh
```

Or manually:
```bash
# Build
docker-compose build

# Run
docker-compose up
```

#### Option B: Using Docker directly

```bash
# Make script executable
chmod +x docker-run.sh

# Run
./docker-run.sh
```

Or manually:
```bash
# Build
docker build -t inspectre:latest .

# Run
docker run -it --rm \
    --name inspectre \
    -p 8000:8000 \
    -v "$(pwd)/recordings:/app/recordings" \
    -v "$(pwd)/chroma_db:/app/chroma_db" \
    -v "$(pwd)/logs:/app/logs" \
    -v "$(pwd)/.env:/app/.env:ro" \
    --device /dev/video0:/dev/video0 \
    --network host \
    inspectre:latest
```

## Running in Background

To run as a daemon (background service):

```bash
docker-compose up -d
```

To view logs:
```bash
docker-compose logs -f
```

To stop:
```bash
docker-compose down
```

## Data Persistence

Data is stored in these directories (mounted as volumes):
- `./recordings/` - Video chunks
- `./chroma_db/` - ChromaDB database
- `./logs/` - Application logs

These persist even when the container is stopped.

## Troubleshooting

### Build Fails

1. **Out of disk space:**
```bash
# Check disk space
df -h

# Clean up Docker
docker system prune -a
```

2. **Memory issues:**
```bash
# Check available memory
free -h

# Increase swap if needed
sudo dphys-swapfile swapoff
sudo nano /etc/dphys-swapfile  # Set CONF_SWAPSIZE=2048
sudo dphys-swapfile setup
sudo dphys-swapfile swapon
```

### Backend Won't Start

1. **Check logs:**
```bash
docker-compose logs inspectre
```

2. **Verify .env file:**
```bash
# Make sure .env exists and has correct values
cat .env
```

3. **Test backend manually:**
```bash
docker-compose exec inspectre python /app/run.py
```

### Electron Won't Start

1. **Check Xvfb:**
```bash
docker-compose exec inspectre ps aux | grep Xvfb
```

2. **If you have a display connected:**
   - Modify Dockerfile to use host X server instead of Xvfb
   - Or run with `-e DISPLAY=$DISPLAY -v /tmp/.X11-unix:/tmp/.X11-unix`

### Port Already in Use

If port 8000 is already in use:

```bash
# Find what's using it
sudo lsof -i :8000

# Or change port in docker-compose.yml
ports:
  - "8001:8000"  # Change host port
```

### Camera Access Issues

If you're not using a camera, comment out the device line in `docker-compose.yml`:

```yaml
# devices:
#   - /dev/video0:/dev/video0
```

## Performance Tips

1. **Use SSD/USB 3.0** for better I/O performance
2. **Increase swap** if you have limited RAM
3. **Use Pi 4 or newer** for better performance
4. **Close other applications** during build

## Updating the Application

To update after code changes:

```bash
# Stop current instance
docker-compose down

# Rebuild
docker-compose build

# Start again
docker-compose up
```

## Clean Up

To remove everything and start fresh:

```bash
# Stop and remove containers
docker-compose down

# Remove image
docker rmi inspectre:latest

# Remove volumes (WARNING: deletes all data)
docker-compose down -v
```

## Notes

- First build takes 20-30 minutes on Raspberry Pi
- Subsequent builds are faster due to Docker layer caching
- The app runs Electron in headless mode using Xvfb
- All data persists in mounted volumes
- Backend API is accessible at `http://localhost:8000`
