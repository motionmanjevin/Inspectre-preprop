"""WhatsApp account linking helpers."""
from __future__ import annotations

import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional

from app.core.config import get_settings
from app.services import whatsapp_repository as repo


def is_phone_jid(jid: str) -> bool:
    txt = (jid or "").strip().lower()
    if not txt or "@lid" in txt or "@g.us" in txt or "@newsletter" in txt:
        return False
    if txt.endswith("@c.us") or txt.endswith("@s.whatsapp.net"):
        local = txt.split("@", 1)[0]
        digits = "".join(ch for ch in local if ch.isdigit())
        return len(digits) >= 10
    return txt.isdigit() and len(txt) >= 10


def normalize_whatsapp_jid(raw: str) -> str:
    """Canonical phone JID (digits + @s.whatsapp.net). Preserves @lid unchanged."""
    txt = (raw or "").strip().lower()
    if not txt:
        return ""
    if txt.endswith("@lid"):
        return txt
    local = txt.split("@", 1)[0] if "@" in txt else txt
    digits = "".join(ch for ch in local if ch.isdigit())
    return f"{digits}@s.whatsapp.net" if digits else txt


def phone_jid_from_waha_payload(inner: dict) -> str:
    """Extract a phone-based JID from WAHA payload _data when from uses @lid."""
    data = inner.get("_data")
    if not isinstance(data, dict):
        return ""
    for key in ("remoteJid", "from", "author", "participant", "senderPn"):
        val = str(data.get(key) or "")
        if "@c.us" in val or "@s.whatsapp.net" in val:
            normalized = normalize_whatsapp_jid(val)
            if is_phone_jid(normalized):
                return normalized
    return ""


def parse_waha_sender(from_raw: str, inner: dict) -> tuple[str, str]:
    """
    Return (link_key, waha_chat_id).
    link_key is the stable identity for account linking; waha_chat_id is used for replies.
    """
    waha_chat_id = (from_raw or "").strip().lower()
    if not waha_chat_id:
        return "", ""
    phone = phone_jid_from_waha_payload(inner)
    if phone:
        return phone, waha_chat_id
    if waha_chat_id.endswith("@lid"):
        return waha_chat_id, waha_chat_id
    return normalize_whatsapp_jid(waha_chat_id), waha_chat_id


def _hash_code(code: str) -> str:
    return hashlib.sha256(code.strip().upper().encode("utf-8")).hexdigest()


def issue_link_code(user_id: int) -> dict:
    settings = get_settings()
    code = secrets.token_hex(3).upper()
    expires = datetime.utcnow() + timedelta(minutes=settings.WHATSAPP_LINK_CODE_TTL_MINUTES)
    repo.upsert_link_code(user_id=user_id, link_code_hash=_hash_code(code), expires_at=expires.isoformat())
    return {"code": code, "expires_at": expires.isoformat()}


def consume_link_code(link_key: str, code: str, waha_chat_id: str = "") -> Optional[int]:
    if not code:
        return None
    chat_id = (waha_chat_id or link_key).strip().lower()
    canonical = normalize_whatsapp_jid(link_key) if is_phone_jid(link_key) else link_key.strip().lower()
    if is_phone_jid(canonical):
        canonical = normalize_whatsapp_jid(canonical)
    return repo.consume_link_code(
        canonical_jid=canonical,
        waha_chat_id=chat_id,
        link_code_hash=_hash_code(code),
        now_iso=datetime.utcnow().isoformat(),
    )


def get_link_status_for_user(user_id: int) -> dict:
    row = repo.get_link_by_user_id(user_id)
    if not row:
        return {"linked": False, "whatsapp_jid": "", "link_status": "none", "verified_at": ""}
    linked = str(row["link_status"] or "") == "linked" and bool(str(row["whatsapp_jid"] or "").strip())
    return {
        "linked": linked,
        "whatsapp_jid": str(row["whatsapp_jid"] or ""),
        "link_status": str(row["link_status"] or "none"),
        "verified_at": str(row["verified_at"] or ""),
        "link_expires_at": str(row["link_expires_at"] or ""),
    }
