# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Keyless authenticated Spark client for Gemini's deep reasoning surface.

This module provides a specialized Spark client that activates deep reasoning,
chain-of-thought, and advanced generation modes on gemini.google.com using
the Boq batchexecute protocol and browser session cookies.
"""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Any

from aphrody.gemini_web import (
    DEFAULT_BASE_URL,
    GeminiWebClient,
    GeminiWebResponse,
    SessionTokens,
    load_cookies,
)

if TYPE_CHECKING:
    import httpx


class SparkClient(GeminiWebClient):
    """Client for Gemini Spark / Advanced reasoning mode.

    Inherits all Boq batchexecute transport capabilities from :class:`GeminiWebClient`
    and preconfigures request payloads for Spark reasoning mode.
    """

    def __init__(
        self,
        cookies: (str | Path | dict[str, str] | list[dict[str, Any]] | None) = None,
        base_url: str = DEFAULT_BASE_URL,
        http: httpx.Client | None = None,
        timeout: float = 120.0,
    ) -> None:
        """Initialize Spark client with cookies and extended reasoning timeout.

        Args:
            cookies: Cookie source or None for automatic discovery.
            base_url: Gemini web base URL.
            http: Optional httpx.Client instance.
            timeout: Timeout in seconds (defaults to 120s for deep reasoning).
        """
        super().__init__(
            cookies=cookies,
            base_url=base_url,
            http=http,
            timeout=timeout,
        )

    def spark_generate(
        self,
        prompt: str,
        conversation_id: str | None = None,
        response_id: str | None = None,
        choice_id: str | None = None,
        model: str | None = "spark",
    ) -> GeminiWebResponse:
        """Execute a prompt with Spark mode explicitly enabled.

        Args:
            prompt: User message string.
            conversation_id: Optional conversation ID to continue.
            response_id: Optional previous response ID.
            choice_id: Optional previous choice ID.
            model: Model identifier tag (default: 'spark').

        Returns:
            GeminiWebResponse containing reasoning output and turn IDs.
        """
        return self.generate(
            prompt=prompt,
            conversation_id=conversation_id,
            response_id=response_id,
            choice_id=choice_id,
            spark_mode=True,
            model=model,
        )


__all__ = [
    "GeminiWebClient",
    "GeminiWebResponse",
    "SessionTokens",
    "SparkClient",
    "load_cookies",
]
