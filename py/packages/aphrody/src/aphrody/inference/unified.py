# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
"""Unified inference adapter over the existing native-provider HTTP client.

Model execution belongs to the configured Aphrody gateway, llama-server, Jan
or another compatible provider. This facade does not load or simulate models.
"""

from __future__ import annotations

import dataclasses
import math
import os
import time
from collections.abc import Generator, Sequence
from enum import StrEnum
from typing import Any
from urllib.parse import urlsplit

from aphrody.inference.harmony_reasoning import OpenAICompatibleReasoningClient


class InferenceBackend(StrEnum):
    """Supported inference execution backends."""

    LOCAL = "local"
    JAN = "jan"
    HARMONY = "harmony"
    OPENAI = "openai"
    GEMINI_WEB = "gemini_web"


@dataclasses.dataclass(frozen=True)
class UnifiedInferenceRequest:
    """Unified inference parameters across models and compatible providers."""

    prompt: str
    model: str | None = None
    backend: InferenceBackend = InferenceBackend.LOCAL
    system_prompt: str | None = None
    thought: str | None = None
    temperature: float = 0.7
    max_tokens: int = 1024
    top_p: float = 0.95
    history: Sequence[dict[str, str]] | None = None
    metadata: dict[str, Any] = dataclasses.field(default_factory=dict)
    top_k: int | None = None
    stop: tuple[str, ...] = ()
    presence_penalty: float = 0.0
    frequency_penalty: float = 0.0


@dataclasses.dataclass(frozen=True)
class UnifiedInferenceResult:
    """Standardized response, distinguishing provider usage from estimates."""

    text: str
    thought: str | None
    model: str
    backend: InferenceBackend
    latency_ms: float
    usage: dict[str, int]
    usage_source: str = "estimate"
    finish_reason: str | None = None


