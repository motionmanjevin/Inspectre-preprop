"""Video serving API routes."""
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from app.core.config import get_settings
from app.services.auth_service import AuthService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/videos", tags=["videos"])


@router.get("/{file_path:path}")
async def get_video(
    file_path: str,
    request: Request,
    token: str | None = None,
):
    """
    Serve video file from recordings directory.
    
    Args:
        filename: Name of the video file to serve
    
    Returns:
        Video file response
    
    Raises:
        HTTPException: If video file not found
    """
    # Video players (HTML <video>, mobile) generally can't attach Authorization headers easily.
    # We accept either:
    # - Authorization: Bearer <jwt>
    # - ?token=<jwt>
    raw_token: str | None = token
    if not raw_token:
        auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
        if auth_header and auth_header.lower().startswith("bearer "):
            raw_token = auth_header.split(" ", 1)[1].strip()

    if not raw_token:
        raise HTTPException(status_code=401, detail="Missing authentication token")

    # Validate token (we don't need the user payload for streaming)
    AuthService().verify_token(raw_token)

    settings = get_settings()
    recordings_dir = Path(settings.RECORDINGS_DIR)
    video_path = recordings_dir / file_path
    
    # Security: Ensure the file is within the recordings directory (prevent path traversal)
    try:
        video_path.resolve().relative_to(recordings_dir.resolve())
    except ValueError:
        raise HTTPException(
            status_code=403,
            detail="Access denied: Invalid file path"
        )
    
    if not video_path.exists():
        logger.warning(f"Video file not found: {file_path}")
        raise HTTPException(
            status_code=404,
            detail=f"Video file not found: {file_path}"
        )
    
    # Determine content type based on file extension
    ext = video_path.suffix.lower()
    content_types = {
        '.avi': 'video/x-msvideo',
        '.mp4': 'video/mp4',
        '.mov': 'video/quicktime',
        '.mkv': 'video/x-matroska',
        '.webm': 'video/webm',
    }
    media_type = content_types.get(ext, 'video/mp4')
    
    logger.debug(f"Serving video: {file_path}")
    return FileResponse(
        video_path,
        media_type=media_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Disposition": f'inline; filename="{video_path.name}"'
        }
    )
