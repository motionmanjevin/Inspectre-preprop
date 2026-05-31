"""Conversation state machine for WhatsApp query flow."""
from __future__ import annotations

import hashlib
import hmac
import logging
import re
import threading
from collections import deque
from datetime import datetime
from typing import Optional

from app.api.models.responses import AnalysisResult
from app.api.routes import raw_footage
from app.core.config import get_settings
from app.services.billing_client import get_billing_client
from app.services.waha_client import WahaClient
from app.services.user_service import UserService
from app.services.whatsapp_linking_service import (
    consume_link_code,
    parse_waha_sender,
)
from app.services.whatsapp_voice_transcription import extract_voice_media, transcribe_waha_voice
from app.services.whatsapp_repository import (
    ConversationState,
    find_linked_account,
    get_conversation,
    mark_event_processed,
    upsert_conversation,
    upsert_jid_aliases,
)

logger = logging.getLogger(__name__)
_rate_lock = threading.Lock()
_recent_messages: dict[str, deque[float]] = {}


def _now_ts() -> float:
    return datetime.utcnow().timestamp()


def _range_label(time_str: str, duration: float) -> str:
    try:
        hh, mm, ss = [int(x) for x in time_str.split(":")]
    except Exception:
        return time_str
    start_sec = hh * 3600 + mm * 60 + ss
    dur = int(duration if duration and duration > 0 else 3600)
    end_sec = start_sec + dur
    sh, sm, ss2 = start_sec // 3600, (start_sec % 3600) // 60, start_sec % 60
    eh, em, es = end_sec // 3600, (end_sec % 3600) // 60, end_sec % 60
    return f"{sh:02d}:{sm:02d}:{ss2:02d}-{eh:02d}:{em:02d}:{es:02d}"


def _is_rate_limited(waha_chat_id: str) -> bool:
    settings = get_settings()
    cap = max(1, settings.WHATSAPP_MAX_MESSAGES_PER_MINUTE)
    now = _now_ts()
    with _rate_lock:
        q = _recent_messages.setdefault(waha_chat_id, deque())
        while q and now - q[0] > 60:
            q.popleft()
        if len(q) >= cap:
            return True
        q.append(now)
        return False


def _verify_webhook_auth(body: bytes, signature: str, api_key_header: str) -> bool:
    settings = get_settings()
    expected_key = (settings.WAHA_API_KEY or "").strip()
    if expected_key and api_key_header:
        return hmac.compare_digest(api_key_header.strip(), expected_key)
    secret = (settings.WAHA_WEBHOOK_SECRET or "").strip()
    if not secret:
        return True
    if not signature:
        return False
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    candidate = signature.strip().lower()
    if candidate.startswith("sha256="):
        candidate = candidate.split("=", 1)[1]
    return hmac.compare_digest(digest, candidate)


def _parse_selection(text: str, max_index: int) -> list[int]:
    txt = (text or "").strip().lower()
    if txt in {"all", "*"}:
        return list(range(1, max_index + 1))
    picks: set[int] = set()
    for token in re.split(r"[,\s]+", txt):
        if not token:
            continue
        if "-" in token:
            a, b = token.split("-", 1)
            if a.isdigit() and b.isdigit():
                lo, hi = sorted((int(a), int(b)))
                for n in range(lo, hi + 1):
                    if 1 <= n <= max_index:
                        picks.add(n)
            continue
        if token.isdigit():
            n = int(token)
            if 1 <= n <= max_index:
                picks.add(n)
    return sorted(picks)


def _is_group_chat(waha_chat_id: str) -> bool:
    return "@g.us" in (waha_chat_id or "")


def _extract_inbound_message(payload: dict) -> tuple[str, str, str, str, str, bool, str, str]:
    """Return (event_id, link_key, waha_chat_id, text, event_type, from_me, media_url, media_mimetype)."""
    event_type = str(payload.get("event") or payload.get("eventType") or "")
    inner = payload.get("payload") if isinstance(payload.get("payload"), dict) else {}
    if event_type in {"message", "message.any"} and inner:
        from_me = bool(inner.get("fromMe"))
        from_raw = str(inner.get("from") or inner.get("participant") or "")
        link_key, waha_chat_id = parse_waha_sender(from_raw, inner)
        text = str(inner.get("body") or "").strip()
        media_url, media_mimetype = extract_voice_media(inner)
        event_id = str(
            inner.get("id")
            or hashlib.sha256(
                f"{event_type}:{payload.get('session')}:{waha_chat_id}:{inner.get('timestamp')}:{text}:{media_url}".encode()
            ).hexdigest()
        )
        return event_id, link_key, waha_chat_id, text, event_type, from_me, media_url, media_mimetype
    return "", "", "", "", event_type, False, "", ""


def _fmt_dates(dates: list[str]) -> str:
    lines = ["Choose date:", "0) Today"]
    for idx, d in enumerate(dates, start=1):
        lines.append(f"{idx}) {d}")
    lines.append("Reply with one number. Example: 0")
    return "\n".join(lines)


