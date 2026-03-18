"""Startup orchestrator: connectivity checks, service init, offline mode, periodic retry.

Called from app.main startup_event and the /system/decision endpoint.
"""
import asyncio
import logging
import threading
import time
from typing import Optional

from app.core.connectivity import check_internet
from app.core.system_state import system_state, SystemMode
from app.services.device_config_service import (
    get_device_config,
    has_device_config,
    set_last_tunnel_url,
    set_recording_active,
)

logger = logging.getLogger(__name__)

_background_thread: Optional[threading.Thread] = None
_stream_waiter_running = False
_stream_waiter_lock = threading.Lock()


def has_any_user() -> bool:
    """Return True if at least one user account exists."""
    import sqlite3
    from pathlib import Path
    db = Path("users.db")
    if not db.exists():
        return False
    try:
        conn = sqlite3.connect(str(db))
        row = conn.execute("SELECT COUNT(*) FROM users").fetchone()
        conn.close()
        return row and row[0] > 0
    except Exception:
        return False


def get_primary_user_email() -> Optional[str]:
    """Return the email of the first registered user (primary admin)."""
    import sqlite3
    from pathlib import Path
    db = Path("users.db")
    if not db.exists():
        return None
    try:
        conn = sqlite3.connect(str(db))
        row = conn.execute("SELECT email FROM users ORDER BY id LIMIT 1").fetchone()
        conn.close()
        return row[0] if row else None
    except Exception:
        return None


def _init_r2_from_device_config(cfg: dict):
    """Initialize R2 uploader using device config credentials."""
    from app.services.r2_uploader import R2Uploader
    import app.main as main_mod

    r2_account_id = cfg.get("r2_account_id", "")
    r2_access_key_id = cfg.get("r2_access_key_id", "")
    r2_secret_access_key = cfg.get("r2_secret_access_key", "")
    r2_bucket_name = cfg.get("r2_bucket_name", "")
    r2_public_url_base = cfg.get("r2_public_url_base", "")

    if not all([r2_account_id, r2_access_key_id, r2_secret_access_key, r2_bucket_name]):
        logger.warning("R2 credentials incomplete in device config; falling back to .env")
        main_mod.get_r2_uploader()
        return

    main_mod._r2_uploader = R2Uploader(
        account_id=r2_account_id,
        access_key_id=r2_access_key_id,
        secret_access_key=r2_secret_access_key,
        bucket_name=r2_bucket_name,
        public_url_base=r2_public_url_base,
    )
    logger.info("R2 uploader initialized from device config")


def _start_tunnel_and_notify(cfg: dict):
    """Start the Cloudflare tunnel and email the user if the URL changed."""
    import app.main as main_mod
    from app.services.email_service import EmailService

    try:
        tm = main_mod.get_tunnel_manager()
        url = tm.start_tunnel()
        if url:
            system_state.tunnel_url = url
            last_url = cfg.get("last_tunnel_url", "")
            if url != last_url:
                logger.info("Tunnel URL changed: %s -> %s", last_url or "(none)", url)
                set_last_tunnel_url(url)
                email_svc = EmailService.from_device_config(cfg)
                user_email = get_primary_user_email()
                if email_svc and user_email:
                    email_svc.send_tunnel_link(user_email, url)
                else:
                    logger.info("SMTP not configured or no user email; skipping tunnel notification")
    except Exception as e:
        logger.warning("Tunnel startup failed: %s", e)


def start_online_services():
    """Initialize all online services: R2, Qwen, ChromaDB, tunnel."""
    import app.main as main_mod

    cfg = get_device_config() or {}

    try:
        _init_r2_from_device_config(cfg)
    except Exception as e:
        logger.warning("R2 init failed: %s", e)

    try:
        main_mod.get_qwen_client()
        logger.info("Qwen client initialized")
    except Exception as e:
        logger.warning("Qwen client init failed: %s", e)

    try:
        main_mod.get_chroma_store()
        logger.info("ChromaDB initialized")
    except Exception as e:
        logger.warning("ChromaDB init failed: %s", e)

    _start_tunnel_and_notify(cfg)
    system_state.services_started = True


