"""Main FastAPI application."""
import logging
import threading
from typing import Optional

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import get_settings, Settings
from app.core.logging_config import setup_logging
# Import routes after services are defined to avoid circular imports
from app.api.routes import search, analysis, health
from app.services.r2_uploader import R2Uploader
from app.services.qwen_client import QwenVLClient
from app.services.chroma_store import ChromaStore
from app.services.alert_service import AlertService
from app.utils.exceptions import R2UploadError, QwenAPIError, ChromaDBError

# Setup logging
setup_logging()
logger = logging.getLogger(__name__)

# Initialize FastAPI app
settings = get_settings()
app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    description="Backend system for recording RTSP streams, processing with Qwen 3 VL models, and providing intelligent search and analysis",
    docs_url="/docs",
    redoc_url="/redoc"
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # Configure appropriately for production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Include routers (import recording after chunk_callback is defined)
from app.api.routes import recording, videos, alerts, auth

app.include_router(health.router)  # Public endpoint
app.include_router(auth.router)  # Public endpoints (register/login)
app.include_router(recording.router)
app.include_router(search.router)
app.include_router(analysis.router)
app.include_router(videos.router)
app.include_router(alerts.router)

# Initialize services (singleton pattern)
_qwen_client: Optional[QwenVLClient] = None
_r2_uploader: Optional[R2Uploader] = None
_chroma_store: Optional[ChromaStore] = None
_alert_service: Optional[AlertService] = None


def get_qwen_client() -> QwenVLClient:
    """Get or create Qwen client instance."""
    global _qwen_client
    if _qwen_client is None:
        _qwen_client = QwenVLClient(
            api_key=settings.QWEN_API_KEY,
            base_url=settings.QWEN_BASE_URL
        )
    return _qwen_client


def get_r2_uploader() -> R2Uploader:
    """Get or create R2 uploader instance."""
    global _r2_uploader
    if _r2_uploader is None:
        try:
            _r2_uploader = R2Uploader(
                account_id=settings.R2_ACCOUNT_ID,
                access_key_id=settings.R2_ACCESS_KEY_ID,
                secret_access_key=settings.R2_SECRET_ACCESS_KEY,
                bucket_name=settings.R2_BUCKET_NAME,
                public_url_base=settings.R2_PUBLIC_URL_BASE
            )
        except R2UploadError as e:
            logger.warning(f"R2 uploader not initialized: {str(e)}")
            raise
    return _r2_uploader


def get_chroma_store() -> ChromaStore:
    """Get or create ChromaDB store instance."""
    global _chroma_store
    if _chroma_store is None:
        _chroma_store = ChromaStore(
            collection_name=settings.CHROMA_COLLECTION_NAME,
            persist_directory=settings.CHROMA_DB_DIR
        )
    return _chroma_store


def get_alert_service() -> AlertService:
    """Get or create AlertService instance."""
    global _alert_service
    if _alert_service is None:
        _alert_service = AlertService()
    return _alert_service


def chunk_callback(chunk_path: str) -> None:
    """
    Callback function when a video chunk is complete.
    
    Args:
        chunk_path: Path to the completed video chunk
    """
    def process_chunk():
        """Process chunk in background thread."""
        try:
            # Upload to R2
            logger.info(f"Processing chunk: {chunk_path}")
            r2_uploader = get_r2_uploader()
            public_url = r2_uploader.upload_file(chunk_path)
            logger.info(f"Uploaded to: {public_url}")
            
            # Get enabled alerts
            alert_service = get_alert_service()
            enabled_alerts = alert_service.get_enabled_alerts()
            
            # Prepare alerts for Qwen (list of dicts with 'id' and 'query')
            alerts_for_qwen = [
                {"id": alert["id"], "query": alert["query"]}
                for alert in enabled_alerts
            ]
            
            # Process with Qwen 3 VL Plus (with alerts injected)
            qwen_client = get_qwen_client()
            analysis = qwen_client.process_video_plus(
                video_url=public_url,
                preprompt=settings.VIDEO_PREPROMPT,
                fps=settings.VIDEO_FPS,
                alerts=alerts_for_qwen if alerts_for_qwen else None
            )
            logger.info("Analysis complete")
            
            # Parse alert responses if alerts were checked
            if alerts_for_qwen:
                alert_ids = [alert["id"] for alert in alerts_for_qwen]
                analysis_content = analysis.get("choices", [{}])[0].get("message", {}).get("content", "")
                alert_results = QwenVLClient.parse_alert_responses(analysis_content, alert_ids)
                
                # Log triggered alerts
                from pathlib import Path
                chunk_filename = Path(chunk_path).name
                for alert_id, triggered in alert_results.items():
                    if triggered:
                        alert = next((a for a in enabled_alerts if a["id"] == alert_id), None)
                        if alert:
                            # Extract a snippet of the analysis (first 200 chars)
                            analysis_snippet = analysis_content[:200] if analysis_content else None
                            alert_service.add_alert_history(
                                alert_id=alert_id,
                                alert_query=alert["query"],
                                video_url=public_url,
                                local_path=chunk_filename,
                                analysis_snippet=analysis_snippet
                            )
                            logger.info(f"Alert triggered: {alert_id} - {alert['query']}")
            
            # Store in ChromaDB with local path for video serving
            chroma_store = get_chroma_store()
            from pathlib import Path
            chunk_filename = Path(chunk_path).name
            chroma_store.add_video_analysis(
                video_url=public_url,
                analysis_json=analysis,
                metadata={"local_path": chunk_filename}  # Store filename for local serving
            )
            logger.info("Stored in ChromaDB")
            
            # Optionally delete local file to save space
            # import os
            # os.remove(chunk_path)
            
        except R2UploadError as e:
            logger.error(f"R2 upload error for chunk {chunk_path}: {str(e)}")
        except QwenAPIError as e:
            logger.error(f"Qwen API error for chunk {chunk_path}: {str(e)}")
        except ChromaDBError as e:
            logger.error(f"ChromaDB error for chunk {chunk_path}: {str(e)}")
        except Exception as e:
            logger.error(f"Unexpected error processing chunk {chunk_path}: {str(e)}", exc_info=True)
    
    # Process chunk in background thread
    thread = threading.Thread(target=process_chunk, daemon=True, name="ChunkProcessor")
    thread.start()


@app.on_event("startup")
async def startup_event():
    """Initialize services on startup."""
    logger.info(f"Starting {settings.APP_NAME} v{settings.APP_VERSION}")
    
    # Validate configuration
    if not settings.QWEN_API_KEY:
        logger.warning("QWEN_API_KEY not set")
    
    # Try to initialize services
    try:
        get_chroma_store()
        logger.info("ChromaDB initialized")
    except Exception as e:
        logger.error(f"Failed to initialize ChromaDB: {str(e)}")
    
    try:
        get_r2_uploader()
        logger.info("R2 uploader initialized")
    except Exception as e:
        logger.warning(f"R2 uploader not available: {str(e)}")
    
    logger.info("Application startup complete")


@app.on_event("shutdown")
async def shutdown_event():
    """Cleanup on shutdown."""
    logger.info("Shutting down application")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=settings.DEBUG,
        log_level=settings.LOG_LEVEL.lower()
    )
