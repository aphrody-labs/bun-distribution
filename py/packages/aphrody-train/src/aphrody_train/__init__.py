# SPDX-License-Identifier: Apache-2.0
"""aphrody-train package."""

from importlib import import_module
from typing import Any

__version__ = "0.1.0"

_LAZY_EXPORTS = {
    "GpuRagEngine": ".multimodal_rag",
    "MultimodalDoc": ".multimodal_rag",
    "load_multimodal_corpus": ".multimodal_rag",
}
__all__ = [
    "GpuRagEngine",
    "MultimodalDoc",
    "__version__",
    "load_multimodal_corpus",
]


def __getattr__(name: str) -> Any:
    """Load optional domain APIs only when a caller asks for them."""
    module_name = _LAZY_EXPORTS.get(name)
    if module_name is None:
        raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
    value = getattr(import_module(module_name, __name__), name)
    globals()[name] = value
    return value


def __dir__() -> list[str]:
    return sorted((*globals(), *_LAZY_EXPORTS))
