# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
"""Google DeepMind Gemma 4 family integration for Aphrody.

Exposes native architecture configurations, samplers, multi-backend clients,
inference engine, fine-tuning/training (LoRA, SFT, DPO, NPO), benchmarking,
evaluation, API serving, and Model Context Protocol (MCP) tool registrations:
- Gemma 4 E2B (2B dense multimodal)
- Gemma 4 E4B (4B dense multimodal)
- Gemma 4 26B/A4B (26B/4B active MoE multimodal)
- Gemma 4 31B (31B dense multimodal)
"""

from __future__ import annotations

from aphrody.gemma4.benchmark import (
    BenchmarkReport,
    Gemma4Benchmark,
)
from aphrody.gemma4.client import Gemma4Backend, Gemma4Client
from aphrody.gemma4.engine import (
    Gemma4InferenceEngine,
    Gemma4KVCacheManager,
    Gemma4MoERouter,
    Gemma4MultimodalProcessor,
    LayerKVCache,
    MoERoutingDecision,
    create_kv_cache_sharing_patterns,
)
from aphrody.gemma4.evaluation import (
    EvaluationSummary,
    Gemma4Evaluator,
    compute_bleu_score,
    compute_exact_match,
    compute_rouge_l,
)
from aphrody.gemma4.jan import (
    JanBridgeServer,
    JanConfigManager,
    JanModelManifest,
    generate_jan_manifest,
)
from aphrody.gemma4.mcp import Gemma4McpManager, register_gemma4_tools
from aphrody.gemma4.models import (
    GEMMA4_26B_A4B_MOE_CONFIG,
    GEMMA4_31B_CONFIG,
    GEMMA4_E2B_CONFIG,
    GEMMA4_E4B_CONFIG,
    GEMMA4_MODELS,
    AttentionType,
    ConformerConfig,
    Gemma4Config,
    KVCacheSharingConfig,
    VisionEncoderConfig,
    get_model_config,
    list_models,
)
from aphrody.gemma4.multimodal_tuning import (
    Gemma4Exporter,
    Gemma4MultimodalDPOTrainer,
    Gemma4MultimodalSFTTrainer,
    LossMaskingStrategy,
    ModalityType,
    MultimodalDataset,
    MultimodalLoRAConfig,
    MultimodalLoRAModel,
    MultimodalMessage,
    MultimodalSample,
    MultimodalTrainResult,
)
from aphrody.gemma4.sampler import (
    Gemma4GenerationResult,
    Gemma4Sampler,
    Gemma4SamplingParams,
)
from aphrody.gemma4.server import (
    Gemma4RequestHandler,
    Gemma4Server,
    create_chat_completion_response,
    create_models_response,
)
from aphrody.gemma4.training import (
    Gemma4DPOTrainer,
    Gemma4LoRAModel,
    Gemma4NPOTrainer,
    Gemma4SFTTrainer,
    LoRAAdapterLayer,
    LoRAConfig,
    SFTTrainResult,
)

__all__ = [
    "AttentionType",
    "BenchmarkReport",
    "ConformerConfig",
    "EvaluationSummary",
    "GEMMA4_26B_A4B_MOE_CONFIG",
    "GEMMA4_31B_CONFIG",
    "GEMMA4_E2B_CONFIG",
    "GEMMA4_E4B_CONFIG",
    "GEMMA4_MODELS",
    "Gemma4Backend",
    "Gemma4Benchmark",
    "Gemma4Client",
    "Gemma4Config",
    "Gemma4DPOTrainer",
    "Gemma4Evaluator",
    "Gemma4Exporter",
    "Gemma4GenerationResult",
    "Gemma4InferenceEngine",
    "Gemma4KVCacheManager",
    "Gemma4LoRAModel",
    "Gemma4McpManager",
    "Gemma4MoERouter",
    "Gemma4MultimodalDPOTrainer",
    "Gemma4MultimodalProcessor",
    "Gemma4MultimodalSFTTrainer",
    "Gemma4NPOTrainer",
    "Gemma4RequestHandler",
    "Gemma4SFTTrainer",
    "Gemma4Sampler",
    "Gemma4SamplingParams",
    "Gemma4Server",
    "JanBridgeServer",
    "JanConfigManager",
    "JanModelManifest",
    "KVCacheSharingConfig",
    "LayerKVCache",
    "LoRAAdapterLayer",
    "LoRAConfig",
    "LossMaskingStrategy",
    "ModalityType",
    "MoERoutingDecision",
    "MultimodalDataset",
    "MultimodalLoRAConfig",
    "MultimodalLoRAModel",
    "MultimodalMessage",
    "MultimodalSample",
    "MultimodalTrainResult",
    "SFTTrainResult",
    "VisionEncoderConfig",
    "compute_bleu_score",
    "compute_exact_match",
    "compute_rouge_l",
    "create_chat_completion_response",
    "create_kv_cache_sharing_patterns",
    "create_models_response",
    "generate_jan_manifest",
    "get_model_config",
    "list_models",
    "register_gemma4_tools",
]
