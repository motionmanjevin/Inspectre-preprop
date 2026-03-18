"""Autopilot API: set prompt + time range (max 24h), list responses per chunk."""
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.api.dependencies import get_current_user
from app.services.autopilot_service import (
    get_config,
    set_config as svc_set_config,
    get_results,
    get_result_by_chunk_id,
)
from app.services.billing_client import get_billing_client

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/autopilot", tags=["autopilot"])


class AutopilotConfigResponse(BaseModel):
    prompt: str
    range_start_iso: str
    range_end_iso: str
    updated_at: str


class AutopilotConfigSetRequest(BaseModel):
    prompt: str = Field(..., min_length=1)
    range_start_iso: str = Field(..., description="ISO datetime e.g. 2026-02-18T16:00:00Z")
    range_end_iso: str = Field(..., description="ISO datetime, must be within 24h of range_start")


class AutopilotResultItem(BaseModel):
    chunk_id: str
    prompt: str
    analysis: str | None
    error: str | None
    video_url: str
    chunk_start_iso: str
    chunk_end_iso: str
    created_at_iso: str


class AutopilotResultsListResponse(BaseModel):
    results: list[AutopilotResultItem]


@router.get("/config", response_model=AutopilotConfigResponse | None)
async def get_autopilot_config(
    current_user: dict = Depends(get_current_user),
) -> AutopilotConfigResponse | None:
    """Get current autopilot config (prompt + time range). Returns null if not set."""
    cfg = get_config()
    if not cfg:
        return None
    return AutopilotConfigResponse(
        prompt=cfg["prompt"],
        range_start_iso=cfg["range_start_iso"],
        range_end_iso=cfg["range_end_iso"],
        updated_at=cfg.get("updated_at", ""),
    )


@router.put("/config", response_model=AutopilotConfigResponse)
async def set_autopilot_config(
    request: AutopilotConfigSetRequest,
    current_user: dict = Depends(get_current_user),
) -> AutopilotConfigResponse:
    """Set autopilot: prompt and time range (max 24 hours)."""
    try:
        # Estimate duration in hours for billing; clamp to max 24h
        start = datetime.fromisoformat(request.range_start_iso.replace("Z", "+00:00"))
        end = datetime.fromisoformat(request.range_end_iso.replace("Z", "+00:00"))
        total_hours = max(0.0, (end - start).total_seconds() / 3600.0)
        total_hours = min(total_hours, 24.0)

        billing = get_billing_client()
        debit = billing.debit_autopilot(
            email=current_user["email"],
            hours=total_hours,
            metadata={"range_start_iso": request.range_start_iso, "range_end_iso": request.range_end_iso},
        )
        if not debit.get("ok"):
            reason = debit.get("reason", "insufficient_credits")
            if reason == "insufficient_credits":
                raise HTTPException(status_code=402, detail="Not enough credits for this autopilot range. Please purchase more or shorten the range.")
            else:
                raise HTTPException(status_code=503, detail="Billing service unavailable, please try again.")

        cfg = svc_set_config(
            prompt=request.prompt.strip(),
            range_start_iso=request.range_start_iso.strip(),
            range_end_iso=request.range_end_iso.strip(),
        )
        return AutopilotConfigResponse(
            prompt=cfg["prompt"],
            range_start_iso=cfg["range_start_iso"],
            range_end_iso=cfg["range_end_iso"],
            updated_at=cfg["updated_at"],
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/responses", response_model=AutopilotResultsListResponse)
async def list_autopilot_responses(
    current_user: dict = Depends(get_current_user),
) -> AutopilotResultsListResponse:
    """List all autopilot results (cards: chunk time range + response). Newest first."""
    raw = get_results()
    items = [
        AutopilotResultItem(
            chunk_id=r["chunk_id"],
            prompt=r.get("prompt", ""),
            analysis=r.get("analysis"),
            error=r.get("error"),
            video_url=r.get("video_url", ""),
            chunk_start_iso=r.get("chunk_start_iso", ""),
            chunk_end_iso=r.get("chunk_end_iso", ""),
            created_at_iso=r.get("created_at_iso", ""),
        )
        for r in raw
    ]
    return AutopilotResultsListResponse(results=items)


@router.get("/responses/{chunk_id}", response_model=AutopilotResultItem)
async def get_autopilot_response(
    chunk_id: str,
    current_user: dict = Depends(get_current_user),
) -> AutopilotResultItem:
    """Get full autopilot response for one chunk (for full-page view)."""
    r = get_result_by_chunk_id(chunk_id)
    if not r:
        raise HTTPException(status_code=404, detail="Autopilot result not found for this chunk")
    return AutopilotResultItem(
        chunk_id=r["chunk_id"],
        prompt=r.get("prompt", ""),
        analysis=r.get("analysis"),
        error=r.get("error"),
        video_url=r.get("video_url", ""),
        chunk_start_iso=r.get("chunk_start_iso", ""),
        chunk_end_iso=r.get("chunk_end_iso", ""),
        created_at_iso=r.get("created_at_iso", ""),
    )
