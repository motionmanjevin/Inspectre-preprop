from __future__ import annotations

import datetime as dt
from typing import Optional

from sqlalchemy import (
    Column,
    DateTime,
    Enum,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    create_engine,
    func,
)
from sqlalchemy.orm import declarative_base, relationship, sessionmaker, Session
import enum
import os


DB_PATH = os.environ.get("PAYMENTS_DB_PATH", "payments.db")
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


class SubscriptionStatus(str, enum.Enum):
    BASE = "base"
    PREMIUM = "premium"


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, nullable=False, index=True)
    subscription_status = Column(Enum(SubscriptionStatus), nullable=False, default=SubscriptionStatus.BASE)
    premium_valid_until = Column(DateTime, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())
    last_seen_at = Column(DateTime, nullable=False, server_default=func.now(), onupdate=func.now())

    balance = relationship("UserBalance", back_populates="user", uselist=False)
    transactions = relationship("Transaction", back_populates="user")


class UserBalance(Base):
    __tablename__ = "user_balances"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, unique=True)
    query_credits = Column(Integer, nullable=False, default=0)
    free_queries_remaining = Column(Integer, nullable=False, default=0)
    free_autopilot_remaining = Column(Integer, nullable=False, default=0)

    user = relationship("User", back_populates="balance")


class ProductType(str, enum.Enum):
    CREDITS = "credits"
    SUBSCRIPTION = "subscription"


class Product(Base):
    __tablename__ = "products"

    id = Column(String(64), primary_key=True)  # e.g. P15, P30, P50, PREMIUM_MONTHLY
    name = Column(String(255), nullable=False)
    type = Column(Enum(ProductType), nullable=False)
    query_amount = Column(Integer, nullable=True)  # for credits packs
    duration_days = Column(Integer, nullable=True)  # for subscriptions
    price_ghc = Column(Float, nullable=False)
    created_at = Column(DateTime, nullable=False, server_default=func.now())


class TransactionType(str, enum.Enum):
    PURCHASE_CREDITS = "purchase_credits"
    PREMIUM_SUBSCRIPTION = "premium_subscription"
    DEBIT_QUERY = "debit_query"
    DEBIT_AUTOPILOT = "debit_autopilot"
    REFUND = "refund"


class TransactionStatus(str, enum.Enum):
    PENDING = "pending"
    SUCCESS = "success"
    FAILED = "failed"


class Transaction(Base):
    __tablename__ = "transactions"

    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    type = Column(Enum(TransactionType), nullable=False)
    amount_ghc = Column(Float, nullable=True)
    query_delta = Column(Integer, nullable=False, default=0)
    free_autopilot_delta = Column(Integer, nullable=False, default=0)
    paystack_reference = Column(String(255), nullable=True, index=True)
    paystack_status = Column(String(64), nullable=True)  # raw status text from Paystack
    status = Column(Enum(TransactionStatus), nullable=False, default=TransactionStatus.PENDING)
    meta = Column(Text, nullable=True)
    created_at = Column(DateTime, nullable=False, server_default=func.now())

    user = relationship("User", back_populates="transactions")


def init_db() -> None:
    """Create tables and seed static products if needed."""
    Base.metadata.create_all(bind=engine)
    with SessionLocal() as db:
        _seed_products(db)


def _get_product(db: Session, product_id: str) -> Optional[Product]:
    return db.query(Product).filter(Product.id == product_id).first()


def _seed_products(db: Session) -> None:
    """Ensure default products exist (idempotent)."""
    defaults = [
        Product(
            id="P15",
            name="15 query credits",
            type=ProductType.CREDITS,
            query_amount=15,
            duration_days=None,
            price_ghc=5.0,
        ),
        Product(
            id="P30",
            name="30 query credits",
            type=ProductType.CREDITS,
            query_amount=30,
            duration_days=None,
            price_ghc=10.0,
        ),
        Product(
            id="P50",
            name="50 query credits",
            type=ProductType.CREDITS,
            query_amount=50,
            duration_days=None,
            price_ghc=15.0,
        ),
        Product(
            id="PREMIUM_MONTHLY",
            name="Premium monthly subscription",
            type=ProductType.SUBSCRIPTION,
            query_amount=None,
            duration_days=30,
            price_ghc=200.0,
        ),
    ]
    for prod in defaults:
        existing = _get_product(db, prod.id)
        if not existing:
            db.add(prod)
    db.commit()


def get_or_create_user_with_balance(db: Session, email: str) -> User:
    """Fetch user + balance; create with base free quotas if new."""
    user = db.query(User).filter(User.email == email).first()
    if not user:
        user = User(email=email, subscription_status=SubscriptionStatus.BASE)
        db.add(user)
        db.flush()  # assign id
        balance = UserBalance(
            user_id=user.id,
            query_credits=20,  # include free queries
            free_queries_remaining=20,
            free_autopilot_remaining=5,
        )
        db.add(balance)
        db.commit()
        db.refresh(user)
        return user

    # Ensure balance exists for legacy users
    if not user.balance:
        balance = UserBalance(
            user_id=user.id,
            query_credits=20,
            free_queries_remaining=20,
            free_autopilot_remaining=5,
        )
        db.add(balance)
        db.commit()
        db.refresh(user)
    return user


def is_premium_active(user: User) -> bool:
    if user.subscription_status != SubscriptionStatus.PREMIUM:
        return False
    if not user.premium_valid_until:
        return False
    return user.premium_valid_until >= dt.datetime.utcnow()

