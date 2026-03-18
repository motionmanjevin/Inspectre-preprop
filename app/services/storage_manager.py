"""Size-based storage retention manager for local footage and R2."""
import logging
from pathlib import Path
from typing import List, Tuple

logger = logging.getLogger(__name__)


def get_dir_usage(directory: str | Path, glob_pattern: str = "*.mp4") -> List[Tuple[Path, float, float]]:
    """Return list of (path, size_bytes, mtime) sorted oldest-first."""
    d = Path(directory)
    if not d.exists():
        return []
    items = []
    for f in d.glob(glob_pattern):
        try:
            st = f.stat()
            items.append((f, st.st_size, st.st_mtime))
        except OSError:
            continue
    items.sort(key=lambda x: x[2])  # oldest first
    return items


def cleanup_local_footage(directory: str | Path, max_gb: float) -> int:
    """
    Delete oldest MP4 files in *directory* until total usage is below max_gb * 0.95.
    Also cleans up .thumbs/ entries for deleted files.
    Returns number of files deleted.
    """
    items = get_dir_usage(directory)
    total = sum(s for _, s, _ in items)
    target = max_gb * 1e9 * 0.95
    deleted = 0
    thumbs_dir = Path(directory) / ".thumbs"

    for path, size, _ in items:
        if total <= target:
            break
        try:
            path.unlink(missing_ok=True)
            total -= size
            deleted += 1
            thumb = thumbs_dir / f"{path.stem}.jpg"
            thumb.unlink(missing_ok=True)
        except Exception as e:
            logger.warning("Failed to delete %s: %s", path, e)

    if deleted:
        logger.info("Local retention cleanup: deleted %d files in %s (limit %.1f GB)", deleted, directory, max_gb)
    return deleted


def cleanup_r2_footage(r2_uploader, prefix: str = "raw_footage/", max_gb: float = 10.0) -> int:
    """
    List objects under *prefix* in R2, delete oldest until total is below max_gb * 0.95.
    Returns number of objects deleted.
    """
    try:
        paginator = r2_uploader.s3_client.get_paginator("list_objects_v2")
        objects = []
        for page in paginator.paginate(Bucket=r2_uploader.bucket_name, Prefix=prefix):
            for obj in page.get("Contents", []):
                objects.append((obj["Key"], obj["Size"], obj["LastModified"]))
    except Exception as e:
        logger.warning("R2 listing failed for retention cleanup: %s", e)
        return 0

    objects.sort(key=lambda x: x[2])  # oldest first
    total = sum(s for _, s, _ in objects)
    target = max_gb * 1e9 * 0.95
    deleted = 0

    for key, size, _ in objects:
        if total <= target:
            break
        try:
            r2_uploader.s3_client.delete_object(Bucket=r2_uploader.bucket_name, Key=key)
            total -= size
            deleted += 1
        except Exception as e:
            logger.warning("Failed to delete R2 object %s: %s", key, e)

    if deleted:
        logger.info("R2 retention cleanup: deleted %d objects (limit %.1f GB)", deleted, max_gb)
    return deleted
