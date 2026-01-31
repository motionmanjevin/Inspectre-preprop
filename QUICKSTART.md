# Quick Start Guide

## Installation

1. **Install dependencies:**
```bash
pip install -r requirements.txt
```

2. **Set up environment:**
```bash
# Copy template
cp env_template.txt .env

# Edit .env with your credentials
# Minimum required:
QWEN_API_KEY=sk-your-key-here
R2_ACCOUNT_ID=your-account-id
R2_ACCESS_KEY_ID=your-key-id
R2_SECRET_ACCESS_KEY=your-secret-key
R2_BUCKET_NAME=your-bucket-name
R2_PUBLIC_URL_BASE=https://your-bucket.r2.dev
```

3. **Run the application:**
```bash
python run.py
```

The API will be available at `http://localhost:8000`

## Basic Usage

### 1. Start Recording
```bash
curl -X POST http://localhost:8000/recording/start \
  -H "Content-Type: application/json" \
  -d '{"rtsp_url": "rtsp://your-stream-url"}'
```

### 2. Check Status
```bash
curl http://localhost:8000/recording/status
```

### 3. Search for Clips
```bash
curl -X POST http://localhost:8000/search/clips \
  -H "Content-Type: application/json" \
  -d '{"query": "person walking", "n_results": 5}'
```

### 4. Analyze Videos
```bash
curl -X POST http://localhost:8000/analysis \
  -H "Content-Type: application/json" \
  -d '{"query": "What happened?", "n_results": 3}'
```

### 5. Stop Recording
```bash
curl -X POST http://localhost:8000/recording/stop
```

## API Documentation

Once the server is running, visit:
- **Swagger UI**: http://localhost:8000/docs
- **ReDoc**: http://localhost:8000/redoc

## Project Structure

```
app/
├── api/          # API endpoints and models
├── core/         # Configuration
├── services/     # Business logic
└── utils/        # Utilities
```

See `PROJECT_STRUCTURE.md` for detailed information.

## Troubleshooting

### Import Errors
Make sure you're running from the project root:
```bash
python run.py
# NOT: python app/main.py
```

### Missing Dependencies
```bash
pip install -r requirements.txt
```

### Configuration Issues
Check that your `.env` file exists and contains all required variables.

### Logs
Check `logs/app.log` for detailed error messages.
