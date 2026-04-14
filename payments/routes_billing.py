from __future__ import annotations

import math
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from .db import (
    SessionLocal,
    User,
    Transaction,
    TransactionType,
    TransactionStatus,
    Product,
    get_or_create_user_with_balance,
    is_premium_active,
)
from .schemas import (
    UserSyncRequest,
    BillingStateResponse,
    DebitQueryRequest,
    DebitAutopilotRequest,
    DebitResponse,
)

import os
import httpx
import json


router = APIRouter(prefix="/billing", tags=["billing"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


DBDep = Annotated[Session, Depends(get_db)]


def _to_billing_state(user: User) -> BillingStateResponse:
    bal = user.balance
    return BillingStateResponse(
        email=user.email,
        subscription_status=user.subscription_status,
        premium_valid_until=user.premium_valid_until,
        query_credits=bal.query_credits if bal else 0,
        free_queries_remaining=bal.free_queries_remaining if bal else 0,
        free_autopilot_remaining=bal.free_autopilot_remaining if bal else 0,
    )


@router.post("/users/sync", response_model=BillingStateResponse)
def sync_user(payload: UserSyncRequest, db: DBDep):
    user = get_or_create_user_with_balance(db, payload.email)
    return _to_billing_state(user)


@router.get("/state", response_model=BillingStateResponse)
def get_state(email: str, db: DBDep):
    user = db.query(User).filter(User.email == email).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not user.balance:
        user = get_or_create_user_with_balance(db, email)
    return _to_billing_state(user)


@router.post("/debit/query", response_model=DebitResponse)
def debit_query(payload: DebitQueryRequest, db: DBDep):
    user = get_or_create_user_with_balance(db, payload.email)
    bal = user.balance

    if is_premium_active(user):
        return DebitResponse(ok=True, billing_state=_to_billing_state(user))

    needed = payload.amount
    if bal.query_credits < needed:
        return DebitResponse(ok=False, reason="insufficient_credits", billing_state=_to_billing_state(user))

    bal.query_credits -= needed
    free_used = min(bal.free_queries_remaining, needed)
    if free_used > 0:
        bal.free_queries_remaining -= free_used

    tx = Transaction(
        user_id=user.id,
        type=TransactionType.DEBIT_QUERY,
        amount_ghc=None,
        query_delta=-needed,
        free_autopilot_delta=0,
        meta=None,
    )
    db.add(tx)
    db.commit()
    db.refresh(user)
    return DebitResponse(ok=True, billing_state=_to_billing_state(user))


@router.post("/debit/autopilot", response_model=DebitResponse)
def debit_autopilot(payload: DebitAutopilotRequest, db: DBDep):
    user = get_or_create_user_with_balance(db, payload.email)
    bal = user.balance

    blocks = max(1, math.ceil(payload.hours / 4.0))

    free_to_use = min(bal.free_autopilot_remaining, blocks)
    remaining_blocks = blocks - free_to_use

    queries_needed = remaining_blocks * 2

    # If not enough query credits for paid blocks, fail.
    if queries_needed > 0 and bal.query_credits < queries_needed:
        return DebitResponse(ok=False, reason="insufficient_credits", billing_state=_to_billing_state(user))

    # Apply debits
    if free_to_use > 0:
        bal.free_autopilot_remaining -= free_to_use
    if queries_needed > 0:
        bal.query_credits -= queries_needed

    tx = Transaction(
        user_id=user.id,
        type=TransactionType.DEBIT_AUTOPILOT,
        amount_ghc=None,
        query_delta=-queries_needed,
        free_autopilot_delta=-free_to_use,
        meta=None,
    )
    db.add(tx)
    db.commit()
    db.refresh(user)
    return DebitResponse(ok=True, billing_state=_to_billing_state(user))


class CheckoutRequest(BaseModel):
    email: EmailStr
    product_id: str
    device_id: str | None = None
    return_url: str | None = None


class CheckoutResponse(BaseModel):
    pay_url: str
    transaction_id: int


PAYSTACK_SECRET_KEY = os.environ.get("PAYSTACK_SECRET_KEY", "")
PAYSTACK_BASE_URL = "https://api.paystack.co"


@router.post("/checkout", response_model=CheckoutResponse)
def create_checkout(payload: CheckoutRequest, db: DBDep):
    if not PAYSTACK_SECRET_KEY:
        raise HTTPException(status_code=500, detail="Paystack not configured")

    user = get_or_create_user_with_balance(db, payload.email)

    product = db.query(Product).filter(Product.id == payload.product_id).first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")

    # Create local transaction record in pending state
    tx = Transaction(
        user_id=user.id,
        type=TransactionType.PURCHASE_CREDITS if product.type == ProductType.CREDITS else TransactionType.PREMIUM_SUBSCRIPTION,
        amount_ghc=product.price_ghc,
        query_delta=0,
        free_autopilot_delta=0,
        paystack_reference=None,
        paystack_status=None,
        status=TransactionStatus.PENDING,
        meta=json.dumps(
            {
                "product_id": product.id,
                "device_id": payload.device_id,
            }
        ),
    )
    db.add(tx)
    db.commit()
    db.refresh(tx)

    # Initialize Paystack transaction (amount in kobo/pesewas)
    amount_pesewas = int(product.price_ghc * 100)
    init_payload = {
        "email": user.email,
        "amount": amount_pesewas,
        "metadata": {
            "transaction_id": tx.id,
            "product_id": product.id,
            "device_id": payload.device_id,
        },
    }
    if payload.return_url:
        init_payload["callback_url"] = payload.return_url

    headers = {
        "Authorization": f"Bearer {PAYSTACK_SECRET_KEY}",
        "Content-Type": "application/json",
    }

    with httpx.Client(base_url=PAYSTACK_BASE_URL, timeout=10.0) as client:
        resp = client.post("/transaction/initialize", json=init_payload, headers=headers)
        if resp.status_code != 200:
            raise HTTPException(status_code=502, detail="Failed to initialize Paystack transaction")
        data = resp.json()
        if not data.get("status"):
            raise HTTPException(status_code=502, detail="Paystack returned an error")

    auth_url = data["data"]["authorization_url"]
    reference = data["data"]["reference"]

    # Update transaction with reference
    tx.paystack_reference = reference
    tx.paystack_status = "initialized"
    db.commit()

    return CheckoutResponse(pay_url=auth_url, transaction_id=tx.id)


@router.post("/paystack/webhook")
async def paystack_webhook(request: Request, db: DBDep):
    # NOTE: In production, verify Paystack signature header here.
    body_bytes = await request.body()
    try:
        payload = json.loads(body_bytes.decode("utf-8"))
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON")

    event = payload.get("event")
    data = payload.get("data", {})
    reference = data.get("reference")

    if not reference:
        raise HTTPException(status_code=400, detail="Missing reference")

    tx = db.query(Transaction).filter(Transaction.paystack_reference == reference).first()
    if not tx:
        # Nothing to do
        return {"status": "ignored"}

    tx.paystack_status = event or data.get("status") or tx.paystack_status

    # Only credit on successful charge event
    if event == "charge.success" and tx.status == TransactionStatus.PENDING:
        user = db.query(User).filter(User.id == tx.user_id).first()
        if not user:
            raise HTTPException(status_code=400, detail="User not found for transaction")
        if not user.balance:
            from .db import get_or_create_user_with_balance
            user = get_or_create_user_with_balance(db, user.email)
        bal = user.balance

        meta = {}
        if tx.meta:
            try:
                meta = json.loads(tx.meta)
            except Exception:
                meta = {}
        product_id = meta.get("product_id")
        product = db.query(Product).filter(Product.id == product_id).first() if product_id else None

        if product and product.type == ProductType.CREDITS and product.query_amount:
            bal.query_credits += product.query_amount
            tx.query_delta = product.query_amount
        elif product and product.type == ProductType.SUBSCRIPTION and product.duration_days:
            # Activate / extend premium
            import datetime as dt
            now = dt.datetime.utcnow()
            if is_premium_active(user):
                # extend from current expiry
                base = user.premium_valid_until or now
            else:
                base = now
            user.subscription_status = SubscriptionStatus.PREMIUM
            user.premium_valid_until = base + dt.timedelta(days=product.duration_days)
            # Reset premium free autopilots (10 per period)
            bal.free_autopilot_remaining += 10
            tx.free_autopilot_delta = 10

        tx.status = TransactionStatus.SUCCESS
        db.commit()
    elif event in {"charge.failed", "charge.error"}:
        tx.status = TransactionStatus.FAILED
        db.commit()

    return {"status": "ok"}

