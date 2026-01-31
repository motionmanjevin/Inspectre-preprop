# Inspectre Video Analysis Backend

A production-ready backend system for recording RTSP video streams, processing them with Qwen 3 VL models, and providing intelligent search and analysis capabilities.

## 🏗️ Architecture

The project follows industry-standard software architecture patterns:

```
Inspectre/
├── app/
│   ├── api/              # API layer
│   │   ├── routes/       # Route handlers
│   │   └── models/       # Request/Response models
│   ├── core/             # Core configuration
│   ├── services/         # Business logic layer
│   ├── utils/            # Utilities and exceptions
│   └── main.py           # FastAPI application
├── tests/                # Test suite
├── logs/                 # Application logs
└── run.py                # Application entry point
```

### Components

1. **Video Recording Service**: Records RTSP streams in 10-minute AVI chunks
2. **R2 Upload Service**: Uploads chunks to Cloudflare R2 and retrieves public URLs
3. **Qwen API Client**: Interfaces with Qwen 3 VL Plus and Flash APIs
4. **ChromaDB Store**: Vector database for semantic search of video analysis
5. **FastAPI Application**: RESTful API with proper error handling and logging

## 🚀 Setup

### Prerequisites

- Python 3.9+
- Cloudflare R2 account with bucket configured
- Alibaba Cloud API key for Qwen models

### Installation

1. **Clone and install dependencies:**
```bash
pip install -r requirements.txt
```

2. **Configure environment variables:**
```bash
# Copy the template
cp env_template.txt .env

# Edit .env with your credentials
# Required:
# - QWEN_API_KEY
# - R2_ACCOUNT_ID
# - R2_ACCESS_KEY_ID
# - R2_SECRET_ACCESS_KEY
# - R2_BUCKET_NAME
# - R2_PUBLIC_URL_BASE
```

3. **Run the application:**
```bash
python run.py
# or
uvicorn app.main:app --reload
```

The API will be available at `http://localhost:8000`
- API Documentation: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

## 📡 API Endpoints

### Recording

#### Start Recording
```http
POST /recording/start
Content-Type: application/json

{
  "rtsp_url": "rtsp://your-stream-url"
}
```

#### Stop Recording
```http
POST /recording/stop
```

#### Get Status
```http
GET /recording/status
```

### Search

#### Search for Clips
```http
POST /search/clips
Content-Type: application/json

{
  "query": "person walking in hallway",
  "n_results": 5
}
```

### Analysis

#### Analyze Videos
```http
POST /analysis
Content-Type: application/json

{
  "query": "What suspicious activities occurred?",
  "n_results": 5
}
```

### Health

#### Health Check
```http
GET /health
```

## 🔄 Workflow

1. **Start Recording**: POST to `/recording/start` with RTSP URL
2. **Automatic Processing**: System automatically:
   - Records 10-minute chunks
   - Uploads each chunk to R2
   - Processes with Qwen 3 VL Plus (with preprompt)
   - Stores results in ChromaDB with video link
3. **Query System**:
   - **Clip Search**: Find relevant entries and return video links
   - **Analysis**: Find relevant entries, process each with Qwen 3 VL Flash sequentially, return raw output

## 🏛️ Project Structure

- **`app/api/`**: API routes and models (separation of concerns)
- **`app/core/`**: Configuration and logging setup
- **`app/services/`**: Business logic services
- **`app/utils/`**: Custom exceptions and utilities
- **`app/main.py`**: FastAPI application initialization

## 📝 Features

- ✅ Production-ready structure with proper separation of concerns
- ✅ Comprehensive error handling and logging
- ✅ Type hints throughout
- ✅ Pydantic models for request/response validation
- ✅ Environment-based configuration
- ✅ CORS middleware support
- ✅ Automatic API documentation (Swagger/ReDoc)
- ✅ Health check endpoints
- ✅ Background processing for video chunks

## 🔧 Configuration

All configuration is managed through environment variables (see `env_template.txt`):

- **Qwen API**: API key and base URL
- **R2 Storage**: Account ID, credentials, bucket name, public URL
- **Video Processing**: Chunk duration, FPS, preprompt
- **Storage**: Directories for recordings and ChromaDB
- **Logging**: Log level and output settings

## 📊 Logging

Logs are written to:
- Console (stdout)
- File: `logs/app.log`

Log levels can be configured via `LOG_LEVEL` environment variable.

## 🧪 Testing

```bash
# Run tests (when implemented)
pytest tests/
```

## 📦 Dependencies

- **FastAPI**: Modern web framework
- **Uvicorn**: ASGI server
- **OpenCV**: Video processing
- **boto3**: Cloudflare R2 integration
- **ChromaDB**: Vector database
- **Pydantic**: Data validation
- **Requests**: HTTP client

## 🔒 Security Notes

- Never commit `.env` files
- Use environment variables for sensitive data
- Configure CORS appropriately for production
- Validate all user inputs (handled by Pydantic)

## 📄 License

[Your License Here]

## 🤝 Contributing

[Contributing Guidelines]
