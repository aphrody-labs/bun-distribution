# SPDX-License-Identifier: Apache-2.0
"""Canonical Google/Gemini runtime configuration for the Python surface."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_GOOGLE_PROJECT = "aphrody"
DEFAULT_GOOGLE_LOCATION = "us-central1"


def resolve_project(explicit: str | None = None) -> str:
    """Resolve the project, with ``rgfr`` selected only by explicit config."""
    return (
        explicit
        or os.environ.get("APHRODY_VERTEX_PROJECT")
        or os.environ.get("GOOGLE_CLOUD_PROJECT")
        or DEFAULT_GOOGLE_PROJECT
    )


def resolve_location(explicit: str | None = None) -> str:
    """Resolve the shared Google location."""
    return (
        explicit
        or os.environ.get("APHRODY_VERTEX_LOCATION")
        or os.environ.get("GOOGLE_CLOUD_LOCATION")
        or DEFAULT_GOOGLE_LOCATION
    )


@dataclass(frozen=True)
class GoogleRuntime:
    """Resolved, non-secret runtime settings shared by all Python clients."""

    project: str
    location: str
    home: Path
    auth: str


def runtime(
    *, project: str | None = None, location: str | None = None
) -> GoogleRuntime:
    """Return centralized settings without loading or exposing credentials."""
    return GoogleRuntime(
        project=resolve_project(project),
        location=resolve_location(location),
        home=Path(os.environ.get("APHRODY_HOME", "~/.aphrody")).expanduser(),
        auth=os.environ.get("APHRODY_GCP_AUTH", "adc-or-secret-manager"),
    )
