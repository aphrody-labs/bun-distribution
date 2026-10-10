# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Resolve where aphrody keeps its private secrets (tokens, cookies).

aphrody never embeds secrets; it reads them at runtime from a private,
git-ignored directory. The directory is resolved in this order:

1. ``$APHRODY_SECRETS_DIR`` — an explicit override.
2. ``<repo root>/var/secrets`` — when running inside the aphrody repository
   (the repo root is the nearest ancestor of the CWD that contains a ``.git``
   entry). This matches the repo convention of keeping git-ignored secrets
   under ``var/`` and is the cross-platform token home on Linux (cible #1),
   where there is no Windows Credential Manager.
3. ``~/.aphrody`` — fallback for a standalone install outside the repo.

Resolution is dynamic (per call) so a process that changes directory, or a
test that sets ``$APHRODY_SECRETS_DIR``, always sees the right location.
"""

from __future__ import annotations

import os
import shutil
import sys
from pathlib import Path

_REPO_MARKER = ".git"


def _repo_var_secrets() -> Path | None:
    """Return ``<repo root>/var/secrets`` if the CWD is inside the repo."""
    here = Path.cwd().resolve()
    for directory in (here, *here.parents):
        if (directory / _REPO_MARKER).exists():
            return directory / "var" / "secrets"
    return None


def state_dir() -> Path:
    """Return the unified aphrody state directory ($APHRODY_HOME or ~/.aphrody)."""
    override = os.environ.get("APHRODY_HOME")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".aphrody"


def cache_dir() -> Path:
    """Return the unified cache directory (<state_dir>/cache)."""
    override = os.environ.get("APHRODY_CACHE_DIR")
    if override:
        return Path(override).expanduser()
    return state_dir() / "cache"


def memory_dir() -> Path:
    """Return the unified memory directory (<state_dir>/memory)."""
    return state_dir() / "memory"


def memory_sqlite_path() -> Path:
    """Return canonical path to memory.sqlite (<state_dir>/memory/memory.sqlite)."""
    return memory_dir() / "memory.sqlite"


def vector_dir() -> Path:
    """Return the unified vector store directory (<state_dir>/vector)."""
    return state_dir() / "vector"


def lancedb_dir() -> Path:
    """Return canonical path for LanceDB vector storage (<state_dir>/vector/lancedb)."""
    return vector_dir() / "lancedb"


def sessions_dir() -> Path:
    """Return the unified sessions history directory (<state_dir>/sessions)."""
    return state_dir() / "sessions"


def secrets_dir() -> Path:
    """Return the directory aphrody uses for private secrets.

    See the module docstring for the resolution order.

    Returns:
        The resolved secrets directory (it may not yet exist).
    """
    override = os.environ.get("APHRODY_SECRETS_DIR")
    if override:
        return Path(override).expanduser()
    repo = _repo_var_secrets()
    if repo is not None:
        return repo
    return state_dir()


def secret_file(name: str) -> Path:
    """Return the path of secret file *name* inside :func:`secrets_dir`.

    Args:
        name: The file name (e.g. ``"google-cookies.json"``).

    Returns:
        The absolute path to the secret file.
    """
    return secrets_dir() / name


def executable_name(name: str, *, platform: str | None = None) -> str:
    """Apply the native executable suffix without embedding an install path."""
    if (platform or sys.platform) == "win32" and not name.lower().endswith(".exe"):
        return f"{name}.exe"
    return name


def resolve_executable(name: str, configured: str | None, variable: str) -> Path | None:
    """Discover through PATH or validate an explicitly selected executable."""
    if configured:
        expanded = str(Path(configured).expanduser())
        candidate = Path(shutil.which(expanded) or expanded)
        if not candidate.is_file():
            raise FileNotFoundError(
                f"{variable} executable does not exist: {candidate}"
            )
        if sys.platform != "win32" and not os.access(candidate, os.X_OK):
            raise PermissionError(
                f"{variable} executable is not executable: {candidate}"
            )
        return candidate.resolve()
    on_path = shutil.which(executable_name(name))
    return Path(on_path) if on_path else None


def resolve_runtime_binary(name: str, variable: str, fallback: str) -> Path:
    """Resolve an executable from an override, PATH, or the shared state directory.

    An invalid explicit override fails immediately instead of silently choosing
    another runtime. Missing automatic candidates remain a descriptive fallback
    path so the caller can report the required runtime without downloading it.
    """
    on_path = resolve_executable(name, os.environ.get(variable), variable)
    if on_path:
        return on_path
    fallback_path = Path(fallback)
    fallback_path = fallback_path.with_name(executable_name(fallback_path.name))
    for candidate in (
        state_dir() / "bin" / executable_name(name),
        state_dir() / fallback_path,
    ):
        if candidate.is_file() and (
            sys.platform == "win32" or os.access(candidate, os.X_OK)
        ):
            return candidate
    return state_dir() / fallback_path
