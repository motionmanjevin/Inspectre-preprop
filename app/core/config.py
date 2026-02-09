"""Application configuration management."""
import os
from pathlib import Path
from typing import Optional
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""
    
    # Application
    APP_NAME: str = "Inspectre Video Analysis Backend"
    APP_VERSION: str = "1.0.0"
    DEBUG: bool = os.getenv("DEBUG", "False").lower() == "true"
    
    # Qwen API Settings
    QWEN_API_KEY: str
    QWEN_BASE_URL: str = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1"
    # Qwen embedding (v3) and reranker for search relevance (replaces ChromaDB similarity)
    QWEN_EMBEDDING_MODEL: str = "text-embedding-v3"
    # For Singapore: qwen3-rerank. For Beijing: gte-rerank-v2
    QWEN_RERANK_MODEL: str = "qwen3-rerank"
    # Reranker: max docs per request (qwen3-rerank and gte-rerank-v2 support 500)
    QWEN_RERANK_MAX_DOCS: int = 500
    # Max chars per document for reranker (truncate; ~4k tokens ≈ 16k chars)
    QWEN_RERANK_MAX_CHARS_PER_DOC: int = 16000
    # Optional instruction to steer reranker behavior (format with {query} if desired)
    QWEN_RERANK_INSTRUCT: str = (
        "Rerank the clip analyses for relevance to the query: '{query}'. "
        "Favor clips where the described action/event actually occurs. "
        "Treat explicit negations (e.g., 'no one stood up') as NOT relevant to occurrence questions."
    )

    # Cloudflare R2 Settings
    R2_ACCOUNT_ID: str = ""
    R2_ACCESS_KEY_ID: str = ""
    R2_SECRET_ACCESS_KEY: str = ""
    R2_BUCKET_NAME: str = ""
    R2_PUBLIC_URL_BASE: str = ""
    
    # Video Processing Settings
    VIDEO_PREPROMPT: str = (
        "this is a camera for a section of the library ; take not of every single individual person and detailed narration of their actions at all times ; also take not of each individuals clothing and appearance . leave you output in a structures json format"
    )
    VIDEO_CHUNK_DURATION: int = 600  # 10 minutes in seconds
    VIDEO_FPS: int = 2
    
    # Storage Settings
    RECORDINGS_DIR: str = "recordings"
    CHROMA_DB_DIR: str = "./chroma_db"
    CHROMA_COLLECTION_NAME: str = "video_analysis"
    
    # Search Settings
    DEFAULT_SEARCH_RESULTS: int = 5
    MAX_SEARCH_RESULTS: int = 25
    # Legacy: unused when using Qwen rerank for search.
    CLIP_MAX_DISTANCE: float = 0.80
    # Min relevance_score (0–1) from Qwen reranker to include in search results (higher = stricter)
    CLIP_MIN_RELEVANCE_SCORE: float = 0.3

    # Analysis Settings (when using Qwen rerank: min relevance_score 0–1 to send to VL Flash)
    ANALYSIS_MIN_RELEVANCE_SCORE: float = 0.0
    
    # Authentication Settings
    JWT_SECRET_KEY: str = os.getenv("JWT_SECRET_KEY", "your-secret-key-change-in-production")
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 7  # 7 days
    
    # Database Settings
    DATABASE_URL: str = "sqlite:///./users.db"
    
    # Logging
    LOG_LEVEL: str = os.getenv("LOG_LEVEL", "INFO")
    
    class Config:
        """Pydantic config."""
        env_file = ".env"
        env_file_encoding = "utf-8"
        case_sensitive = True


@lru_cache()
def get_settings() -> Settings:
    """Get cached settings instance."""
    return Settings()
