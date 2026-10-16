# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Public Aphrody SDK exports, loaded on demand.

Importing this module never loads credentials, launches processes, or imports
optional providers. Existing public names retain their original implementations.
"""

from __future__ import annotations

from importlib import import_module
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:
    from aphrody._version import __version__
    from aphrody.actors import (
        ActorClient,
        ActorError,
        ActorManifest,
        ActorRunResult,
        list_actors,
        run_actor,
    )
    from aphrody.auth.tokens import OAuthToken
    from aphrody.autocomplete import (
        CodeCompleter,
        Completion,
        CompletionRequest,
    )
    from aphrody.background_review import (
        BackgroundReview,
        spawn_background_review,
    )
    from aphrody.bpy_runner import BlenderRunner, BlenderRunnerError
    from aphrody.client import AphrodyClient
    from aphrody.command_guard import CommandGuard, SecurityError
    from aphrody.data_batch import (
        DataBatch,
        VectorBatch,
        analyze_batch,
        analyze_vector_batch,
    )
    from aphrody.document.docling_extractor import (
        DoclingExtractionResult,
        DoclingExtractor,
        DocumentBlock,
        ExtractionPageResult,
    )
    from aphrody.evaluation import LocalEvaluator
    from aphrody.gemini_web import GeminiWebClient, SessionTokens, load_cookies
    from aphrody.gemma4 import (
        GEMMA4_26B_A4B_MOE_CONFIG,
        GEMMA4_31B_CONFIG,
        GEMMA4_E2B_CONFIG,
        GEMMA4_E4B_CONFIG,
        Gemma4Backend,
        Gemma4Client,
        Gemma4Config,
        Gemma4Sampler,
        get_model_config,
    )
    from aphrody.gemma4 import (
        list_models as list_gemma4_models,
    )
    from aphrody.google import GeminiWebError, GeminiWebResponse
    from aphrody.google_docs import AuthenticatedDocsClient, GoogleDocBuilder
    from aphrody.google_drive import AuthenticatedDriveClient
    from aphrody.google_runtime import GoogleRuntime
    from aphrody.google_runtime import runtime as google_runtime
    from aphrody.inference.harmony_reasoning import (
        HarmonyParser,
        HarmonyReasoningResult,
        HarmonyRunner,
        run_harmony_reasoning,
    )
    from aphrody.session_db import SessionDB
    from aphrody.soul_creator import SoulCreator
    from aphrody.spark import SparkClient
    from aphrody.timeout_monitor import (
        RunawayDetector,
        RunawayLoopError,
        TimeoutMonitor,
    )
    from aphrody.vertex import GeminiVertex
    from aphrody.web_browser import (
        WebBrowserClient,
        WebBrowserError,
        WebBrowserTransport,
    )

_EXPORTS = {
    "ActorClient": ("aphrody.actors", "ActorClient"),
    "ActorError": ("aphrody.actors", "ActorError"),
    "ActorManifest": ("aphrody.actors", "ActorManifest"),
    "ActorRunResult": ("aphrody.actors", "ActorRunResult"),
    "AphrodyClient": ("aphrody.client", "AphrodyClient"),
    "AuthenticatedDocsClient": (
        "aphrody.google_docs",
        "AuthenticatedDocsClient",
    ),
    "AuthenticatedDriveClient": (
        "aphrody.google_drive",
        "AuthenticatedDriveClient",
    ),
    "BackgroundReview": ("aphrody.background_review", "BackgroundReview"),
    "BlenderRunner": ("aphrody.bpy_runner", "BlenderRunner"),
    "BlenderRunnerError": ("aphrody.bpy_runner", "BlenderRunnerError"),
    "CodeCompleter": ("aphrody.autocomplete", "CodeCompleter"),
    "CommandGuard": ("aphrody.command_guard", "CommandGuard"),
    "Completion": ("aphrody.autocomplete", "Completion"),
    "CompletionRequest": ("aphrody.autocomplete", "CompletionRequest"),
    "DataBatch": ("aphrody.data_batch", "DataBatch"),
    "DoclingExtractionResult": (
        "aphrody.document.docling_extractor",
        "DoclingExtractionResult",
    ),
    "DoclingExtractor": (
        "aphrody.document.docling_extractor",
        "DoclingExtractor",
    ),
    "DocumentBlock": ("aphrody.document.docling_extractor", "DocumentBlock"),
    "ExtractionPageResult": (
        "aphrody.document.docling_extractor",
        "ExtractionPageResult",
    ),
    "GEMMA4_26B_A4B_MOE_CONFIG": ("aphrody.gemma4", "GEMMA4_26B_A4B_MOE_CONFIG"),
    "GEMMA4_31B_CONFIG": ("aphrody.gemma4", "GEMMA4_31B_CONFIG"),
    "GEMMA4_E2B_CONFIG": ("aphrody.gemma4", "GEMMA4_E2B_CONFIG"),
    "GEMMA4_E4B_CONFIG": ("aphrody.gemma4", "GEMMA4_E4B_CONFIG"),
    "Gemma4Backend": ("aphrody.gemma4", "Gemma4Backend"),
    "Gemma4Client": ("aphrody.gemma4", "Gemma4Client"),
    "Gemma4Config": ("aphrody.gemma4", "Gemma4Config"),
    "Gemma4Sampler": ("aphrody.gemma4", "Gemma4Sampler"),
    "GeminiVertex": ("aphrody.vertex", "GeminiVertex"),
    "GeminiWebClient": ("aphrody.gemini_web", "GeminiWebClient"),
    "GeminiWebError": ("aphrody.google", "GeminiWebError"),
    "GeminiWebResponse": ("aphrody.google", "GeminiWebResponse"),
    "GoogleDocBuilder": ("aphrody.google_docs", "GoogleDocBuilder"),
    "GoogleRuntime": ("aphrody.google_runtime", "GoogleRuntime"),
    "HarmonyParser": ("aphrody.inference.harmony_reasoning", "HarmonyParser"),
    "HarmonyReasoningResult": (
        "aphrody.inference.harmony_reasoning",
        "HarmonyReasoningResult",
    ),
    "HarmonyRunner": ("aphrody.inference.harmony_reasoning", "HarmonyRunner"),
    "LocalEvaluator": ("aphrody.evaluation", "LocalEvaluator"),
    "OAuthToken": ("aphrody.auth.tokens", "OAuthToken"),
    "RunawayDetector": ("aphrody.timeout_monitor", "RunawayDetector"),
    "RunawayLoopError": ("aphrody.timeout_monitor", "RunawayLoopError"),
    "SecurityError": ("aphrody.command_guard", "SecurityError"),
    "SessionDB": ("aphrody.session_db", "SessionDB"),
    "SessionTokens": ("aphrody.gemini_web", "SessionTokens"),
    "SoulCreator": ("aphrody.soul_creator", "SoulCreator"),
    "SparkClient": ("aphrody.spark", "SparkClient"),
    "TimeoutMonitor": ("aphrody.timeout_monitor", "TimeoutMonitor"),
    "WebBrowserClient": ("aphrody.web_browser", "WebBrowserClient"),
    "WebBrowserError": ("aphrody.web_browser", "WebBrowserError"),
    "WebBrowserTransport": ("aphrody.web_browser", "WebBrowserTransport"),
    "VectorBatch": ("aphrody.data_batch", "VectorBatch"),
    "__version__": ("aphrody._version", "__version__"),
    "analyze_batch": ("aphrody.data_batch", "analyze_batch"),
    "analyze_vector_batch": ("aphrody.data_batch", "analyze_vector_batch"),
    "get_model_config": ("aphrody.gemma4", "get_model_config"),
    "google_runtime": ("aphrody.google_runtime", "runtime"),
    "list_actors": ("aphrody.actors", "list_actors"),
    "list_gemma4_models": ("aphrody.gemma4", "list_models"),
    "load_cookies": ("aphrody.gemini_web", "load_cookies"),
    "run_actor": ("aphrody.actors", "run_actor"),
    "run_harmony_reasoning": (
        "aphrody.inference.harmony_reasoning",
        "run_harmony_reasoning",
    ),
    "spawn_background_review": (
        "aphrody.background_review",
        "spawn_background_review",
    ),
}

__all__ = [
    "ActorClient",
    "ActorError",
    "ActorManifest",
    "ActorRunResult",
    "AphrodyClient",
    "AuthenticatedDocsClient",
    "AuthenticatedDriveClient",
    "BackgroundReview",
    "BlenderRunner",
    "BlenderRunnerError",
    "CodeCompleter",
    "CommandGuard",
    "Completion",
    "CompletionRequest",
    "DataBatch",
    "DoclingExtractionResult",
    "DoclingExtractor",
    "DocumentBlock",
    "ExtractionPageResult",
    "GEMMA4_26B_A4B_MOE_CONFIG",
    "GEMMA4_31B_CONFIG",
    "GEMMA4_E2B_CONFIG",
    "GEMMA4_E4B_CONFIG",
    "Gemma4Backend",
    "Gemma4Client",
    "Gemma4Config",
    "Gemma4Sampler",
    "GeminiVertex",
    "GeminiWebClient",
    "GeminiWebError",
    "GeminiWebResponse",
    "GoogleDocBuilder",
    "GoogleRuntime",
    "HarmonyParser",
    "HarmonyReasoningResult",
    "HarmonyRunner",
    "LocalEvaluator",
    "OAuthToken",
    "RunawayDetector",
    "RunawayLoopError",
    "SecurityError",
    "SessionDB",
    "SessionTokens",
    "SoulCreator",
    "SparkClient",
    "TimeoutMonitor",
    "WebBrowserClient",
    "WebBrowserError",
    "WebBrowserTransport",
    "VectorBatch",
    "__version__",
    "analyze_batch",
    "analyze_vector_batch",
    "get_model_config",
    "google_runtime",
    "list_actors",
    "list_gemma4_models",
    "load_cookies",
    "run_actor",
    "run_harmony_reasoning",
    "spawn_background_review",
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
