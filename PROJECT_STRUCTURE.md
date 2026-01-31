# Project Structure

This document describes the refactored project structure following industry best practices.

## Directory Layout

```
Inspectre/
├── app/                          # Main application package
│   ├── __init__.py              # Package initialization
│   ├── main.py                  # FastAPI application entry point
│   │
│   ├── api/                     # API layer
│   │   ├── __init__.py
│   │   ├── routes/              # Route handlers (controllers)
│   │   │   ├── __init__.py
│   │   │   ├── recording.py     # Recording endpoints
│   │   │   ├── search.py        # Search endpoints
│   │   │   ├── analysis.py      # Analysis endpoints
│   │   │   └── health.py        # Health check endpoints
│   │   └── models/              # Request/Response models
│   │       ├── __init__.py
│   │       ├── requests.py      # Request schemas
│   │       └── responses.py     # Response schemas
│   │
│   ├── core/                    # Core configuration
│   │   ├── __init__.py
│   │   ├── config.py           # Settings management (Pydantic)
│   │   └── logging_config.py   # Logging setup
│   │
│   ├── services/                # Business logic layer
│   │   ├── __init__.py
│   │   ├── video_recorder.py   # RTSP recording service
│   │   ├── r2_uploader.py       # Cloudflare R2 upload service
│   │   ├── qwen_client.py       # Qwen API client service
│   │   └── chroma_store.py      # ChromaDB storage service
│   │
│   └── utils/                   # Utilities
│       ├── __init__.py
│       └── exceptions.py        # Custom exception classes
│
├── tests/                       # Test suite
│   └── __init__.py
│
├── logs/                        # Application logs (gitignored)
├── recordings/                  # Video chunks (gitignored)
├── chroma_db/                   # ChromaDB data (gitignored)
│
├── .env                         # Environment variables (gitignored)
├── .gitignore                   # Git ignore rules
├── env_template.txt             # Environment template
├── requirements.txt             # Python dependencies
├── pyproject.toml               # Project metadata
├── run.py                       # Application entry point
└── README.md                    # Project documentation
```

## Architecture Principles

### 1. Separation of Concerns
- **API Layer** (`app/api/`): Handles HTTP requests/responses, validation
- **Service Layer** (`app/services/`): Contains business logic
- **Core** (`app/core/`): Configuration and infrastructure setup
- **Utils** (`app/utils/`): Shared utilities and exceptions

### 2. Dependency Management
- Services are initialized as singletons in `main.py`
- Dependency injection pattern for service access
- Clear separation between layers prevents circular dependencies

### 3. Configuration
- Environment-based configuration using Pydantic Settings
- Type-safe configuration with validation
- Support for `.env` files

### 4. Error Handling
- Custom exception hierarchy in `app/utils/exceptions.py`
- Proper error propagation and logging
- HTTP status codes aligned with error types

### 5. Logging
- Structured logging with configurable levels
- Logs to both console and file
- Contextual logging throughout the application

## Key Files

### `app/main.py`
- FastAPI application initialization
- Service singleton management
- Route registration
- Startup/shutdown event handlers
- Chunk processing callback

### `app/core/config.py`
- Pydantic Settings for type-safe configuration
- Environment variable loading
- Default values and validation

### `app/services/`
Each service is self-contained with:
- Clear interface
- Error handling
- Logging
- Type hints

### `app/api/routes/`
Each route module:
- Handles specific domain (recording, search, analysis)
- Uses Pydantic models for validation
- Proper error handling and HTTP status codes
- Logging for debugging

## Benefits of This Structure

1. **Maintainability**: Clear separation makes it easy to locate and modify code
2. **Testability**: Services can be easily mocked and tested
3. **Scalability**: Easy to add new features without affecting existing code
4. **Type Safety**: Pydantic models ensure data validation
5. **Documentation**: Self-documenting code with type hints and docstrings
6. **Error Handling**: Centralized exception handling
7. **Configuration**: Type-safe, validated configuration management

## Migration Notes

The old flat structure has been reorganized:
- `config.py` → `app/core/config.py`
- `video_recorder.py` → `app/services/video_recorder.py`
- `r2_uploader.py` → `app/services/r2_uploader.py`
- `qwen_client.py` → `app/services/qwen_client.py`
- `chroma_store.py` → `app/services/chroma_store.py`
- `main.py` → `app/main.py` (with refactored structure)

All imports have been updated to use the new structure.
