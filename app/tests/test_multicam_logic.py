import unittest
from unittest.mock import patch

from app.api.routes.raw_footage import _camera_scope_prompt_addendum
from app.services.device_config_service import normalize_multi_cameras
from app.services.multi_camera_grid_recorder import MultiCameraGridRecorder


class MultiCamLogicTests(unittest.TestCase):
    def test_normalize_multi_cameras_returns_four_slots(self):
        cams = normalize_multi_cameras(
            [
                {"slot": 1, "name": "Front", "rtsp_url": "rtsp://a", "enabled": True},
                {"slot": 4, "name": "Gate", "rtsp_url": "", "enabled": False},
            ]
        )
        self.assertEqual(len(cams), 4)
        self.assertEqual(cams[0]["name"], "Front")
        self.assertEqual(cams[3]["name"], "Gate")
        self.assertEqual(cams[1]["slot"], 2)

    @patch("app.api.routes.raw_footage.get_device_config")
    def test_scope_prompt_addendum_filters_to_selected_slots(self, mock_cfg):
        mock_cfg.return_value = {
            "camera_mode": "multi",
            "multi_cameras_json": [
                {"slot": 1, "name": "Front Door", "rtsp_url": "rtsp://1", "enabled": True},
                {"slot": 2, "name": "Back Yard", "rtsp_url": "rtsp://2", "enabled": True},
                {"slot": 3, "name": "Garage", "rtsp_url": "rtsp://3", "enabled": True},
                {"slot": 4, "name": "Street", "rtsp_url": "rtsp://4", "enabled": True},
            ],
        }
        addendum = _camera_scope_prompt_addendum([2])
        self.assertIn("Slot 2 (top-right): Back Yard", addendum)
        self.assertNotIn("Front Door", addendum)
        self.assertIn("Required timestamp format example", addendum)

    @patch("app.api.routes.raw_footage.get_device_config")
    def test_scope_prompt_empty_for_single_mode(self, mock_cfg):
        mock_cfg.return_value = {"camera_mode": "single", "multi_cameras_json": []}
        self.assertEqual(_camera_scope_prompt_addendum([1, 2]), "")

    def test_single_enabled_rtsp_url_detects_one_cam(self):
        cams = [
            {"slot": 1, "name": "A", "rtsp_url": "rtsp://live", "enabled": True},
            {"slot": 2, "name": "B", "rtsp_url": "", "enabled": False},
            {"slot": 3, "name": "C", "rtsp_url": "", "enabled": False},
            {"slot": 4, "name": "D", "rtsp_url": "", "enabled": False},
        ]
        url, idx = MultiCameraGridRecorder._single_enabled_rtsp_url(cams)
        self.assertEqual(url, "rtsp://live")
        self.assertEqual(idx, 0)

    def test_single_enabled_rtsp_url_none_when_multiple(self):
        cams = [
            {"slot": 1, "name": "A", "rtsp_url": "rtsp://a", "enabled": True},
            {"slot": 2, "name": "B", "rtsp_url": "rtsp://b", "enabled": True},
            {"slot": 3, "name": "C", "rtsp_url": "", "enabled": False},
            {"slot": 4, "name": "D", "rtsp_url": "", "enabled": False},
        ]
        url, idx = MultiCameraGridRecorder._single_enabled_rtsp_url(cams)
        self.assertIsNone(url)
        self.assertIsNone(idx)

    def test_single_rtsp_filter_uses_split_and_placeholder_geq(self):
        rec = MultiCameraGridRecorder(
            cameras=[
                {"slot": 1, "name": "Live", "rtsp_url": "rtsp://x", "enabled": True},
                {"slot": 2, "name": "Empty", "rtsp_url": "", "enabled": False},
                {"slot": 3, "name": "Off", "rtsp_url": "", "enabled": False},
                {"slot": 4, "name": "Off2", "rtsp_url": "", "enabled": False},
            ],
            output_dir=".",
        )
        fc = rec._build_filter_complex(640, 360)
        self.assertIn("split=outputs=4", fc)
        self.assertIn("geq=lum='0':cb='128':cr='128'", fc)
        self.assertIn("xstack=inputs=4", fc)


if __name__ == "__main__":
    unittest.main()

