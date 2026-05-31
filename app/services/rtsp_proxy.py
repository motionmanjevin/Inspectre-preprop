"""MediaMTX-based RTSP restream proxy.

Each enabled camera is republished as a stable local RTSP path (e.g. rtsp://127.0.0.1:8554/cam1).
The multi-camera grid recorder then reads from those local URLs instead of pulling raw RTSP from
the cameras directly, which materially reduces decode errors / jitter / sync issues across feeds.

The proxy is best-effort: if the `mediamtx` binary is not installed, the system falls back to the
original direct-RTSP pipeline. Install MediaMTX from https://github.com/bluenviron/mediamtx and make
sure `mediamtx` (or `mediamtx.exe` on Windows) is on PATH.
"""
from __future__ import annotations

import logging
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from urllib.parse import urlparse
from pathlib import Path
from typing import Dict, List, Optional

logger = logging.getLogger(__name__)


def _camera_path_name(slot: int) -> str:
    """Stable local path name for a camera slot."""
    return f"cam{int(slot)}"


class MediaMTXProxy:
    """Manages a MediaMTX subprocess that restreams cameras to local RTSP paths."""

    def __init__(
        self,
        cameras: List[Dict[str, object]],
        port: int = 8554,
        bind_host: str = "127.0.0.1",
        binary_path: str = "mediamtx",
        log_level: str = "warn",
    ) -> None:
        self.cameras = list(cameras)
        self.port = int(port)
        self.bind_host = str(bind_host or "127.0.0.1")
        self.binary_path = str(binary_path or "mediamtx")
        self.log_level = str(log_level or "warn")

        self._proc: Optional[subprocess.Popen] = None
        self._config_path: Optional[Path] = None
        self._url_mapping: Dict[str, str] = {}
        self._stderr_thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()

    @classmethod
    def is_available(cls, binary_path: str = "mediamtx") -> bool:
        """Return True if the mediamtx binary is on PATH."""
        return shutil.which(binary_path) is not None

    @staticmethod
    def _enabled_cameras(cameras: List[Dict[str, object]]) -> List[Dict[str, object]]:
        active: List[Dict[str, object]] = []
        for cam in cameras:
            if not isinstance(cam, dict):
                continue
            url = str(cam.get("rtsp_url") or "").strip()
            enabled = bool(cam.get("enabled", bool(url)))
            if enabled and url:
                active.append(cam)
        return active

    def build_config_yaml(self) -> str:
        """Render minimal MediaMTX YAML restreaming each enabled camera by slot."""
        lines: List[str] = [
            f"logLevel: {self.log_level}",
            "api: no",
            "metrics: no",
            "playback: no",
            f"rtspAddress: {self.bind_host}:{self.port}",
            "rtmp: no",
            "hls: no",
            "webrtc: no",
            "srt: no",
            "paths:",
        ]

        active = self._enabled_cameras(self.cameras)
        if not active:
            lines.append("  _placeholder:")
            lines.append("    source: publisher")
            return "\n".join(lines) + "\n"

        for cam in active:
            try:
                slot = int(cam.get("slot") or 0)
            except Exception:
                slot = 0
            if slot < 1 or slot > 4:
                continue
            url = str(cam.get("rtsp_url") or "").strip()
            if not url:
                continue
            path_name = _camera_path_name(slot)
            safe_url = url.replace("\\", "\\\\").replace('"', '\\"')
            lines.append(f"  {path_name}:")
            lines.append(f'    source: "{safe_url}"')
            lines.append("    sourceOnDemand: no")
            lines.append("    rtspTransport: tcp")

        return "\n".join(lines) + "\n"

    def _proxy_url_for_slot(self, slot: int) -> str:
        return f"rtsp://{self.bind_host}:{self.port}/{_camera_path_name(slot)}"

    def _wait_for_listener(self, timeout: float) -> bool:
        deadline = time.monotonic() + max(0.1, timeout)
        while time.monotonic() < deadline:
            if self._stop_event.is_set():
                return False
            if self._proc and self._proc.poll() is not None:
                return False
            try:
                with socket.create_connection((self.bind_host, self.port), timeout=0.5):
                    return True
            except OSError:
                time.sleep(0.25)
        return False

    @staticmethod
    def _rtsp_describe_ok(rtsp_url: str, timeout: float = 1.5) -> bool:
        """Return True if RTSP DESCRIBE for url succeeds with 200."""
        try:
            parsed = urlparse(rtsp_url)
            host = parsed.hostname
            port = int(parsed.port or 554)
            if not host:
                return False
            req_url = rtsp_url
            if not parsed.path:
                req_url = f"{rtsp_url.rstrip('/')}/"
            req = (
                f"DESCRIBE {req_url} RTSP/1.0\r\n"
                "CSeq: 1\r\n"
                "Accept: application/sdp\r\n"
                "User-Agent: inspectre-proxy-probe\r\n"
                "\r\n"
            ).encode("utf-8", errors="ignore")
            with socket.create_connection((host, port), timeout=timeout) as s:
                s.settimeout(timeout)
                s.sendall(req)
                data = s.recv(1024)
            return b"RTSP/1.0 200" in data or b"RTSP/2.0 200" in data
        except Exception:
            return False

    def _wait_for_paths_ready(self, proxy_urls: List[str], timeout: float) -> bool:
        """Wait until every expected local proxy URL accepts RTSP DESCRIBE."""
        if not proxy_urls:
            return False
        deadline = time.monotonic() + max(1.0, timeout)
        while time.monotonic() < deadline:
            if self._stop_event.is_set():
                return False
            if self._proc and self._proc.poll() is not None:
                return False
            all_ready = True
            for proxy_url in proxy_urls:
                if not self._rtsp_describe_ok(proxy_url):
                    all_ready = False
                    break
            if all_ready:
                return True
            time.sleep(0.4)
        return False

    def _drain_stderr(self) -> None:
        try:
            assert self._proc is not None
            assert self._proc.stderr is not None
            for raw_line in self._proc.stderr:
                line = (raw_line or "").strip()
                if not line:
                    continue
                logger.debug("mediamtx: %s", line)
        except Exception:
            return

    def start(self, startup_timeout: float = 8.0) -> Dict[str, str]:
        """Start MediaMTX and return mapping of original_url -> proxy_url for enabled slots."""
        if self._proc is not None and self._proc.poll() is None:
            return dict(self._url_mapping)

        if not self.is_available(self.binary_path):
            raise RuntimeError(
                "MediaMTX binary not found on PATH. Install MediaMTX or set RTSP_PROXY_ENABLED=false."
            )

        active = self._enabled_cameras(self.cameras)
        if not active:
            logger.info("RTSP proxy: no enabled cameras to restream; skipping")
            return {}

        config_text = self.build_config_yaml()
        tf = tempfile.NamedTemporaryFile(
            mode="w", suffix=".yml", prefix="mediamtx_", delete=False, encoding="utf-8"
        )
        try:
            tf.write(config_text)
            tf.flush()
            self._config_path = Path(tf.name)
        finally:
            tf.close()

        cmd = [self.binary_path, str(self._config_path)]
        logger.info(
            "Starting MediaMTX RTSP proxy on %s:%d (paths: %s)",
            self.bind_host,
            self.port,
            ", ".join(_camera_path_name(int(c.get("slot") or 0)) for c in active),
        )
        self._stop_event.clear()
        try:
            self._proc = subprocess.Popen(
                cmd,
                stdout=subprocess.DEVNULL,
                stderr=subprocess.PIPE,
                text=True,
            )
        except FileNotFoundError as e:
            self._cleanup_config()
            raise RuntimeError(f"Failed to launch MediaMTX: {e}") from e

        self._stderr_thread = threading.Thread(
            target=self._drain_stderr, daemon=True, name="MediaMTXStderr"
        )
        self._stderr_thread.start()

        if not self._wait_for_listener(startup_timeout):
            logger.warning("MediaMTX did not start listening on %s:%d within %.1fs", self.bind_host, self.port, startup_timeout)
            self.stop()
            return {}

        mapping: Dict[str, str] = {}
        for cam in active:
            try:
                slot = int(cam.get("slot") or 0)
            except Exception:
                continue
            if slot < 1 or slot > 4:
                continue
            url = str(cam.get("rtsp_url") or "").strip()
            if not url:
                continue
            mapping[url] = self._proxy_url_for_slot(slot)

        # Avoid startup races: only expose proxy URLs once each path answers DESCRIBE.
        expected_proxy_urls = list(mapping.values())
        if not self._wait_for_paths_ready(expected_proxy_urls, startup_timeout):
            logger.warning(
                "MediaMTX started but proxied paths not ready in time (%s); falling back to direct RTSP",
                ", ".join(expected_proxy_urls),
            )
            self.stop()
            return {}
        self._url_mapping = mapping
        return dict(mapping)

    def stop(self) -> None:
        self._stop_event.set()
        proc = self._proc
        self._proc = None
        if proc is not None and proc.poll() is None:
            try:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=2)
            except Exception as e:
                logger.warning("Error stopping MediaMTX: %s", e)
        self._url_mapping.clear()
        self._cleanup_config()

    def _cleanup_config(self) -> None:
        path = self._config_path
        self._config_path = None
        if path is not None:
            try:
                path.unlink(missing_ok=True)
            except Exception:
                pass

    @property
    def is_running(self) -> bool:
        return self._proc is not None and self._proc.poll() is None

    @property
    def url_mapping(self) -> Dict[str, str]:
        return dict(self._url_mapping)


