#!/usr/bin/env python3
"""Re-encode footage_*.mp4 files for HTML5 browser playback (one-time fix for existing files)."""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

# Allow running from repo root: python scripts/remux_raw_footage_for_browser.py
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.core.config import get_settings
from app.utils.mp4_browser import reencode_for_browser


def main() -> int:
    parser = argparse.ArgumentParser(description="Re-encode raw footage MP4s for browser playback.")
    parser.add_argument(
        "--dir",
        type=Path,
        default=None,
        help="Footage directory (default: RAW_FOOTAGE_DIR from settings)",
    )
    parser.add_argument(
        "--file",
        type=Path,
        default=None,
        help="Single MP4 to re-encode (overrides --dir glob)",
    )
    args = parser.parse_args()

    if args.file:
        targets = [args.file.resolve()]
    else:
        footage_dir = args.dir or Path(get_settings().RAW_FOOTAGE_DIR)
        targets = sorted(footage_dir.glob("footage_*.mp4"))

    if not targets:
        print("No footage_*.mp4 files found.")
        return 1

    ok = 0
    for path in targets:
        print(f"Re-encoding {path.name} ...", flush=True)
        if reencode_for_browser(str(path)):
            ok += 1
            print(f"  OK: {path.name}")
        else:
            print(f"  FAILED: {path.name}", file=sys.stderr)

    print(f"Done: {ok}/{len(targets)} succeeded.")
    return 0 if ok == len(targets) else 2


if __name__ == "__main__":
    raise SystemExit(main())