class UnifiedInferenceClient:
    """Thin product adapter; transport and Harmony parsing have one owner."""

    def __init__(
        self,
        default_model: str = "gemma4-e2b",
        *,
        base_url: str | None = None,
        api_key: str = "no-key",
        timeout: float = 120.0,
    ):
        if not isinstance(default_model, str) or not default_model.strip():
            raise ValueError("model must be non-empty")
        self.default_model = default_model
        self.base_url = base_url
        self.api_key = api_key
        self.timeout = timeout

    def _prepare(self, request: UnifiedInferenceRequest):
        """One validation and payload contract for complete and streaming turns."""
        backend = InferenceBackend(request.backend)
        if backend == InferenceBackend.GEMINI_WEB:
            raise NotImplementedError("Use GeminiWebClient for the Gemini Web protocol")
        if request.thought is not None:
            raise ValueError("thought prefill is unsupported by this transport")
        if not isinstance(request.prompt, str) or not request.prompt.strip():
            raise ValueError("prompt must be non-empty text")
        model = self.default_model if request.model is None else request.model
        if not isinstance(model, str) or not model.strip():
            raise ValueError("model must be non-empty")
        if not math.isfinite(request.temperature) or not 0 <= request.temperature <= 2:
            raise ValueError("temperature must be between 0 and 2")
        if not math.isfinite(request.top_p) or not 0 < request.top_p <= 1:
            raise ValueError("top_p must be greater than 0 and at most 1")
        if type(request.max_tokens) is not int or request.max_tokens < 1:
            raise ValueError("max_tokens must be a positive integer")
        history = list(request.history or ())
        for turn in history:
            if (
                not isinstance(turn, dict)
                or turn.get("role") not in {"system", "user", "assistant"}
                or not isinstance(turn.get("content"), str)
            ):
                raise ValueError("history must contain text messages with valid roles")
        if request.system_prompt is not None and not isinstance(
            request.system_prompt, str
        ):
            raise ValueError("system_prompt must be text")
        endpoint = self.base_url or os.environ.get("APHRODY_INFERENCE_ENDPOINT")
        if endpoint is None and backend == InferenceBackend.JAN:
            endpoint = "http://127.0.0.1:1337/v1"
        if not endpoint:
            raise ValueError("Configure base_url or APHRODY_INFERENCE_ENDPOINT")
        url = urlsplit(endpoint)
        if (
            url.scheme not in {"http", "https"}
            or not url.hostname
            or url.username is not None
            or url.password is not None
            or url.query
            or url.fragment
        ):
            raise ValueError(
                "Inference base URL must use HTTP(S) without credentials or query"
            )
        endpoint = endpoint.rstrip("/").removesuffix("/chat/completions")
        if request.top_k is not None and (
            type(request.top_k) is not int or request.top_k < 1
        ):
            raise ValueError("top_k must be a positive integer")
        for penalty in (request.presence_penalty, request.frequency_penalty):
            if not math.isfinite(penalty) or not -2 <= penalty <= 2:
                raise ValueError("sampling penalties must be between -2 and 2")
        if not isinstance(request.stop, (tuple, list)) or any(
            not isinstance(item, str) for item in request.stop
        ):
            raise ValueError("stop must contain strings")
        messages = []
        if request.system_prompt:
            messages.append({"role": "system", "content": request.system_prompt})
        messages.extend(history)
        messages.append({"role": "user", "content": request.prompt})
        payload = dict(
            model=model,
            messages=messages,
            temperature=request.temperature,
            top_p=request.top_p,
            max_tokens=request.max_tokens,
        )
        if request.top_k is not None:
            payload["top_k"] = request.top_k
        if request.stop:
            payload["stop"] = list(request.stop)
        if request.presence_penalty:
            payload["presence_penalty"] = request.presence_penalty
        if request.frequency_penalty:
            payload["frequency_penalty"] = request.frequency_penalty
        client = OpenAICompatibleReasoningClient(
            base_url=endpoint, api_key=self.api_key, model=model, timeout=self.timeout
        )
        return client, payload

    def stream(self, request: UnifiedInferenceRequest) -> Generator[str, None, None]:
        """Stream actual provider deltas, never split a completed response into words."""
        client, payload = self._prepare(request)
        yield from client.transport().stream(payload)

    def infer(self, request: UnifiedInferenceRequest) -> UnifiedInferenceResult:
        t0 = time.perf_counter()
        client, payload = self._prepare(request)
        data = client.transport().complete(payload)
        raw = client.parse_response(data)
        usage = raw.metadata
        source = "provider"
        if usage is not None and not isinstance(usage, dict):
            raise ValueError("Invalid inference provider token usage")
        if not usage:
            source = "estimate"
            text = request.prompt + (request.system_prompt or "")
            text += "".join(turn["content"] for turn in (request.history or ()))
            prompt = max(1, math.ceil(len(text) / 4))
            completion = math.ceil(len(raw.raw) / 4)
            usage = dict(
                prompt_tokens=prompt,
                completion_tokens=completion,
                total_tokens=prompt + completion,
            )
        keys = ("prompt_tokens", "completion_tokens", "total_tokens")
        if not isinstance(usage, dict) or any(
            type(usage.get(key)) is not int or usage[key] < 0 for key in keys
        ):
            raise ValueError("Invalid inference provider token usage")
        model = data.get("model") or payload["model"]
        finish_reason = data["choices"][0].get("finish_reason")
        if not isinstance(model, str) or (
            finish_reason is not None and not isinstance(finish_reason, str)
        ):
            raise ValueError("Invalid inference provider model or finish reason")
        return UnifiedInferenceResult(
            text=raw.final,
            thought=raw.analysis or None,
            model=model,
            backend=InferenceBackend(request.backend),
            latency_ms=round((time.perf_counter() - t0) * 1000.0, 2),
            usage={key: usage[key] for key in keys},
            usage_source=source,
            finish_reason=finish_reason,
        )
