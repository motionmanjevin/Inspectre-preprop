from __future__ import annotations

import datetime as dt
from typing import Optional, Any, Dict

from pydantic import BaseModel, Field, EmailStr

from .db import SubscriptionStatus


class UserSyncRequest(BaseModel):
  email: EmailStr


class BillingState(BaseModel):
  email: EmailStr
  subscription_status: SubscriptionStatus
  premium_valid_until: Optional[dt.datetime] = None
  query_credits: int = 0
  free_queries_remaining: int = 0
  free_autopilot_remaining: int = 0


class BillingStateResponse(BillingState):
  pass


class DebitQueryRequest(BaseModel):
  email: EmailStr
  amount: int = Field(default=1, ge=1)
  reason: str = Field(default="standard_query")
  metadata: Optional[Dict[str, Any]] = None


class DebitAutopilotRequest(BaseModel):
  email: EmailStr
  hours: float = Field(..., gt=0)
  metadata: Optional[Dict[str, Any]] = None


class DebitResponse(BaseModel):
  ok: bool
  reason: Optional[str] = None
  billing_state: Optional[BillingState] = None

