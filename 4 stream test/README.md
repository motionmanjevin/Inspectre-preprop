# 4-stream 2×2 grid recording (test harness)

Records **up to 4 RTSP feeds** into a single **1280×720** H.264 MP4 with a **2×2 grid**. Each cell shows a **camera name** at the **bottom-left**.

## Why the old script “crashed” when one video ended

Chaining `overlay=shortest=1` makes FFmpeg stop the composite when the **shortest** input ends. One dead stream can tear down the whole filter graph.

This test uses:

1. An **infinite black base** (`lavfi` `color` + `stream_loop`) so the composite has no “main” timeline that ends early.
2. **`shortest=0`** on every overlay so one stream ending does not shorten the base.
3. **`eof_action=repeat`** on overlays so when an RTSP feed drops, FFmpeg **holds the last frame** for that cell instead of failing the whole output.

## Requirements

- FFmpeg with `drawtext` (needs a font file — see script defaults).
- Network reachability to your cameras.

## Quick start

**Sanity check (no cameras):** writes a 15s synthetic 2×2 grid to `grid_demo.mp4`:

```bash
cd "4 stream test"
python grid_record_test.py --demo -o grid_demo.mp4
```

**Real RTSP (1–4 URLs):**

```bash
python grid_record_test.py --output out.mp4 --duration 120 \
  --url "rtsp://user:pass@cam1/stream" "rtsp://user:pass@cam2/stream" \
  --name "Front" "Back"
```

- **1–4** `--url` values; empty grid slots are filled with **black** (no RTSP needed).
- Omit `--duration` to record until **Ctrl+C** (not all builds handle SIGINT cleanly on Windows — prefer a finite `--duration` on Windows).


## JSON config (optional)

```bash
python grid_record_test.py --config cameras.example.json --output grid.mp4 --duration 60
```

## Relation to main Inspectre app

This folder is **standalone**. The production path would mirror `VideoRecorder` + raw segments: same FFmpeg patterns (TCP RTSP, timeouts), but driven from device config and chunked like `footage_*.mp4`.
