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
    # With cosine distance (lower is better). If distance is higher than this, we treat it as "not relevant".
    # NOTE: cosine distance commonly falls in ~[0, 1] for most embeddings (sometimes up to 2 depending on backend).
    # 0.50 can be too strict in practice and may filter out relevant matches.
    CLIP_MAX_DISTANCE: float = 0.70

    # Analysis Settings (stricter than clip search to avoid wasting credits)
    # Only clips with distance <= this will be sent to Qwen Flash.
    ANALYSIS_MAX_DISTANCE: float = 0.70
    
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
