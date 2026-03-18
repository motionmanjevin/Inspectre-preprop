"""Client for external payments/billing server."""
from __future__ import annotations

import logging
from typing import Any, Dict, Optional

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)


class BillingClient:
    def __init__(self) -> None:
        settings = get_settings()
        self.base_url = settings.PAYMENTS_API_BASE_URL.rstrip("/")
        self._client = httpx.Client(base_url=self.base_url, timeout=5.0)

    def sync_user(self, email: str) -> Optional[Dict[str, Any]]:
        try:
            resp = self._client.post("/billing/users/sync", json={"email": email})
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.warning("Billing sync_user failed for %s: %s", email, e)
            return None

    def get_state(self, email: str) -> Optional[Dict[str, Any]]:
        try:
            resp = self._client.get("/billing/state", params={"email": email})
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.warning("Billing get_state failed for %s: %s", email, e)
            return None

    def debit_query(self, email: str, reason: str = "standard_query", amount: int = 1) -> Dict[str, Any]:
        try:
            resp = self._client.post(
                "/billing/debit/query",
                json={"email": email, "amount": amount, "reason": reason},
            )
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error("Billing debit_query failed for %s: %s", email, e)
            return {"ok": False, "reason": "billing_unavailable"}

    def debit_autopilot(self, email: str, hours: float, metadata: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
        try:
            payload: Dict[str, Any] = {"email": email, "hours": hours}
            if metadata:
                payload["metadata"] = metadata
            resp = self._client.post("/billing/debit/autopilot", json=payload)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error("Billing debit_autopilot failed for %s: %s", email, e)
            return {"ok": False, "reason": "billing_unavailable"}

    def create_checkout(self, email: str, product_id: str, device_id: Optional[str] = None) -> Dict[str, Any]:
        payload: Dict[str, Any] = {"email": email, "product_id": product_id}
        if device_id:
            payload["device_id"] = device_id
        try:
            resp = self._client.post("/billing/checkout", json=payload)
            resp.raise_for_status()
            return resp.json()
        except Exception as e:
            logger.error("Billing checkout failed for %s: %s", email, e)
            raise


_client: Optional[BillingClient] = None


def get_billing_client() -> BillingClient:
    global _client
    if _client is None:
        _client = BillingClient()
    return _client

