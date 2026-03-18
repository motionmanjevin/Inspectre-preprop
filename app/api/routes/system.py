"""System startup status and decision endpoints."""
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional

from app.core.system_state import system_state, SystemMode

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/system", tags=["system"])


class SystemStatusResponse(BaseModel):
    mode: str
    has_account: bool
    has_device_config: bool
    internet_available: bool
    tunnel_url: Optional[str] = None
    services_started: bool
    decision_remaining_seconds: int
    rtsp_error: bool = False
    rtsp_error_message: str = ""
    rtsp_retry_count: int = 0


class DecisionRequest(BaseModel):
    decision: str = Field(..., description="'retry' or 'offline'")


class DecisionResponse(BaseModel):
    mode: str
    message: str


@router.get("/startup-status", response_model=SystemStatusResponse)
async def get_startup_status():
    """Get current system startup status (public, no auth required for startup screen)."""
    return SystemStatusResponse(**system_state.to_dict())


@router.post("/decision", response_model=DecisionResponse)
async def post_decision(req: DecisionRequest):
    """User decision during PENDING_DECISION: retry or go offline."""
    if system_state.mode != SystemMode.PENDING_DECISION:
        return DecisionResponse(mode=system_state.mode.value, message="Not in pending-decision state.")

    if req.decision == "retry":
        from app.core.connectivity import check_internet
        if check_internet():
            system_state.internet_available = True
            from app.core.startup_orchestrator import start_online_services
            try:
                start_online_services()
                system_state.set_mode(SystemMode.ONLINE)
                return DecisionResponse(mode="online", message="Internet available. Services started.")
            except Exception as e:
                logger.error("Failed to start online services on retry: %s", e)
                system_state.set_mode(SystemMode.OFFLINE_RAW)
                from app.core.startup_orchestrator import start_offline_raw
                start_offline_raw()
                return DecisionResponse(mode="offline_raw", message=f"Retry connected but services failed: {e}. Running offline.")
        else:
            system_state.set_mode(SystemMode.OFFLINE_RAW)
            from app.core.startup_orchestrator import start_offline_raw
            start_offline_raw()
            return DecisionResponse(mode="offline_raw", message="Still no internet after retry. Running offline raw recording.")
    elif req.decision == "offline":
        system_state.set_mode(SystemMode.OFFLINE_RAW)
        from app.core.startup_orchestrator import start_offline_raw
        start_offline_raw()
        return DecisionResponse(mode="offline_raw", message="Offline mode activated. Raw recording started.")
    else:
        raise HTTPException(status_code=400, detail="decision must be 'retry' or 'offline'")


class RtspRetryRequest(BaseModel):
    new_rtsp_url: Optional[str] = None


class RtspRetryResponse(BaseModel):
    success: bool
    message: str


@router.post("/rtsp-retry", response_model=RtspRetryResponse)
async def rtsp_retry(req: RtspRetryRequest):
    """Retry RTSP connection (optionally with a new URL). Updates device config if new URL works."""
    if not system_state.rtsp_error:
        return RtspRetryResponse(success=True, message="No RTSP error to recover from.")

    from app.core.startup_orchestrator import attempt_rtsp_recovery
    success, message = attempt_rtsp_recovery(req.new_rtsp_url)
    return RtspRetryResponse(success=success, message=message)
