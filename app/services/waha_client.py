"""Outbound WAHA (WhatsApp HTTP API) client."""
from __future__ import annotations

import logging

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# WhatsApp text limit is 4096; stay under for safety.
_DEFAULT_MAX_TEXT_LEN = 4000


def jid_to_waha_chat_id(jid: str) -> str:
    """Map stored JID to WAHA chatId. Preserves @lid / @g.us; converts phone JIDs to @c.us."""
    if not jid:
        return jid
    lower = jid.strip().lower()
    if "@lid" in lower or "@g.us" in lower or "@newsletter" in lower:
        return lower
    if lower.endswith("@c.us"):
        return lower
    if lower.endswith("@s.whatsapp.net"):
        return lower.replace("@s.whatsapp.net", "@c.us")
    digits = "".join(ch for ch in lower if ch.isdigit())
    return f"{digits}@c.us" if digits else lower


def split_long_text(text: str, max_len: int = _DEFAULT_MAX_TEXT_LEN) -> list[str]:
    """Split text into WhatsApp-safe chunks, preferring paragraph then line breaks."""
    body = text or ""
    if len(body) <= max_len:
        return [body] if body else []
    parts: list[str] = []
    remaining = body
    while remaining:
        if len(remaining) <= max_len:
            parts.append(remaining)
            break
        window = remaining[:max_len]
        split_at = window.rfind("\n\n")
        if split_at < max_len // 3:
            split_at = window.rfind("\n")
        if split_at < max_len // 3:
            split_at = window.rfind(" ")
        if split_at < max_len // 3:
            split_at = max_len
        parts.append(remaining[:split_at].rstrip())
        remaining = remaining[split_at:].lstrip()
    return parts


class WahaClient:
    def __init__(self) -> None:
        settings = get_settings()
        self.base_url = (settings.WAHA_API_BASE_URL or settings.EVOLUTION_API_BASE_URL or "").rstrip("/")
        self.api_key = settings.WAHA_API_KEY or settings.EVOLUTION_API_KEY or ""
        self.session = settings.WAHA_SESSION or settings.EVOLUTION_INSTANCE or "default"
        self.timeout = max(3, int(settings.WAHA_SEND_TIMEOUT_SECONDS or settings.EVOLUTION_SEND_TIMEOUT_SECONDS or 15))

    def is_configured(self) -> bool:
        return bool(self.base_url and self.api_key)

    def send_text(self, to_jid: str, text: str) -> None:
        if not self.is_configured():
            logger.warning("WAHA send skipped: missing WAHA_* config")
            return
        chat_id = jid_to_waha_chat_id(to_jid)
        payload = {
            "session": self.session,
            "chatId": chat_id,
            "text": text,
        }
        headers = {
            "X-Api-Key": self.api_key,
            "Content-Type": "application/json",
        }
        try:
            with httpx.Client(timeout=self.timeout) as client:
                resp = client.post(f"{self.base_url}/api/sendText", json=payload, headers=headers)
                if resp.status_code >= 300:
                    logger.warning("WAHA send failed (%s): %s", resp.status_code, resp.text)
        except Exception as exc:
            logger.warning("WAHA send exception: %s", exc)

    def send_text_long(self, to_jid: str, text: str, max_len: int = _DEFAULT_MAX_TEXT_LEN) -> None:
        chunks = split_long_text(text, max_len=max_len)
        total = len(chunks)
        for idx, chunk in enumerate(chunks, start=1):
            payload = chunk
            if total > 1:
                payload = f"({idx}/{total})\n{chunk}"
            self.send_text(to_jid, payload)