def _fmt_chunks(day: str, chunks: list[raw_footage.RawFootageItem]) -> str:
    lines = [f"Chunks for {day} (select one or many):"]
    for idx, c in enumerate(chunks, start=1):
        label = "Live" if c.is_live else _range_label(c.time, c.duration_seconds or 0)
        lines.append(f"{idx}) {label}")
    lines.append("Reply: 1,3 or 2-4 or all")
    return "\n".join(lines)


def _footage_playback_url(result: AnalysisResult) -> str:
    """Public playback URL for WhatsApp (R2 preferred, then result video_url)."""
    video_url = (result.video_url or "").strip()
    if video_url.lower().startswith(("http://", "https://")):
        return video_url
    filename = (result.local_path or "").strip()
    if not filename:
        return ""
    settings = get_settings()
    base = (settings.R2_PUBLIC_URL_BASE or "").rstrip("/")
    if base:
        return f"{base}/raw_footage/{filename}"
    return video_url


def _fmt_analysis_results(results: list[AnalysisResult]) -> str:
    lines: list[str] = []
    for idx, result in enumerate(results, start=1):
        filename = (result.local_path or f"chunk {idx}").strip()
        if result.error:
            lines.append(f"{idx}. {filename}\nERROR: {result.error}")
            continue
        playback = _footage_playback_url(result)
        header = f"{idx}. {filename}"
        if playback:
            header = f"{header}\nWatch: {playback}"
        text = (result.analysis or "").strip() or "No analysis text returned."
        lines.append(f"{header}\n\n{text}")
    return "\n\n".join(lines) if lines else "No analysis results returned."


