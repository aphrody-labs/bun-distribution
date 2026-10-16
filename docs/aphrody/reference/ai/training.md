<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody training

The Rust supervisor in `crates/ai/train` runs the `aphrody-train` member
of the shared `py/` workspace (or `APHRODY_PY_ROOT`) through
`uv`. Python 3.12 is pinned for the training
environment. The worker sends JSONL `start`, `progress`, `eval`, `artifact`,
`done`, and `error` events to the supervisor. The supervisor checks the job ID,
artifact size, and SHA-256 digest before reporting success.

## Available jobs

| `aphrody train run --kind` | Current behavior |
| --- | --- |
| `triples` | Creates triples from input chunks. A supplied gold file filters overlapping records. |
| `dataset-rollouts` | Exports successful turns from rollout JSONL, redacts common credential forms, and excludes matching gold queries and URLs. Requires `--input` and `--gold`. |
| `dataset-dpo` | Exports same-turn failed or denied tool calls that were repaired successfully. Requires `--input` and `--gold`. |
| `embed` | Fine-tunes a SentenceTransformers embedding model and exports an ONNX model after parity validation. |
| `rerank` | Fine-tunes a cross-encoder and exports an ONNX model after parity validation. |
| `dry-run` | Runs a bounded CPU training and ONNX export probe. |
| `lora` | Trains a full-precision PEFT LoRA adapter from guarded, prepared rollouts and exports a GGUF adapter. Requires `--input`, `--gold`, a local `--base-model`, and the official llama.cpp converter path. QLoRA 4-bit training is not implemented. |

For `embed` and `rerank`, install the full Python extra through
`uv sync --project py --package aphrody-train --extra full
--locked`. Set `APHRODY_PY_ROOT` when the workspace is elsewhere. Run the CLI
from the repository root; the Rust supervisor locates the shared workspace.

The `--input` value is a chunks file for `triples`, a triples JSONL file for
`embed`/`rerank`, and a rollout directory for the dataset jobs. `--allow-cpu`
permits CPU training if no CUDA GPU is available. Embed/rerank/LoRA jobs acquire
an exclusive GPU lease; dataset jobs do not.

## Verified local smoke, 2026-09-24

Using four synthetic triples and one CPU training step each:

| Model | Export size | PyTorch versus ONNX check |
| --- | ---: | --- |
| MiniLM L3 embedding | 69,022,961 bytes | Minimum cosine 0.99999988 |
| MiniLM L2 reranker | 62,506,969 bytes | Maximum absolute difference 0.000001907 |

Both exports passed `onnx.checker` and artifact digest verification. The
embedding export was loaded by Rust `OrtEmbedder::load_user_defined` and
produced three finite, nonzero 384-dimensional vectors. Its cosine for a
related pair was 0.767620, compared with 0.003446 for an unrelated pair.
The opt-in test is `crates/ai/rag/tests/trained_onnx_smoke.rs`; it needs
`APHRODY_TRAIN_SMOKE_MODEL_DIR` and a local ONNX Runtime library.

A separate one-step CPU smoke used two synthetic, gold-disjoint rollout
examples with a local SmolLM2-135M-Instruct base. It produced a 930,368-byte
LoRA GGUF adapter. Before emitting the artifact event, the worker checked
finite safetensors weights, 60 nonzero updated `lora_B` matrices, the GGUF
adapter metadata, and 120 paired LoRA tensors. The adapter requires its base
model for inference. Set `APHRODY_LLAMA_CPP_CONVERTER` to an official
`llama.cpp/convert_lora_to_gguf.py` checkout with `gguf-py` before this job.

These synthetic examples verify the export and loader path. They do not
measure retrieval quality on an untouched gold set. `aphrody train promote`
refuses installation until baseline and candidate Recall@5 and per-tag scores
are measured against a shadow index. No model was promoted by this smoke.
The LoRA smoke also does not establish response quality or 4-bit QLoRA
training.

Redaction recognizes credential keys and common token patterns; inspect any
dataset before sharing it outside the local training environment. See the
[Python training README](../../../../py/packages/aphrody-train/README.md) for worker entry points.

## Bun Qwen3-Coder 30B adapter delivery

