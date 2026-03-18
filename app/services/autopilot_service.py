"""Autopilot: run a fixed query on every raw chunk within a time range as chunks are finalized.

This module now stores state in the main SQLite database (users.db) instead of JSON files.
"""
import logging
import sqlite3
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, List, Dict, Any

logger = logging.getLogger(__name__)

_DB_PATH = Path("users.db")
_lock = threading.Lock()
_MAX_RANGE_HOURS = 24


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def _init_tables() -> None:
    """Create autopilot tables if they don't exist."""
    with _lock:
        conn = _get_conn()
        try:
            # Single-row config (id=1)
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS autopilot_config (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    prompt TEXT NOT NULL DEFAULT '',
                    range_start_iso TEXT NOT NULL DEFAULT '',
                    range_end_iso TEXT NOT NULL DEFAULT '',
                    updated_at TEXT NOT NULL DEFAULT ''
                )
                """
            )
            # Results table (one per chunk/run; keep simple for now)
            conn.execute(
                """
                CREATE TABLE IF NOT EXISTS autopilot_results (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    chunk_id TEXT NOT NULL,
                    prompt TEXT NOT NULL,
                    analysis TEXT,
                    error TEXT,
                    video_url TEXT NOT NULL DEFAULT '',
                    chunk_start_iso TEXT NOT NULL DEFAULT '',
                    chunk_end_iso TEXT NOT NULL DEFAULT '',
                    created_at_iso TEXT NOT NULL
                )
                """
            )
            conn.commit()
        finally:
            conn.close()


# Ensure tables exist on import
_init_tables()


def get_config() -> Optional[dict]:
    """Return current autopilot config or None if not set. Keys: prompt, range_start_iso, range_end_iso."""
    with _lock:
        conn = _get_conn()
        try:
            row = conn.execute("SELECT * FROM autopilot_config WHERE id = 1").fetchone()
        finally:
            conn.close()
    if row is None or not row["prompt"]:
        return None
    return dict(row)


def set_config(prompt: str, range_start_iso: str, range_end_iso: str) -> dict:
    """Set autopilot config. range_start/range_end are ISO datetime strings; range must be <= 24h."""
    start = datetime.fromisoformat(range_start_iso.replace("Z", "+00:00"))
    end = datetime.fromisoformat(range_end_iso.replace("Z", "+00:00"))
    if end <= start:
        raise ValueError("range_end must be after range_start")
    delta = end - start
    if delta.total_seconds() > _MAX_RANGE_HOURS * 3600:
        raise ValueError(f"Time range must be at most {_MAX_RANGE_HOURS} hours")
    prompt_clean = prompt.strip()
    updated_at = datetime.utcnow().isoformat() + "Z"
    with _lock:
        conn = _get_conn()
        try:
            existing = conn.execute("SELECT id FROM autopilot_config WHERE id = 1").fetchone()
            if existing:
                conn.execute(
                    """
                    UPDATE autopilot_config
                    SET prompt = ?, range_start_iso = ?, range_end_iso = ?, updated_at = ?
                    WHERE id = 1
                    """,
                    (prompt_clean, range_start_iso, range_end_iso, updated_at),
                )
            else:
                conn.execute(
                    """
                    INSERT INTO autopilot_config (id, prompt, range_start_iso, range_end_iso, updated_at)
                    VALUES (1, ?, ?, ?, ?)
                    """,
                    (prompt_clean, range_start_iso, range_end_iso, updated_at),
                )
            conn.commit()
        finally:
            conn.close()
    return {
        "prompt": prompt_clean,
        "range_start_iso": range_start_iso,
        "range_end_iso": range_end_iso,
        "updated_at": updated_at,
    }


def _chunk_datetime_from_filename(filename: str) -> Optional[datetime]:
    """Parse chunk start datetime from filename (footage_YYYYMMDD_HHMMSS.mp4 or _partial.mp4)."""
    stem = Path(filename).stem
    if not stem.startswith("footage_"):
        return None
    rest = stem.replace("footage_", "").replace("_partial", "")
    parts = rest.split("_")
    if len(parts) < 2:
        return None
    date_str, time_str = parts[0], parts[1]
    if len(date_str) != 8 or len(time_str) != 6:
        return None
    try:
        return datetime(
            int(date_str[:4]), int(date_str[4:6]), int(date_str[6:8]),
            int(time_str[:2]), int(time_str[2:4]), int(time_str[4:6]),
        )
    except ValueError:
        return None


def chunk_in_autopilot_range(filename: str) -> bool:
    """True if chunk filename's start time falls within the current autopilot range.
    Chunk filenames are in server local time (from datetime.fromtimestamp in main);
    we convert to UTC for comparison with the app-supplied range (UTC)."""
    cfg = get_config()
    if not cfg:
        return False
    dt = _chunk_datetime_from_filename(filename)
    if not dt:
        return False
    # Interpret naive dt as server local time, convert to UTC
    try:
        ts = time.mktime(dt.timetuple())
        dt_utc = datetime.fromtimestamp(ts, tz=timezone.utc)
    except (ValueError, OSError):
        dt_utc = dt.replace(tzinfo=timezone.utc)
    start = datetime.fromisoformat(cfg["range_start_iso"].replace("Z", "+00:00"))
    end = datetime.fromisoformat(cfg["range_end_iso"].replace("Z", "+00:00"))
    return start <= dt_utc <= end


def get_results() -> list:
    """List all autopilot results (newest first). Each item: chunk_id, prompt, analysis, error, video_url, chunk_start_iso, chunk_end_iso, created_at_iso."""
    with _lock:
        conn = _get_conn()
        try:
            rows: List[sqlite3.Row] = conn.execute(
                """
                SELECT chunk_id, prompt, analysis, error, video_url,
                       chunk_start_iso, chunk_end_iso, created_at_iso
                FROM autopilot_results
                ORDER BY datetime(created_at_iso) DESC, id DESC
                """
            ).fetchall()
        finally:
            conn.close()
    return [dict(r) for r in rows]


def add_result(
    chunk_id: str,
    prompt: str,
    analysis: Optional[str],
    error: Optional[str],
    video_url: str,
    chunk_start_iso: str,
    chunk_end_iso: str,
) -> None:
    """Append one autopilot result."""
    with _lock:
        conn = _get_conn()
        try:
            created_at_iso = datetime.utcnow().isoformat() + "Z"
            conn.execute(
                """
                INSERT INTO autopilot_results (
                    chunk_id, prompt, analysis, error, video_url,
                    chunk_start_iso, chunk_end_iso, created_at_iso
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    chunk_id,
                    prompt,
                    analysis,
                    error,
                    video_url,
                    chunk_start_iso,
                    chunk_end_iso,
                    created_at_iso,
                ),
            )
            conn.commit()
        finally:
            conn.close()


