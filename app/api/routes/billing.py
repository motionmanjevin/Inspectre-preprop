"""Proxy endpoints for billing state and checkout, used by mobile/web clients."""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel

from app.api.dependencies import get_current_user
from app.services.billing_client import get_billing_client


router = APIRouter(prefix="/billing", tags=["billing"])


class BillingStateOut(BaseModel):
    subscription_status: str
    premium_valid_until: str | None = None
    query_credits: int
    free_queries_remaining: int
    free_autopilot_remaining: int


class CheckoutRequest(BaseModel):
    product_id: str


class CheckoutResponse(BaseModel):
    pay_url: str
    transaction_id: int


@router.get("/state", response_model=BillingStateOut)
async def get_billing_state(current_user: dict = Depends(get_current_user)) -> BillingStateOut:
    client = get_billing_client()
    raw = client.get_state(current_user["email"]) or client.sync_user(current_user["email"])
    if not raw:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Billing service unavailable")
    return BillingStateOut(
        subscription_status=raw["subscription_status"],
        premium_valid_until=raw.get("premium_valid_until"),
        query_credits=raw["query_credits"],
        free_queries_remaining=raw.get("free_queries_remaining", 0),
        free_autopilot_remaining=raw.get("free_autopilot_remaining", 0),
    )


@router.post("/checkout", response_model=CheckoutResponse)
async def create_checkout(
    payload: CheckoutRequest,
    current_user: dict = Depends(get_current_user),
) -> CheckoutResponse:
    client = get_billing_client()
    try:
        resp = client.create_checkout(email=current_user["email"], product_id=payload.product_id)
    except Exception:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Failed to start checkout")

    return CheckoutResponse(pay_url=resp["pay_url"], transaction_id=resp["transaction_id"])

