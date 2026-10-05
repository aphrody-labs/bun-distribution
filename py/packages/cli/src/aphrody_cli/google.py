"""uv/Python launcher for the single Rust ``aphrody-google`` authority."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from pathlib import Path

from aphrody import _paths


def _resolve_binary() -> str | None:
    """Resolve the native Google authority without requiring a reloaded PATH."""
    configured = os.environ.get("APHRODY_GOOGLE_BIN")
    if configured:
        candidate = Path(configured).expanduser()
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
        return None

    on_path = shutil.which("aphrody-google") or shutil.which("google")
    if on_path:
        return on_path

    home = _paths.state_dir() / "bin"
    for name in (
        "aphrody-google",
        "google",
    ):
        candidate = home / name
        if candidate.is_file() and os.access(candidate, os.X_OK):
            return str(candidate)
    return None


def main() -> int:
    """Forward the command line to the native aphrody Google binary."""
    binary = _resolve_binary()
    if not binary:
        print(
            "aphrody-google binary not found; install the Rust binary first",
            file=sys.stderr,
        )
        return 127
    return subprocess.call([binary, *sys.argv[1:]])
