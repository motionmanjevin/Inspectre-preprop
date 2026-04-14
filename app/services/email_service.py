"""SMTP email service for sending tunnel link notifications."""
import logging
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from typing import Optional, Dict, Any
from app.core.config import get_settings

logger = logging.getLogger(__name__)


class EmailService:
    """Sends emails using SMTP credentials from device config."""

    def __init__(
        self,
        host: str,
        port: int,
        username: str,
        password: str,
        from_address: str,
        use_tls: bool = True,
    ):
        self.host = host
        self.port = port
        self.username = username
        self.password = password
        self.from_address = from_address
        self.use_tls = use_tls

    @classmethod
    def from_device_config(cls, cfg: Dict[str, Any]) -> Optional["EmailService"]:
        """Create an EmailService from a device_config dict. Returns None if SMTP is not configured."""
        host = cfg.get("smtp_host", "")
        if not host:
            return None
        return cls(
            host=host,
            port=int(cfg.get("smtp_port", 587)),
            username=cfg.get("smtp_username", ""),
            password=cfg.get("smtp_password", ""),
            from_address=cfg.get("smtp_from_address", ""),
            use_tls=bool(cfg.get("smtp_use_tls", 1)),
        )

    @classmethod
    def from_settings(cls) -> Optional["EmailService"]:
        """Create EmailService from .env-backed application settings."""
        s = get_settings()
        if not (s.SMTP_HOST and s.SMTP_USERNAME and s.SMTP_PASSWORD):
            return None
        return cls(
            host=s.SMTP_HOST,
            port=int(s.SMTP_PORT),
            username=s.SMTP_USERNAME,
            password=s.SMTP_PASSWORD,
            from_address=s.SMTP_FROM_ADDRESS or s.SMTP_USERNAME,
            use_tls=bool(s.SMTP_USE_TLS),
        )

    def send_tunnel_link(self, to_email: str, tunnel_url: str) -> bool:
        """Send the new tunnel URL to the user's email. Returns True on success."""
        subject = "Inspectre - New Tunnel URL"
        body = (
            f"Your Inspectre device has a new Cloudflare tunnel URL:\n\n"
            f"  {tunnel_url}\n\n"
            f"You can paste this into the mobile app to connect.\n\n"
            f"This link changes whenever the device restarts or reconnects to the internet."
        )
        return self._send(to_email, subject, body)

    def _send(self, to_email: str, subject: str, body: str) -> bool:
        try:
            msg = MIMEMultipart()
            msg["From"] = self.from_address or self.username
            msg["To"] = to_email
            msg["Subject"] = subject
            msg.attach(MIMEText(body, "plain"))

            # Port 465 = implicit SSL. Port 587 = submission port (must use STARTTLS for AUTH).
            # Most providers (Gmail, etc.) only advertise AUTH over TLS; plain connection fails with
            # "SMTP AUTH extension not supported by server".
            if self.port == 465:
                server = smtplib.SMTP_SSL(self.host, self.port, timeout=15)
                server.ehlo()
            else:
                server = smtplib.SMTP(self.host, self.port, timeout=15)
                server.ehlo()
                # Use STARTTLS for 587 (standard) or when use_tls is True
                if self.port == 587 or self.use_tls:
                    server.starttls()
                    server.ehlo()

            if self.username:
                server.login(self.username, self.password)
            server.sendmail(msg["From"], [to_email], msg.as_string())
            server.quit()
            logger.info("Tunnel link email sent to %s", to_email)
            return True
        except Exception as e:
            logger.error("Failed to send tunnel link email to %s: %s", to_email, e)
            return False
