"""Persistence helpers for WhatsApp linking, conversations, and webhook idempotency."""
from __future__ import annotations

import json
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Optional

_DB_PATH = Path("users.db")
_lock = threading.Lock()


def _utcnow() -> str:
    return datetime.utcnow().isoformat()


def _conn() -> sqlite3.Connection:
    conn = sqlite3.connect(str(_DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


@dataclass
class ConversationState:
    whatsapp_jid: str
    user_id: Optional[int]
    state: str
    payload: dict[str, Any]
    updated_at: str


def init_whatsapp_tables() -> None:
    with _lock:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS whatsapp_account_links (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id INTEGER NOT NULL,
                whatsapp_jid TEXT NOT NULL UNIQUE,
                link_status TEXT NOT NULL DEFAULT 'linked',
                link_code_hash TEXT NOT NULL DEFAULT '',
                link_expires_at TEXT NOT NULL DEFAULT '',
                verified_at TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT '',
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS whatsapp_conversations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                whatsapp_jid TEXT NOT NULL UNIQUE,
                user_id INTEGER,
                state TEXT NOT NULL DEFAULT 'idle',
                state_payload TEXT NOT NULL DEFAULT '{}',
                last_incoming_at TEXT NOT NULL DEFAULT '',
                last_outgoing_at TEXT NOT NULL DEFAULT '',
                updated_at TEXT NOT NULL DEFAULT '',
                FOREIGN KEY(user_id) REFERENCES users(id)
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS whatsapp_webhook_events (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                provider_event_id TEXT NOT NULL UNIQUE,
                whatsapp_jid TEXT NOT NULL DEFAULT '',
                event_type TEXT NOT NULL DEFAULT 'message',
                status TEXT NOT NULL DEFAULT 'processed',
                error TEXT NOT NULL DEFAULT '',
                processed_at TEXT NOT NULL DEFAULT ''
            )
            """
        )
        cur.execute(
            """
            CREATE TABLE IF NOT EXISTS whatsapp_jid_aliases (
                alias_jid TEXT PRIMARY KEY,
                canonical_jid TEXT NOT NULL
            )
            """
        )
        for stmt in (
            "ALTER TABLE whatsapp_account_links ADD COLUMN waha_chat_id TEXT NOT NULL DEFAULT ''",
        ):
            try:
                cur.execute(stmt)
            except sqlite3.OperationalError:
                pass
        conn.commit()
        conn.close()


def mark_event_processed(provider_event_id: str, whatsapp_jid: str, event_type: str) -> bool:
    """Return False if this event id was already processed."""
    with _lock:
        conn = _conn()
        cur = conn.cursor()
        try:
            cur.execute(
                """
                INSERT INTO whatsapp_webhook_events
                (provider_event_id, whatsapp_jid, event_type, status, processed_at)
                VALUES (?, ?, ?, 'processed', ?)
                """,
                (provider_event_id, whatsapp_jid, event_type, _utcnow()),
            )
            conn.commit()
            return True
        except sqlite3.IntegrityError:
            return False
        finally:
            conn.close()


def upsert_link_code(user_id: int, link_code_hash: str, expires_at: str) -> None:
    now = _utcnow()
    with _lock:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("SELECT id FROM whatsapp_account_links WHERE user_id = ?", (user_id,))
        row = cur.fetchone()
        if row:
            cur.execute(
                """
                UPDATE whatsapp_account_links
                SET link_code_hash = ?, link_expires_at = ?, link_status = 'pending', updated_at = ?
                WHERE user_id = ?
                """,
                (link_code_hash, expires_at, now, user_id),
            )
        else:
            cur.execute(
                """
                INSERT INTO whatsapp_account_links
                (user_id, whatsapp_jid, link_status, link_code_hash, link_expires_at, created_at, updated_at)
                VALUES (?, ?, 'pending', ?, ?, ?, ?)
                """,
                (user_id, "", link_code_hash, expires_at, now, now),
            )
        conn.commit()
        conn.close()


def get_link_by_user_id(user_id: int) -> Optional[sqlite3.Row]:
    with _lock:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("SELECT * FROM whatsapp_account_links WHERE user_id = ?", (user_id,))
        row = cur.fetchone()
        conn.close()
        return row


def get_link_by_jid(whatsapp_jid: str) -> Optional[sqlite3.Row]:
    with _lock:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("SELECT * FROM whatsapp_account_links WHERE whatsapp_jid = ?", (whatsapp_jid,))
        row = cur.fetchone()
        conn.close()
        return row


def upsert_jid_aliases(canonical_jid: str, *aliases: str) -> None:
    canonical = (canonical_jid or "").strip().lower()
    if not canonical:
        return
    with _lock:
        conn = _conn()
        cur = conn.cursor()
        for alias in aliases:
            alias_id = (alias or "").strip().lower()
            if not alias_id or alias_id == canonical:
                continue
            cur.execute(
                """
                INSERT INTO whatsapp_jid_aliases (alias_jid, canonical_jid)
                VALUES (?, ?)
                ON CONFLICT(alias_jid) DO UPDATE SET canonical_jid = excluded.canonical_jid
                """,
                (alias_id, canonical),
            )
        conn.commit()
        conn.close()


def _canonical_jid_for(jid: str) -> str:
    needle = (jid or "").strip().lower()
    if not needle:
        return ""
    with _lock:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("SELECT canonical_jid FROM whatsapp_jid_aliases WHERE alias_jid = ?", (needle,))
        row = cur.fetchone()
        conn.close()
    return str(row["canonical_jid"]) if row else needle


def get_link_by_waha_chat_id(waha_chat_id: str) -> Optional[sqlite3.Row]:
    needle = (waha_chat_id or "").strip().lower()
    if not needle:
        return None
    with _lock:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            "SELECT * FROM whatsapp_account_links WHERE waha_chat_id = ? AND link_status = 'linked'",
            (needle,),
        )
        row = cur.fetchone()
        conn.close()
        return row


def find_linked_account(link_key: str, waha_chat_id: str) -> Optional[sqlite3.Row]:
    """Resolve a linked account by phone JID, WAHA chat id, or stored aliases."""
    candidates: list[str] = []
    for raw in (link_key, waha_chat_id):
        val = (raw or "").strip().lower()
        if val and val not in candidates:
            candidates.append(val)
        canonical = _canonical_jid_for(val) if val else ""
        if canonical and canonical not in candidates:
            candidates.append(canonical)
    for jid in candidates:
        row = get_link_by_jid(jid)
        if row and str(row["link_status"] or "") == "linked":
            return row
        row = get_link_by_waha_chat_id(jid)
        if row:
            return row
    return None


def consume_link_code(
    canonical_jid: str,
    waha_chat_id: str,
    link_code_hash: str,
    now_iso: str,
) -> Optional[int]:
    """Bind a pending link code to a jid, returns user_id when consumed."""
    canonical = (canonical_jid or "").strip().lower()
    chat_id = (waha_chat_id or canonical).strip().lower()
    with _lock:
        conn = _conn()
        cur = conn.cursor()
        cur.execute(
            """
            SELECT * FROM whatsapp_account_links
            WHERE link_code_hash = ? AND link_status = 'pending' AND link_expires_at >= ?
            ORDER BY id DESC LIMIT 1
            """,
            (link_code_hash, now_iso),
        )
        row = cur.fetchone()
        if not row:
            conn.close()
            return None
        user_id = int(row["user_id"])
        cur.execute(
            """
            UPDATE whatsapp_account_links
            SET whatsapp_jid = ?, waha_chat_id = ?, link_status = 'linked', link_code_hash = '',
                link_expires_at = '', verified_at = ?, updated_at = ?
            WHERE id = ?
            """,
            (canonical, chat_id, now_iso, now_iso, int(row["id"])),
        )
        conn.commit()
        conn.close()
    upsert_jid_aliases(canonical, chat_id)
    return user_id


def unlink_user(user_id: int) -> None:
    with _lock:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("DELETE FROM whatsapp_account_links WHERE user_id = ?", (user_id,))
        conn.commit()
        conn.close()


def upsert_conversation(
    whatsapp_jid: str,
    state: str,
    payload: dict[str, Any],
    user_id: Optional[int] = None,
    incoming: bool = False,
    outgoing: bool = False,
) -> None:
    now = _utcnow()
    with _lock:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("SELECT id, last_incoming_at, last_outgoing_at FROM whatsapp_conversations WHERE whatsapp_jid = ?", (whatsapp_jid,))
        row = cur.fetchone()
        payload_json = json.dumps(payload or {})
        if row:
            last_in = now if incoming else str(row["last_incoming_at"] or "")
            last_out = now if outgoing else str(row["last_outgoing_at"] or "")
            cur.execute(
                """
                UPDATE whatsapp_conversations
                SET user_id = COALESCE(?, user_id),
                    state = ?, state_payload = ?, last_incoming_at = ?, last_outgoing_at = ?, updated_at = ?
                WHERE whatsapp_jid = ?
                """,
                (user_id, state, payload_json, last_in, last_out, now, whatsapp_jid),
            )
        else:
            cur.execute(
                """
                INSERT INTO whatsapp_conversations
                (whatsapp_jid, user_id, state, state_payload, last_incoming_at, last_outgoing_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    whatsapp_jid,
                    user_id,
                    state,
                    payload_json,
                    now if incoming else "",
                    now if outgoing else "",
                    now,
                ),
            )
        conn.commit()
        conn.close()


def get_conversation(whatsapp_jid: str) -> ConversationState:
    with _lock:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("SELECT * FROM whatsapp_conversations WHERE whatsapp_jid = ?", (whatsapp_jid,))
        row = cur.fetchone()
        conn.close()
    if not row:
        return ConversationState(
            whatsapp_jid=whatsapp_jid,
            user_id=None,
            state="idle",
            payload={},
            updated_at="",
        )
    payload_raw = str(row["state_payload"] or "{}")
    try:
        payload = json.loads(payload_raw)
    except Exception:
        payload = {}
    return ConversationState(
        whatsapp_jid=whatsapp_jid,
        user_id=int(row["user_id"]) if row["user_id"] is not None else None,
        state=str(row["state"] or "idle"),
        payload=payload if isinstance(payload, dict) else {},
        updated_at=str(row["updated_at"] or ""),
    )


def is_any_whatsapp_linked() -> bool:
    with _lock:
        conn = _conn()
        cur = conn.cursor()
        cur.execute("SELECT 1 FROM whatsapp_account_links WHERE link_status = 'linked' LIMIT 1")
        row = cur.fetchone()
        conn.close()
        return row is not None
