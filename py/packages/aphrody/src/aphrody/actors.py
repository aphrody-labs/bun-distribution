# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Programmatic Python access to Aphrody Web Browser Actors.

The web runtime owns Actor discovery and execution. This module uses its bounded JSON CLI
contract, so Python, Rust, Bun and MCP execute the same installed Actors.
"""

from __future__ import annotations

import contextlib
import json
import math
import os
import shutil
import subprocess
import tempfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any


class ActorError(RuntimeError):
    """Aphrody Web Browser Actor discovery or execution failed."""


@dataclass(frozen=True)
class ActorManifest:
    """Actor exposed by Aphrody Web Browser or an installed Web package."""

    name: str
    path: Path
    title: str | None = None
    description: str | None = None


@dataclass(frozen=True)
class ActorRunResult:
    """Structured output from an Actor run."""

    actor: str
    storage_dir: Path
    output: Any = None


class ActorClient:
    """Configured client for installed Aphrody Web Browser Actors.

    The client owns no persistent process. Each call uses a bounded CLI run;
    successful output directories remain owned by the caller.
    """

    def __init__(
        self,
        *,
        web_browser_bin: str | os.PathLike[str] | None = None,
        timeout: float = 300,
        discovery_timeout: float = 30,
    ) -> None:
        _validate_timeout(timeout)
        _validate_timeout(discovery_timeout)
        self.web_browser_bin = web_browser_bin
        self.timeout = timeout
        self.discovery_timeout = discovery_timeout

    def list(self) -> list[ActorManifest]:
        """Discover Actors using this client's executable and timeout."""
        return list_actors(
            web_browser_bin=self.web_browser_bin, timeout=self.discovery_timeout
        )

    def run(
        self,
        actor: str,
        *,
        input: Any = None,
        storage_dir: str | os.PathLike[str] | None = None,
        purge: bool = True,
    ) -> ActorRunResult:
        """Run an Actor; preserve successful output for caller inspection."""
        return run_actor(
            actor,
            input=input,
            storage_dir=storage_dir,
            purge=purge,
            timeout=self.timeout,
            web_browser_bin=self.web_browser_bin,
        )


def _validate_timeout(timeout: float) -> None:
    if not math.isfinite(timeout) or timeout <= 0:
        raise ValueError("timeout must be finite and positive")


def _binary(explicit: str | os.PathLike[str] | None) -> str:
    path = (
        explicit
        or os.environ.get("APHRODY_WEB_BROWSER_BIN")
        or os.environ.get("BXC_BIN")
        or shutil.which("aphrody-web-browser")
        or shutil.which("bxc")
    )
    if path is None:
        raise ActorError(
            "Aphrody Web Browser binary not found; install it or set APHRODY_WEB_BROWSER_BIN"
        )
    return os.fspath(path)


def _invoke(
    args: list[str], *, timeout: float, bxc_bin: str | os.PathLike[str] | None
) -> Any:
    _validate_timeout(timeout)
    try:
        result = subprocess.run(
            [_binary(bxc_bin), "actor", *args, "--json"],
            capture_output=True,
            text=True,
            encoding="utf-8",
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired as exc:
        raise ActorError(
            f"Aphrody Web Browser Actor timed out after {timeout:g}s"
        ) from exc
    except OSError as exc:
        raise ActorError(
            f"Could not launch Aphrody Web Browser Actor: {exc.strerror}"
        ) from exc
    if result.returncode != 0:
        # The input JSON and child output may contain credentials.
        raise ActorError(
            f"Aphrody Web Browser Actor exited with code {result.returncode}"
        )
    try:
        return json.loads(result.stdout)
    except (TypeError, json.JSONDecodeError) as exc:
        raise ActorError("Aphrody Web Browser Actor returned invalid JSON") from exc


def list_actors(
    *,
    timeout: float = 30,
    web_browser_bin: str | os.PathLike[str] | None = None,
    bxc_bin: str | os.PathLike[str] | None = None,
) -> list[ActorManifest]:
    """Discover built-in and installed Web package Actors."""
    data = _invoke(["list"], timeout=timeout, bxc_bin=web_browser_bin or bxc_bin)
    if not isinstance(data, list):
        raise ActorError("Aphrody Web Browser Actor list returned invalid JSON")
    try:
        return [
            ActorManifest(
                name=item["name"],
                path=Path(item["path"]),
                title=item.get("title"),
                description=item.get("description"),
            )
            for item in data
        ]
    except (KeyError, TypeError, ValueError) as exc:
        raise ActorError(
            "Aphrody Web Browser Actor list returned an invalid manifest"
        ) from exc


def run_actor(
    actor: str,
    *,
    input: Any = None,
    storage_dir: str | os.PathLike[str] | None = None,
    purge: bool = True,
    timeout: float = 300,
    web_browser_bin: str | os.PathLike[str] | None = None,
    bxc_bin: str | os.PathLike[str] | None = None,
) -> ActorRunResult:
    """Execute an Actor by name or path and return its JSON output.

    A private output directory is created when ``storage_dir`` is omitted.
    The returned directory remains available for inspection; callers clean it up.
    """
    if not actor:
        raise ValueError("actor must not be empty")
    _validate_timeout(timeout)
    owns_storage = storage_dir is None
    path = (
        Path(storage_dir)
        if storage_dir is not None
        else Path(tempfile.mkdtemp(prefix="aphrody-actor-"))
    )
    args = ["run", actor, "--storage-dir", os.fspath(path)]
    input_path: Path | None = None
    try:
        if input is not None:
            fd, raw_path = tempfile.mkstemp(
                prefix="aphrody-actor-input-", suffix=".json"
            )
            input_path = Path(raw_path)
            with os.fdopen(fd, "w", encoding="utf-8") as stream:
                try:
                    json.dump(input, stream, separators=(",", ":"), allow_nan=False)
                except (TypeError, ValueError) as exc:
                    raise ActorError("Actor input must be valid JSON") from exc
            args.extend(["--input-file", os.fspath(input_path)])
        if not purge:
            args.append("--no-purge")
        data = _invoke(args, timeout=timeout, bxc_bin=web_browser_bin or bxc_bin)
        if (
            not isinstance(data, dict)
            or not isinstance(data.get("actor"), str)
            or not isinstance(data.get("storageDir"), str)
        ):
            raise ActorError("Aphrody Web Browser Actor run returned invalid JSON")
        return ActorRunResult(
            actor=data["actor"],
            storage_dir=Path(data["storageDir"]),
            output=data.get("output"),
        )
    except BaseException:
        if owns_storage:
            with contextlib.suppress(OSError):
                shutil.rmtree(path)
        raise
    finally:
        if input_path is not None:
            input_path.unlink(missing_ok=True)
