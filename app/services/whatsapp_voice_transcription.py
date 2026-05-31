"""Download WhatsApp voice media from WAHA and transcribe with Qwen ASR."""
from __future__ import annotations

import base64
import logging
from urllib.parse import parse_qs, urlencode, urlparse, urlunparse

import httpx
import requests

from app.core.config import get_settings
from app.utils.exceptions import QwenAPIError

logger = logging.getLogger(__name__)

_VOICE_MIMETYPES = (
    "audio/",
    "application/ogg",
    "application/octet-stream",
)


def _dashscope_root() -> str:
    settings = get_settings()
    base = (settings.QWEN_BASE_URL or "").rstrip("/")
    if "/compatible-mode" in base:
        return base.split("/compatible-mode", 1)[0]
    if base.endswith("/v1"):
        return base[:-3].rstrip("/")
    return base or "https://dashscope-intl.aliyuncs.com"


def is_voice_media(mimetype: str, inner: dict) -> bool:
    """True for WhatsApp voice notes / audio attachments."""
    mt = (mimetype or "").strip().lower()
    if any(mt.startswith(prefix) for prefix in _VOICE_MIMETYPES):
        return True
    data = inner.get("_data") if isinstance(inner.get("_data"), dict) else {}
    msg_type = str(data.get("type") or inner.get("type") or "").lower()
    if msg_type in {"ptt", "audio"}:
        return True
    if inner.get("isPtt") or inner.get("ptt"):
        return True
    return False


def extract_voice_media(inner: dict) -> tuple[str, str]:
    """Return (media_url, mimetype) when message has downloadable voice media."""
    if not isinstance(inner, dict) or not inner.get("hasMedia"):
        return "", ""
    media = inner.get("media") if isinstance(inner.get("media"), dict) else {}
    url = str(media.get("url") or "").strip()
    if not url:
        return "", ""
    mimetype = str(media.get("mimetype") or "audio/ogg").strip()
    if not is_voice_media(mimetype, inner):
        return "", ""
    return url, mimetype


def download_waha_media(media_url: str, api_key: str, timeout: float = 60.0) -> bytes:
    """Fetch media bytes from WAHA /api/files with API key auth."""
    key = (api_key or "").strip()
    if not media_url:
        raise ValueError("Missing media URL")
    headers = {"X-Api-Key": key} if key else {}
    parsed = urlparse(media_url)
    query = parse_qs(parsed.query, keep_blank_values=True)
    if key and "x-api-key" not in query:
        query["x-api-key"] = [key]
        media_url = urlunparse(parsed._replace(query=urlencode(query, doseq=True)))
    with httpx.Client(timeout=timeout, follow_redirects=True) as client:
        resp = client.get(media_url, headers=headers)
        if resp.status_code >= 300:
            raise ValueError(f"WAHA media download failed ({resp.status_code})")
        return resp.content


def _parse_asr_response(data: dict) -> str:
    output = data.get("output") if isinstance(data.get("output"), dict) else {}
    choices = output.get("choices") if isinstance(output.get("choices"), list) else []
    for choice in choices:
        if not isinstance(choice, dict):
            continue
        message = choice.get("message") if isinstance(choice.get("message"), dict) else {}
        content = message.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict):
                    text = str(block.get("text") or "").strip()
                    if text:
                        return text
        if isinstance(content, str) and content.strip():
            return content.strip()
    raise QwenAPIError("Qwen ASR returned no transcription text")


def transcribe_audio_bytes(audio_bytes: bytes, mimetype: str) -> str:
    """Transcribe short audio using Qwen3-ASR-Flash (DashScope sync, base64 input)."""
    settings = get_settings()
    if not settings.QWEN_API_KEY:
        raise QwenAPIError("QWEN_API_KEY is not configured")
    if not audio_bytes:
        raise QwenAPIError("Empty audio payload")
    mt = (mimetype or "audio/ogg").split(";", 1)[0].strip() or "audio/ogg"
    b64 = base64.b64encode(audio_bytes).decode("ascii")
    audio_data_url = f"data:{mt};base64,{b64}"
    model = (settings.QWEN_ASR_MODEL or "qwen3-asr-flash").strip()
    endpoint = f"{_dashscope_root()}/api/v1/services/aigc/multimodal-generation/generation"
    payload = {
        "model": model,
        "input": {
            "messages": [
                {"role": "system", "content": [{"text": ""}]},
                {"role": "user", "content": [{"audio": audio_data_url}]},
            ]
        },
        "parameters": {"asr_options": {"enable_itn": False}},
    }
    headers = {
        "Authorization": f"Bearer {settings.QWEN_API_KEY}",
        "Content-Type": "application/json",
    }
    try:
        resp = requests.post(endpoint, json=payload, headers=headers, timeout=120)
        if resp.status_code >= 300:
            raise QwenAPIError(f"Qwen ASR failed: status={resp.status_code} body={resp.text[:500]}")
        data = resp.json()
    except QwenAPIError:
        raise
    except Exception as exc:
        raise QwenAPIError(f"Qwen ASR request failed: {exc}") from exc
    text = _parse_asr_response(data)
    if not text:
        raise QwenAPIError("Qwen ASR returned empty transcription")
    return text


def transcribe_waha_voice(media_url: str, mimetype: str) -> str:
    """Download voice note from WAHA and return transcription text."""
    settings = get_settings()
    api_key = settings.WAHA_API_KEY or settings.EVOLUTION_API_KEY or ""
    audio = download_waha_media(media_url, api_key=api_key)
    return transcribe_audio_bytes(audio, mimetype)
