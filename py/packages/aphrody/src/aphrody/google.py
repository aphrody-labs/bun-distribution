# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Google provider facade, loaded on demand.

Importing this module never loads credentials, launches processes, or imports
optional providers. Existing public names retain their original implementations.
"""

from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from aphrody.gemini_web import (
        GeminiWebClient,
        GeminiWebError,
        GeminiWebResponse,
        SessionTokens,
        load_cookies,
    )
    from aphrody.google_docs import AuthenticatedDocsClient, GoogleDocBuilder
    from aphrody.google_drive import AuthenticatedDriveClient
    from aphrody.google_runtime import GoogleRuntime, runtime
    from aphrody.spark import SparkClient
    from aphrody.vertex import GeminiVertex

_EXPORTS = {
    "AuthenticatedDocsClient": (
        "aphrody.google_docs",
        "AuthenticatedDocsClient",
    ),
    "AuthenticatedDriveClient": (
        "aphrody.google_drive",
        "AuthenticatedDriveClient",
    ),
    "GeminiVertex": ("aphrody.vertex", "GeminiVertex"),
    "GeminiWebClient": ("aphrody.gemini_web", "GeminiWebClient"),
    "GeminiWebError": ("aphrody.gemini_web", "GeminiWebError"),
    "GeminiWebResponse": ("aphrody.gemini_web", "GeminiWebResponse"),
    "GoogleDocBuilder": ("aphrody.google_docs", "GoogleDocBuilder"),
    "GoogleRuntime": ("aphrody.google_runtime", "GoogleRuntime"),
    "SessionTokens": ("aphrody.gemini_web", "SessionTokens"),
    "SparkClient": ("aphrody.spark", "SparkClient"),
    "load_cookies": ("aphrody.gemini_web", "load_cookies"),
    "runtime": ("aphrody.google_runtime", "runtime"),
}

__all__ = [
    "AuthenticatedDocsClient",
    "AuthenticatedDriveClient",
    "GeminiVertex",
    "GeminiWebClient",
    "GeminiWebError",
    "GeminiWebResponse",
    "GoogleDocBuilder",
    "GoogleRuntime",
    "SessionTokens",
    "SparkClient",
    "load_cookies",
    "runtime",
]


def __getattr__(name: str) -> Any:
    try:
        module, attribute = _EXPORTS[name]
    except KeyError:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}") from None
    value = getattr(import_module(module), attribute)
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted(set(globals()) | set(__all__))
