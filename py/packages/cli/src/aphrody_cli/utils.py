# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Shared helper utilities for the aphrody CLI."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def _emit(value: Any) -> None:
    """Print a result as indented JSON (dict/list) or plain text."""
    if isinstance(value, (dict, list)):
        print(json.dumps(value, indent=2, ensure_ascii=False))
    else:
        print(value)


def _as_list(value: Any) -> list:
    """Wrap a scalar in a list; pass lists through unchanged."""
    return value if isinstance(value, list) else [value]


def _image_aspect_ratios() -> tuple[str, ...]:
    """Return the supported aspect ratios (indirection keeps imports lazy)."""
    from aphrody.prompts import ASPECT_RATIOS

    return ASPECT_RATIOS


def _image_sizes() -> tuple[str, ...]:
    """Return the supported image-size tiers."""
    from aphrody.prompts import IMAGE_SIZES

    return IMAGE_SIZES


def _parse_formats(value: Any) -> tuple[str, ...]:
    """Normalise an ``optimize`` flag into a tuple of format names.

    Args:
        value: ``False``/``None`` (none), ``True`` (png+webp default), a list,
            or a comma-separated string like ``"png,webp,avif"``.

    Returns:
        A tuple of lowercase format names.
    """
    if not value:
        return ()
    if value is True:
        return ("png", "webp")
    if isinstance(value, (list, tuple)):
        return tuple(str(v).strip().lower() for v in value if str(v).strip())
    return tuple(s.strip().lower() for s in str(value).split(",") if s.strip())


def build_completion_request(
    *,
    prefix: str | None,
    file: str | None,
    suffix: str,
    line: int | None,
    col: int | None,
    lang: str | None,
    marker: str | None,
) -> Any:
    """Build an ``autocomplete.CompletionRequest`` from raw CLI arguments.

    Either a ``file`` (whose cursor position is resolved from ``line``/``col``
    or an inline ``marker``) or an explicit ``prefix``/``suffix`` pair.

    Args:
        prefix: Literal code before the cursor. Ignored when ``file`` is given.
        file: Path to read the buffer from, splitting it at the cursor.
        suffix: Literal code after the cursor. Ignored when ``file`` is given.
        line: 1-based cursor line within ``file``.
        col: 0-based cursor column within ``file``.
        lang: Language hint; inferred from the path when omitted.
        marker: Inline cursor marker, defaulting to the module's own.

    Returns:
        The populated ``autocomplete.CompletionRequest``.
    """
    from aphrody import autocomplete as ac

    if file is None:
        return ac.CompletionRequest(prefix=prefix or "", suffix=suffix, language=lang)
    text = Path(file).read_text(encoding="utf-8")
    eff_marker = marker if marker is not None else ac.DEFAULT_CURSOR_MARKER
    pre, suf = ac.split_at_cursor(text, line=line, col=col, marker=eff_marker)
    return ac.CompletionRequest(
        prefix=pre,
        suffix=suf,
        language=lang or ac.language_for_path(file),
        path=file,
    )


def _autocomplete_dry_run(
    prefix: str | None,
    file: str | None,
    suffix: str,
    line: int | None,
    col: int | None,
    lang: str | None,
    marker: str | None,
    n: int,
    model: str,
) -> dict[str, Any]:
    """Resolve an autocomplete request offline (no model call) for smoke tests.

    Returns the normalised request + the exact prompt that *would* be sent, so
    the command can be exercised without burning live quota or needing network.
    """
    from aphrody import autocomplete as ac

    req = build_completion_request(
        prefix=prefix,
        file=file,
        suffix=suffix,
        line=line,
        col=col,
        lang=lang,
        marker=marker,
    )
    system, user = ac.build_prompt(req)
    return {
        "dry_run": True,
        "model": model,
        "n": n,
        "language": req.language,
        "mode": "fill-in-the-middle" if req.suffix.strip() else "continuation",
        "prefix": req.prefix,
        "suffix": req.suffix,
        "system_instruction": system,
        "user_prompt": user,
    }
