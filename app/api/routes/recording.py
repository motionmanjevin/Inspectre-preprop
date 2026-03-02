"""Recording API routes."""
import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends

from app.api.models.requests import StartRecordingRequest
from app.api.models.responses import RecordingResponse, StatusResponse
from app.api.dependencies import get_current_user
from app.services.video_recorder import VideoRecorder
from app.services.chroma_store import ChromaStore
from app.core.config import get_settings
from app.utils.exceptions import VideoRecordingError, ChromaDBError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/recording", tags=["recording"])

# Global recorder instance (in production, use dependency injection)
_video_recorder: Optional[VideoRecorder] = None
_raw_recording_active: bool = False


def get_video_recorder() -> Optional[VideoRecorder]:
    """Get current video recorder instance."""
    return _video_recorder


@router.post("/start", response_model=RecordingResponse)
async def start_recording(
    request: StartRecordingRequest,
    current_user: dict = Depends(get_current_user)
) -> RecordingResponse:
    """
    Start recording RTSP stream in chunks.
    
    Args:
        request: Recording request with RTSP URL
    
    Returns:
        Recording response with status
    
    Raises:
        HTTPException: If recording fails to start
    """
    global _video_recorder, _raw_recording_active
    
    if _video_recorder and _video_recorder.is_recording:
        raise HTTPException(
            status_code=400,
            detail="Recording already in progress"
        )
    
    try:
        settings = get_settings()
        raw_mode = request.raw_mode or False

        if raw_mode:
            # Raw recording: 1‑min chunks, saved in footage dir, recorded only when motion is detected.
            # These chunks are later concatenated into 1‑hour files and uploaded once.
            output_dir = settings.RAW_FOOTAGE_DIR
            chunk_duration_seconds = 60  # 1 minute per motion-triggered chunk
            # Force motion detection for raw mode regardless of UI toggle
            motion_detection_enabled = True
            motion_threshold = request.motion_threshold or 0.3
            from app.main import raw_chunk_callback
            callback = raw_chunk_callback
            _raw_recording_active = True
        else:
            output_dir = settings.RECORDINGS_DIR
            if request.chunk_duration:
                chunk_duration_seconds = request.chunk_duration * 60
            else:
                chunk_duration_seconds = settings.VIDEO_CHUNK_DURATION
            motion_detection_enabled = request.motion_detection_enabled or False
            motion_threshold = request.motion_threshold or 0.3
            from app.main import chunk_callback
            callback = chunk_callback
            _raw_recording_active = False

        _video_recorder = VideoRecorder(
            rtsp_url=request.rtsp_url,
            output_dir=output_dir,
            chunk_duration=chunk_duration_seconds,
            motion_detection_enabled=motion_detection_enabled,
            motion_threshold=motion_threshold
        )
        
        _video_recorder.start_recording(callback=callback)
        
        logger.info(f"Recording started for {request.rtsp_url}" + (" (raw footage)" if raw_mode else ""))
        return RecordingResponse(
            status="recording_started",
            rtsp_url=request.rtsp_url
        )
    except VideoRecordingError as e:
        logger.error(f"Failed to start recording: {str(e)}")
        raise HTTPException(
            status_code=500,
            detail=f"Failed to start recording: {str(e)}"
        ) from e
    except Exception as e:
        logger.error(f"Unexpected error starting recording: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        ) from e


@router.post("/stop", response_model=RecordingResponse)
async def stop_recording(
    current_user: dict = Depends(get_current_user)
) -> RecordingResponse:
    """
    Stop recording RTSP stream.
    
    Returns:
        Recording response with status
    
    Raises:
        HTTPException: If no recording is in progress
    """
    global _video_recorder
    
    if not _video_recorder or not _video_recorder.is_recording:
        raise HTTPException(
            status_code=400,
            detail="No recording in progress"
        )
    
    try:
        global _raw_recording_active
        rtsp_url = _video_recorder.rtsp_url
        was_raw = _raw_recording_active
        _video_recorder.stop_recording()
        _raw_recording_active = False
        if was_raw:
            from app.main import flush_raw_segments
            flush_raw_segments()
        logger.info("Recording stopped")
        return RecordingResponse(
            status="recording_stopped",
            rtsp_url=rtsp_url
        )
    except Exception as e:
        logger.error(f"Failed to stop recording: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Failed to stop recording: {str(e)}"
        ) from e


@router.get("/status", response_model=StatusResponse)
async def get_status(
    current_user: dict = Depends(get_current_user)
) -> StatusResponse:
    """
    Get current recording status.
    
    Returns:
        Status response with recording state
    """
    global _video_recorder
    
    return StatusResponse(
        recording=_video_recorder.is_recording if _video_recorder else False,
        rtsp_url=_video_recorder.rtsp_url if _video_recorder else None
    )


@router.post("/clear-database", response_model=RecordingResponse)
async def clear_database(
    current_user: dict = Depends(get_current_user)
) -> RecordingResponse:
    """
    Clear ChromaDB and delete all recorded video clips.
    
    This will:
    - Delete all entries from ChromaDB
    - Delete all video files from the recordings directory
    
    Returns:
        Recording response with status
    
    Raises:
        HTTPException: If clearing fails
    """
    try:
        settings = get_settings()
        
        # Clear ChromaDB
        try:
            chroma_store = ChromaStore(
                collection_name=settings.CHROMA_COLLECTION_NAME,
                persist_directory=settings.CHROMA_DB_DIR
            )
            chroma_store.clear_all()
            logger.info("ChromaDB cleared successfully")
        except ChromaDBError as e:
            logger.error(f"Failed to clear ChromaDB: {str(e)}")
            raise HTTPException(
                status_code=500,
                detail=f"Failed to clear ChromaDB: {str(e)}"
            ) from e
        
        # Delete all video files from recordings directory
        recordings_dir = Path(settings.RECORDINGS_DIR)
        deleted_count = 0
        if recordings_dir.exists():
            video_extensions = {'.avi', '.mp4', '.mov', '.mkv', '.webm'}
            for video_file in recordings_dir.iterdir():
                if video_file.is_file() and video_file.suffix.lower() in video_extensions:
                    try:
                        video_file.unlink()
                        deleted_count += 1
                    except Exception as e:
                        logger.warning(f"Failed to delete {video_file}: {str(e)}")
            
            logger.info(f"Deleted {deleted_count} video files from recordings directory")
        else:
            logger.info("Recordings directory does not exist, skipping file deletion")
        
        return RecordingResponse(
            status="database_cleared",
            rtsp_url=None
        )
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Unexpected error clearing database: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail=f"Unexpected error: {str(e)}"
        ) from e
