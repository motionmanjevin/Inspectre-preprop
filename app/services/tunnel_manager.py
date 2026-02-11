"""Cloudflare Tunnel manager service."""
import logging
import re
import subprocess
import threading
from typing import Optional
from collections import deque

from app.utils.exceptions import VideoRecordingError

logger = logging.getLogger(__name__)


class TunnelManager:
    """Manages Cloudflare Tunnel process and URL extraction."""
    
    def __init__(self, local_url: str = "http://localhost:8000"):
        """
        Initialize tunnel manager.
        
        Args:
            local_url: Local URL to tunnel (default: http://localhost:8000)
        """
        self.local_url = local_url
        self.tunnel_process: Optional[subprocess.Popen] = None
        self.tunnel_url: Optional[str] = None
        self._stderr_buffer: deque[str] = deque(maxlen=50)
        self._lock = threading.Lock()
    
    def start_tunnel(self) -> str:
        """
        Start Cloudflare tunnel and extract public URL.
        
        Returns:
            Public tunnel URL (e.g., https://xxxxx.trycloudflare.com)
        
        Raises:
            VideoRecordingError: If tunnel fails to start or URL cannot be extracted
        """
        with self._lock:
            if self.tunnel_process is not None:
                if self.tunnel_url:
                    logger.info(f"Tunnel already running: {self.tunnel_url}")
                    return self.tunnel_url
                else:
                    logger.warning("Tunnel process exists but URL not captured yet")
                    return None
            
            try:
                logger.info(f"Starting Cloudflare tunnel for {self.local_url}")
                # Start cloudflared tunnel
                self.tunnel_process = subprocess.Popen(
                    ["cloudflared", "tunnel", "--url", self.local_url],
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,
                )
                
                # Start stderr reader thread
                stderr_thread = threading.Thread(
                    target=self._drain_stderr,
                    daemon=True,
                    name="TunnelStderr"
                )
                stderr_thread.start()
                
                # Wait a bit for tunnel to initialize and print URL
                import time
                max_wait = 10  # seconds
                wait_interval = 0.5
                waited = 0
                
                while waited < max_wait:
                    if self.tunnel_url:
                        logger.info(f"Tunnel started successfully: {self.tunnel_url}")
                        return self.tunnel_url
                    time.sleep(wait_interval)
                    waited += wait_interval
                    
                    # Check if process died
                    if self.tunnel_process.poll() is not None:
                        stderr_tail = list(self._stderr_buffer)
                        raise VideoRecordingError(
                            f"Cloudflare tunnel exited unexpectedly. "
                            f"exit_code={self.tunnel_process.returncode} "
                            f"stderr_tail={' | '.join(stderr_tail) if stderr_tail else '(none)'}"
                        )
                
                # If we get here, URL wasn't captured
                stderr_tail = list(self._stderr_buffer)
                raise VideoRecordingError(
                    f"Failed to extract tunnel URL after {max_wait}s. "
                    f"stderr_tail={' | '.join(stderr_tail) if stderr_tail else '(none)'}"
                )
                
            except FileNotFoundError:
                raise VideoRecordingError(
                    "cloudflared not found. Install Cloudflare Tunnel and ensure 'cloudflared' is on PATH."
                ) from None
            except Exception as e:
                raise VideoRecordingError(f"Failed to start tunnel: {str(e)}") from e
    
    def _drain_stderr(self) -> None:
        """Read stderr and extract tunnel URL."""
        try:
            assert self.tunnel_process is not None
            assert self.tunnel_process.stderr is not None
            
            for line in self.tunnel_process.stderr:
                line = line.strip()
                if not line:
                    continue
                
                self._stderr_buffer.append(line)
                logger.debug(f"cloudflared: {line}")
                
                # Extract URL from cloudflared output
                # Pattern: "https://xxxxx.trycloudflare.com" or similar
                url_patterns = [
                    r'https://[a-zA-Z0-9-]+\.trycloudflare\.com',
                    r'https://[a-zA-Z0-9-]+\.cfargotunnel\.com',
                    r'https://[a-zA-Z0-9.-]+\.trycloudflare\.com',
                ]
                
                for pattern in url_patterns:
                    match = re.search(pattern, line)
                    if match:
                        url = match.group(0)
                        if not self.tunnel_url:
                            self.tunnel_url = url
                            logger.info(f"Extracted tunnel URL: {url}")
                        break
                        
        except Exception as e:
            logger.error(f"Error reading tunnel stderr: {e}")
    
    def stop_tunnel(self) -> None:
        """Stop the tunnel process."""
        with self._lock:
            if self.tunnel_process is not None:
                try:
                    logger.info("Stopping Cloudflare tunnel")
                    self.tunnel_process.terminate()
                    try:
                        self.tunnel_process.wait(timeout=5)
                    except subprocess.TimeoutExpired:
                        self.tunnel_process.kill()
                        self.tunnel_process.wait()
                except Exception as e:
                    logger.error(f"Error stopping tunnel: {e}")
                finally:
                    self.tunnel_process = None
                    self.tunnel_url = None
    
    def get_tunnel_url(self) -> Optional[str]:
        """Get current tunnel URL if available."""
        return self.tunnel_url
    
    def __del__(self):
        """Cleanup on destruction."""
        self.stop_tunnel()
