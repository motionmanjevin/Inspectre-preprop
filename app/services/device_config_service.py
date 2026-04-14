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
from typing import Optional, Dict, Any, List
from app.core.config import get_settings

logger = logging.getLogger(__name__)

_DB_PATH = Path("users.db")
_lock = threading.Lock()
_DEFAULT_MULTI_CAMERAS = [
    {"slot": 1, "name": "Cam 1", "rtsp_url": "", "enabled": False},
    {"slot": 2, "name": "Cam 2", "rtsp_url": "", "enabled": False},
    {"slot": 3, "name": "Cam 3", "rtsp_url": "", "enabled": False},
    {"slot": 4, "name": "Cam 4", "rtsp_url": "", "enabled": False},
]

_REQUIRED_SETUP_FIELDS = [
    "r2_account_id",
    "r2_access_key_id",
    "r2_secret_access_key",
    "r2_bucket_name",
    "r2_public_url_base",
]


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
                camera_mode TEXT NOT NULL DEFAULT 'single',
                multi_cameras_json TEXT NOT NULL DEFAULT '[]',
                setup_deferred INTEGER NOT NULL DEFAULT 0,
                setup_completed INTEGER NOT NULL DEFAULT 0,
                setup_completed_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT ''
            )
        """)
        # Safe migrations for existing installs
        cols = {row["name"] for row in conn.execute("PRAGMA table_info(device_config)").fetchall()}
        if "camera_mode" not in cols:
            conn.execute("ALTER TABLE device_config ADD COLUMN camera_mode TEXT NOT NULL DEFAULT 'single'")
        if "multi_cameras_json" not in cols:
            conn.execute("ALTER TABLE device_config ADD COLUMN multi_cameras_json TEXT NOT NULL DEFAULT '[]'")
        if "setup_deferred" not in cols:
            conn.execute("ALTER TABLE device_config ADD COLUMN setup_deferred INTEGER NOT NULL DEFAULT 0")
        if "setup_completed" not in cols:
            conn.execute("ALTER TABLE device_config ADD COLUMN setup_completed INTEGER NOT NULL DEFAULT 0")
        if "setup_completed_at" not in cols:
            conn.execute("ALTER TABLE device_config ADD COLUMN setup_completed_at TEXT NOT NULL DEFAULT ''")
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
        cfg = dict(row)
        cfg["camera_mode"] = (cfg.get("camera_mode") or "single").strip().lower()
        if cfg["camera_mode"] not in {"single", "multi"}:
            cfg["camera_mode"] = "single"
        cfg["multi_cameras_json"] = normalize_multi_cameras(cfg.get("multi_cameras_json"))
        cfg["setup_deferred"] = bool(cfg.get("setup_deferred", 0))
        cfg["setup_completed"] = bool(cfg.get("setup_completed", 0))
        cfg["setup_completed_at"] = str(cfg.get("setup_completed_at") or "")
        return cfg


def normalize_multi_cameras(raw_value: Any) -> list[Dict[str, Any]]:
    """Normalize raw multi camera JSON into a strict 4-slot structure."""
    parsed: list[Dict[str, Any]] = []
    if isinstance(raw_value, str):
        try:
            decoded = json.loads(raw_value or "[]")
            if isinstance(decoded, list):
                parsed = decoded
        except Exception:
            parsed = []
    elif isinstance(raw_value, list):
        parsed = raw_value

    merged = [dict(item) for item in _DEFAULT_MULTI_CAMERAS]
    for idx, entry in enumerate(parsed[:4]):
        if not isinstance(entry, dict):
            continue
        slot = entry.get("slot", idx + 1)
        if not isinstance(slot, int) or slot < 1 or slot > 4:
            slot = idx + 1
        name = str(entry.get("name") or f"Cam {slot}").strip() or f"Cam {slot}"
        rtsp_url = str(entry.get("rtsp_url") or "").strip()
        enabled = bool(entry.get("enabled", bool(rtsp_url)))
        merged[slot - 1] = {"slot": slot, "name": name, "rtsp_url": rtsp_url, "enabled": enabled}
    return merged


def get_active_multi_cameras(cfg: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Return enabled multi-camera slots with non-empty RTSP URLs."""
    use_cfg = cfg or get_device_config() or {}
    cams = normalize_multi_cameras(use_cfg.get("multi_cameras_json"))
    return [c for c in cams if c.get("enabled") and (c.get("rtsp_url") or "").strip()]


