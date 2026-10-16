# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Lazy importers for aphrody's optional (extra-gated) dependencies.

Every heavy third-party dependency is declared in an ``[project.optional-
dependencies]`` extra rather than in the core dependency set, so starting the
CLI does not import them. Modules therefore import them *inside* the functions
that need them and surface a single, actionable error when the extra is not
installed. Centralising those importers here keeps the install hint identical
everywhere instead of drifting per module.
"""

from __future__ import annotations

from typing import Any

__all__ = ["require_oxipng", "require_pillow", "require_polars", "require_pyarrow"]


def _missing(package: str, purpose: str, extra: str) -> str:
    """Build the canonical "install the extra" error message."""
    return (
        f"{package} is required for {purpose}; "
        f"install the {extra} extra: uv pip install 'aphrody[{extra}]'"
    )


def require_pillow(purpose: str = "image processing") -> Any:
    """Import and return the ``PIL.Image`` module.

    Args:
        purpose: What the caller needs Pillow for, injected into the error
            message so the user knows which command failed.

    Returns:
        The imported ``PIL.Image`` module.

    Raises:
        RuntimeError: If Pillow is not installed.
    """
    try:
        from PIL import Image
    except ImportError as exc:  # pragma: no cover - depends on env
        raise RuntimeError(_missing("Pillow", purpose, "images")) from exc
    return Image


def require_oxipng(purpose: str = "PNG optimisation") -> Any:
    """Import and return the ``oxipng`` module.

    Args:
        purpose: What the caller needs oxipng for.

    Returns:
        The imported ``oxipng`` module.

    Raises:
        RuntimeError: If pyoxipng is not installed.
    """
    try:
        import oxipng
    except ImportError as exc:  # pragma: no cover - depends on env
        raise RuntimeError(_missing("pyoxipng", purpose, "images")) from exc
    return oxipng


def require_polars(purpose: str = "data batch operations") -> Any:
    """Import and return the ``polars`` module.

    Args:
        purpose: What the caller needs Polars for, injected into the error
            message so the user knows which command failed.

    Returns:
        The imported ``polars`` module.

    Raises:
        RuntimeError: If polars is not installed.
    """
    try:
        import polars as pl
    except ImportError as exc:  # pragma: no cover - depends on env
        raise RuntimeError(_missing("polars", purpose, "data")) from exc
    return pl


def require_pyarrow(purpose: str = "Apache Arrow operations") -> Any:
    """Import and return the ``pyarrow`` module.

    Args:
        purpose: What the caller needs PyArrow for.

    Returns:
        The imported ``pyarrow`` module.

    Raises:
        RuntimeError: If pyarrow is not installed.
    """
    try:
        import pyarrow as pa
    except ImportError as exc:  # pragma: no cover - depends on env
        raise RuntimeError(_missing("pyarrow", purpose, "data")) from exc
    return pa
