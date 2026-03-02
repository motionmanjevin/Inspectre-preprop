"""Raw footage API: list 1-hour chunks, serve video, query selected chunks with Qwen VL."""
import logging
from pathlib import Path
from datetime import datetime

from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.api.dependencies import get_current_user
from app.core.config import get_settings
from app.services.auth_service import AuthService
from app.services.qwen_client import QwenVLClient
from app.api.models.responses import AnalysisResult, AnalysisResponse
from app.utils.exceptions import QwenAPIError
from app.main import get_live_raw_segments_state, create_temp_raw_concat_for_query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/raw", tags=["raw-footage"])


class RawFootageItem(BaseModel):
    """Single raw footage chunk (1-hour file)."""
    id: str = Field(..., description="Filename (e.g. footage_20260218_160000.mp4)")
    filename: str = Field(..., description="Same as id")
    date: str = Field(..., description="Date YYYY-MM-DD from filename")
    time: str = Field(..., description="Time HH:MM:SS from filename")
    size_bytes: int = Field(0, description="File size in bytes")
    video_url: str = Field(..., description="R2 public URL for playback/analysis")
    is_live: bool = Field(False, description="Whether this item represents the current in-progress hour")
    segments_done: int = Field(0, description="Number of 1-minute segments recorded so far (for live item)")
    segments_total: int = Field(60, description="Total segments per hour (typically 60)")


class RawFootageListResponse(BaseModel):
    """List of raw footage chunks (newest first)."""
    chunks: list[RawFootageItem] = Field(..., description="Footage files")


class RawQueryRequest(BaseModel):
    """Request to run analysis on 1 or 2 selected raw chunks."""
    query: str = Field(..., description="Analysis query")
    chunk_ids: list[str] = Field(..., min_length=1, max_length=2, description="1 or 2 chunk filenames (e.g. footage_20260218_160000.mp4)")


def _get_qwen_client() -> QwenVLClient:
    settings = get_settings()
    return QwenVLClient(api_key=settings.QWEN_API_KEY, base_url=settings.QWEN_BASE_URL)


def _r2_url_for_footage(filename: str) -> str:
    settings = get_settings()
    base = (settings.R2_PUBLIC_URL_BASE or "").rstrip("/")
    return f"{base}/raw_footage/{filename}" if base else ""


@router.get("/footage", response_model=RawFootageListResponse)
async def list_footage(
    current_user: dict = Depends(get_current_user)
) -> RawFootageListResponse:
    """List raw footage chunks (1-hour files) from the footage directory and R2."""
    settings = get_settings()
    footage_dir = Path(settings.RAW_FOOTAGE_DIR)
    items: list[RawFootageItem] = []
    if not footage_dir.exists():
        return RawFootageListResponse(chunks=[])

    for path in sorted(footage_dir.glob("footage_*.mp4"), key=lambda p: p.stat().st_mtime, reverse=True):
        name = path.name
        try:
            stat = path.stat()
            size_bytes = stat.st_size
        except OSError:
            size_bytes = 0
        # Parse footage_YYYYMMDD_HHMMSS.mp4 or footage_YYYYMMDD_HHMMSS_partial.mp4
        stem = path.stem  # footage_20260218_160000 or footage_20260218_160000_partial
        parts = stem.replace("footage_", "").split("_")
        date_str = parts[0] if len(parts) >= 1 else ""  # 20260218
        time_str = parts[1] if len(parts) >= 2 else ""  # 160000
        if len(date_str) == 8:
            date_str = f"{date_str[:4]}-{date_str[4:6]}-{date_str[6:8]}"
        if len(time_str) == 6:
            time_str = f"{time_str[:2]}:{time_str[2:4]}:{time_str[4:6]}"
        video_url = _r2_url_for_footage(name)
        items.append(
            RawFootageItem(
                id=name,
                filename=name,
                date=date_str,
                time=time_str,
                size_bytes=size_bytes,
                video_url=video_url,
            )
        )

    # Optionally include a synthetic "live" item for the in-progress hour
    has_live, seg_done, seg_total = get_live_raw_segments_state()
    if has_live:
        now = datetime.utcnow()
        items.insert(
            0,
            RawFootageItem(
                id="__live__",
                filename="__live__",
                date=now.date().isoformat(),
                time=now.strftime("%H:%M:%S"),
                size_bytes=0,
                video_url="",
                is_live=True,
                segments_done=seg_done,
                segments_total=seg_total,
            ),
        )

    return RawFootageListResponse(chunks=items)