def get_setup_missing_fields(cfg: Optional[Dict[str, Any]] = None) -> List[str]:
    """
    Return missing configuration keys for 'full_device_config' completion policy.

    Required:
    - Camera setup (single: rtsp_url, multi: at least one active camera)
    - R2 credentials/public base
    - SMTP settings
    """
    use_cfg = cfg or get_device_config() or {}
    missing: List[str] = []

    camera_mode = str(use_cfg.get("camera_mode") or "single").strip().lower()
    if camera_mode == "multi":
        if not get_active_multi_cameras(use_cfg):
            missing.append("camera.multi_active_stream")
    else:
        if not str(use_cfg.get("rtsp_url") or "").strip():
            missing.append("camera.rtsp_url")

    for key in _REQUIRED_SETUP_FIELDS:
        if not str(use_cfg.get(key) or "").strip():
            missing.append(key)
    settings = get_settings()
    if not str(settings.SMTP_HOST or "").strip():
        missing.append("env.SMTP_HOST")
    if not str(settings.SMTP_USERNAME or "").strip():
        missing.append("env.SMTP_USERNAME")
    if not str(settings.SMTP_PASSWORD or "").strip():
        missing.append("env.SMTP_PASSWORD")
    if int(getattr(settings, "SMTP_PORT", 0) or 0) <= 0:
        missing.append("env.SMTP_PORT")

    return missing


def is_full_setup_complete(cfg: Optional[Dict[str, Any]] = None) -> bool:
    """True when all required setup fields are present."""
    return len(get_setup_missing_fields(cfg)) == 0


def upsert_device_config(data: Dict[str, Any]) -> Dict[str, Any]:
    """Insert or update the device config (always id=1). Returns the saved config."""
    from datetime import datetime
    data["updated_at"] = datetime.utcnow().isoformat()
    data.pop("id", None)
    if "camera_mode" in data:
        mode = str(data.get("camera_mode") or "single").strip().lower()
        data["camera_mode"] = mode if mode in {"single", "multi"} else "single"
    if "multi_cameras_json" in data:
        data["multi_cameras_json"] = json.dumps(normalize_multi_cameras(data["multi_cameras_json"]))
    if "setup_deferred" in data:
        data["setup_deferred"] = 1 if bool(data["setup_deferred"]) else 0
    if "setup_completed" in data:
        data["setup_completed"] = 1 if bool(data["setup_completed"]) else 0
    if "setup_completed_at" in data:
        data["setup_completed_at"] = str(data.get("setup_completed_at") or "")

    columns = [
        "rtsp_url", "camera_name", "video_preprompt",
        "r2_account_id", "r2_access_key_id", "r2_secret_access_key",
        "r2_bucket_name", "r2_public_url_base",
        "smtp_host", "smtp_port", "smtp_username", "smtp_password",
        "smtp_from_address", "smtp_use_tls",
        "reliable_internet",
        "last_tunnel_url", "last_recording_active",
        "local_storage_max_gb", "r2_max_gb",
        "camera_mode", "multi_cameras_json",
        "setup_deferred", "setup_completed", "setup_completed_at",
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
        if not row:
            return {}
        saved = dict(row)
        saved["camera_mode"] = (saved.get("camera_mode") or "single").strip().lower()
        if saved["camera_mode"] not in {"single", "multi"}:
            saved["camera_mode"] = "single"
        saved["multi_cameras_json"] = normalize_multi_cameras(saved.get("multi_cameras_json"))
        saved["setup_deferred"] = bool(saved.get("setup_deferred", 0))
        saved["setup_completed"] = bool(saved.get("setup_completed", 0))
        saved["setup_completed_at"] = str(saved.get("setup_completed_at") or "")
        return saved


def set_last_tunnel_url(url: str) -> None:
    """Shortcut to persist the last known tunnel URL."""
    upsert_device_config({"last_tunnel_url": url})


def set_recording_active(active: bool) -> None:
    """Persist whether raw recording was active (for resume after crash)."""
    upsert_device_config({"last_recording_active": 1 if active else 0})


def has_device_config() -> bool:
    """Return True if a device config row exists (i.e. initial setup was done)."""
    return get_device_config() is not None