def has_result_for_chunk(chunk_id: str) -> bool:
    """True if we already have an autopilot result for this chunk_id."""
    with _lock:
        conn = _get_conn()
        try:
            row = conn.execute(
                "SELECT 1 FROM autopilot_results WHERE chunk_id = ? LIMIT 1",
                (chunk_id,),
            ).fetchone()
        finally:
            conn.close()
    return row is not None


def get_result_by_chunk_id(chunk_id: str) -> Optional[dict]:
    """Return the autopilot result for this chunk_id if any."""
    with _lock:
        conn = _get_conn()
        try:
            row = conn.execute(
                """
                SELECT chunk_id, prompt, analysis, error, video_url,
                       chunk_start_iso, chunk_end_iso, created_at_iso
                FROM autopilot_results
                WHERE chunk_id = ?
                ORDER BY datetime(created_at_iso) DESC, id DESC
                LIMIT 1
                """,
                (chunk_id,),
            ).fetchone()
        finally:
            conn.close()
    return dict(row) if row else None


def chunk_start_iso_from_filename(filename: str) -> Optional[str]:
    """Return ISO datetime string for chunk start from filename, or None."""
    dt = _chunk_datetime_from_filename(filename)
    if not dt:
        return None
    return dt.strftime("%Y-%m-%dT%H:%M:%S") + "Z"
