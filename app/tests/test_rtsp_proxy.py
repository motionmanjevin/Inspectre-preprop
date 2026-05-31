import unittest
from unittest.mock import patch

from app.services.rtsp_proxy import (
    MediaMTXProxy,
    remap_cameras_for_proxy,
    start_proxy_if_enabled,
)


class MediaMTXConfigTests(unittest.TestCase):
    def _cams(self):
        return [
            {"slot": 1, "name": "Front", "rtsp_url": "rtsp://user:pw@10.0.0.10/live", "enabled": True},
            {"slot": 2, "name": "Back", "rtsp_url": "rtsp://10.0.0.11/live", "enabled": True},
            {"slot": 3, "name": "Side", "rtsp_url": "", "enabled": False},
            {"slot": 4, "name": "Gate", "rtsp_url": "rtsp://10.0.0.12/live", "enabled": False},
        ]

    def test_build_config_yaml_only_includes_enabled(self):
        proxy = MediaMTXProxy(self._cams(), port=18554, bind_host="127.0.0.1")
        yaml_text = proxy.build_config_yaml()

        self.assertIn("rtspAddress: 127.0.0.1:18554", yaml_text)
        self.assertIn("rtmp: no", yaml_text)
        self.assertIn("hls: no", yaml_text)
        self.assertIn("webrtc: no", yaml_text)
        self.assertIn("srt: no", yaml_text)
        self.assertIn("api: no", yaml_text)

        self.assertIn("  cam1:", yaml_text)
        self.assertIn("  cam2:", yaml_text)
        self.assertNotIn("  cam3:", yaml_text)
        self.assertNotIn("  cam4:", yaml_text)

        self.assertIn('source: "rtsp://user:pw@10.0.0.10/live"', yaml_text)
        self.assertIn("rtspTransport: tcp", yaml_text)
        self.assertIn("sourceOnDemand: no", yaml_text)

    def test_build_config_yaml_no_active_cameras_uses_placeholder(self):
        proxy = MediaMTXProxy(
            [
                {"slot": 1, "rtsp_url": "", "enabled": False},
                {"slot": 2, "rtsp_url": "", "enabled": False},
                {"slot": 3, "rtsp_url": "", "enabled": False},
                {"slot": 4, "rtsp_url": "", "enabled": False},
            ]
        )
        yaml_text = proxy.build_config_yaml()
        self.assertIn("_placeholder", yaml_text)

    def test_remap_cameras_swaps_only_mapped_urls(self):
        cams = self._cams()
        mapping = {
            "rtsp://user:pw@10.0.0.10/live": "rtsp://127.0.0.1:8554/cam1",
            "rtsp://10.0.0.11/live": "rtsp://127.0.0.1:8554/cam2",
        }
        remapped = remap_cameras_for_proxy(cams, mapping)

        self.assertEqual(remapped[0]["rtsp_url"], "rtsp://127.0.0.1:8554/cam1")
        self.assertEqual(remapped[1]["rtsp_url"], "rtsp://127.0.0.1:8554/cam2")
        self.assertEqual(remapped[2]["rtsp_url"], "")
        self.assertEqual(remapped[3]["rtsp_url"], "rtsp://10.0.0.12/live")
        # Original list is untouched.
        self.assertEqual(cams[0]["rtsp_url"], "rtsp://user:pw@10.0.0.10/live")

    def test_remap_cameras_noop_when_mapping_empty(self):
        cams = self._cams()
        out = remap_cameras_for_proxy(cams, {})
        self.assertEqual([c["rtsp_url"] for c in out], [c["rtsp_url"] for c in cams])

    def test_wait_for_paths_ready_returns_true_when_describe_succeeds(self):
        proxy = MediaMTXProxy(self._cams(), port=8554, bind_host="127.0.0.1")
        with patch.object(proxy, "_rtsp_describe_ok", return_value=True):
            ok = proxy._wait_for_paths_ready(
                ["rtsp://127.0.0.1:8554/cam1", "rtsp://127.0.0.1:8554/cam2"],
                timeout=1.0,
            )
        self.assertTrue(ok)

    def test_wait_for_paths_ready_returns_false_when_describe_never_succeeds(self):
        proxy = MediaMTXProxy(self._cams(), port=8554, bind_host="127.0.0.1")
        with patch.object(proxy, "_rtsp_describe_ok", return_value=False):
            ok = proxy._wait_for_paths_ready(["rtsp://127.0.0.1:8554/cam1"], timeout=1.0)
        self.assertFalse(ok)


class StartProxyIfEnabledTests(unittest.TestCase):
    def setUp(self):
        from app.core.config import get_settings
        get_settings.cache_clear()

    def tearDown(self):
        from app.services.rtsp_proxy import stop_proxy
        stop_proxy()
        from app.core.config import get_settings
        get_settings.cache_clear()

    def test_disabled_returns_empty_mapping_and_does_not_invoke_binary(self):
        with patch.dict("os.environ", {"RTSP_PROXY_ENABLED": "false"}, clear=False):
            from app.core.config import get_settings
            get_settings.cache_clear()
            with patch("app.services.rtsp_proxy.MediaMTXProxy.is_available") as mock_avail:
                mapping = start_proxy_if_enabled([
                    {"slot": 1, "rtsp_url": "rtsp://x", "enabled": True},
                ])
                self.assertEqual(mapping, {})
                mock_avail.assert_not_called()

    def test_enabled_but_binary_missing_returns_empty_and_warns(self):
        with patch.dict("os.environ", {"RTSP_PROXY_ENABLED": "true"}, clear=False):
            from app.core.config import get_settings
            get_settings.cache_clear()
            with patch("app.services.rtsp_proxy.MediaMTXProxy.is_available", return_value=False):
                mapping = start_proxy_if_enabled([
                    {"slot": 1, "rtsp_url": "rtsp://x", "enabled": True},
                ])
                self.assertEqual(mapping, {})


if __name__ == "__main__":
    unittest.main()