_proxy_singleton: Optional[MediaMTXProxy] = None
_proxy_lock = threading.Lock()


def get_proxy() -> Optional[MediaMTXProxy]:
    """Return the active proxy instance (or None)."""
    return _proxy_singleton


def remap_cameras_for_proxy(
    cameras: List[Dict[str, object]],
    url_mapping: Dict[str, str],
) -> List[Dict[str, object]]:
    """Return a deep-enough copy of cameras with rtsp_url replaced by proxy URL when present."""
    if not url_mapping:
        return list(cameras)
    out: List[Dict[str, object]] = []
    for cam in cameras:
        if not isinstance(cam, dict):
            out.append(cam)
            continue
        new_cam = dict(cam)
        original = str(new_cam.get("rtsp_url") or "").strip()
        if original and original in url_mapping:
            new_cam["rtsp_url"] = url_mapping[original]
        out.append(new_cam)
    return out


def start_proxy_if_enabled(
    cameras: List[Dict[str, object]],
) -> Dict[str, str]:
    """Start the singleton proxy if env-enabled and binary available; return URL mapping (or empty)."""
    global _proxy_singleton
    from app.core.config import get_settings

    settings = get_settings()
    if not bool(getattr(settings, "RTSP_PROXY_ENABLED", False)):
        return {}

    binary = getattr(settings, "RTSP_PROXY_BINARY", "mediamtx") or "mediamtx"
    if not MediaMTXProxy.is_available(binary):
        logger.warning(
            "RTSP_PROXY_ENABLED=true but '%s' binary is not on PATH; falling back to direct RTSP",
            binary,
        )
        return {}

    with _proxy_lock:
        if _proxy_singleton is not None and _proxy_singleton.is_running:
            return _proxy_singleton.url_mapping

        proxy = MediaMTXProxy(
            cameras=cameras,
            port=int(getattr(settings, "RTSP_PROXY_PORT", 8554)),
            bind_host=str(getattr(settings, "RTSP_PROXY_BIND_HOST", "127.0.0.1")),
            binary_path=binary,
        )
        try:
            mapping = proxy.start()
        except Exception as e:
            logger.warning("Could not start RTSP proxy, using direct RTSP. Error: %s", e)
            return {}
        if not mapping:
            try:
                proxy.stop()
            except Exception:
                pass
            return {}
        _proxy_singleton = proxy
        return dict(mapping)


def stop_proxy() -> None:
    global _proxy_singleton
    with _proxy_lock:
        proxy = _proxy_singleton
        _proxy_singleton = None
    if proxy is not None:
        try:
            proxy.stop()
        except Exception as e:
            logger.warning("Error stopping RTSP proxy: %s", e)
