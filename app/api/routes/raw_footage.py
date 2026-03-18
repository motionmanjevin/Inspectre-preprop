"""Raw footage API: list 1-hour chunks, serve video, query selected chunks with Qwen VL."""
import logging
import subprocess
import threading
import uuid
from datetime import datetime
from enum import Enum
from pathlib import Path
from typing import Callable, Dict, List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from app.api.dependencies import get_current_user
from app.api.models.responses import AnalysisResponse, AnalysisResult
from app.core.config import get_settings
from app.services.auth_service import AuthService
from app.services.qwen_client import QwenVLClient
from app.utils.exceptions import QwenAPIError

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/raw", tags=["raw-footage"])


class RawFootageItem(BaseModel):
    """Single raw footage chunk (1-hour file)."""
    id: str = Field(..., description="Filename (e.g. footage_20260218_160000.mp4)")
    filename: str = Field(..., description="Same as id")
    date: str = Field(..., description="Date YYYY-MM-DD from filename")
    time: str = Field(..., description="Time HH:MM:SS from filename")
    size_bytes: int = Field(0, description="File size in bytes")
    duration_seconds: float = Field(0, description="Duration of the video in seconds")
    video_url: str = Field(..., description="R2 public URL for playback/analysis")
    is_live: bool = Field(False, description="Whether this item represents the current in-progress hour")
    segments_done: int = Field(0, description="Number of 1-minute segments recorded so far (for live item)")
    segments_total: int = Field(60, description="Total segments per hour (typically 60)")


def _get_video_duration(path: Path) -> float:
    """Get video duration in seconds using ffprobe."""
    try:
        result = subprocess.run(
            ["ffprobe", "-v", "quiet", "-print_format", "json", "-show_format", str(path)],
            capture_output=True, text=True, timeout=5,
        )
        if result.returncode == 0:
            import json
            info = json.loads(result.stdout)
            return float(info.get("format", {}).get("duration", 0))
    except Exception:
        pass
    return 0


class RawFootageListResponse(BaseModel):
    """List of raw footage chunks (newest first)."""
    chunks: list[RawFootageItem] = Field(..., description="Footage files")


class RawQueryRequest(BaseModel):
    """Request to run analysis on one or more selected raw chunks."""
    query: str = Field(..., description="Analysis query")
    chunk_ids: list[str] = Field(
        ...,
        min_length=1,
        description="One or more chunk filenames (e.g. footage_20260218_160000.mp4, or '__live__' for current hour)",
    )


