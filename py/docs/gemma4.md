<!-- SPDX-License-Identifier: Apache-2.0 -->
# Google DeepMind Gemma 4 Family Architecture & Aphrody Integration

This document specifies the technical architecture of the Google DeepMind Gemma 4 model family and details its native integration across the Aphrody Python SDK, Gemini Web App, `agy` CLI, Antigravity 2.0, and Model Context Protocol (MCP) toolchain.

---

## 1. Gemma 4 Model Family Architecture

The Gemma 4 family introduces high-efficiency multimodal architectures combining text generation, variable-aspect-ratio vision encoders, and Conformer audio encoders.

| Parameter / Feature | Gemma 4 E2B | Gemma 4 E4B | Gemma 4 26B/A4B (MoE) | Gemma 4 31B |
| :--- | :--- | :--- | :--- | :--- |
| **Model Type** | Dense Multimodal | Dense Multimodal | Mixture-of-Experts (MoE) | Dense Multimodal |
| **Total Parameters** | 2.3B | 4.6B | 25.8B | 30.7B |
| **Active Parameters** | 2.3B | 4.6B | 4.1B | 30.7B |
| **Transformer Layers** | 35 | 42 | 30 | 60 |
| **Hidden Dimension ($d_{\text{model}}$)** | 1,536 | 2,560 | 2,816 | 5,376 |
| **FFW Dimension ($d_{\text{ffw}}$)** | 6,144 | 10,240 | 2,112 (shared) + 704 (exp) | 21,504 |
| **Query Heads** | 8 | 8 | 16 | 32 |
| **KV Heads** | 1 | 2 | 8 | 16 |
| **Global KV Heads** | None | None | 2 | 4 |
| **Sliding Window Size** | 512 | 512 | 1,024 | 1,024 |
| **Attention Pattern** | 4 Local + 1 Global | 5 Local + 1 Global | 5 Local + 1 Global | 5 Local + 1 Global |
| **MoE Routing** | None | None | 128 experts (top-8 active) | None |
| **KV Cache Sharing** | 20 / 35 layers (57.1%) | 18 / 42 layers (42.8%) | None | None |
| **Vision Encoder** | Clipped-linear SigLIP | Clipped-linear SigLIP | 27-layer SigLIP ($d=1152$) | 27-layer SigLIP ($d=1152$) |
| **Audio Encoder** | 12-layer Conformer | 12-layer Conformer | Optional | Optional |
| **Bidirectional Attention** | None | None | Vision tokens | Vision tokens |

### 1.1 Mixture of Experts (MoE) Routing in Gemma 4 26B/A4B

Gemma 4 26B/A4B utilizes an asymmetric MoE architecture:
- **128 Total Experts**: Each expert operates with an intermediate dimension of 704.
- **Top-8 Dynamic Routing**: Tokens are routed to 8 experts per layer based on softmax gating.
- **Shared Dense MLP Branch**: An always-active dense feed-forward layer of hidden dimension 2,112 ensures base semantic representation remains cohesive across unrouted context.
- **Bi-directional Cross-Attention**: Multimodal vision patch tokens (280 tokens per frame) use bidirectional attention, allowing visual embeddings to attend forward and backward across the patch grid.

### 1.2 KV Cache Sharing Optimization

To reduce memory consumption during continuous long-context inference:
- **Gemma 4 E2B**: Shares KV projection weights across 20 of its 35 layers (`frac_shared_layers = 0.5714`), with shared feed-forward layer hidden dimension expanded to 12,288.
- **Gemma 4 E4B**: Shares KV projections across 18 of its 42 layers (`frac_shared_layers = 0.4286`).

---

## 2. High-Performance Inference Engine & KV Cache

Implemented in `aphrody.gemma4.engine`:
- **`Gemma4InferenceEngine`**: Coordinates multimodal prefill, prompt tokenization, MoE expert gating, and layer KV caching.
- **`Gemma4KVCacheManager`**: Manages dedicated and shared layer buffers, calculating exact byte footprints.
- **`Gemma4MoERouter`**: Implements top-8 routing over 128 experts and parallel shared dense MLP accumulation.
- **`Gemma4MultimodalProcessor`**: Processes variable-aspect-ratio SigLIP images (280 soft tokens/image) and Conformer audio frames (128 soft tokens/sec).

---

## 3. Fine-Tuning & Model Training Infrastructure

