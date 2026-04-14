"""Device configuration API routes."""
import logging
from datetime import datetime
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from typing import Optional, List

from app.api.dependencies import get_current_user
from app.services.device_config_service import (
    get_device_config,
    upsert_device_config,
    get_setup_missing_fields,
    is_full_setup_complete,
)
from app.core.config import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/device-config", tags=["device-config"])


class DeviceConfigRequest(BaseModel):
    rtsp_url: Optional[str] = None
    camera_name: Optional[str] = None
    video_preprompt: Optional[str] = None
    r2_account_id: Optional[str] = None
    r2_access_key_id: Optional[str] = None
    r2_secret_access_key: Optional[str] = None
    r2_bucket_name: Optional[str] = None
    r2_public_url_base: Optional[str] = None
    smtp_host: Optional[str] = None
    smtp_port: Optional[int] = None
    smtp_username: Optional[str] = None
    smtp_password: Optional[str] = None
    smtp_from_address: Optional[str] = None
    smtp_use_tls: Optional[bool] = None
    reliable_internet: Optional[bool] = None
    local_storage_max_gb: Optional[float] = None
    r2_max_gb: Optional[float] = None
    camera_mode: Optional[str] = None
    multi_cameras_json: Optional[List[dict]] = None
    setup_deferred: Optional[bool] = None
    setup_completed: Optional[bool] = None


class SetupStatusResponse(BaseModel):
    is_complete: bool = False
    setup_deferred: bool = False
    missing_fields: List[str] = Field(default_factory=list)


class DeviceConfigResponse(BaseModel):
    rtsp_url: str = ""
    camera_name: str = ""
    video_preprompt: str = ""
    r2_account_id: str = ""
    r2_access_key_id: str = ""
    r2_secret_access_key: str = ""
    r2_bucket_name: str = ""
    r2_public_url_base: str = ""
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_from_address: str = ""
    smtp_use_tls: bool = True
    reliable_internet: bool = True
    local_storage_max_gb: float = 50.0
    r2_max_gb: float = 10.0
    camera_mode: str = "single"
    multi_cameras_json: List[dict] = Field(default_factory=list)
    setup_deferred: bool = False
    setup_completed: bool = False
    setup_completed_at: str = ""
    setup_status: SetupStatusResponse = Field(default_factory=SetupStatusResponse)


def _to_response(cfg: Optional[dict]) -> DeviceConfigResponse:
    raw = cfg or {}
    settings = get_settings()
    missing = get_setup_missing_fields(raw)
    setup_deferred = bool(raw.get("setup_deferred", False))
    setup_completed = bool(raw.get("setup_completed", False))
    return DeviceConfigResponse(
        rtsp_url=raw.get("rtsp_url", ""),
        camera_name=raw.get("camera_name", ""),
        video_preprompt=raw.get("video_preprompt", ""),
        r2_account_id=raw.get("r2_account_id", ""),
        r2_access_key_id=raw.get("r2_access_key_id", ""),
        r2_secret_access_key=raw.get("r2_secret_access_key", ""),
        r2_bucket_name=raw.get("r2_bucket_name", ""),
        r2_public_url_base=raw.get("r2_public_url_base", ""),
        smtp_host=settings.SMTP_HOST or "",
        smtp_port=int(settings.SMTP_PORT or 587),
        smtp_username=settings.SMTP_USERNAME or "",
        smtp_password=settings.SMTP_PASSWORD or "",
        smtp_from_address=settings.SMTP_FROM_ADDRESS or "",
        smtp_use_tls=bool(settings.SMTP_USE_TLS),
        reliable_internet=bool(raw.get("reliable_internet", 1)),
        local_storage_max_gb=raw.get("local_storage_max_gb", 50.0),
        r2_max_gb=raw.get("r2_max_gb", 10.0),
        camera_mode=raw.get("camera_mode", "single"),
        multi_cameras_json=raw.get("multi_cameras_json", []),
        setup_deferred=setup_deferred,
        setup_completed=setup_completed,
        setup_completed_at=raw.get("setup_completed_at", "") or "",
        setup_status=SetupStatusResponse(
            is_complete=(len(missing) == 0),
            setup_deferred=setup_deferred,
            missing_fields=missing,
        ),
    )


@router.get("", response_model=DeviceConfigResponse)
async def read_device_config(current_user: dict = Depends(get_current_user)):
    """Get the current device configuration."""
    cfg = get_device_config()
    return _to_response(cfg)


@router.put("", response_model=DeviceConfigResponse)
async def update_device_config(
    req: DeviceConfigRequest,
    current_user: dict = Depends(get_current_user),
):
    """Update device configuration. Only provided fields are changed."""
    data = req.dict(exclude_none=True)
    # SMTP is now sourced from .env settings, not device_config.
    for smtp_key in (
        "smtp_host",
        "smtp_port",
        "smtp_username",
        "smtp_password",
        "smtp_from_address",
        "smtp_use_tls",
    ):
        data.pop(smtp_key, None)
    if "smtp_use_tls" in data:
        data["smtp_use_tls"] = 1 if data["smtp_use_tls"] else 0
    if "reliable_internet" in data:
        data["reliable_internet"] = 1 if data["reliable_internet"] else 0
    if "setup_deferred" in data:
        data["setup_deferred"] = 1 if data["setup_deferred"] else 0
    if "setup_completed" in data:
        data["setup_completed"] = 1 if data["setup_completed"] else 0
    cfg = upsert_device_config(data)

    # Enforce setup completion policy based on required full config.
    complete = is_full_setup_complete(cfg)
    patch = {}
    if complete and not bool(cfg.get("setup_completed", False)):
        patch["setup_completed"] = 1
        patch["setup_completed_at"] = datetime.utcnow().isoformat()
        patch["setup_deferred"] = 0
    elif not complete and bool(cfg.get("setup_completed", False)):
        patch["setup_completed"] = 0
        patch["setup_completed_at"] = ""
    if patch:
        cfg = upsert_device_config(patch)

    # If the system was waiting for setup, trigger service startup now
    from app.core.system_state import system_state, SystemMode
    if system_state.mode == SystemMode.IDLE_NO_ACCOUNT:
        import threading
        from app.core.startup_orchestrator import run_startup_sequence
        threading.Thread(target=run_startup_sequence, daemon=True, name="PostConfigStartup").start()

    return _to_response(cfg)
