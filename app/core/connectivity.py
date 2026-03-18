"""Internet connectivity checker."""
import logging
import urllib.request
import urllib.error

logger = logging.getLogger(__name__)

_CHECK_URLS = [
    "https://1.1.1.1",
    "https://www.google.com",
]
_TIMEOUT = 5  # seconds


def check_internet() -> bool:
    """Return True if the device has a working internet connection."""
    for url in _CHECK_URLS:
        try:
            req = urllib.request.Request(url, method="HEAD")
            with urllib.request.urlopen(req, timeout=_TIMEOUT):
                return True
        except Exception:
            continue
    logger.warning("Internet connectivity check failed for all targets")
    return False
