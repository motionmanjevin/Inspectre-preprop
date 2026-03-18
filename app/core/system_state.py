"""Global system startup state.

Tracks the current mode of the application (online, offline, pending decision, etc.)
and provides helpers for mode transitions.
"""
import logging
import time
import threading
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)


class SystemMode(str, Enum):
    STARTING = "starting"
    IDLE_NO_ACCOUNT = "idle_no_account"
    PENDING_DECISION = "pending_decision"
    ONLINE = "online"
    OFFLINE_RAW = "offline_raw"


class SystemState:
    """Thread-safe global system state."""

    def __init__(self):
        self._lock = threading.Lock()
        self.mode: SystemMode = SystemMode.STARTING
        self.has_account: bool = False
        self.has_device_config: bool = False
        self.internet_available: bool = False
        self.pending_decision_start: Optional[float] = None  # time.time()
        self.last_internet_check: float = 0.0
        self.tunnel_url: Optional[str] = None
        self.services_started: bool = False

        # RTSP error / retry state
        self.rtsp_error: bool = False
        self.rtsp_error_message: str = ""
        self.rtsp_retry_count: int = 0
        self.rtsp_max_retries: int = 10

    def set_mode(self, mode: SystemMode):
        with self._lock:
            prev = self.mode
            self.mode = mode
            if mode == SystemMode.PENDING_DECISION:
                self.pending_decision_start = time.time()
            logger.info("System mode: %s -> %s", prev.value, mode.value)

    def get_decision_remaining_seconds(self) -> int:
        """Seconds remaining in the 60-second decision window (0 if not in PENDING_DECISION)."""
        if self.mode != SystemMode.PENDING_DECISION or self.pending_decision_start is None:
            return 0
        elapsed = time.time() - self.pending_decision_start
        remaining = max(0, 60 - int(elapsed))
        return remaining

    def clear_rtsp_error(self):
        with self._lock:
            self.rtsp_error = False
            self.rtsp_error_message = ""
            self.rtsp_retry_count = 0

    def to_dict(self) -> dict:
        return {
            "mode": self.mode.value,
            "has_account": self.has_account,
            "has_device_config": self.has_device_config,
            "internet_available": self.internet_available,
            "tunnel_url": self.tunnel_url,
            "services_started": self.services_started,
            "decision_remaining_seconds": self.get_decision_remaining_seconds(),
            "rtsp_error": self.rtsp_error,
            "rtsp_error_message": self.rtsp_error_message,
            "rtsp_retry_count": self.rtsp_retry_count,
        }


# Singleton
system_state = SystemState()