class WhatsAppConversationService:
    def __init__(self) -> None:
        self.sender = WahaClient()
        self.user_service = UserService()

    def _should_transcribe_voice(self, link_key: str, waha_chat_id: str) -> bool:
        if not get_settings().WHATSAPP_VOICE_TRANSCRIPTION_ENABLED:
            return False
        if find_linked_account(link_key, waha_chat_id):
            return True
        state = get_conversation(waha_chat_id).state
        return state in {"await_date", "await_chunks"}

    def handle_webhook(self, body: bytes, payload: dict, signature: str, api_key_header: str = "") -> None:
        if not _verify_webhook_auth(body, signature, api_key_header):
            raise ValueError("Invalid webhook authentication")
        event_id, link_key, waha_chat_id, text, event_type, from_me, media_url, media_mimetype = (
            _extract_inbound_message(payload)
        )
        if event_type and event_type not in {"message"}:
            return
        if from_me or not waha_chat_id:
            return
        if _is_group_chat(waha_chat_id):
            return
        if link_key and link_key != waha_chat_id:
            upsert_jid_aliases(link_key, waha_chat_id)
        if not mark_event_processed(event_id, waha_chat_id, event_type):
            return
        if _is_rate_limited(waha_chat_id):
            self.sender.send_text(waha_chat_id, "Rate limit reached. Please wait a minute and try again.")
            return

        resolved_text = (text or "").strip()
        if not resolved_text and media_url and self._should_transcribe_voice(link_key, waha_chat_id):
            try:
                resolved_text = transcribe_waha_voice(media_url, media_mimetype).strip()
            except Exception as exc:
                logger.warning("Voice transcription failed for %s: %s", waha_chat_id, exc)
                if find_linked_account(link_key, waha_chat_id):
                    self.sender.send_text(
                        waha_chat_id,
                        "Could not transcribe your voice note. Please try again or send text.",
                    )
                return
            if not resolved_text:
                if find_linked_account(link_key, waha_chat_id):
                    self.sender.send_text(waha_chat_id, "Voice note was empty. Please try again.")
                return
            if find_linked_account(link_key, waha_chat_id):
                self.sender.send_text(waha_chat_id, f'Heard: "{resolved_text}"')

        conv = get_conversation(waha_chat_id)
        upsert_conversation(waha_chat_id, state=conv.state, payload=conv.payload, incoming=True)
        self._handle_message(waha_chat_id, link_key, resolved_text)

    def _resolve_linked_user(self, link_key: str, waha_chat_id: str) -> Optional[dict]:
        link = find_linked_account(link_key, waha_chat_id)
        if not link:
            return None
        user_id = int(link["user_id"])
        return self.user_service.get_user_by_id(user_id)

    def _handle_message(self, waha_chat_id: str, link_key: str, text: str) -> None:
        txt = (text or "").strip()
        lower = txt.lower()
        if not txt:
            return
        if lower.startswith("link "):
            code = txt.split(" ", 1)[1].strip()
            user_id = consume_link_code(link_key, code, waha_chat_id=waha_chat_id)
            if user_id:
                upsert_conversation(waha_chat_id, state="idle", payload={}, user_id=user_id, outgoing=True)
                self.sender.send_text(waha_chat_id, "WhatsApp linked successfully. Send your query now.")
            else:
                self.sender.send_text(
                    waha_chat_id,
                    "Invalid or expired link code. Generate a new code from Inspectre setup.",
                )
            return

        user = self._resolve_linked_user(link_key, waha_chat_id)
        if not user:
            return

        state = get_conversation(waha_chat_id)
        if lower in {"/cancel", "cancel"}:
            upsert_conversation(waha_chat_id, state="idle", payload={}, user_id=user["id"], outgoing=True)
            self.sender.send_text(waha_chat_id, "Cancelled. Send a new query when ready.")
            return

        if state.state in {"idle", ""}:
            self._start_query(waha_chat_id, user["id"], txt)
            return
        if state.state == "await_date":
            self._handle_date_choice(waha_chat_id, user["id"], txt, state)
            return
        if state.state == "await_chunks":
            self._handle_chunk_choice(waha_chat_id, user, txt, state)
            return

        upsert_conversation(waha_chat_id, state="idle", payload={}, user_id=user["id"])
        self.sender.send_text(waha_chat_id, "Session reset. Send your query to begin.")

    def _start_query(self, waha_chat_id: str, user_id: int, query: str) -> None:
        items = raw_footage.build_raw_footage_items()
        dates: list[str] = []
        for item in items:
            if item.is_live:
                continue
            if item.date and item.date not in dates:
                dates.append(item.date)
        if not dates:
            self.sender.send_text(waha_chat_id, "No footage available yet.")
            return
        payload = {"query": query, "dates": dates}
        upsert_conversation(waha_chat_id, state="await_date", payload=payload, user_id=user_id, outgoing=True)
        self.sender.send_text(waha_chat_id, f"Query received: \"{query}\"\n\n{_fmt_dates(dates)}")

    def _handle_date_choice(self, waha_chat_id: str, user_id: int, choice: str, state: ConversationState) -> None:
        payload = dict(state.payload or {})
        dates: list[str] = [str(d) for d in payload.get("dates", []) if d]
        if not dates:
            upsert_conversation(waha_chat_id, state="idle", payload={}, user_id=user_id)
            self.sender.send_text(waha_chat_id, "No dates available. Send query again.")
            return
        selected_date = ""
        if choice.isdigit():
            idx = int(choice)
            if idx == 0:
                selected_date = datetime.utcnow().date().isoformat()
            elif 1 <= idx <= len(dates):
                selected_date = dates[idx - 1]
        if not selected_date:
            self.sender.send_text(waha_chat_id, "Invalid date option. Reply with one number, e.g. 0")
            return
        items = [x for x in raw_footage.build_raw_footage_items() if (x.date == selected_date and not x.is_live)]
        max_chunks = max(1, get_settings().WHATSAPP_DEFAULT_MAX_CHUNKS)
        items = items[:max_chunks]
        if not items:
            self.sender.send_text(waha_chat_id, f"No chunks found for {selected_date}. Reply with another date number.")
            return
        next_payload = {
            "query": payload.get("query", ""),
            "selected_date": selected_date,
            "chunk_ids": [x.id for x in items],
        }
        upsert_conversation(waha_chat_id, state="await_chunks", payload=next_payload, user_id=user_id, outgoing=True)
        self.sender.send_text(waha_chat_id, _fmt_chunks(selected_date, items))

    def _handle_chunk_choice(self, waha_chat_id: str, user: dict, choice: str, state: ConversationState) -> None:
        payload = dict(state.payload or {})
        chunk_ids: list[str] = [str(x) for x in payload.get("chunk_ids", []) if x]
        query = str(payload.get("query", "")).strip()
        if not query or not chunk_ids:
            upsert_conversation(waha_chat_id, state="idle", payload={}, user_id=user["id"])
            self.sender.send_text(waha_chat_id, "Session expired. Please send your query again.")
            return
        picks = _parse_selection(choice, len(chunk_ids))
        if not picks:
            self.sender.send_text(waha_chat_id, "Invalid chunk selection. Reply like: 1,3 or 2-4 or all")
            return
        selected = [chunk_ids[i - 1] for i in picks]

        billing = get_billing_client()
        debit = billing.debit_query(email=user["email"], reason="whatsapp_raw_query", amount=1)
        if not debit.get("ok"):
            reason = debit.get("reason", "insufficient_credits")
            if reason == "insufficient_credits":
                self.sender.send_text(waha_chat_id, "Not enough query credits. Please purchase a pack in Inspectre.")
            else:
                self.sender.send_text(waha_chat_id, "Billing service unavailable. Please try again later.")
            return

        self.sender.send_text(waha_chat_id, f"Analyzing {len(selected)} chunk(s)...")
        qwen_client = raw_footage._get_qwen_client()
        settings = raw_footage.get_settings()
        results = raw_footage._process_raw_chunks(
            query=query,
            chunk_ids=selected,
            camera_scope=None,
            settings=settings,
            qwen_client=qwen_client,
            per_result=None,
        )
        out = _fmt_analysis_results(results)
        upsert_conversation(waha_chat_id, state="idle", payload={}, user_id=user["id"], outgoing=True)
        self.sender.send_text_long(waha_chat_id, out)