def start_offline_raw():
    """Start raw recording when offline — auto-upload is always on but failures are non-fatal."""
    _auto_start_raw_recording()


def _stream_waiter_loop(rtsp_url: str) -> None:
    """Background loop: probe RTSP every 30s; when stream is available, start recording and exit."""
    global _stream_waiter_running
    interval = 30
    logger.info("RTSP stream not yet available at %s; will start recording when stream is detected (checking every %ds)", rtsp_url, interval)
    while _stream_waiter_running:
        time.sleep(interval)
        if not _stream_waiter_running:
            break
        if _try_rtsp_connection(rtsp_url):
            with _stream_waiter_lock:
                _stream_waiter_running = False
            logger.info("RTSP stream detected; starting recording now")
            _auto_start_raw_recording(rtsp_url_override=rtsp_url, skip_probe=True)
            return
    logger.debug("Stream waiter exiting")


def _auto_start_raw_recording(rtsp_url_override: str | None = None, skip_probe: bool = False):
    """Auto-start raw recording.

    If skip_probe is False, probes the RTSP URL first. If the stream is not available,
    starts a background waiter that checks every 30s and starts recording when the stream comes up.
    Always sets reliable_internet=True so uploads are attempted.
    """
    global _stream_waiter_running
    cfg = get_device_config()
    if not cfg:
        return
    rtsp_url = rtsp_url_override or cfg.get("rtsp_url", "")
    if not rtsp_url:
        logger.warning("No RTSP URL in device config; cannot auto-start raw recording")
        return

    from app.api.routes.recording import get_video_recorder
    recorder = get_video_recorder()
    if recorder and recorder.is_recording:
        logger.info("Recording already in progress; skipping auto-start")
        return

    if not skip_probe and not _try_rtsp_connection(rtsp_url):
        with _stream_waiter_lock:
            if _stream_waiter_running:
                return
            _stream_waiter_running = True
        t = threading.Thread(
            target=_stream_waiter_loop,
            args=(rtsp_url,),
            daemon=True,
            name="RtspStreamWaiter",
        )
        t.start()
        return

    # After a successful probe, wait before starting the segmenter so the RTSP server
    # (e.g. phone camera app) has time to release the connection and accept the recorder.
    if not skip_probe:
        time.sleep(5)
        logger.debug("Probe finished; starting recorder after 5s delay")

    from app.services.video_recorder import VideoRecorder
    from app.main import raw_chunk_callback, set_raw_auto_upload
    from app.core.config import get_settings
    import app.api.routes.recording as rec_mod

    settings = get_settings()
    set_raw_auto_upload(True)

    rec_mod._video_recorder = VideoRecorder(
        rtsp_url=rtsp_url,
        output_dir=settings.RAW_FOOTAGE_DIR,
        chunk_duration=60,
        motion_detection_enabled=False,
        motion_threshold=0.3,
    )
    rec_mod._video_recorder.start_recording(callback=raw_chunk_callback)
    rec_mod._raw_recording_active = True
    set_recording_active(True)
    logger.info("Auto-started raw recording for %s (auto-upload=True)", rtsp_url)


def _stop_and_flush_recording():
    """Stop current recording and flush remaining segments as partial footage."""
    import app.api.routes.recording as rec_mod
    from app.main import flush_raw_segments

    recorder = rec_mod._video_recorder
    if recorder and recorder.is_recording:
        try:
            recorder.stop_recording()
        except Exception as e:
            logger.warning("Error stopping recorder during RTSP recovery: %s", e)
    rec_mod._raw_recording_active = False

    try:
        flush_raw_segments()
        logger.info("Flushed remaining segments as partial footage after RTSP error")
    except Exception as e:
        logger.warning("Error flushing segments: %s", e)


