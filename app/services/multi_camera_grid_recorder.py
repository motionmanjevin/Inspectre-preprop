"""Multi-camera grid recorder service for up to 4 RTSP streams."""
from __future__ import annotations

import logging
import os
import platform
import subprocess
import tempfile
import threading
import time
from collections import deque
from pathlib import Path
from typing import Callable, Dict, List, Optional

from app.utils.exceptions import VideoRecordingError

logger = logging.getLogger(__name__)


class MultiCameraGridRecorder:
    """Records up to 4 RTSP streams as a single 2x2 grid video."""

    def __init__(
        self,
        cameras: List[Dict[str, object]],
        output_dir: str,
        chunk_duration: int = 60,
        output_width: int = 1280,
        output_height: int = 720,
        fps: int = 25,
    ) -> None:
        self.cameras = list(cameras)[:4]
        self.output_dir = Path(output_dir)
        self.chunk_duration = chunk_duration
        self.output_width = output_width
        self.output_height = output_height
        self.fps = fps

        self.is_recording = False
        self.current_ffmpeg_process: Optional[subprocess.Popen] = None
        self.recording_thread: Optional[threading.Thread] = None
        self.segment_monitor_thread: Optional[threading.Thread] = None
        self.callback: Optional[Callable[[str], None]] = None
        self._stop_event = threading.Event()
        self._seen_segments: set[str] = set()
        self._segment_last_sizes: Dict[str, int] = {}
        self._recording_start_time: Optional[float] = None
        self._filter_script_path: Optional[str] = None
        self.rtsp_url = "multi-camera-grid"

        self.output_dir.mkdir(parents=True, exist_ok=True)
        logger.info("MultiCameraGridRecorder initialized with %d camera slot(s)", len(self.cameras))

    @staticmethod
    def _default_fontfile() -> str:
        if platform.system() == "Windows":
            win = os.environ.get("WINDIR", r"C:\Windows")
            font = Path(win) / "Fonts" / "arial.ttf"
            if font.exists():
                s = font.resolve().as_posix()
                if len(s) >= 2 and s[1] == ":":
                    return f"{s[0]}\\:{s[2:]}"
                return s.replace(":", "\\:")
        for candidate in (
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "/usr/share/fonts/TTF/DejaVuSans.ttf",
            "/System/Library/Fonts/Supplemental/Arial.ttf",
        ):
            if Path(candidate).exists():
                return candidate
        return ""

    @staticmethod
    def _escape_text(text: str) -> str:
        return (text or "").replace("\\", "\\\\").replace("'", "'\\''")

    @staticmethod
    def _slot_name(slot: int) -> str:
        return {
            1: "Top Left",
            2: "Top Right",
            3: "Bottom Left",
            4: "Bottom Right",
        }.get(slot, f"Slot {slot}")

    def _normalize_cameras(self) -> List[Dict[str, object]]:
        defaults = []
        for i in range(1, 5):
            defaults.append({"slot": i, "name": f"Cam {i}", "rtsp_url": "", "enabled": False})
        for idx, c in enumerate(self.cameras[:4]):
            if not isinstance(c, dict):
                continue
            slot = c.get("slot", idx + 1)
            try:
                slot = int(slot)
            except Exception:
                slot = idx + 1
            if slot < 1 or slot > 4:
                slot = idx + 1
            name = str(c.get("name") or f"Cam {slot}").strip() or f"Cam {slot}"
            rtsp_url = str(c.get("rtsp_url") or "").strip()
            enabled = bool(c.get("enabled", bool(rtsp_url)))
            defaults[slot - 1] = {"slot": slot, "name": name, "rtsp_url": rtsp_url, "enabled": enabled}
        return defaults

    @staticmethod
    def _all_enabled_same_rtsp_url(cams: List[Dict[str, object]]) -> Optional[str]:
        """If all four slots are enabled with the same non-empty RTSP URL, return it (single demuxer + split)."""
        urls: List[str] = []
        for cam in cams:
            rtsp_url = str(cam.get("rtsp_url") or "").strip()
            enabled = bool(cam.get("enabled", bool(rtsp_url)))
            if not enabled or not rtsp_url:
                return None
            urls.append(rtsp_url)
        if len(urls) != 4:
            return None
        first = urls[0]
        if all(u == first for u in urls):
            return first
        return None

    @staticmethod
    def _single_enabled_rtsp_url(cams: List[Dict[str, object]]) -> tuple[Optional[str], Optional[int]]:
        """
        If exactly one slot is enabled with a non-empty RTSP URL, return (url, index 0..3).
        Used to avoid infinite lavfi black placeholders: all four cells share that stream's timeline.
        """
        found: Optional[tuple[str, int]] = None
        for idx, cam in enumerate(cams):
            rtsp_url = str(cam.get("rtsp_url") or "").strip()
            enabled = bool(cam.get("enabled", bool(rtsp_url)))
            if not enabled or not rtsp_url:
                continue
            if found is not None:
                return None, None
            found = (rtsp_url, idx)
        if found is None:
            return None, None
        return found[0], found[1]

    def _decorate_cell_filter(
        self,
        input_tag: str,
        cam: Dict[str, object],
        cell_w: int,
        cell_h: int,
        font_prefix: str,
        out_idx: int,
        *,
        force_active: bool = False,
    ) -> str:
        """One cell: scale, pad, camera name, optional No Signal / hint. input_tag e.g. '[0:v]' or '[sp2]'."""
        slot = int(cam["slot"])
        label = self._escape_text(str(cam["name"]))
        has_url = bool(str(cam.get("rtsp_url") or "").strip())
        enabled = bool(cam.get("enabled", has_url))
        fallback = not force_active and (not enabled or not has_url)

        seg = (
            f"{input_tag}scale={cell_w}:{cell_h}:force_original_aspect_ratio=decrease,"
            f"pad={cell_w}:{cell_h}:(ow-iw)/2:(oh-ih)/2:black,"
            f"drawtext={font_prefix}text='{label}':x=8:y=h-th-8:fontsize=18:fontcolor=white:"
            f"box=1:boxcolor=black@0.55:boxborderw=4"
        )
        if fallback:
            seg += (
                f",drawtext={font_prefix}text='No Signal ({self._slot_name(slot)})':"
                f"x=(w-text_w)/2:y=(h-text_h)/2:fontsize=24:fontcolor=white:"
                f"box=1:boxcolor=black@0.6:boxborderw=6"
            )
        else:
            seg += (
                f",drawtext={font_prefix}text='Last frame holds if stream ends':"
                f"x=8:y=8:fontsize=14:fontcolor=white@0.85:box=1:boxcolor=black@0.35:boxborderw=4"
            )
        seg += f"[cf{out_idx}]"
        return seg

    def _decorate_placeholder_cell_same_timeline(
        self,
        input_tag: str,
        cam: Dict[str, object],
        cell_w: int,
        cell_h: int,
        font_prefix: str,
        out_idx: int,
    ) -> str:
        """
        Black cell + labels, clocked from the same decoded stream as the live camera (split branch).
        Avoids lavfi stream_loop inputs that would keep xstack running after the RTSP ends.
        """
        slot = int(cam["slot"])
        label = self._escape_text(str(cam["name"]))
        return (
            f"{input_tag}scale={cell_w}:{cell_h}:force_original_aspect_ratio=decrease,"
            f"pad={cell_w}:{cell_h}:(ow-iw)/2:(oh-ih)/2:black,"
            f"geq=lum='0':cb='128':cr='128',"
            f"drawtext={font_prefix}text='{label}':x=8:y=h-th-8:fontsize=18:fontcolor=white:"
            f"box=1:boxcolor=black@0.55:boxborderw=4,"
            f"drawtext={font_prefix}text='No Signal ({self._slot_name(slot)})':"
            f"x=(w-text_w)/2:y=(h-text_h)/2:fontsize=24:fontcolor=white:"
            f"box=1:boxcolor=black@0.6:boxborderw=6"
            f"[cf{out_idx}]"
        )

    def _build_filter_complex(self, cell_w: int, cell_h: int) -> str:
        """
        2x2 grid via xstack (no infinite full-frame base layer).

        overlay+eof_action=repeat on an infinite black base never terminated, so the segment muxer could
        write chunks forever after all RTSP inputs ended. xstack keeps showing each cell's last frame after
        that input EOF; when every finite input has ended, the graph ends and FFmpeg exits.
        """
        cams = self._normalize_cameras()
        fontfile = self._default_fontfile()
        font_prefix = f"fontfile='{fontfile}':" if fontfile else ""
        parts: List[str] = []

        same_url = self._all_enabled_same_rtsp_url(cams)
        single_url, single_idx = self._single_enabled_rtsp_url(cams)

        if same_url:
            parts.append("[0:v]split=outputs=4[sp0][sp1][sp2][sp3]")
            for i in range(4):
                parts.append(
                    self._decorate_cell_filter(
                        f"[sp{i}]",
                        cams[i],
                        cell_w,
                        cell_h,
                        font_prefix,
                        i,
                        force_active=True,
                    )
                )
        elif single_url is not None and single_idx is not None:
            parts.append("[0:v]split=outputs=4[sp0][sp1][sp2][sp3]")
            for i in range(4):
                if i == single_idx:
                    parts.append(
                        self._decorate_cell_filter(
                            f"[sp{i}]",
                            cams[i],
                            cell_w,
                            cell_h,
                            font_prefix,
                            i,
                        )
                    )
                else:
                    parts.append(
                        self._decorate_placeholder_cell_same_timeline(
                            f"[sp{i}]",
                            cams[i],
                            cell_w,
                            cell_h,
                            font_prefix,
                            i,
                        )
                    )
            logger.info(
                "Multi-camera grid: single RTSP with 3 placeholder cells on shared timeline (stops when stream ends)"
            )
        else:
            for i in range(4):
                parts.append(
                    self._decorate_cell_filter(
                        f"[{i}:v]",
                        cams[i],
                        cell_w,
                        cell_h,
                        font_prefix,
                        i,
                    )
                )

        parts.append(
            "[cf0][cf1][cf2][cf3]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0[grid];"
            f"[grid]fps=fps={self.fps}[outv]"
        )
        return ";".join(parts)

    def _build_ffmpeg_segment_cmd(self) -> list[str]:
        cell_w = self.output_width // 2
        cell_h = self.output_height // 2
        cams = self._normalize_cameras()
        same_url = self._all_enabled_same_rtsp_url(cams)
        single_url, _ = self._single_enabled_rtsp_url(cams)
        filter_complex = self._build_filter_complex(cell_w, cell_h)
        out_template = str(self.output_dir / "chunk_%Y%m%d_%H%M%S.mp4")

        cmd: list[str] = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y"]

        if same_url:
            cmd += [
                "-rtsp_transport",
                "tcp",
                "-thread_queue_size",
                "512",
                "-fflags",
                "+genpts",
                "-use_wallclock_as_timestamps",
                "1",
                "-i",
                same_url,
            ]
        elif single_url:
            cmd += [
                "-rtsp_transport",
                "tcp",
                "-thread_queue_size",
                "512",
                "-fflags",
                "+genpts",
                "-use_wallclock_as_timestamps",
                "1",
                "-i",
                single_url,
            ]
        else:
            for cam in cams:
                rtsp_url = str(cam.get("rtsp_url") or "").strip()
                enabled = bool(cam.get("enabled", bool(rtsp_url)))
                if enabled and rtsp_url:
                    cmd += [
                        "-rtsp_transport",
                        "tcp",
                        "-thread_queue_size",
                        "512",
                        "-fflags",
                        "+genpts",
                        "-use_wallclock_as_timestamps",
                        "1",
                        "-i",
                        rtsp_url,
                    ]
                else:
                    cmd += [
                        "-f",
                        "lavfi",
                        "-stream_loop",
                        "-1",
                        "-i",
                        f"color=c=black:s={cell_w}x{cell_h}:r={self.fps}",
                    ]

        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as tf:
            tf.write(filter_complex)
            self._filter_script_path = tf.name

        cmd += [
            "-filter_complex_script", self._filter_script_path,
            "-map", "[outv]",
            "-an",
            "-c:v", "libx264",
            "-preset", "veryfast",
            "-crf", "23",
            "-pix_fmt", "yuv420p",
            "-f", "segment",
            "-segment_time", str(self.chunk_duration),
            "-reset_timestamps", "1",
            "-strftime", "1",
            out_template,
        ]
        return cmd

    def _run_ffmpeg_segmenter(self) -> None:
        cmd = self._build_ffmpeg_segment_cmd()
        logger.info("Starting multi-camera FFmpeg grid recorder")
        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        except FileNotFoundError as e:
            raise VideoRecordingError("FFmpeg not found. Install FFmpeg and ensure 'ffmpeg' is on PATH.") from e
        self.current_ffmpeg_process = proc
        stderr_tail: deque[str] = deque(maxlen=40)

        def _drain_stderr() -> None:
            try:
                assert proc.stderr is not None
                for line in proc.stderr:
                    line = line.strip()
                    if not line:
                        continue
                    stderr_tail.append(line)
                    logger.debug("ffmpeg-grid: %s", line)
            except Exception:
                pass

        stderr_thread = threading.Thread(target=_drain_stderr, daemon=True, name="FFmpegGridStderr")
        stderr_thread.start()

        try:
            proc.wait()
        finally:
            self.current_ffmpeg_process = None
            if self._filter_script_path:
                try:
                    Path(self._filter_script_path).unlink(missing_ok=True)
                except Exception:
                    pass
                self._filter_script_path = None

        if not self._stop_event.is_set():
            if proc.returncode == 0:
                # All finite inputs ended (e.g. every RTSP stream closed); graph no longer infinite.
                logger.warning(
                    "Multi-camera FFmpeg exited cleanly (all streams finished). "
                    "Recording stopped; restart recording if cameras are back online."
                )
                return
            tail = " | ".join(list(stderr_tail)) if stderr_tail else "(none)"
            raise VideoRecordingError(
                "Multi-camera FFmpeg exited unexpectedly while recording. "
                f"exit_code={proc.returncode} stderr_tail={tail}"
            )

    def _segment_monitor_loop(self) -> None:
        poll_interval = 1.0
        stable_polls_required = 2
        stable_counts: Dict[str, int] = {}
        while self.is_recording and not self._stop_event.is_set():
            try:
                if self._recording_start_time is None:
                    time.sleep(poll_interval)
                    continue
                files = sorted(self.output_dir.glob("chunk_*.mp4"), key=lambda p: p.stat().st_mtime)
                for p in files:
                    fp = str(p)
                    if fp in self._seen_segments:
                        continue
                    try:
                        mtime = p.stat().st_mtime
                        if mtime < self._recording_start_time:
                            self._seen_segments.add(fp)
                            continue
                        size = p.stat().st_size
                    except FileNotFoundError:
                        continue

                    prev_size = self._segment_last_sizes.get(fp)
                    self._segment_last_sizes[fp] = size
                    if prev_size is not None and prev_size == size and size > 0:
                        stable_counts[fp] = stable_counts.get(fp, 0) + 1
                    else:
                        stable_counts[fp] = 0

                    if stable_counts[fp] >= stable_polls_required:
                        self._seen_segments.add(fp)
                        stable_counts.pop(fp, None)
                        if self.callback:
                            try:
                                self.callback(fp)
                            except Exception as e:
                                logger.error("Error in multi-camera chunk callback: %s", e)

                time.sleep(poll_interval)
            except Exception as e:
                logger.debug("Multi-camera segment monitor error (non-fatal): %s", e)
                time.sleep(poll_interval)

    def _record_loop(self) -> None:
        try:
            self._run_ffmpeg_segmenter()
        except Exception as e:
            logger.error("Error in multi-camera recording loop: %s", e, exc_info=True)
            self.is_recording = False
            raise VideoRecordingError(f"Multi-camera recording failed: {e}") from e
        finally:
            self.is_recording = False

    def start_recording(self, callback: Optional[Callable[[str], None]] = None) -> None:
        if self.is_recording:
            logger.warning("Multi-camera recording already in progress")
            return
        self.is_recording = True
        self._stop_event.clear()
        self.callback = callback
        self._recording_start_time = time.time()
        self._seen_segments.clear()
        self._segment_last_sizes.clear()

        self.segment_monitor_thread = threading.Thread(
            target=self._segment_monitor_loop,
            daemon=True,
            name="MultiCamSegmentMonitor",
        )
        self.segment_monitor_thread.start()
        self.recording_thread = threading.Thread(
            target=self._record_loop,
            daemon=True,
            name="MultiCamRecorder",
        )
        self.recording_thread.start()
        logger.info("Multi-camera recording started")

    def stop_recording(self) -> None:
        if not self.is_recording:
            logger.warning("No multi-camera recording in progress")
            return
        self.is_recording = False
        self._stop_event.set()
        if self.current_ffmpeg_process:
            try:
                self.current_ffmpeg_process.terminate()
                self.current_ffmpeg_process.wait(timeout=5)
            except Exception:
                try:
                    self.current_ffmpeg_process.kill()
                except Exception:
                    pass
            self.current_ffmpeg_process = None
        if self.recording_thread:
            self.recording_thread.join(timeout=5)
        if self.segment_monitor_thread:
            self.segment_monitor_thread.join(timeout=5)
        if self._filter_script_path:
            try:
                Path(self._filter_script_path).unlink(missing_ok=True)
            except Exception:
                pass
            self._filter_script_path = None
        logger.info("Multi-camera recording stopped")

