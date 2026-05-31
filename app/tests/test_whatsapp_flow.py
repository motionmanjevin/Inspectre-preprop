from __future__ import annotations

import hashlib
import hmac
from pathlib import Path

from app.services import whatsapp_repository as repo
from app.services.waha_client import jid_to_waha_chat_id, split_long_text
from app.services.whatsapp_conversation_service import (
    _extract_inbound_message,
    _fmt_analysis_results,
    _footage_playback_url,
    _parse_selection,
    _verify_webhook_auth,
)
from app.api.models.responses import AnalysisResult
from app.services.whatsapp_linking_service import (
    consume_link_code,
    issue_link_code,
    normalize_whatsapp_jid,
    parse_waha_sender,
)


def test_parse_selection_variants():
    assert _parse_selection("all", 4) == [1, 2, 3, 4]
    assert _parse_selection("1,3", 4) == [1, 3]
    assert _parse_selection("2-4", 5) == [2, 3, 4]
    assert _parse_selection("9", 4) == []


def test_normalize_whatsapp_jid():
    assert normalize_whatsapp_jid("233555111222") == "233555111222@s.whatsapp.net"
    assert normalize_whatsapp_jid("233555111222@s.whatsapp.net") == "233555111222@s.whatsapp.net"
    assert normalize_whatsapp_jid("233555111222@c.us") == "233555111222@s.whatsapp.net"
    assert normalize_whatsapp_jid("190847559684139@lid") == "190847559684139@lid"


def test_parse_waha_sender_lid_with_phone_in_data():
    inner = {
        "from": "190847559684139@lid",
        "_data": {"remoteJid": "233506009755@s.whatsapp.net"},
    }
    link_key, chat_id = parse_waha_sender("190847559684139@lid", inner)
    assert chat_id == "190847559684139@lid"
    assert link_key == "233506009755@s.whatsapp.net"


def test_jid_to_waha_chat_id_preserves_lid():
    assert jid_to_waha_chat_id("190847559684139@lid") == "190847559684139@lid"
    assert jid_to_waha_chat_id("233506009755@s.whatsapp.net") == "233506009755@c.us"


def test_split_long_text():
    short = split_long_text("hello")
    assert short == ["hello"]
    long_body = "a" * 5000
    parts = split_long_text(long_body, max_len=4000)
    assert len(parts) == 2
    assert sum(len(p) for p in parts) >= 5000 - 10
    assert all(len(p) <= 4000 for p in parts)


def test_footage_playback_url_prefers_r2(monkeypatch):
    class _S:
        R2_PUBLIC_URL_BASE = "https://cdn.example.com"

    monkeypatch.setattr("app.services.whatsapp_conversation_service.get_settings", lambda: _S())
    url = _footage_playback_url(
        AnalysisResult(
            video_url="",
            local_path="footage_20260515_185232.mp4",
            analysis="ok",
        )
    )
    assert url == "https://cdn.example.com/raw_footage/footage_20260515_185232.mp4"


def test_fmt_analysis_results_includes_watch_link(monkeypatch):
    class _S:
        R2_PUBLIC_URL_BASE = "https://cdn.example.com"

    monkeypatch.setattr("app.services.whatsapp_conversation_service.get_settings", lambda: _S())
    out = _fmt_analysis_results(
        [
            AnalysisResult(
                video_url="https://cdn.example.com/raw_footage/a.mp4",
                local_path="a.mp4",
                analysis="Two people visible.",
            )
        ]
    )
    assert "Watch: https://cdn.example.com/raw_footage/a.mp4" in out
    assert "Two people visible." in out
    assert "a.mp4" in out


def test_extract_waha_message_payload():
    payload = {
        "event": "message",
        "session": "default",
        "payload": {
            "id": "true_233555111222@c.us_ABC",
            "from": "233555111222@c.us",
            "fromMe": False,
            "body": "hello",
        },
    }
    event_id, link_key, chat_id, text, event_type, from_me, media_url, media_mimetype = _extract_inbound_message(payload)
    assert event_id == "true_233555111222@c.us_ABC"
    assert link_key == "233555111222@s.whatsapp.net"
    assert chat_id == "233555111222@c.us"
    assert text == "hello"
    assert event_type == "message"
    assert from_me is False
    assert media_url == ""
    assert media_mimetype == ""