def _try_rtsp_connection(rtsp_url: str) -> bool:
    """Quick check if an RTSP stream is reachable using FFmpeg."""
    import subprocess
    try:
        result = subprocess.run(
            [
                "ffmpeg", "-hide_banner", "-loglevel", "error",
                "-rtsp_transport", "tcp",
                "-i", rtsp_url,
                "-t", "2", "-f", "null", "-",
            ],
            capture_output=True, text=True, timeout=15,
        )
        return result.returncode == 0
    except Exception:
        return False


def attempt_rtsp_recovery(new_rtsp_url: str | None = None):
    """Called from the /system/rtsp-retry endpoint. Tests the link, updates config, restarts recording."""
    cfg = get_device_config()
    if not cfg:
        return False, "No device config found"

    url = new_rtsp_url or cfg.get("rtsp_url", "")
    if not url:
        return False, "No RTSP URL provided"

    if not _try_rtsp_connection(url):
        return False, f"Cannot connect to RTSP stream: {url}"

    # If a new URL was provided and it works, update device config
    if new_rtsp_url and new_rtsp_url != cfg.get("rtsp_url", ""):
        from app.services.device_config_service import upsert_device_config
        upsert_device_config({"rtsp_url": new_rtsp_url})
        logger.info("RTSP URL updated in device config: %s", new_rtsp_url)

    system_state.clear_rtsp_error()
    _auto_start_raw_recording(rtsp_url_override=url)
    return True, "Recording restarted successfully"


def _background_monitor():
    """Background thread: handles decision timeout, periodic retry, RTSP watchdog, and storage cleanup."""
    import time
    auto_retry_done = False

    while True:
        time.sleep(5)

        # --- RTSP recording watchdog ---
        if not system_state.rtsp_error:
            try:
                import app.api.routes.recording as rec_mod
                recorder = rec_mod._video_recorder
                if recorder and not recorder.is_recording and rec_mod._raw_recording_active:
                    logger.warning("Recording died unexpectedly — starting RTSP recovery")
                    _stop_and_flush_recording()

                    cfg = get_device_config() or {}
                    rtsp_url = cfg.get("rtsp_url", "")
                    system_state.rtsp_retry_count = 0

                    recovered = False
                    for attempt in range(1, system_state.rtsp_max_retries + 1):
                        system_state.rtsp_retry_count = attempt
                        logger.info("RTSP reconnect attempt %d/%d for %s", attempt, system_state.rtsp_max_retries, rtsp_url)
                        time.sleep(min(attempt * 3, 15))

                        if _try_rtsp_connection(rtsp_url):
                            logger.info("RTSP stream recovered on attempt %d", attempt)
                            system_state.clear_rtsp_error()
                            _auto_start_raw_recording()
                            recovered = True
                            break

                    if not recovered:
                        logger.error("RTSP recovery failed after %d attempts", system_state.rtsp_max_retries)
                        system_state.rtsp_error = True
                        system_state.rtsp_error_message = (
                            f"Lost connection to camera ({rtsp_url}). "
                            f"Failed to reconnect after {system_state.rtsp_max_retries} attempts."
                        )
                        set_recording_active(False)
            except Exception as e:
                logger.debug("RTSP watchdog check error: %s", e)

        # --- Decision timeout logic ---
        if system_state.mode == SystemMode.PENDING_DECISION:
            remaining = system_state.get_decision_remaining_seconds()
            if remaining <= 0 and not auto_retry_done:
                auto_retry_done = True
                logger.info("Decision timeout reached, performing automatic retry")
                if check_internet():
                    system_state.internet_available = True
                    try:
                        start_online_services()
                        system_state.set_mode(SystemMode.ONLINE)
                        _auto_start_raw_recording()
                    except Exception as e:
                        logger.error("Auto-retry online services failed: %s", e)
                        system_state.set_mode(SystemMode.OFFLINE_RAW)
                        start_offline_raw()
                else:
                    logger.info("Auto-retry: still no internet, entering offline mode")
                    system_state.set_mode(SystemMode.OFFLINE_RAW)
                    start_offline_raw()

        # --- Periodic retry while in offline mode (every 2 min) ---
        if system_state.mode == SystemMode.OFFLINE_RAW:
            now = time.time()
            if now - system_state.last_internet_check >= 120:
                system_state.last_internet_check = now
                if check_internet():
                    logger.info("Internet restored while in offline mode")
                    system_state.internet_available = True
                    try:
                        start_online_services()
                        system_state.set_mode(SystemMode.ONLINE)
                        try:
                            from app.api.routes import raw_footage
                            raw_footage.process_pending_autopilot_chunks()
                        except Exception as ap_e:
                            logger.debug("Autopilot pending skip: %s", ap_e)
                    except Exception as e:
                        logger.warning("Online transition failed: %s", e)

        # --- Monitor online -> offline transition (recording keeps going) ---
        if system_state.mode == SystemMode.ONLINE:
            now = time.time()
            if now - system_state.last_internet_check >= 120:
                system_state.last_internet_check = now
                if not check_internet():
                    logger.warning("Internet lost while in online mode — recording continues, uploads will retry")
                    system_state.internet_available = False
                    system_state.set_mode(SystemMode.OFFLINE_RAW)

        # --- Storage retention (every 10 min) ---
        now = time.time()
        if not hasattr(_background_monitor, "_last_cleanup"):
            _background_monitor._last_cleanup = now
        if now - _background_monitor._last_cleanup >= 600:
            _background_monitor._last_cleanup = now
            try:
                _run_storage_cleanup()
            except Exception as e:
                logger.warning("Storage cleanup error: %s", e)


