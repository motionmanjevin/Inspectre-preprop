"""WhatsApp webhook and account-linking routes."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from app.api.dependencies import get_current_user
from app.core.config import get_settings
from app.services.user_service import UserService
from app.services.whatsapp_conversation_service import WhatsAppConversationService
from app.services.whatsapp_linking_service import get_link_status_for_user, issue_link_code
from app.services.whatsapp_repository import unlink_user

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])


class WhatsAppLinkStatusResponse(BaseModel):
    linked: bool
    whatsapp_jid: str
    link_status: str
    verified_at: str = ""
    link_expires_at: str = ""
    display_number: str = ""


class WhatsAppLinkStartResponse(BaseModel):
    code: str
    expires_at: str
    display_number: str = ""
    instructions: str


_svc = WhatsAppConversationService()


def _ensure_enabled() -> None:
    if not get_settings().WHATSAPP_ENABLED:
        raise HTTPException(status_code=503, detail="WhatsApp integration is disabled")


@router.post("/webhook")
async def whatsapp_webhook(request: Request) -> dict:
    settings = get_settings()
    if not settings.WHATSAPP_ENABLED:
        return {"status": "disabled"}
    body = await request.body()
    try:
        payload = await request.json()
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Invalid JSON: {exc}")
    signature = request.headers.get("x-signature") or ""
    api_key = request.headers.get("x-api-key") or request.headers.get("X-Api-Key") or ""
    try:
        _svc.handle_webhook(body=body, payload=payload, signature=signature, api_key_header=api_key)
        return {"status": "ok"}
    except ValueError as exc:
        raise HTTPException(status_code=401, detail=str(exc))


@router.get("/link/status", response_model=WhatsAppLinkStatusResponse)
async def get_whatsapp_link_status(current_user: dict = Depends(get_current_user)) -> WhatsAppLinkStatusResponse:
    _ensure_enabled()
    user_id = int(current_user["id"])
    status = get_link_status_for_user(user_id)
    return WhatsAppLinkStatusResponse(
        linked=bool(status.get("linked")),
        whatsapp_jid=str(status.get("whatsapp_jid") or ""),
        link_status=str(status.get("link_status") or "none"),
        verified_at=str(status.get("verified_at") or ""),
        link_expires_at=str(status.get("link_expires_at") or ""),
        display_number=get_settings().WHATSAPP_DISPLAY_NUMBER,
    )


@router.post("/link/start", response_model=WhatsAppLinkStartResponse)
async def start_whatsapp_link(current_user: dict = Depends(get_current_user)) -> WhatsAppLinkStartResponse:
    _ensure_enabled()
    user = UserService().get_user_by_id(int(current_user["id"]))
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    out = issue_link_code(user_id=int(user["id"]))
    number = get_settings().WHATSAPP_DISPLAY_NUMBER
    instr = f"Send: LINK {out['code']}"
    if number:
        instr = f"Send to {number}: LINK {out['code']}"
    return WhatsAppLinkStartResponse(
        code=out["code"],
        expires_at=out["expires_at"],
        display_number=number,
        instructions=instr,
    )


@router.post("/link/unlink")
async def unlink_whatsapp(current_user: dict = Depends(get_current_user)) -> dict:
    _ensure_enabled()
    unlink_user(int(current_user["id"]))
    return {"status": "ok"}