**Status: INCOMPLET (2026-09-28).** This is the execution runbook for
[D3T](../../plans/ai/PLAN.md#d3t--qualify-a-bun-coding-adapter-for-qwen3-coder-30b). It
targets a reproducible adapter for the committed Aphrody Bun fork, followed by
measured coding-task qualification. The existing LoRA worker has only a small
full-precision smoke; no 30B QLoRA run or Bun quality evaluation has passed.

### Model and resource contract

- Inference base: catalog ID `qwen3-coder-30b-a3b-q4km`, the pinned
  `unsloth/Qwen3-Coder-30B-A3B-Instruct-GGUF` Q4_K_M file
  (`17.28 GiB`; expected SHA-256
  `fadc3e5f8d42bf7e894a785b05082e47daee4df26680389817e2093056f088ad`).
  Resume the Aphrody model pull and let the store verify the digest. This GGUF
  is an inference artifact; it is not the input to PEFT training.
- Training base: official
  [Qwen/Qwen3-Coder-30B-A3B-Instruct](https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct)
  safetensors, tokenizer and chat template, pinned at observed revision
  `b2cff646eb4bb1d68355c01b18ae02e7cf42d120`. Freeze this revision
  in the run manifest and verify that the GGUF uses the same base/tokenizer.
  Its 16 BF16 shards occupy roughly 61 GB before caches or checkpoints.
  The official Coder card specifies non-thinking mode. Preserve its exact chat
  template, tool-call tokens and tokenizer; do not substitute generic Qwen3
  thinking or tool templates without a matching inference check.
- The local RTX 4070 has 12,282 MiB VRAM, with about 23 GiB system RAM.
  The 17.28 GiB inference file alone exceeds VRAM; NF4 training also needs
  activations, adapters and optimizer state. The local machine is the data,
  smoke and hybrid-inference host. Begin the 30B training qualification on a
  CUDA host with at least 48 GiB VRAM and 150 GiB free scratch; this is an
  entry target, not a guarantee. Measure a forward/backward step and peak
  allocated/reserved memory before accepting that host. If it fails, use a
  larger GPU or a validated distributed/offload path, never silently shrink
  the target model. Keep the 30B job pending until a qualifying host exists.
- Pin the official llama.cpp converter revision separately. A GGUF adapter
  must load against the catalog base, with matching model architecture,
  tokenizer and target tensor names. Conversion support for this Qwen3 MoE
  variant is an explicit gate, not an assumption.
- The locked `py/aphrody-train/.venv` (not in repo) has Torch 2.8 CUDA 12.9, Transformers,
  PEFT and TRL; CUDA import was observed on the local 4070. It does not yet
  pin `bitsandbytes` or implement QLoRA. Add a dedicated locked training
  extra and prove its NF4 kernels on the selected host before a 30B job.

### Ordered work and exit evidence

| Stage | Work | Exit evidence |
| --- | --- | --- |
| 0. Freeze inputs | Finish the digest-checked GGUF pull; pin the official HF revision, GGUF digest, Bun fork commit, upstream commit, toolchain and converter commit in an ignored run manifest. Wait for the currently dirty Bun tree to be committed or use an isolated clean checkout at an explicit revision. | Immutable IDs, model license, clean source checkout and available disk recorded. |
| 1. Build Bun tasks | Inventory first-party `src/`, `packages/`, `test/` and relevant docs through the existing Aphrody search/RAG owners. Exclude vendored, generated, binary, dependency, credential and unrelated user files. Derive instruction/patch pairs from reviewed Bun commits and reproducible bug fixes; retain source commit, path, license and test oracle per example. Use retrieval at inference for broad repository context instead of trying to memorize every file. | Corpus manifest with SHA-256, provenance, redaction report, deduplication report and task counts. |
| 2. Hold out gold | Split by commit lineage, feature and related files before chunking or generating prompts. Keep later, unseen Bun fixes and their hidden tests out of training and validation. Deduplicate exact and near-duplicate code across splits. Produce guarded rollout JSONL for the existing `dataset rollouts` and `lora` readers; extend the builder only where their schemas cannot express verified tasks. | At least 50 independent held-out tasks plus a validation set, zero known cross-split leaks, and a preserved gold file containing query/test references. If there are too few verified tasks, stop instead of fabricating labels. |
| 3. Establish baseline | Run the unmodified catalog GGUF with the pinned Bun retrieval context and task harness. Apply produced patches in disposable clean Bun checkouts. Use the fork's `bun bd` debug build and focused tests from its AGENTS.md, plus type/build checks for affected paths. Record parseable tool calls, patch applicability, test pass@1, latency and memory. | Baseline outputs, exact prompts/context, executable results and failure categories saved outside Git. |
| 4. Implement QLoRA | Add NF4/double-quantized loading of the official HF base, BF16 compute, `prepare_model_for_kbit_training`, gradient checkpointing, accumulation, bounded sequence length, resumable checkpoints and a deterministic seed to `aphrody-train`. Inspect actual `named_modules()` before choosing attention/expert projection targets; freeze router and base weights and log trainable tensor counts. Add assistant-response loss masking, validation loss and early stopping. Keep the Rust supervisor's GPU lease, cancellation, JSONL events and artifact hashing. | Locked dependency resolution, tiny-model end-to-end smoke, then a 30B one-step forward/backward pilot with finite loss and measured peak VRAM/RAM. |
| 5. Train candidate | Run a bounded pilot on the 30B base, inspect held-out validation behavior, then the full scheduled job with periodic checkpoint/restart proof. Save adapter safetensors, configuration, data/model IDs, seed, step/loss trace and GPU telemetry. Do not place weights, prompts or private rollouts in Git. | Finished job, resumed checkpoint proof, finite updated LoRA tensors and reproducible artifact hashes. |
| 6. Export and qualify | Convert the PEFT adapter with pinned official llama.cpp. Verify Qwen3 MoE tensor mapping and load it through the Aphrody managed `llama-server` with the same catalog GGUF. Compare base and adapter on the untouched Bun gold set under identical prompts, retrieval, decoding and budgets. Confirm output patches apply and hidden `bun bd` tests pass. Measure general coding regressions, tool-call format, latency and GPU/RAM use. | Adapter GGUF digest, successful offline inference, complete baseline/candidate table and no hidden-test contamination. A proposed quality gate is >=5 percentage points higher Bun pass@1 with no >2-point general-coding regression; treat these as targets until measured with uncertainty intervals. |
| 7. Promote or reject | Add a code-adapter promotion path; the current `aphrody train promote` refuses installation, while the library's existing promotion criteria target retrieval rather than coding LoRA. Register the adapter only after stage 6, bind it to its exact GGUF/base revision and retain rollback to the base. | Signed-off run manifest with source/model/data/converter hashes, evaluation artifacts, installed load/unload proof and rollback outcome. Otherwise mark the candidate rejected. |

### Present command boundary

The commands below exist now; the 30B QLoRA job and code-adapter promotion
commands are **planned work** and must not be claimed as runnable yet.

```sh
cd ~/src/aphrody-ai
uv sync --project ../aphrody-py --package aphrody-train --extra full --locked
git -C ../bun rev-parse HEAD
git -C ../bun status --porcelain=v1
aphrody model pull qwen3-coder-30b-a3b-q4km
aphrody train status
```

The existing supervised input command is `aphrody train run --kind lora
--input <prepared-rollouts-dir> --gold <gold.jsonl> --base-model
<local-hf-directory> --out-dir <output-dir>`. It currently loads the entire
Hugging Face base without 4-bit quantization, trains only `q_proj` and
`v_proj` at length 512, and cannot resume a 30B QLoRA run. Do not invoke it
for this target until stage 4 lands.

Primary technical references: [Qwen3-Coder model and tokenizer](https://huggingface.co/Qwen/Qwen3-Coder-30B-A3B-Instruct),
[Qwen3-Coder source](https://github.com/QwenLM/Qwen3-Coder),
[PEFT quantization](https://huggingface.co/docs/peft/main/developer_guides/quantization),
[bitsandbytes installation](https://huggingface.co/docs/bitsandbytes/main/installation),
and [llama.cpp LoRA conversion](https://github.com/ggml-org/llama.cpp/blob/master/convert_lora_to_gguf.py).
