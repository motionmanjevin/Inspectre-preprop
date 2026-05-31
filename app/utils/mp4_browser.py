"""MP4 helpers for reliable HTML5 <video> playback in browsers."""
from __future__ import annotations

import logging
import subprocess
from pathlib import Path

logger = logging.getLogger(__name__)


def remux_faststart_copy(video_path: str, timeout: int = 120) -> bool:
    """Move moov to file start via stream copy (fast, fixes moov-at-end only)."""
    path = Path(video_path)
    if not path.exists() or path.stat().st_size == 0:
        return False
    temp_path = path.with_suffix(".faststart.tmp.mp4")
    try:
        cmd = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            str(path),
            "-c",
            "copy",
            "-movflags",
            "+faststart",
            str(temp_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if result.returncode != 0:
            logger.debug("Faststart copy failed for %s: %s", path.name, result.stderr)
            return False
        if not temp_path.exists() or temp_path.stat().st_size == 0:
            return False
        temp_path.replace(path)
        return True
    except Exception as e:
        logger.debug("Faststart copy error for %s: %s", path.name, e)
        return False
    finally:
        temp_path.unlink(missing_ok=True)


def reencode_for_browser(video_path: str, timeout: int = 7200) -> bool:
    """
    Re-encode to H.264 yuv420p with faststart (fixes concat timestamp/mux issues).
    Overwrites the input file on success.
    """
    path = Path(video_path)
    if not path.exists() or path.stat().st_size == 0:
        return False
    temp_path = path.with_suffix(".browser.tmp.mp4")
    try:
        cmd = [
            "ffmpeg",
            "-y",
            "-hide_banner",-
            "-loglevel",
            "error",
            "-i",
            str(path),
            "-c:v",
            "libx264",
            "-preset",
            "veryfast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            "-movflags",
            "+faststart",
            "-an",
            str(temp_path),
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        if result.returncode != 0:
            logger.warning("Browser re-encode failed for %s: %s", path.name, result.stderr)
            return False
        if not temp_path.exists() or temp_path.stat().st_size == 0:
            logger.warning("Browser re-encode produced empty output for %s", path.name)
            return False
        temp_path.replace(path)
        logger.info("Re-encoded for browser playback: %s", path.name)
        return True
    except subprocess.TimeoutExpired:
        logger.warning("Browser re-encode timed out for %s", path.name)
        return False
    except Exception as e:
        logger.warning("Browser re-encode error for %s: %s", path.name, e)
        return False
    finally:
        temp_path.unlink(missing_ok=True)
