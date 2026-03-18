"""Device configuration persistence service.

Stores per-device settings (camera, R2, SMTP, Cloudflare, video_preprompt, etc.)
separately from the static .env file. These are user-editable at registration
and from the Settings page.
"""
import json
import logging
import sqlite3
import threading
from pathlib import Path
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)

_DB_PATH = Path("users.db")
_lock = threading.Lock()


def _get_conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def init_device_config_table() -> None:
    """Create the device_config table if it doesn't exist."""
    with _lock:
        conn = _get_conn()
        conn.execute("""
            CREATE TABLE IF NOT EXISTS device_config (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                rtsp_url TEXT NOT NULL DEFAULT '',
                camera_name TEXT NOT NULL DEFAULT '',
                video_preprompt TEXT NOT NULL DEFAULT '',
                r2_account_id TEXT NOT NULL DEFAULT '',
                r2_access_key_id TEXT NOT NULL DEFAULT '',
                r2_secret_access_key TEXT NOT NULL DEFAULT '',
                r2_bucket_name TEXT NOT NULL DEFAULT '',
                r2_public_url_base TEXT NOT NULL DEFAULT '',
                smtp_host TEXT NOT NULL DEFAULT '',
                smtp_port INTEGER NOT NULL DEFAULT 587,
                smtp_username TEXT NOT NULL DEFAULT '',
                smtp_password TEXT NOT NULL DEFAULT '',
                smtp_from_address TEXT NOT NULL DEFAULT '',
                smtp_use_tls INTEGER NOT NULL DEFAULT 1,
                reliable_internet INTEGER NOT NULL DEFAULT 1,
                last_tunnel_url TEXT NOT NULL DEFAULT '',
                last_recording_active INTEGER NOT NULL DEFAULT 0,
                local_storage_max_gb REAL NOT NULL DEFAULT 50.0,
                r2_max_gb REAL NOT NULL DEFAULT 10.0,
                updated_at TEXT NOT NULL DEFAULT ''
            )
        """)
        conn.commit()
        conn.close()


def get_device_config() -> Optional[Dict[str, Any]]:
    """Return the single device config row, or None if not yet created."""
    with _lock:
        conn = _get_conn()
        row = conn.execute("SELECT * FROM device_config WHERE id = 1").fetchone()
        conn.close()
        if row is None:
            return None
        return dict(row)


def upsert_device_config(data: Dict[str, Any]) -> Dict[str, Any]:
    """Insert or update the device config (always id=1). Returns the saved config."""
    from datetime import datetime
    data["updated_at"] = datetime.utcnow().isoformat()
    data.pop("id", None)

    columns = [
        "rtsp_url", "camera_name", "video_preprompt",
        "r2_account_id", "r2_access_key_id", "r2_secret_access_key",
        "r2_bucket_name", "r2_public_url_base",
        "smtp_host", "smtp_port", "smtp_username", "smtp_password",
        "smtp_from_address", "smtp_use_tls",
        "reliable_internet",
        "last_tunnel_url", "last_recording_active",
        "local_storage_max_gb", "r2_max_gb",
        "updated_at",
    ]

    filtered = {k: data[k] for k in columns if k in data}
    if not filtered:
        return get_device_config() or {}

    with _lock:
        conn = _get_conn()
        existing = conn.execute("SELECT id FROM device_config WHERE id = 1").fetchone()
        if existing:
            set_clause = ", ".join(f"{k} = ?" for k in filtered)
            conn.execute(
                f"UPDATE device_config SET {set_clause} WHERE id = 1",
                list(filtered.values()),
            )
        else:
            filtered["id"] = 1
            cols = ", ".join(filtered.keys())
            placeholders = ", ".join("?" for _ in filtered)
            conn.execute(
                f"INSERT INTO device_config ({cols}) VALUES ({placeholders})",
                list(filtered.values()),
            )
        conn.commit()
        row = conn.execute("SELECT * FROM device_config WHERE id = 1").fetchone()
        conn.close()
        return dict(row) if row else {}


def set_last_tunnel_url(url: str) -> None:
    """Shortcut to persist the last known tunnel URL."""
    upsert_device_config({"last_tunnel_url": url})


def set_recording_active(active: bool) -> None:
    """Persist whether raw recording was active (for resume after crash)."""
    upsert_device_config({"last_recording_active": 1 if active else 0})


def has_device_config() -> bool:
    """Return True if a device config row exists (i.e. initial setup was done)."""
    return get_device_config() is not None
