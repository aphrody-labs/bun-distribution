#!/usr/bin/env python3
"""Inventory RG immutable releases; delete old ones only with --apply.

Keep the active release and the two newest other valid releases for rollback.
Only the canonical VPS release root is mutable. Never follow symlinks.
"""

import argparse
import json
import os
import re
import shutil
from pathlib import Path

CANONICAL_ROOT = Path("/home/ubuntu/apps/rg/releases")
SHA = re.compile(r"[0-9a-f]{40}\Z")


def fail(message: str) -> None:
    raise SystemExit(f"refusing release pruning: {message}")


def release_marker(path: Path) -> bool:
    """Reject malformed or symlinked release roots and marker files."""
    if not SHA.fullmatch(path.name) or path.is_symlink() or not path.is_dir():
        return False
    for name in ("RELEASE_SHA", "release.json", "SHA256SUMS"):
        marker = path / name
        if marker.is_symlink() or not marker.is_file():
            return False
    try:
        manifest = json.loads((path / "release.json").read_text())
        return (
            (path / "RELEASE_SHA").read_text().strip() == path.name
            and manifest.get("schemaVersion") == 1
            and manifest.get("repository") == "rg"
            and manifest.get("commit") == path.name
        )
    except (OSError, ValueError, TypeError):
        return False


def bytes_on_disk(path: Path) -> int:
    """Report allocated size without crossing a symlink or another filesystem."""
    root_device = path.stat(follow_symlinks=False).st_dev
    total = 0
    for directory, dirs, files in os.walk(path, followlinks=False):
        for name in dirs + files:
            entry = Path(directory) / name
            info = entry.lstat()
            if info.st_dev == root_device:
                total += info.st_blocks * 512
        dirs[:] = [name for name in dirs if not (Path(directory) / name).is_symlink()]
    return total


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--apply", action="store_true", help="delete eligible old releases"
    )
    parser.add_argument(
        "--max-delete",
        type=int,
        help="preview or delete 1..3 oldest eligible releases; required with --apply",
    )
    parser.add_argument(
        "--root", type=Path, default=CANONICAL_ROOT, help="dry-run fixture root only"
    )
    args = parser.parse_args()
    if args.apply and (args.max_delete is None or not 1 <= args.max_delete <= 3):
        fail("--apply requires --max-delete between 1 and 3")
    if args.max_delete is not None and not 1 <= args.max_delete <= 3:
        fail("--max-delete must be between 1 and 3")
    root = args.root
    if args.apply and root != CANONICAL_ROOT:
        fail("--apply requires /home/ubuntu/apps/rg/releases")
    if root.is_symlink() or not root.is_dir():
        fail("release root missing or symlinked")
    if args.apply and (root.resolve() != CANONICAL_ROOT or os.geteuid() != 0):
        fail("canonical root and root privileges required")

    current_link = root.parent / "current"
    if not current_link.is_symlink():
        fail("current release pointer missing")
    current = current_link.resolve(strict=True)
    if current.parent != root.resolve() or not release_marker(current):
        fail("current pointer is not a valid direct child release")

    entries = list(root.iterdir())
    malformed = [
        p.name for p in entries if SHA.fullmatch(p.name) and not release_marker(p)
    ]
    if malformed:
        fail("malformed SHA-named entries: " + ", ".join(sorted(malformed)))
    releases = [p for p in entries if release_marker(p)]
    # Preserve active, then the two most recently built valid alternatives.
    rollback = sorted(
        (p for p in releases if p != current),
        key=lambda p: p.stat().st_mtime_ns,
        reverse=True,
    )[:2]
    keep = {current, *rollback}
    candidates = sorted(
        (p for p in releases if p not in keep), key=lambda p: p.stat().st_mtime_ns
    )
    selected = (
        set(candidates[: args.max_delete]) if args.max_delete is not None else set()
    )
    for path in sorted(releases, key=lambda p: p.stat().st_mtime_ns, reverse=True):
        if path in keep:
            action = "KEEP"
        elif path in selected:
            action = "DELETE" if args.apply else "WOULD_DELETE"
        else:
            action = "DEFER" if args.max_delete is not None else "ELIGIBLE"
        size_gib = bytes_on_disk(path) / 1024**3
        print(f"{action}\t{path.name}\t{size_gib:.2f} GiB")
        if args.apply and path in selected:
            # Recheck immediately before mutation; never follow changed pointers.
            if current_link.resolve(strict=True) != current or not release_marker(path):
                fail("pointer or release changed during prune")
            if path.parent != CANONICAL_ROOT or path.is_symlink():
                fail("candidate escaped canonical release root")
            shutil.rmtree(path)
    print(
        f"valid={len(releases)} keep={len(keep)} candidates={len(candidates)} selected={len(selected)} mode={'apply' if args.apply else 'dry-run'}"
    )


if __name__ == "__main__":
    main()