Implemented in `aphrody.gemma4.training`:
- **LoRA Adaptation (`LoRAConfig`, `Gemma4LoRAModel`)**: Low-rank matrix decomposition ($r=8, 16$) injected into attention query/value projections and MoE routing matrices.
- **Supervised Fine-Tuning (`Gemma4SFTTrainer`)**: Instruction training loop with completion-only token loss masking and learning rate scheduling.
- **Direct Preference Optimization (`Gemma4DPOTrainer`)**: Reference margin alignment $\mathcal{L}_{\text{DPO}}$ over $(x, y_w, y_l)$ preference pairs.
- **Negative Preference Optimization (`Gemma4NPOTrainer`)**: Safety unlearning and refusal steering penalty $\mathcal{L}_{\text{NPO}}$.

---

## 4. Benchmarking & Linguistic Evaluation Suite

Implemented in `aphrody.gemma4.benchmark` and `aphrody.gemma4.evaluation`:
- **Throughput & TTFT Benchmarks (`Gemma4Benchmark`)**: Measures generation tokens per second, Time-to-First-Token (TTFT), inter-token latency, and memory savings from KV cache sharing.
- **Linguistic Metrics (`Gemma4Evaluator`)**: Evaluates Exact Match accuracy, BLEU-4, ROUGE-L, and estimated perplexity.

---

## 5. OpenAI-Compatible & SSE API Server

Implemented in `aphrody.gemma4.server`:
- **OpenAI Compatibility**:
  - `POST /v1/chat/completions`: Supports batch JSON and real-time streaming Server-Sent Events (`text/event-stream`).
  - `GET /v1/models`: Returns list of all Gemma 4 family variants with parameter metadata.
  - `GET /healthz`: Health and readiness check.
- **CLI Runner**: `aphrody-python gemma4 serve --host 127.0.0.1 --port 8080`.

---

## 6. Multi-Runtime AI Client

Implemented in `aphrody.gemma4.client`:
- **Sync & Async Interfaces**: Supports `chat()`, `stream_chat()`, `await achat()`, and `async for chunk in astream_chat()`.
- **Multi-Backend Dispatch**:
  - `LOCAL`: Local JAX / Flax / Python execution.
  - `GEMINI_WEB`: Keyless Boq batchexecute RPCs and SSE streaming.
  - `ANTIGRAVITY`: On-device Antigravity 2.0 / `agy` connection adapter.
  - `VERTEX`: Enterprise Google Cloud Platform Vertex AI runtime.

---

## 7. CLI Suite (`aphrody-python gemma4`)

```bash
  # List all Gemma 4 models
  aphrody-python gemma4 models

  # Inspect MoE architecture and KV sharing
  aphrody-python gemma4 inspect gemma4-26b-a4b

  # Interactive chat turn
  aphrody-python gemma4 chat "Explain quantum entanglement" --model=gemma4-e2b

  # Multimodal token accounting sample
  aphrody-python gemma4 sample "Describe scene and transcribe" --images=1 --audio_secs=5.0

  # Run full inference benchmark
  aphrody-python gemma4 bench --model=gemma4-26b-a4b

  # Run task evaluation on dataset
  aphrody-python gemma4 eval --model=gemma4-e2b

  # Fine-tune model with LoRA / SFT
  aphrody-python gemma4 train --model=gemma4-e2b --epochs=3 --output=adapter.json

  # Direct Preference Optimization (DPO) alignment
  aphrody-python gemma4 dpo --model=gemma4-e2b --beta=0.1

  # Launch OpenAI-compatible API server
  aphrody-python gemma4 serve --port=8080
```

---

## 8. Model Context Protocol (MCP) Server Integration

Aphrody exposes native Gemma 4 tools for any MCP-compliant assistant or IDE:
- **`gemma4_list_models`**: Returns JSON specifications of all Gemma 4 models.
- **`gemma4_inspect`**: Returns layer configurations, MoE dimensions, and encoder profiles.
- **`gemma4_chat`**: Dispatches chat prompts to local or keyless web backends.
- **`gemma4_multimodal_sample`**: Simulates variable aspect ratio image (280 tokens/image) and Conformer audio tokens (128 tokens/sec).

---

## 9. Git Submodule & Upstream Fork Management

- **Source**: `aphrody-labs/gemma` on GitHub; no longer vendored (removed 2026-10-05).
- **Active Branch**: `yolo` tracking `aphrody-labs/gemma:yolo`.
- **Upstream Mirror**: `google-deepmind/gemma:main`.
- **Author Identity**: All commits signed by `aphrody-dev <contact@aphrody.com>`.
