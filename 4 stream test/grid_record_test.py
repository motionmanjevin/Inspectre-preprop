#!/usr/bin/env python3
"""
Test harness: merge up to 4 RTSP streams into one 2×2 H.264 MP4 with per-cell labels.

Uses xstack (same as app/services/multi_camera_grid_recorder.py): each cell keeps showing its last frame
after that input ends; when all finite inputs finish, the graph ends (no infinite segment spam).
If all four slots use the same RTSP URL, one demuxer + split=4 avoids starving the server.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import platform
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

LOG = logging.getLogger("grid_record_test")

NUM_SLOTS = 4
DEFAULT_OUT_W, DEFAULT_OUT_H = 1280, 720
DEFAULT_CELL_W, DEFAULT_CELL_H = 640, 360
DEFAULT_FPS = 25


def default_fontfile() -> str:
    """Return FFmpeg drawtext fontfile= path with ':' escaped for Windows drive letters."""
    if platform.system() == "Windows":
        # C:/Windows/... → C\:/Windows/... per FFmpeg drawtext
        p = Path(os.environ.get("WINDIR", r"C:\Windows")) / "Fonts" / "arial.ttf"
        if p.is_file():
            s = p.resolve().as_posix()
            if len(s) >= 2 and s[1] == ":":
                return f"{s[0]}\\:{s[2:]}"
            return s.replace(":", "\\:")
    for candidate in (
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "/usr/share/fonts/TTF/DejaVuSans.ttf",
        "/System/Library/Fonts/Supplemental/Arial.ttf",
    ):
        if Path(candidate).is_file():
            return candidate
    return ""


def escape_drawtext_text(s: str) -> str:
    """Escape text for use inside drawtext=text='...' (single-quoted)."""
    return s.replace("\\", "\\\\").replace("'", "'\\\\''")


def all_four_same_rtsp_url(urls: list[str | None]) -> bool:
    cleaned = [(u or "").strip() for u in urls]
    if not all(cleaned):
        return False
    return len({u for u in cleaned}) == 1


def build_filter_complex(
    names: list[str],
    fontfile: str,
    cell_w: int,
    cell_h: int,
    fps: int,
    *,
    single_rtsp_input: bool,
) -> str:
    """Inputs are four cell-sized streams [0:v]..[3:v], or one [0:v] split four ways."""
    parts: list[str] = []
    font_opt = f"fontfile='{fontfile}':" if fontfile else ""

    def cell_chain(in_tag: str, idx: int) -> None:
        name = escape_drawtext_text(names[idx] or f"Cam {idx + 1}")
        parts.append(
            f"{in_tag}scale={cell_w}:{cell_h}:force_original_aspect_ratio=decrease,"
            f"pad={cell_w}:{cell_h}:(ow-iw)/2:(oh-ih)/2:black,"
            f"drawtext={font_opt}text='{name}':x=8:y=h-th-8:fontsize=18:fontcolor=white:"
            f"box=1:boxcolor=black@0.55:boxborderw=4[cf{idx}]"
        )

    if single_rtsp_input:
        parts.append("[0:v]split=outputs=4[sp0][sp1][sp2][sp3]")
        for i in range(NUM_SLOTS):
            cell_chain(f"[sp{i}]", i)
    else:
        for i in range(NUM_SLOTS):
            cell_chain(f"[{i}:v]", i)

    parts.append(
        "[cf0][cf1][cf2][cf3]xstack=inputs=4:layout=0_0|w0_0|0_h0|w0_h0[grid];"
        f"[grid]fps=fps={fps}[outv]"
    )
    return ";".join(parts)


def load_config(path: Path) -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def run_ffmpeg(
    urls: list[str | None],
    names: list[str],
    output: Path,
    duration: float | None,
    fps: int,
    out_w: int,
    out_h: int,
    cell_w: int,
    cell_h: int,
    fontfile: str,
    video_codec: str,
    preset: str,
    crf: int,
    rtsp_transport: str,
    extra_args: list[str],
    demo: bool = False,
) -> int:
    if len(urls) != NUM_SLOTS or len(names) != NUM_SLOTS:
        raise ValueError("Internal: need exactly 4 url/name slots")

    single_rtsp = (not demo) and all_four_same_rtsp_url(urls)
    fc = build_filter_complex(
        names, fontfile, cell_w, cell_h, fps, single_rtsp_input=single_rtsp
    )

    cmd: list[str] = ["ffmpeg", "-hide_banner", "-y"]

    if single_rtsp:
        u0 = (urls[0] or "").strip()
        if rtsp_transport:
            cmd += ["-rtsp_transport", rtsp_transport]
        cmd += [
            "-thread_queue_size",
            "512",
            "-fflags",
            "+genpts",
            "-use_wallclock_as_timestamps",
            "1",
            "-i",
            u0,
        ]
    else:
        for i, url in enumerate(urls):
            if demo:
                cmd += [
                    "-f",
                    "lavfi",
                    "-stream_loop",
                    "-1",
                    "-i",
                    f"testsrc2=size={cell_w}x{cell_h}:rate={fps}",
                ]
            elif url and url.strip():
                if rtsp_transport:
                    cmd += ["-rtsp_transport", rtsp_transport]
                cmd += [
                    "-thread_queue_size",
                    "512",
                    "-fflags",
                    "+genpts",
                    "-use_wallclock_as_timestamps",
                    "1",
                    "-i",
                    url.strip(),
                ]
            else:
                cmd += [
                    "-f",
                    "lavfi",
                    "-stream_loop",
                    "-1",
                    "-i",
                    f"color=c=black:s={cell_w}x{cell_h}:r={fps}",
                ]

    script_path: str | None = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False, encoding="utf-8") as tf:
            tf.write(fc)
            script_path = tf.name
    except OSError as e:
        LOG.error("Could not write filter script: %s", e)
        return 1

    try:
        cmd += ["-filter_complex_script", script_path, "-map", "[outv]", "-an"]
        if duration is not None and duration > 0:
            cmd += ["-t", str(duration)]
        if video_codec == "libx264":
            cmd += ["-c:v", "libx264", "-preset", preset, "-crf", str(crf), "-pix_fmt", "yuv420p"]
        else:
            cmd += ["-c:v", video_codec, "-pix_fmt", "yuv420p"]
        cmd += extra_args
        cmd += [str(output)]

        LOG.info("Running: %s", " ".join(cmd[:15]) + " ... " + str(output))
        proc = subprocess.run(cmd)
        return proc.returncode
    finally:
        try:
            Path(script_path).unlink(missing_ok=True)
        except OSError:
            pass


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Record 2×2 RTSP grid to one MP4 (test harness).")
    p.add_argument("--output", "-o", type=Path, default=Path("grid_out.mp4"), help="Output MP4 path")
    p.add_argument(
        "--duration",
        "-t",
        type=float,
        default=None,
        help="Stop after N seconds (omit = run until process killed; Ctrl+C)",
    )
    p.add_argument("--url", nargs="*", default=[], help="1–4 RTSP URLs (pads with black if fewer)")
    p.add_argument("--name", nargs="*", default=[], help="Labels for each URL (default Cam 1..4)")
    p.add_argument("--config", type=Path, default=None, help="JSON config (see cameras.example.json)")
    p.add_argument("--fps", type=int, default=DEFAULT_FPS)
    p.add_argument("--out-w", type=int, default=DEFAULT_OUT_W)
    p.add_argument("--out-h", type=int, default=DEFAULT_OUT_H)
    p.add_argument("--cell-w", type=int, default=DEFAULT_CELL_W)
    p.add_argument("--cell-h", type=int, default=DEFAULT_CELL_H)
    p.add_argument("--font", type=str, default="", help="Path to .ttf for drawtext (auto-detect if empty)")
    p.add_argument("--rtsp-transport", default="tcp", help="tcp|udp (tcp recommended)")
    p.add_argument("--preset", default="veryfast")
    p.add_argument("--crf", type=int, default=23)
    p.add_argument("--codec", default="libx264")
    p.add_argument("-v", "--verbose", action="store_true")
    p.add_argument(
        "--demo",
        action="store_true",
        help="Use 4 synthetic test patterns (no RTSP). Good for verifying the grid pipeline.",
    )
    p.add_argument("ffmpeg_extra", nargs=argparse.REMAINDER, help="After -- , pass extra ffmpeg args")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(levelname)s %(message)s")

    if args.ffmpeg_extra and args.ffmpeg_extra[0] == "--":
        extra = args.ffmpeg_extra[1:]
    else:
        extra = args.ffmpeg_extra or []

    urls: list[str | None] = [None] * NUM_SLOTS
    names = [f"Cam {i + 1}" for i in range(NUM_SLOTS)]

    if args.config:
        cfg = load_config(args.config)
        streams = cfg.get("streams") or []
        for i in range(min(NUM_SLOTS, len(streams))):
            item = streams[i] or {}
            u = (item.get("url") or "").strip()
            urls[i] = u if u else None
            if item.get("name"):
                names[i] = str(item["name"])
        args.fps = int(cfg.get("fps", args.fps))
        args.out_w = int(cfg.get("output_width", args.out_w))
        args.out_h = int(cfg.get("output_height", args.out_h))
        args.cell_w = int(cfg.get("cell_width", args.cell_w))
        args.cell_h = int(cfg.get("cell_height", args.cell_h))

    if args.url:
        for i, u in enumerate(args.url[:NUM_SLOTS]):
            urls[i] = u.strip() if u.strip() else None
    if args.name:
        for i, n in enumerate(args.name[:NUM_SLOTS]):
            names[i] = n

    demo = bool(args.demo)
    if demo:
        if args.duration is None:
            args.duration = 15.0
            LOG.info("--demo: defaulting --duration to 15s (set explicitly to change)")
        names = [f"Demo {i + 1}" for i in range(NUM_SLOTS)]

    if not shutil.which("ffmpeg"):
        LOG.error("ffmpeg not found in PATH")
        return 1

    font = args.font.strip() or default_fontfile()
    if not font:
        LOG.warning("No font file found; drawtext may fail. Set --font to a .ttf path.")

    code = run_ffmpeg(
        urls=urls,
        names=names,
        output=args.output.resolve(),
        duration=args.duration,
        fps=args.fps,
        out_w=args.out_w,
        out_h=args.out_h,
        cell_w=args.cell_w,
        cell_h=args.cell_h,
        fontfile=font,
        video_codec=args.codec,
        preset=args.preset,
        crf=args.crf,
        rtsp_transport=args.rtsp_transport,
        extra_args=extra,
        demo=demo,
    )
    if code == 0:
        LOG.info("Wrote %s", args.output)
    else:
        LOG.error("ffmpeg exited with code %s", code)
    return code


if __name__ == "__main__":
    sys.exit(main())
