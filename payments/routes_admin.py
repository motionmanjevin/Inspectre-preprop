from __future__ import annotations

from typing import Annotated, List

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from .db import SessionLocal, User, Transaction
from .schemas import BillingStateResponse
from .routes_billing import _to_billing_state


router = APIRouter(prefix="/admin", tags=["admin"])


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


DBDep = Annotated[Session, Depends(get_db)]


@router.get("/users", response_model=List[BillingStateResponse])
def list_users(
    db: DBDep,
    skip: int = 0,
    limit: int = Query(default=50, le=200),
):
    users = db.query(User).order_by(User.created_at.desc()).offset(skip).limit(limit).all()
    return [_to_billing_state(u) for u in users]


@router.get("/users/{user_id}", response_model=BillingStateResponse)
def get_user(user_id: int, db: DBDep):
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        from fastapi import HTTPException, status
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not user.balance:
        from .db import get_or_create_user_with_balance
        user = get_or_create_user_with_balance(db, user.email)
    return _to_billing_state(user)


@router.get("/transactions")
def list_transactions(
    db: DBDep,
    skip: int = 0,
    limit: int = Query(default=50, le=200),
    email: str | None = None,
):
    q = db.query(Transaction).order_by(Transaction.created_at.desc())
    if email:
        q = q.join(User).filter(User.email == email)
    txs = q.offset(skip).limit(limit).all()
    # Return a simple JSON structure; admin frontend can shape it.
    return [
        {
            "id": tx.id,
            "user_id": tx.user_id,
            "type": tx.type.value,
            "amount_ghc": tx.amount_ghc,
            "query_delta": tx.query_delta,
            "free_autopilot_delta": tx.free_autopilot_delta,
            "paystack_reference": tx.paystack_reference,
            "paystack_status": tx.paystack_status,
            "meta": tx.meta,
            "created_at": tx.created_at,
        }
        for tx in txs
    ]

