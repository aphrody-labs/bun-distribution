# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Inference utilities for aphrody."""

from importlib import import_module
from typing import Any

__all__ = [
    "DEFAULT_GPT_OSS_GGUF_PATH",
    "HarmonyParser",
    "HarmonyReasoningResult",
    "HarmonyRunner",
    "InferenceBackend",
    "OpenAICompatibleReasoningClient",
    "UnifiedInferenceClient",
    "UnifiedInferenceRequest",
    "UnifiedInferenceResult",
    "run_harmony_reasoning",
]

_UNIFIED = {
    "InferenceBackend",
    "UnifiedInferenceClient",
    "UnifiedInferenceRequest",
    "UnifiedInferenceResult",
}


def __getattr__(name: str) -> Any:
    """Load a public implementation only when its capability is requested."""
    if name not in __all__:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    owner = "unified" if name in _UNIFIED else "harmony_reasoning"
    value = getattr(import_module(f"aphrody.inference.{owner}"), name)
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted(set(globals()) | set(__all__))