def _run_storage_cleanup():
    """Run size-based cleanup on local footage and R2."""
    from app.services.storage_manager import cleanup_local_footage, cleanup_r2_footage
    from app.core.config import get_settings

    cfg = get_device_config() or {}
    settings = get_settings()

    local_max = cfg.get("local_storage_max_gb", 50.0)
    r2_max = cfg.get("r2_max_gb", 10.0)

    cleanup_local_footage(settings.RAW_FOOTAGE_DIR, local_max)
    cleanup_local_footage(settings.RECORDINGS_DIR, local_max)

    if system_state.internet_available:
        try:
            import app.main as main_mod
            r2 = main_mod.get_r2_uploader()
            cleanup_r2_footage(r2, "raw_footage/", r2_max)
        except Exception as e:
            logger.debug("R2 cleanup skipped: %s", e)


def run_startup_sequence():
    """Main startup sequence called from app startup event."""
    global _background_thread
    from app.services.device_config_service import init_device_config_table

    init_device_config_table()

    account_exists = has_any_user()
    config_exists = has_device_config()

    system_state.has_account = account_exists
    system_state.has_device_config = config_exists

    if not account_exists:
        system_state.set_mode(SystemMode.IDLE_NO_ACCOUNT)
        logger.info("No user account found. Waiting for registration.")
        _start_background_monitor()
        return

    if not config_exists:
        system_state.set_mode(SystemMode.IDLE_NO_ACCOUNT)
        logger.info("No device config found. Waiting for setup.")
        _start_background_monitor()
        return

    internet_ok = check_internet()
    system_state.internet_available = internet_ok
    system_state.last_internet_check = time.time()

    if internet_ok:
        logger.info("Internet available on startup")
        try:
            start_online_services()
            system_state.set_mode(SystemMode.ONLINE)
            _auto_start_raw_recording()
            try:
                from app.api.routes import raw_footage
                raw_footage.process_pending_autopilot_chunks()
            except Exception as e:
                logger.debug("Autopilot pending skip: %s", e)
        except Exception as e:
            logger.error("Online services failed despite internet: %s", e)
            system_state.set_mode(SystemMode.PENDING_DECISION)
    else:
        logger.info("No internet on startup; entering pending-decision state")
        system_state.set_mode(SystemMode.PENDING_DECISION)

    _start_background_monitor()


def _start_background_monitor():
    global _background_thread
    if _background_thread and _background_thread.is_alive():
        return
    _background_thread = threading.Thread(target=_background_monitor, daemon=True, name="SystemMonitor")
    _background_thread.start()
