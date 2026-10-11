#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Infra runbook: remove inactive, old test executables; preserve libraries and caches."""
import argparse
import json
import os
import pathlib
import re
import stat
import time

parser = argparse.ArgumentParser()
parser.add_argument("--apply", action="store_true")
args = parser.parse_args()
root = pathlib.Path("/home/ubuntu/build/cache/cargo/aphrody-wsl/debug/deps")
if root.is_symlink() or not root.is_dir():
    raise SystemExit("expected real factory test directory")
active = set()
for process in pathlib.Path("/proc").iterdir():
    if process.name.isdigit():
        try:
            active.add((process / "exe").resolve(strict=True))
        except (FileNotFoundError, PermissionError, ProcessLookupError):
            pass
pattern = re.compile(r"(?:aphrody(?:_[a-z0-9_]+)?|python_host|client_smoke)-[a-f0-9]{16}")
selected = []
for path in root.iterdir():
    info = path.lstat()
    if (pattern.fullmatch(path.name) and stat.S_ISREG(info.st_mode)
            and info.st_nlink == 1 and info.st_size > 100 * 1024**2
            and info.st_mtime < time.time() - 2 * 3600 and path not in active):
        selected.append((path, info))
before = os.statvfs(root)
removed = 0
for path, info in selected:
    if args.apply:
        current = path.lstat()
        if (current.st_ino, current.st_size, current.st_mtime_ns) != (info.st_ino, info.st_size, info.st_mtime_ns):
            raise SystemExit("test executable changed during cleanup")
        path.unlink()
        removed += 1
after = os.statvfs(root)
print(json.dumps({"apply": args.apply, "candidates": len(selected), "removed": removed,
                  "candidate_bytes": sum(info.st_blocks * 512 for _, info in selected),
                  "freed_bytes": (after.f_bavail - before.f_bavail) * after.f_frsize,
                  "files": [path.name for path, _ in selected]}, indent=2))