@router.get("/videos/{file_path:path}")
async def get_raw_video(
    file_path: str,
    request: Request,
    token: str | None = None,
):
    """Serve raw footage video file (auth via Bearer or ?token=)."""
    raw_token: str | None = token
    if not raw_token:
        auth_header = request.headers.get("authorization") or request.headers.get("Authorization")
        if auth_header and auth_header.lower().startswith("bearer "):
            raw_token = auth_header.split(" ", 1)[1].strip()
    if not raw_token:
        raise HTTPException(status_code=401, detail="Missing authentication token")
    AuthService().verify_token(raw_token)

    settings = get_settings()
    footage_dir = Path(settings.RAW_FOOTAGE_DIR).resolve()
    video_path = (footage_dir / file_path).resolve()
    try:
        video_path.relative_to(footage_dir)
    except ValueError:
        raise HTTPException(status_code=403, detail="Invalid file path")
    if not video_path.exists():
        raise HTTPException(status_code=404, detail="Video not found")

    ext = video_path.suffix.lower()
    content_types = {
        ".mp4": "video/mp4",
        ".avi": "video/x-msvideo",
        ".mov": "video/quicktime",
        ".mkv": "video/x-matroska",
        ".webm": "video/webm",
    }
    media_type = content_types.get(ext, "video/mp4")
    return FileResponse(
        video_path,
        media_type=media_type,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Disposition": f'inline; filename="{video_path.name}"',
        },
    )


@router.post("", response_model=AnalysisResponse)
async def query_footage_chunks(
    request: RawQueryRequest,
    current_user: dict = Depends(get_current_user),
) -> AnalysisResponse:
    """Run analysis on 1 or 2 selected raw footage chunks using Qwen 3 VL Flash."""
    settings = get_settings()
    qwen_client = _get_qwen_client()
    results: list[AnalysisResult] = []
    footage_dir = Path(settings.RAW_FOOTAGE_DIR)

    for chunk_id in request.chunk_ids:
        # Special handling for in-progress hour: synthesize a temporary concat and upload
        if chunk_id == "__live__":
            video_url = create_temp_raw_concat_for_query()
            local_path = None
            if not video_url:
                results.append(
                    AnalysisResult(
                        video_url="",
                        local_path=None,
                        analysis=None,
                        error="No raw footage available yet for live hour.",
                    )
                )
                continue
        else:
            # Resolve to R2 URL (preferred for Qwen) or local path
            video_url = _r2_url_for_footage(chunk_id)
            if not video_url and settings.R2_PUBLIC_URL_BASE:
                video_url = f"{settings.R2_PUBLIC_URL_BASE.rstrip('/')}/raw_footage/{chunk_id}"
            local_path = footage_dir / chunk_id if (footage_dir / chunk_id).exists() else None

        try:
            analysis_output = qwen_client.analyze_video_flash(
                video_url=video_url,
                user_query=request.query,
                fps=settings.VIDEO_FPS,
            )
            results.append(
                AnalysisResult(
                    video_url=video_url,
                    local_path=chunk_id,
                    analysis=analysis_output,
                    error=None,
                )
            )
        except QwenAPIError as e:
            logger.warning(f"Qwen analysis failed for {chunk_id}: {e}")
            results.append(
                AnalysisResult(
                    video_url=video_url,
                    local_path=chunk_id,
                    analysis=None,
                    error=str(e),
                )
            )
        except Exception as e:
            logger.exception(f"Unexpected error analyzing {chunk_id}")
            results.append(
                AnalysisResult(
                    video_url=video_url,
                    local_path=chunk_id,
                    analysis=None,
                    error=str(e),
                )
            )

    return AnalysisResponse(results=results, query=request.query)
