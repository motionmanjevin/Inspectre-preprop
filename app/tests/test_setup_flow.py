import unittest
from unittest.mock import Mock, patch

from app.services.device_config_service import get_setup_missing_fields, is_full_setup_complete
from app.core.startup_orchestrator import _start_tunnel_and_notify
from app.core.config import get_settings


class SetupFlowTests(unittest.TestCase):
    def setUp(self):
        get_settings.cache_clear()

    def tearDown(self):
        get_settings.cache_clear()

    @patch.dict(
        "os.environ",
        {
            "SMTP_HOST": "smtp.example.com",
            "SMTP_PORT": "587",
            "SMTP_USERNAME": "user",
            "SMTP_PASSWORD": "pass",
            "SMTP_FROM_ADDRESS": "device@example.com",
            "SMTP_USE_TLS": "true",
        },
        clear=False,
    )
    def test_full_setup_complete_true_for_valid_single_camera_config(self):
        get_settings.cache_clear()
        cfg = {
            "camera_mode": "single",
            "rtsp_url": "rtsp://camera",
            "r2_account_id": "acc",
            "r2_access_key_id": "key",
            "r2_secret_access_key": "secret",
            "r2_bucket_name": "bucket",
            "r2_public_url_base": "https://pub.example.r2.dev",
        }
        self.assertEqual(get_setup_missing_fields(cfg), [])
        self.assertTrue(is_full_setup_complete(cfg))

    @patch.dict(
        "os.environ",
        {"SMTP_HOST": "", "SMTP_USERNAME": "", "SMTP_PASSWORD": "", "SMTP_PORT": "0"},
        clear=False,
    )
    def test_full_setup_missing_lists_required_keys(self):
        get_settings.cache_clear()
        cfg = {
            "camera_mode": "single",
            "rtsp_url": "",
        }
        missing = get_setup_missing_fields(cfg)
        self.assertIn("camera.rtsp_url", missing)
        self.assertIn("r2_account_id", missing)
        self.assertIn("env.SMTP_HOST", missing)
        self.assertIn("env.SMTP_PORT", missing)
        self.assertFalse(is_full_setup_complete(cfg))

    @patch("app.core.startup_orchestrator.get_primary_user_email", return_value="owner@example.com")
    @patch("app.services.email_service.EmailService.from_settings")
    @patch("app.main.get_tunnel_manager")
    @patch("app.core.startup_orchestrator.set_last_tunnel_url")
    def test_deferred_setup_sends_tunnel_email_every_restart(
        self,
        mock_set_last_url,
        mock_get_tunnel_manager,
        mock_email_factory,
        _mock_primary_email,
    ):
        tm = Mock()
        tm.start_tunnel.return_value = "https://same-tunnel.example"
        mock_get_tunnel_manager.return_value = tm

        email_svc = Mock()
        mock_email_factory.return_value = email_svc

        cfg = {
            "last_tunnel_url": "https://same-tunnel.example",
            "setup_deferred": 1,
        }
        _start_tunnel_and_notify(cfg)

        email_svc.send_tunnel_link.assert_called_once_with(
            "owner@example.com",
            "https://same-tunnel.example",
        )
        mock_set_last_url.assert_not_called()

    @patch("app.core.startup_orchestrator.get_primary_user_email", return_value="owner@example.com")
    @patch("app.services.email_service.EmailService.from_settings")
    @patch("app.main.get_tunnel_manager")
    @patch("app.core.startup_orchestrator.set_last_tunnel_url")
    def test_non_deferred_same_tunnel_does_not_send_email(
        self,
        mock_set_last_url,
        mock_get_tunnel_manager,
        mock_email_factory,
        _mock_primary_email,
    ):
        tm = Mock()
        tm.start_tunnel.return_value = "https://same-tunnel.example"
        mock_get_tunnel_manager.return_value = tm

        email_svc = Mock()
        mock_email_factory.return_value = email_svc

        cfg = {
            "last_tunnel_url": "https://same-tunnel.example",
            "setup_deferred": 0,
        }
        _start_tunnel_and_notify(cfg)

        email_svc.send_tunnel_link.assert_not_called()
        mock_set_last_url.assert_not_called()


if __name__ == "__main__":
    unittest.main()
