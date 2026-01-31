"""Video recording service for RTSP streams."""
import cv2
import time
import logging
import subprocess
import shutil
import os
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from typing import Optional, Callable, Dict, Set
import threading
from collections import deque

from app.utils.exceptions import VideoRecordingError
from app.core.config import get_settings

logger = logging.getLogger(__name__)


class VideoRecorder:
    """Records RTSP video stream in chunks as MP4 files using FFmpeg (direct H.264 copy)."""
    
    def __init__(
        self,
        rtsp_url: str,
        output_dir: Optional[str] = None,
        chunk_duration: Optional[int] = None
    ):
        """
        Initialize video recorder.
        
        Args:
            rtsp_url: RTSP stream URL
            output_dir: Directory to save video chunks
            chunk_duration: Duration of each chunk in seconds
        """
        settings = get_settings()
        self.rtsp_url = rtsp_url
        self.output_dir = Path(output_dir or settings.RECORDINGS_DIR)
        self.chunk_duration = chunk_duration or settings.VIDEO_CHUNK_DURATION
        self.is_recording = False
        self.current_ffmpeg_process: Optional[subprocess.Popen] = None
        self.current_writer: Optional[cv2.VideoWriter] = None
        self.cap: Optional[cv2.VideoCapture] = None
        self.recording_thread: Optional[threading.Thread] = None
        self.segment_monitor_thread: Optional[threading.Thread] = None
        self.callback: Optional[Callable[[str], None]] = None
        self.use_ffmpeg = True  # legacy flag, kept for compatibility
        self._ffmpeg_option_cache: Dict[str, bool] = {}
        self._stop_event = threading.Event()
        self._seen_segments: Set[str] = set()
        self._segment_last_sizes: Dict[str, int] = {}

        # Helpful validation/logging for common RTSP mistakes
        try:
            parsed = urlparse(rtsp_url)
            if parsed.scheme.lower() == "rtsp":
                # 1935/1945 are common RTMP ports; RTSP is usually 554/8554/etc.
                if parsed.port in (1935, 1945):
                    logger.warning(
                        f"RTSP URL is using port {parsed.port} (commonly RTMP). "
                        f"If this stream is RTMP, the URL should start with rtmp:// not rtsp://. url={rtsp_url}"
                    )
                if parsed.path in ("", "/"):
                    logger.warning(
                        f"RTSP URL has no stream path (ends with '/'). Many cameras require a path like "
                        f"rtsp://host:port/stream. url={rtsp_url}"
                    )
        except Exception:
            pass

        # Create output directory
        self.output_dir.mkdir(parents=True, exist_ok=True)
        logger.info(f"VideoRecorder initialized for {rtsp_url}")

    def _ffmpeg_supports_option(self, option: str) -> bool:
        """
        Check whether the installed ffmpeg binary supports a given CLI option.

        Some Windows ffmpeg builds don't support options like -stimeout, which causes ffmpeg to
        fail immediately and forces our OpenCV fallback.
        """
        if option in self._ffmpeg_option_cache:
            return self._ffmpeg_option_cache[option]
        try:
            # "ffmpeg -h full" is fast and lists supported options.
            result = subprocess.run(
                ["ffmpeg", "-hide_banner", "-h", "full"],
                capture_output=True,
                text=True,
                timeout=5,
            )
            haystack = (result.stdout or "") + "\n" + (result.stderr or "")
            supported = f"-{option}" in haystack
        except Exception:
            supported = False
        self._ffmpeg_option_cache[option] = supported
        return supported

    def _strip_unsupported_timeout_opts(self, cmd: list[str], stderr: str) -> list[str]:
        """
        If this ffmpeg build doesn't recognize -stimeout / -rw_timeout, remove them and cache as unsupported.
        """
        s = (stderr or "").lower()
        removed_any = False

        def remove_flag(flag: str, cache_key: str) -> None:
            nonlocal removed_any, cmd
            if flag in cmd:
                idx = cmd.index(flag)
                # remove flag + following value if present
                del cmd[idx:idx + 2]
                self._ffmpeg_option_cache[cache_key] = False
                removed_any = True

        if "option rw_timeout not found" in s or "unrecognized option 'rw_timeout'" in s:
            remove_flag("-rw_timeout", "rw_timeout")
        if "option stimeout not found" in s or "unrecognized option 'stimeout'" in s:
            remove_flag("-stimeout", "stimeout")

        return cmd
    
    def _add_faststart(self, input_path: str) -> str:
        """
        Add faststart flag to MP4 for web streaming (quick remux, no re-encoding).
        
        Args:
            input_path: Path to input video file
            
        Returns:
            Path to output file (same as input_path, overwritten)
        """
        try:
            input_file = Path(input_path)
            temp_output = input_file.parent / f"{input_file.stem}_faststart{input_file.suffix}"
            
            # Quick remux to add faststart flag (very fast, no re-encoding)
            cmd = [
                'ffmpeg',
                '-loglevel', 'error',  # Suppress warnings
                '-y',
                '-i', str(input_path),
                '-c', 'copy',  # Copy streams without re-encoding
                '-movflags', '+faststart',  # Add faststart for web streaming
                str(temp_output)
            ]
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=60  # Should be very fast (seconds)
            )
            
            if result.returncode == 0 and temp_output.exists():
                shutil.move(str(temp_output), str(input_path))
                logger.debug(f"Added faststart flag to: {input_path}")
            else:
                # If faststart fails, original file is still usable
                if temp_output.exists():
                    temp_output.unlink()
                logger.debug(f"Faststart remux skipped (file still usable): {input_path}")
            
            return input_path
            
        except Exception as e:
            logger.debug(f"Faststart remux failed (non-critical): {e}")
            return input_path  # Original file is still usable

    def _build_ffmpeg_segment_cmd(self) -> list[str]:
        """
        Build an ffmpeg command that continuously segments the RTSP stream into MP4 chunks,
        copying H.264 directly (no re-encode).
        """
        # Output template (strftime=1 lets ffmpeg format the timestamp in the filename)
        out_template = str(self.output_dir / "chunk_%Y%m%d_%H%M%S.mp4")

        cmd = [
            "ffmpeg",
            "-hide_banner",
            "-loglevel",
            "error",
            "-rtsp_transport",
            "tcp",
            # Make sure time-based segmentation works even if RTSP timestamps are weird
            "-fflags",
            "+genpts",
            "-use_wallclock_as_timestamps",
            "1",
            "-i",
            self.rtsp_url,
            # video only, direct copy
            "-map",
            "0:v:0",
            "-an",
            "-c:v",
            "copy",
            # segment into mp4 files
            "-f",
            "segment",
            "-segment_time",
            str(self.chunk_duration),
            "-reset_timestamps",
            "1",
            "-strftime",
            "1",
            out_template,
        ]
        return cmd

    def _run_ffmpeg_segmenter(self) -> None:
        """Run ffmpeg segmenter until stopped."""
        cmd = self._build_ffmpeg_segment_cmd()
        logger.info("Starting FFmpeg segment recorder (direct copy)")

        try:
            proc = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True,
            )
        except FileNotFoundError as e:
            raise VideoRecordingError(
                "FFmpeg not found. Install FFmpeg and ensure 'ffmpeg' is on PATH."
            ) from e

        self.current_ffmpeg_process = proc
        stderr_tail: deque[str] = deque(maxlen=30)

        def _drain_stderr() -> None:
            try:
                assert proc.stderr is not None
                for line in proc.stderr:
                    line = line.strip()
                    if not line:
                        continue
                    stderr_tail.append(line)
                    # Keep per-line logs at DEBUG to avoid spam; tail will be surfaced on failure.
                    logger.debug(f"ffmpeg: {line}")
            except Exception:
                pass

        stderr_thread = threading.Thread(target=_drain_stderr, daemon=True, name="FFmpegStderr")
        stderr_thread.start()

        try:
            # Block until stopped (stop_recording terminates the process)
            proc.wait()
        finally:
            self.current_ffmpeg_process = None

        # If we didn't request stop and ffmpeg exited for any reason, treat as failure.
        # Otherwise the API will keep reporting recording=True even though nothing is happening.
        if not self._stop_event.is_set():
            tail = list(stderr_tail)
            raise VideoRecordingError(
                "FFmpeg exited unexpectedly while recording. "
                f"exit_code={proc.returncode} stderr_tail={' | '.join(tail) if tail else '(none)'}"
            )

    def _segment_monitor_loop(self) -> None:
        """
        Monitor output directory for completed segments and call callback.
        We consider a segment complete when its size is stable across polls.
        """
        poll_interval = 1.0
        stable_polls_required = 2
        stable_counts: Dict[str, int] = {}

        while self.is_recording and not self._stop_event.is_set():
            try:
                files = sorted(self.output_dir.glob("chunk_*.mp4"), key=lambda p: p.stat().st_mtime)
                for p in files:
                    fp = str(p)
                    if fp in self._seen_segments:
                        continue

                    try:
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
                        # Finalize segment: add faststart (quick remux, no re-encode)
                        try:
                            self._add_faststart(fp)
                        except Exception:
                            pass

                        self._seen_segments.add(fp)
                        stable_counts.pop(fp, None)

                        if self.callback:
                            try:
                                self.callback(fp)
                            except Exception as e:
                                logger.error(f"Error in chunk callback: {e}")

                time.sleep(poll_interval)
            except Exception as e:
                logger.debug(f"Segment monitor error (non-fatal): {e}")
                time.sleep(poll_interval)
    
    def _record_chunk_ffmpeg(self, chunk_path: str) -> bool:
        """
        Record a single chunk using FFmpeg (preserves H.264 if available).
        
        Args:
            chunk_path: Path where chunk should be saved
            
        Returns:
            True if successful, False otherwise
        """
        try:
            # FFmpeg command to record RTSP stream directly to H.264 MP4
            # -rtsp_transport tcp: Use TCP for more reliable RTSP
            # -i: Input RTSP URL
            # -t: Duration limit (chunk duration)
            # -c:v copy: Copy video codec (preserves H.264, no re-encoding!)
            # -c:a copy: Copy audio if present
            # -f mp4: Force MP4 container
            # -movflags +faststart: Optimize for web streaming
            # -y: Overwrite output
            # Try to fail fast on dead RTSP endpoints but still allow slow networks.
            # Not all ffmpeg builds support the same timeout options, so we probe support.
            timeout_us = "15000000"  # 15s (microseconds)

            input_timeout_opts = []
            if self._ffmpeg_supports_option("rw_timeout"):
                input_timeout_opts += ["-rw_timeout", timeout_us]
            if self._ffmpeg_supports_option("stimeout"):
                input_timeout_opts += ["-stimeout", timeout_us]
            # Some older builds support -timeout (rtsp/udp/tcp) even when the above don't.
            if not input_timeout_opts and self._ffmpeg_supports_option("timeout"):
                input_timeout_opts += ["-timeout", timeout_us]

            cmd = [
                'ffmpeg',
                '-hide_banner',
                '-loglevel', 'error',
                '-rtsp_transport', 'tcp',  # More reliable than UDP
                *input_timeout_opts,
                # Generate/normalize timestamps so -t works reliably on some RTSP sources
                '-fflags', '+genpts',
                '-use_wallclock_as_timestamps', '1',
                '-i', self.rtsp_url,
                '-t', str(self.chunk_duration),  # Duration limit
                # Record video only (audio is often absent and can break copy)
                '-map', '0:v:0',
                '-an',
                '-c:v', 'copy',  # Copy video codec (preserves H.264 if present)
                '-f', 'mp4',
                # Avoid +faststart during live capture; do a quick remux after to prevent end-of-file stalls.
                '-y',
                str(chunk_path)
            ]
            
            process = subprocess.Popen(
                cmd,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                text=True
            )
            
            self.current_ffmpeg_process = process
            
            # Wait for process to complete or timeout
            try:
                # Give FFmpeg a bit of buffer beyond chunk duration.
                timeout_seconds = self.chunk_duration + 60
                stdout, stderr = process.communicate(timeout=timeout_seconds)
                
                if process.returncode == 0:
                    if Path(chunk_path).exists() and Path(chunk_path).stat().st_size > 0:
                        logger.info(f"FFmpeg chunk recorded: {chunk_path}")
                        # Add faststart in a separate quick remux (more reliable)
                        try:
                            self._add_faststart(chunk_path)
                        except Exception:
                            pass
                        return True
                    else:
                        logger.warning(f"FFmpeg recorded empty file: {chunk_path}")
                        return False
                else:
                    # If ffmpeg fails because timeout options aren't supported, retry once without them.
                    retry_cmd = self._strip_unsupported_timeout_opts(cmd.copy(), stderr or "")
                    if retry_cmd != cmd:
                        logger.warning(
                            "FFmpeg build doesn't support some timeout options; retrying without them. "
                            f"rtsp_url={self.rtsp_url} chunk={chunk_path}"
                        )
                        retry_proc = subprocess.Popen(
                            retry_cmd,
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                            text=True
                        )
                        self.current_ffmpeg_process = retry_proc
                        try:
                            _so2, se2 = retry_proc.communicate(timeout=timeout_seconds)
                        except subprocess.TimeoutExpired:
                            retry_proc.kill()
                            retry_proc.wait()
                            logger.warning(f"FFmpeg retry timed out for chunk: {chunk_path}")
                            return False

                        if retry_proc.returncode == 0 and Path(chunk_path).exists() and Path(chunk_path).stat().st_size > 0:
                            logger.info(f"FFmpeg chunk recorded (retry): {chunk_path}")
                            try:
                                self._add_faststart(chunk_path)
                            except Exception:
                                pass
                            return True

                        stderr_preview2 = (se2 or "").strip().splitlines()[-12:]
                        logger.warning(
                            "FFmpeg retry failed for chunk. "
                            f"rtsp_url={self.rtsp_url} chunk={chunk_path} "
                            f"exit_code={retry_proc.returncode} stderr_tail={' | '.join(stderr_preview2) if stderr_preview2 else '(none)'}"
                        )
                        return False

                    stderr_preview = (stderr or "").strip().splitlines()[-12:]
                    logger.warning(
                        "FFmpeg recording failed for chunk. "
                        f"rtsp_url={self.rtsp_url} chunk={chunk_path} "
                        f"exit_code={process.returncode} stderr_tail={' | '.join(stderr_preview) if stderr_preview else '(none)'}"
                    )
                    return False
                    
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
                logger.warning(
                    f"FFmpeg recording timed out for chunk: {chunk_path}. "
                    f"This typically indicates the RTSP stream is unreachable or not producing data."
                )
                return False
                
        except FileNotFoundError:
            logger.warning("FFmpeg not found, will use OpenCV fallback")
            return False
        except Exception as e:
            logger.debug(f"FFmpeg recording error: {e}")
            return False
        finally:
            self.current_ffmpeg_process = None
    
    def _get_chunk_filename(self) -> str:
        """Generate filename for video chunk."""
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        return str(self.output_dir / f"chunk_{timestamp}.mp4")
    
    def start_recording(self, callback: Optional[Callable[[str], None]] = None) -> None:
        """
        Start recording video chunks.
        
        Args:
            callback: Function to call when a chunk is complete.
                     Should accept (chunk_path: str) as argument.
        
        Raises:
            VideoRecordingError: If recording fails to start
        """
        if self.is_recording:
            logger.warning("Recording already in progress")
            return
        
        self.is_recording = True
        self._stop_event.clear()
        self.callback = callback

        # Reset segment tracking
        self._seen_segments.clear()
        self._segment_last_sizes.clear()

        # Start segment monitor (fires callback when each chunk file is finalized)
        self.segment_monitor_thread = threading.Thread(
            target=self._segment_monitor_loop,
            daemon=True,
            name="SegmentMonitor",
        )
        self.segment_monitor_thread.start()

        self.recording_thread = threading.Thread(
            target=self._record_loop,
            daemon=True,
            name="VideoRecorder"
        )
        self.recording_thread.start()
        logger.info("Video recording started")
    
    def stop_recording(self) -> None:
        """Stop recording."""
        if not self.is_recording:
            logger.warning("No recording in progress")
            return
        
        self.is_recording = False
        self._stop_event.set()
        
        # Kill FFmpeg process if running
        if self.current_ffmpeg_process:
            try:
                self.current_ffmpeg_process.terminate()
                self.current_ffmpeg_process.wait(timeout=5)
            except:
                try:
                    self.current_ffmpeg_process.kill()
                except:
                    pass
            self.current_ffmpeg_process = None
        
        if self.recording_thread:
            self.recording_thread.join(timeout=5)
        if self.segment_monitor_thread:
            self.segment_monitor_thread.join(timeout=5)
        logger.info("Video recording stopped")
    
    def _record_loop_ffmpeg(self) -> None:
        """FFmpeg-based recording loop using segment muxer (direct H.264 copy)."""
        self._run_ffmpeg_segmenter()
    
    def _record_loop_opencv(self) -> None:
        """OpenCV-based recording loop (fallback method)."""
        try:
            # Encourage FFmpeg backend and TCP transport for RTSP.
            # This env var is read by OpenCV's FFmpeg backend.
            os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")

            self.cap = cv2.VideoCapture(self.rtsp_url, cv2.CAP_FFMPEG)

            # If supported by the installed OpenCV build, increase timeouts (ms)
            try:
                self.cap.set(cv2.CAP_PROP_OPEN_TIMEOUT_MSEC, 60000)
                self.cap.set(cv2.CAP_PROP_READ_TIMEOUT_MSEC, 60000)
            except Exception:
                pass
            
            if not self.cap.isOpened():
                raise VideoRecordingError(f"Failed to open RTSP stream: {self.rtsp_url}")
            
            # Get video properties
            fps = int(self.cap.get(cv2.CAP_PROP_FPS)) or 30
            width = int(self.cap.get(cv2.CAP_PROP_FRAME_WIDTH))
            height = int(self.cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
            
            if width == 0 or height == 0:
                raise VideoRecordingError("Invalid video dimensions from stream")
            
            logger.info(f"Stream properties: {width}x{height} @ {fps}fps")
            
            # Define codec and create VideoWriter (MPEG-4 for MP4 format)
            fourcc = cv2.VideoWriter_fourcc(*'mp4v')
            
            chunk_path = self._get_chunk_filename()
            self.current_writer = cv2.VideoWriter(
                chunk_path,
                fourcc,
                fps,
                (width, height)
            )
            
            if not self.current_writer.isOpened():
                raise VideoRecordingError(f"Failed to create video writer for {chunk_path}")
            
            frame_count = 0
            frames_per_chunk = fps * self.chunk_duration
            reconnect_attempts = 0
            max_reconnect_attempts = 5
            
            while self.is_recording:
                ret, frame = self.cap.read()
                
                if not ret:
                    reconnect_attempts += 1
                    if reconnect_attempts > max_reconnect_attempts:
                        logger.error("Max reconnection attempts reached")
                        break
                    
                    logger.warning(f"Failed to read frame, reconnecting... (attempt {reconnect_attempts})")
                    time.sleep(1)
                    self.cap.release()
                    self.cap = cv2.VideoCapture(self.rtsp_url)
                    continue
                
                reconnect_attempts = 0
                self.current_writer.write(frame)
                frame_count += 1
                
                # Check if chunk is complete
                if frame_count >= frames_per_chunk:
                    # Finish current chunk
                    self.current_writer.release()
                    logger.info(f"Chunk complete: {chunk_path}")
                    
                    # Convert to browser-compatible MP4
                    try:
                        self._convert_to_browser_mp4(chunk_path)
                    except Exception as e:
                        logger.warning(f"Failed to convert video to browser format: {e}")
                    
                    # Callback with chunk path
                    if self.callback:
                        try:
                            self.callback(chunk_path)
                        except Exception as e:
                            logger.error(f"Error in chunk callback: {e}")
                    
                    # Start new chunk
                    chunk_path = self._get_chunk_filename()
                    self.current_writer = cv2.VideoWriter(
                        chunk_path,
                        fourcc,
                        fps,
                        (width, height)
                    )
                    frame_count = 0
            
            # Cleanup
            if self.current_writer:
                self.current_writer.release()
            if self.cap:
                self.cap.release()
                
        except Exception as e:
            logger.error(f"Error in OpenCV recording loop: {e}", exc_info=True)
            self.is_recording = False
            raise VideoRecordingError(f"Recording failed: {str(e)}") from e
    
    def _convert_to_browser_mp4(self, input_path: str) -> str:
        """
        Convert video to browser-compatible H.264 MP4 using ffmpeg (OpenCV fallback only).
        
        Args:
            input_path: Path to input video file
            
        Returns:
            Path to converted video file (same as input_path, overwritten)
        """
        try:
            # Create temporary file for output (same directory as input)
            input_file = Path(input_path)
            temp_output = input_file.parent / f"{input_file.stem}_temp{input_file.suffix}"
            
            # Use ffmpeg to convert to H.264 MP4 (browser-compatible)
            cmd = [
                'ffmpeg',
                '-loglevel', 'error',
                '-y',
                '-i', str(input_path),
                '-c:v', 'libx264',
                '-preset', 'ultrafast',  # Faster encoding
                '-crf', '25',  # Slightly lower quality for speed
                '-pix_fmt', 'yuv420p',
                '-movflags', '+faststart',
                '-an',  # Remove audio
                str(temp_output)
            ]
            
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=300
            )
            
            if result.returncode != 0:
                if temp_output.exists():
                    temp_output.unlink()
                logger.error(f"FFmpeg conversion failed: {result.stderr}")
                raise VideoRecordingError(f"FFmpeg conversion failed: {result.stderr}")
            
            # Replace original file with converted file
            if temp_output.exists():
                shutil.move(str(temp_output), str(input_path))
                logger.info(f"Video converted to browser-compatible H.264 MP4: {input_path}")
            else:
                raise VideoRecordingError("FFmpeg conversion produced no output file")
            
            return input_path
            
        except subprocess.TimeoutExpired:
            if 'temp_output' in locals() and temp_output.exists():
                temp_output.unlink()
            raise VideoRecordingError("Video conversion timed out")
        except FileNotFoundError:
            logger.warning("FFmpeg not found, skipping conversion. Video may not be browser-compatible.")
            return input_path
        except Exception as e:
            if 'temp_output' in locals() and temp_output.exists():
                temp_output.unlink()
            logger.error(f"Error converting video: {e}")
            return input_path
    
    def _record_loop(self) -> None:
        """Main recording loop - direct FFmpeg segment recording (no conversion)."""
        try:
            self._record_loop_ffmpeg()
        except Exception as e:
            logger.error(f"Error in recording loop: {e}", exc_info=True)
            self.is_recording = False
            raise VideoRecordingError(f"Recording failed: {str(e)}") from e
        finally:
            # If the recording loop exits, recording is no longer active.
            self.is_recording = False
