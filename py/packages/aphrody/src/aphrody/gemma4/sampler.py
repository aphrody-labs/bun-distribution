# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
"""Compatibility sampler delegating actual generation to unified inference."""

from __future__ import annotations

import dataclasses
from collections.abc import Iterator, Sequence
from typing import Any

from aphrody.gemma4.models import Gemma4Config, get_model_config
from aphrody.inference.unified import UnifiedInferenceClient, UnifiedInferenceRequest


@dataclasses.dataclass(frozen=True)
class Gemma4SamplingParams:
    """Sampling parameters for Gemma 4 generation."""

    temperature: float = 0.7
    top_p: float = 0.95
    top_k: int = 40
    max_tokens: int = 2048
    stop_tokens: tuple[str, ...] = ("<end_of_turn>", "<eos>")
    presence_penalty: float = 0.0
    frequency_penalty: float = 0.0


@dataclasses.dataclass(frozen=True)
class Gemma4GenerationResult:
    """Output of a Gemma 4 generation turn."""

    model: str
    text: str
    finish_reason: str = "stop"
    token_count: int = 0
    latency_ms: float = 0.0
    tool_calls: list[dict[str, Any]] = dataclasses.field(default_factory=list)
    usage_source: str = "estimate"


class Gemma4Sampler:
    """High-level sampler for Gemma 4 models supporting multimodal inputs."""

    def __init__(
        self,
        model: str | Gemma4Config = "gemma4-e2b",
        params: Gemma4SamplingParams | None = None,
        *,
        client: UnifiedInferenceClient | None = None,
    ):
        if isinstance(model, str):
            self.config = get_model_config(model)
        else:
            self.config = model
        self.params = params or Gemma4SamplingParams()
        self.client = client or UnifiedInferenceClient(self.config.name)

    def request(
        self,
        prompt: str,
        images: Sequence[Any] | None = None,
        audio: Sequence[Any] | None = None,
        *,
        params: Gemma4SamplingParams | None = None,
        history: Sequence[dict[str, str]] | None = None,
    ) -> UnifiedInferenceRequest:
        if images or audio:
            raise NotImplementedError(
                "Image/audio placeholders are not media payloads; use a qualified multimodal provider"
            )
        sampling = params or self.params
        return UnifiedInferenceRequest(
            prompt=prompt,
            model=self.config.name,
            history=history,
            temperature=sampling.temperature,
            top_p=sampling.top_p,
            max_tokens=sampling.max_tokens,
            top_k=sampling.top_k,
            stop=sampling.stop_tokens,
            presence_penalty=sampling.presence_penalty,
            frequency_penalty=sampling.frequency_penalty,
        )

    def sample(
        self,
        prompt: str,
        images: Sequence[Any] | None = None,
        audio: Sequence[Any] | None = None,
        *,
        params: Gemma4SamplingParams | None = None,
        history: Sequence[dict[str, str]] | None = None,
    ) -> Gemma4GenerationResult:
        """Delegate generation to the same provider used by unified inference."""
        result = self.client.infer(
            self.request(prompt, images, audio, params=params, history=history)
        )
        return Gemma4GenerationResult(
            model=result.model,
            text=result.text,
            finish_reason=result.finish_reason or "unknown",
            token_count=result.usage["completion_tokens"],
            latency_ms=result.latency_ms,
            usage_source=result.usage_source,
        )

    def stream(
        self,
        prompt: str,
        images: Sequence[Any] | None = None,
        audio: Sequence[Any] | None = None,
        *,
        params: Gemma4SamplingParams | None = None,
        history: Sequence[dict[str, str]] | None = None,
    ) -> Iterator[str]:
        """Yield provider deltas and close the upstream when the consumer stops."""
        yield from self.client.stream(
            self.request(prompt, images, audio, params=params, history=history)
        )