class RawJobStatus(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class RawQueryJob(BaseModel):
    """In-memory job for incremental raw footage analysis."""

    id: str
    query: str
    chunk_ids: List[str]
    status: RawJobStatus
    created_at: datetime
    updated_at: datetime
    total_chunks: int
    completed_chunks: int
    results: List[AnalysisResult] = Field(default_factory=list)
    error: Optional[str] = None


class RawJobCreateResponse(BaseModel):
    job_id: str
    total_chunks: int


class RawJobStatusResponse(BaseModel):
    job_id: str
    status: RawJobStatus
    total_chunks: int
    completed_chunks: int
    results: List[AnalysisResult]
    error: Optional[str] = None


_jobs_lock = threading.Lock()
_jobs: Dict[str, RawQueryJob] = {}


def _get_qwen_client() -> QwenVLClient:
    settings = get_settings()
    return QwenVLClient(api_key=settings.QWEN_API_KEY, base_url=settings.QWEN_BASE_URL)


def _r2_url_for_footage(filename: str) -> str:
    settings = get_settings()
    base = (settings.R2_PUBLIC_URL_BASE or "").rstrip("/")
    return f"{base}/raw_footage/{filename}" if base else ""


def _ensure_footage_on_r2(filename: str, footage_dir: Path) -> str:
    """
    If the footage file exists locally but not on R2, upload it and return the R2 public URL.
    Otherwise return the R2 URL (assumed already uploaded).
    """
    local_path = footage_dir / filename
    object_key = f"raw_footage/{filename}"
    if not local_path.exists():
        return _r2_url_for_footage(filename)
    try:
        from app.main import get_r2_uploader
        r2 = get_r2_uploader()
        if not r2.object_exists(object_key):
            r2.upload_file(str(local_path), object_key=object_key)
            logger.info("Uploaded local raw footage to R2 for query: %s", object_key)
    except Exception as e:
        logger.warning("Could not ensure footage on R2 (%s): %s", filename, e)
    return _r2_url_for_footage(filename)


def get_live_raw_segments_state() -> tuple[bool, int, int]:
    """
    Lazy proxy to avoid import-time circular dependency with app.main.
    """
    from app.main import get_live_raw_segments_state as _inner

    return _inner()


def create_temp_raw_concat_for_query() -> str | None:
    """
    Lazy proxy to avoid import-time circular dependency with app.main.
    """
    from app.main import create_temp_raw_concat_for_query as _inner

    return _inner()


def cleanup_temp_raw_queries() -> int:
    """
    Lazy proxy to avoid import-time circular dependency with app.main.
    """
    from app.main import cleanup_temp_raw_queries as _inner

    return _inner()


def _process_raw_chunks(
    query: str,
    chunk_ids: List[str],
    settings,
    qwen_client: QwenVLClient,
    per_result: Optional[Callable[[AnalysisResult], None]] = None,
) -> List[AnalysisResult]:
    """Core logic to analyze one or more raw chunks, optionally streaming per-result callbacks."""
    results: List[AnalysisResult] = []
    footage_dir = Path(settings.RAW_FOOTAGE_DIR)

    for chunk_id in chunk_ids:
        # Special handling for in-progress hour: synthesize a temporary concat and upload
        if chunk_id == "__live__":
            video_url = create_temp_raw_concat_for_query()
            local_path = None
            if not video_url:
                result = AnalysisResult(
                    video_url="",
                    local_path=None,
                    analysis=None,
                    error="No raw footage available yet for live hour.",
                )
                results.append(result)
                if per_result:
                    per_result(result)
                continue
        else:
            # Ensure chunk is on R2 (upload from local if saved with "reliable internet" off)
            video_url = _ensure_footage_on_r2(chunk_id, footage_dir)
            if not video_url and settings.R2_PUBLIC_URL_BASE:
                video_url = f"{settings.R2_PUBLIC_URL_BASE.rstrip('/')}/raw_footage/{chunk_id}"
            local_path = footage_dir / chunk_id if (footage_dir / chunk_id).exists() else None

        try:
            analysis_output = qwen_client.analyze_video_flash(
                video_url=video_url,
                user_query=query,
                fps=settings.VIDEO_FPS,
            )
            result = AnalysisResult(
                video_url=video_url,
                local_path=chunk_id,
                analysis=analysis_output,
                error=None,
            )
        except QwenAPIError as e:
            logger.warning(f"Qwen analysis failed for {chunk_id}: {e}")
            result = AnalysisResult(
                video_url=video_url,
                local_path=chunk_id,
                analysis=None,
                error=str(e),
            )
        except Exception as e:
            logger.exception(f"Unexpected error analyzing {chunk_id}")
            result = AnalysisResult(
                video_url=video_url,
                local_path=chunk_id,
                analysis=None,
                error=str(e),
            )

        results.append(result)
        if per_result:
            per_result(result)

    return results


def _start_raw_query_job(job: RawQueryJob) -> None:
    """Start a background thread to process a raw query job sequentially."""

    def _runner() -> None:
        settings = get_settings()
        qwen_client = _get_qwen_client()
        try:
            with _jobs_lock:
                stored = _jobs.get(job.id)
                if not stored:
                    return
                stored.status = RawJobStatus.RUNNING
                stored.updated_at = datetime.utcnow()

            def _on_result(result: AnalysisResult) -> None:
                with _jobs_lock:
                    stored_inner = _jobs.get(job.id)
                    if not stored_inner:
                        return
                    stored_inner.results.append(result)
                    stored_inner.completed_chunks += 1
                    stored_inner.updated_at = datetime.utcnow()

            _process_raw_chunks(
                query=job.query,
                chunk_ids=job.chunk_ids,
                settings=settings,
                qwen_client=qwen_client,
                per_result=_on_result,
            )

            with _jobs_lock:
                stored = _jobs.get(job.id)
                if stored:
                    stored.status = RawJobStatus.COMPLETED
                    stored.updated_at = datetime.utcnow()
        except Exception as exc:  # pragma: no cover - defensive
            logger.exception("Raw query job %s failed", job.id)
            with _jobs_lock:
                stored = _jobs.get(job.id)
                if stored:
                    stored.status = RawJobStatus.FAILED
                    stored.error = str(exc)
                    stored.updated_at = datetime.utcnow()

    thread = threading.Thread(target=_runner, name=f"RawQueryJob-{job.id}", daemon=True)
    thread.start()


# --- Autopilot: run fixed query on each chunk in time range as it is finalized ---


def maybe_run_autopilot_for_chunk(filename: str) -> None:
    """If autopilot is active and chunk is in range and not yet processed, run analysis in background."""
    from app.services import autopilot_service

    if not autopilot_service.get_config():
        logger.debug("Autopilot skip %s: no config", filename)
        return
    if not autopilot_service.chunk_in_autopilot_range(filename):
        logger.info("Autopilot skip %s: chunk not in configured time range", filename)
        return
    if autopilot_service.has_result_for_chunk(filename):
        logger.debug("Autopilot skip %s: already has result", filename)
        return
    logger.info("Autopilot starting for chunk %s", filename)
    thread = threading.Thread(
        target=_run_autopilot_for_chunk,
        args=(filename,),
        daemon=True,
        name="AutopilotChunk",
    )
    thread.start()


def _run_autopilot_for_chunk(filename: str) -> None:
    """Upload chunk to R2 if needed, run autopilot query, store result. Retries on failure are handled by caller (reconnect/startup)."""
    from datetime import timedelta

    from app.services import autopilot_service

    settings = get_settings()
    footage_dir = Path(settings.RAW_FOOTAGE_DIR)
    cfg = autopilot_service.get_config()
    if not cfg:
        return
    if autopilot_service.has_result_for_chunk(filename):
        return
    prompt = cfg["prompt"]
    video_url = _ensure_footage_on_r2(filename, footage_dir)
    if not video_url:
        video_url = _r2_url_for_footage(filename)
    local_path = footage_dir / filename
    duration = _get_video_duration(local_path) if local_path.exists() else 3600.0
    start_iso = autopilot_service.chunk_start_iso_from_filename(filename) or ""
    start_dt = None
    if start_iso:
        try:
            start_dt = datetime.fromisoformat(start_iso.replace("Z", "+00:00"))
        except ValueError:
            pass
    end_iso = ""
    if start_dt:
        end_dt = start_dt + timedelta(seconds=duration)
        end_iso = end_dt.strftime("%Y-%m-%dT%H:%M:%S") + "Z"
    try:
        qwen_client = _get_qwen_client()
        analysis_output = qwen_client.analyze_video_flash(
            video_url=video_url,
            user_query=prompt,
            fps=settings.VIDEO_FPS,
        )
        autopilot_service.add_result(
            chunk_id=filename,
            prompt=prompt,
            analysis=analysis_output,
            error=None,
            video_url=video_url,
            chunk_start_iso=start_iso,
            chunk_end_iso=end_iso,
        )
        logger.info("Autopilot completed for %s", filename)
    except QwenAPIError as e:
        logger.warning("Autopilot Qwen failed for %s: %s", filename, e)
        autopilot_service.add_result(
            chunk_id=filename,
            prompt=prompt,
            analysis=None,
            error=str(e),
            video_url=video_url or "",
            chunk_start_iso=start_iso,
            chunk_end_iso=end_iso,
        )
    except Exception as e:
        logger.exception("Autopilot failed for %s", filename)
        autopilot_service.add_result(
            chunk_id=filename,
            prompt=prompt,
            analysis=None,
            error=str(e),
            video_url=video_url or "",
            chunk_start_iso=start_iso,
            chunk_end_iso=end_iso,
        )


def process_pending_autopilot_chunks() -> None:
    """Process all chunks in the autopilot time range that do not yet have a result (e.g. after reconnect or startup)."""
    from app.services import autopilot_service

    cfg = autopilot_service.get_config()
    if not cfg:
        return
    settings = get_settings()
    footage_dir = Path(settings.RAW_FOOTAGE_DIR)
    if not footage_dir.exists():
        return
    pending = []
    for path in footage_dir.glob("footage_*.mp4"):
        name = path.name
        if autopilot_service.chunk_in_autopilot_range(name) and not autopilot_service.has_result_for_chunk(name):
            pending.append(name)
    for filename in pending:
        maybe_run_autopilot_for_chunk(filename)


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
        duration = _get_video_duration(path)
        items.append(
            RawFootageItem(
                id=name,
                filename=name,
                date=date_str,
                time=time_str,
                size_bytes=size_bytes,
                duration_seconds=duration,
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


@router.get("/thumbnails/{file_path:path}")
async def get_raw_thumbnail(
    file_path: str,
    request: Request,
    token: str | None = None,
):
    """Serve a cached JPEG thumbnail for a raw footage file. Generated on first request via FFmpeg."""
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

    thumbs_dir = footage_dir / ".thumbs"
    thumbs_dir.mkdir(exist_ok=True)
    thumb_path = thumbs_dir / f"{video_path.stem}.jpg"

    if not thumb_path.exists():
        try:
            cmd = [
                "ffmpeg", "-y",
                "-ss", "1",
                "-i", str(video_path),
                "-frames:v", "1",
                "-vf", "scale=320:-1",
                "-q:v", "5",
                str(thumb_path),
            ]
            subprocess.run(cmd, capture_output=True, timeout=10)
        except Exception as exc:
            logger.warning("Thumbnail generation failed for %s: %s", file_path, exc)

    if not thumb_path.exists():
        raise HTTPException(status_code=500, detail="Failed to generate thumbnail")

    return FileResponse(
        thumb_path,
        media_type="image/jpeg",
        headers={"Cache-Control": "public, max-age=86400"},
    )


@router.post("", response_model=AnalysisResponse)
async def query_footage_chunks(
    request: RawQueryRequest,
    current_user: dict = Depends(get_current_user),

) -> AnalysisResponse:
    """Run analysis on one or more selected raw footage chunks (synchronously)."""
    settings = get_settings()
    qwen_client = _get_qwen_client()
    results = _process_raw_chunks(
        query=request.query,
        chunk_ids=request.chunk_ids,
        settings=settings,
        qwen_client=qwen_client,
        per_result=None,
    )
    return AnalysisResponse(results=results, query=request.query)


@router.post("/jobs", response_model=RawJobCreateResponse)
async def create_raw_query_job(
    request: RawQueryRequest,
    current_user: dict = Depends(get_current_user),
) -> RawJobCreateResponse:
    """Create a background job to process multiple raw chunks sequentially with incremental results."""
    now = datetime.utcnow()
    job_id = str(uuid.uuid4())
    job = RawQueryJob(
        id=job_id,
        query=request.query,
        chunk_ids=list(request.chunk_ids),
        status=RawJobStatus.PENDING,
        created_at=now,
        updated_at=now,
        total_chunks=len(request.chunk_ids),
        completed_chunks=0,
        results=[],
        error=None,
    )
    with _jobs_lock:
        _jobs[job_id] = job

    _start_raw_query_job(job)

    return RawJobCreateResponse(job_id=job_id, total_chunks=job.total_chunks)


@router.get("/jobs/{job_id}", response_model=RawJobStatusResponse)
async def get_raw_query_job_status(
    job_id: str,
    current_user: dict = Depends(get_current_user),
) -> RawJobStatusResponse:
    """Get current status and partial results for a raw query job."""
    with _jobs_lock:
        job = _jobs.get(job_id)
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        # Return a shallow copy snapshot to avoid mutation races
        return RawJobStatusResponse(
            job_id=job.id,
            status=job.status,
            total_chunks=job.total_chunks,
            completed_chunks=job.completed_chunks,
            results=list(job.results),
            error=job.error,
        )


@router.post("/cleanup-temp")
async def cleanup_temp_raw_query_artifacts(
    current_user: dict = Depends(get_current_user),
) -> dict:
    """
    Explicitly clean up temporary raw query concats (R2 objects and local files).

    Intended to be called when the user refreshes/leaves the raw footage page
    in the frontend/mobile app, so that live-query temp videos remain available
    while the user is still interacting with them.
    """
    cleaned = cleanup_temp_raw_queries()
    return {"status": "ok", "cleaned": cleaned}
