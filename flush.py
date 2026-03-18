"""
Inspectre Full Reset
====================
Wipes ALL user data, footage, thumbnails, databases, logs, alerts,
and cached metadata. Returns the system to a completely fresh state.

Usage:  python flush.py
        python flush.py --yes   (skip confirmation prompt)
"""
import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent

TARGETS = {
    # SQLite database (users, device_config)
    "users.db": ROOT / "users.db",

    # ChromaDB vector store
    "chroma_db/": ROOT / "chroma_db",

    # Processed recordings
    "recordings/": ROOT / "recordings",

    # Raw footage + thumbnails cache inside it
    "footage/": ROOT / "footage",

    # Alert rules & history
    "alerts.json": ROOT / "alerts.json",
    "alert_history.json": ROOT / "alert_history.json",

    # Application logs
    "logs/": ROOT / "logs",

    # Frontend local build cache (optional, doesn't contain user data)
    # "frontend/build/": ROOT / "frontend" / "build",
}


def sizeof_fmt(num: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if abs(num) < 1024:
            return f"{num:.1f} {unit}"
        num /= 1024
    return f"{num:.1f} TB"


def get_size(path: Path) -> int:
    if path.is_file():
        return path.stat().st_size
    if path.is_dir():
        return sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
    return 0


def main():
    skip_confirm = "--yes" in sys.argv or "-y" in sys.argv

    print()
    print("=" * 52)
    print("   INSPECTRE  —  Full Data Flush")
    print("=" * 52)
    print()

    found = []
    total_size = 0

    for label, path in TARGETS.items():
        if path.exists():
            size = get_size(path)
            total_size += size
            found.append((label, path, size))
            kind = "dir " if path.is_dir() else "file"
            print(f"  [{kind}]  {label:<28} {sizeof_fmt(size):>10}")
        else:
            print(f"  [ -- ]  {label:<28}    (absent)")

    print()
    if not found:
        print("  Nothing to flush. Already clean.")
        return

    print(f"  Total:  {sizeof_fmt(total_size)}")
    print()

    if not skip_confirm:
        answer = input("  Type 'FLUSH' to confirm complete wipe: ").strip()
        if answer != "FLUSH":
            print("  Aborted.")
            return

    print()
    for label, path, _ in found:
        try:
            if path.is_dir():
                shutil.rmtree(path)
            else:
                path.unlink()
            print(f"  Deleted  {label}")
        except Exception as e:
            print(f"  FAILED   {label}  —  {e}")

    print()
    print("  Done. Inspectre is back to a fresh state.")
    print("  Restart the backend to reinitialize empty stores.")
    print()


if __name__ == "__main__":
    main()