def test_extract_waha_lid_message():
    payload = {
        "event": "message",
        "session": "default",
        "payload": {
            "id": "msg_lid_1",
            "from": "190847559684139@lid",
            "fromMe": False,
            "body": "test query",
            "_data": {"remoteJid": "233506009755@s.whatsapp.net"},
        },
    }
    _, link_key, chat_id, text, _, from_me, media_url, media_mimetype = _extract_inbound_message(payload)
    assert link_key == "233506009755@s.whatsapp.net"
    assert chat_id == "190847559684139@lid"
    assert text == "test query"
    assert from_me is False
    assert media_url == ""
    assert media_mimetype == ""


def test_extract_voice_note_payload():
    from app.services.whatsapp_voice_transcription import extract_voice_media

    payload = {
        "event": "message",
        "session": "default",
        "payload": {
            "from": "233555111222@c.us",
            "fromMe": False,
            "body": "",
            "hasMedia": True,
            "media": {
                "url": "http://localhost:3000/api/files/voice.ogg",
                "mimetype": "audio/ogg; codecs=opus",
            },
            "_data": {"type": "ptt"},
        },
    }
    _, _, _, text, _, _, media_url, media_mimetype = _extract_inbound_message(payload)
    assert text == ""
    assert media_url == "http://localhost:3000/api/files/voice.ogg"
    assert "audio/ogg" in media_mimetype
    assert extract_voice_media(payload["payload"]) == (
        "http://localhost:3000/api/files/voice.ogg",
        "audio/ogg; codecs=opus",
    )


def test_parse_asr_response():
    from app.services.whatsapp_voice_transcription import _parse_asr_response

    data = {
        "output": {
            "choices": [
                {
                    "message": {
                        "role": "assistant",
                        "content": [{"text": "How many people were there?"}],
                    }
                }
            ]
        }
    }
    assert _parse_asr_response(data) == "How many people were there?"


def test_link_code_issue_and_consume(tmp_path: Path, monkeypatch):
    db_file = tmp_path / "users.db"
    monkeypatch.setattr(repo, "_DB_PATH", db_file)
    repo.init_whatsapp_tables()
    out = issue_link_code(user_id=7)
    assert out["code"]
    user_id = consume_link_code(
        "233555111222@s.whatsapp.net",
        out["code"],
        waha_chat_id="190847559684139@lid",
    )
    assert user_id == 7
    link = repo.find_linked_account("190847559684139@lid", "190847559684139@lid")
    assert link is not None
    assert int(link["user_id"]) == 7
    consumed_again = consume_link_code("233555111222@s.whatsapp.net", out["code"])
    assert consumed_again is None


def test_webhook_api_key_auth(monkeypatch):
    class _S:
        WAHA_API_KEY = "waha-key"
        WAHA_WEBHOOK_SECRET = ""

    monkeypatch.setattr("app.services.whatsapp_conversation_service.get_settings", lambda: _S())
    body = b'{"event":"message"}'
    assert _verify_webhook_auth(body, "", "waha-key")
    assert not _verify_webhook_auth(body, "", "wrong")


def test_webhook_signature_hmac(monkeypatch):
    secret = "supersecret"

    class _S:
        WAHA_API_KEY = ""
        WAHA_WEBHOOK_SECRET = secret

    monkeypatch.setattr("app.services.whatsapp_conversation_service.get_settings", lambda: _S())
    body = b'{"event":"message"}'
    digest = hmac.new(secret.encode("utf-8"), body, hashlib.sha256).hexdigest()
    assert _verify_webhook_auth(body, digest, "")
    assert not _verify_webhook_auth(body, "bad", "")
