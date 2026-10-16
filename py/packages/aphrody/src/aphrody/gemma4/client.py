# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
"""Unified client for the Gemma 4 family supporting local, keyless web, and Antigravity runtimes."""

from __future__ import annotations

import asyncio
import enum
from collections.abc import AsyncIterator, Generator, Sequence
from contextlib import suppress
from typing import Any

from aphrody.gemma4.models import Gemma4Config, get_model_config, list_models
from aphrody.gemma4.sampler import (
    Gemma4Sampler,
    Gemma4SamplingParams,
)
from aphrody.inference.unified import UnifiedInferenceClient


class Gemma4Backend(enum.Enum):
    """Execution backend for Gemma 4 models."""

    LOCAL = "local"
    GEMINI_WEB = "gemini_web"
    ANTIGRAVITY = "antigravity"
    VERTEX = "vertex"


class Gemma4Client:
    """Multi-backend client for interacting with Gemma 4 models."""

    def __init__(
        self,
        model: str = "gemma4-e2b",
        backend: Gemma4Backend | str = Gemma4Backend.LOCAL,
        *,
        base_url: str | None = None,
        api_key: str = "no-key",
        timeout: float = 120.0,
    ):
        self.config: Gemma4Config = get_model_config(model)
        self.backend = Gemma4Backend(backend) if isinstance(backend, str) else backend
        self.sampler = Gemma4Sampler(
            self.config,
            client=UnifiedInferenceClient(
                self.config.name, base_url=base_url, api_key=api_key, timeout=timeout
            ),
        )

    def chat(
        self,
        prompt: str,
        *,
        history: Sequence[dict[str, str]] | None = None,
        images: Sequence[Any] | None = None,
        audio: Sequence[Any] | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> str:
        """Send a chat turn to the model and return the reply text."""
        params = Gemma4SamplingParams(temperature=temperature, max_tokens=max_tokens)
        if self.backend != Gemma4Backend.LOCAL:
            full_prompt = self._external_prompt(prompt, history, images, audio)
            if self.backend == Gemma4Backend.GEMINI_WEB:
                from aphrody.gemini_web import GeminiWebClient

                with GeminiWebClient() as web:
                    return web.chat(full_prompt, model=self.config.name)
            from aphrody.antigravity_bridge import AntigravityBridge

            return AntigravityBridge(model=self.config.name).chat(full_prompt)
        return self.sampler.sample(
            prompt, images=images, audio=audio, params=params, history=history
        ).text

    @staticmethod
    def _external_prompt(prompt, history, images, audio):
        if images or audio:
            raise NotImplementedError(
                "This provider adapter requires text; media placeholders are unsupported"
            )
        if history:
            return "\n".join(
                [f"{turn['role']}: {turn['content']}" for turn in history]
                + [f"user: {prompt}"]
            )
        return prompt

    def stream_chat(
        self,
        prompt: str,
        *,
        history: Sequence[dict[str, str]] | None = None,
        images: Sequence[Any] | None = None,
        audio: Sequence[Any] | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> Generator[str, None, None]:
        """Stream from the selected owner; errors never select another backend."""
        if self.backend != Gemma4Backend.LOCAL:
            full_prompt = self._external_prompt(prompt, history, images, audio)
            if self.backend != Gemma4Backend.GEMINI_WEB:
                raise NotImplementedError(
                    "The Antigravity/Vertex bridge has no streaming contract"
                )
            from aphrody.gemini_web import GeminiWebClient

            with GeminiWebClient() as web:
                yield from web.stream_chat(full_prompt, model=self.config.name)
            return
        params = Gemma4SamplingParams(temperature=temperature, max_tokens=max_tokens)
        yield from self.sampler.stream(
            prompt, images=images, audio=audio, params=params, history=history
        )

    async def achat(
        self,
        prompt: str,
        *,
        history: Sequence[dict[str, str]] | None = None,
        images: Sequence[Any] | None = None,
        audio: Sequence[Any] | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> str:
        """Asynchronously send a chat turn to the model."""
        loop = asyncio.get_running_loop()
        return await loop.run_in_executor(
            None,
            lambda: self.chat(
                prompt,
                history=history,
                images=images,
                audio=audio,
                temperature=temperature,
                max_tokens=max_tokens,
            ),
        )

    async def astream_chat(
        self,
        prompt: str,
        *,
        history: Sequence[dict[str, str]] | None = None,
        images: Sequence[Any] | None = None,
        audio: Sequence[Any] | None = None,
        temperature: float = 0.7,
        max_tokens: int = 2048,
    ) -> AsyncIterator[str]:
        """Asynchronously stream response tokens."""
        iterator = self.stream_chat(
            prompt,
            history=history,
            images=images,
            audio=audio,
            temperature=temperature,
            max_tokens=max_tokens,
        )
        sentinel = object()
        pending = None
        try:
            while True:
                pending = asyncio.create_task(
                    asyncio.to_thread(next, iterator, sentinel)
                )
                token = await asyncio.shield(pending)
                pending = None
                if token is sentinel:
                    break
                yield str(token)
        finally:
            # A cancelled next() must finish before generator.close(); HTTP timeout bounds it.
            if pending is not None:
                try:
                    with suppress(Exception):
                        await pending
                finally:
                    await asyncio.to_thread(iterator.close)
            else:
                await asyncio.to_thread(iterator.close)

    def inspect(self) -> dict[str, Any]:
        """Return full architectural specifications for the loaded model."""
        from aphrody.gemma4.service import describe_model

        return describe_model(self.config.name)

    @staticmethod
    def available_models() -> list[dict[str, Any]]:
        """List all supported Gemma 4 models across the ecosystem."""
        return list_models()
