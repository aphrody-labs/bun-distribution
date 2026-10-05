# Gemma 4 E4B W6 Metal Inference Engine Plan

**Date:** 2026-09-19
**Status:** In-Progress
**Progress model:** Phase task checkboxes only

## Executive Summary

Build a product-specific, resident Gemma 4 E4B runtime for one current mode:
screenshot-to-text description using the selected 6-bit E4B target or a
shape-compatible screenshot SFT. Use a native packed W6 Metal decoder, a
separately compiled Core ML/ANE vision tower plus multimodal projection, and
the official Gemma 4 MTP assistant only when it improves this screenshot
workload. Target one engine distribution with a Metal 3 compatibility library,
an optional Metal 4 library selected only where supported and faster, and tuned
Apple7/M1, Apple8/M2, Apple9/M3-M4, and Apple10/M5 policies. Stock and merged
screenshot SFT models differ by validated weight packages, not runtime
implementations.

The current provisional M2 Ultra screenshot row is decode-dominated: 14.194
seconds of its 18.795-second p50 is decode. Holding the other 4.601 seconds
fixed, a 1.5x, 1.8x, or 3x decoder improvement would yield approximately 1.34x,
1.51x, or 2.01x end-to-end before any ANE vision gain. The practical first-win
forecast is therefore 1.2-1.5x end-to-end, with larger gains requiring measured
multi-token acceptance or a separately measured ANE win. These are forecasts,
not native-engine results; the hard promotion gate is 1.2x screenshot-to-text
with no screenshot-quality regression.

## Problem Statement

- **Symptom:** General-purpose Transformers/MPS or MLX-style execution carries
  graph dispatch, generic-shape, packing, and multimodal overhead that is large
  relative to short, batch-one product requests.
- **Root Cause:** The current repository exports full Hugging Face checkpoints
  but has no native Gemma 4 runtime, no W6 package contract, no exact-shape
  kernels, no ANE vision boundary, and no product-corpus performance harness.
- **Impact:** Screenshot descriptions wait on an avoidable inference tax.
  Lower-bit experiments cannot realize their memory advantage unless the
  runtime consumes their exact packed format efficiently.

## Mode Definitions

| Mode | Behavior | Why it matters |
| --- | --- | --- |
| `image_to_text` | Screenshot preprocessing → Core ML/ANE vision tower and 768-to-2,560 projection → Metal E4B prefill/decode | Adds a physical accelerator boundary and image-token contract. |

## Goals and Non-Goals

### Goals

- Run the current winning E4B 6-bit target and shape-compatible merged SFT
  variants with one resident, exact-shape native runtime.
- Preserve the exact selected request ordering and prompts; optimize only model
  execution, packing, residency, and accelerator placement.
- Compile the complete vision tower plus `embed_vision` projection into a Core
  ML package, prove real ANE participation, and measure the ANE-to-Metal handoff.
- Match pinned Hugging Face semantics for processors, per-layer embeddings,
  local/global attention, shared KV, logits, sampling, and multimodal insertion.
- Support Apple7/M1 through Apple10/M5 with one runtime distribution and
  per-family policies. Use Metal 3 as the compatibility baseline so the
  inventoried macOS 15.7.9 M1/M2 hosts remain real targets; advertise only
  exact OS/GPU tuples that pass physical qualification.
- Improve warmed p50 end-to-end latency by at least 1.2x `image_to_text` over
  the best pinned reference that passes the same screenshot corpus on the same
  machine.
- Keep target-only decoding as a permanent fallback; enable the official MTP
  assistant per package only after a positive acceptance/throughput receipt.

### Non-Goals

- Changing request timing, concurrency, prompt ordering, or the user's chosen
  quality/latency workflow.
- Supporting E2B, 12B, 26B, 31B, MoE, video, raw joint image-plus-audio input,
  or arbitrary Hugging Face architectures in the first version.
- Voice transcription, audio encoding, transcript cleanup/rewrite, production
  rewrite-row recovery, and prompt-copy optimization. They are separate future
  workloads and do not block this screenshot SFT engine.
- Training a replacement draft model, dynamically applying LoRA at runtime, or
  supporting geometry-changing SFT checkpoints.
- Building a generic OpenAI/Anthropic HTTP server, multi-tenant scheduler,
  long-context prefix-cache service, or high-concurrency serving stack.
- Requiring placement-sparse buffers, Apple9-only features, or a separate code
  base per Mac SKU.
- Requiring Metal 4 for correctness. Metal 4 kernels may ship as an optional
  measured optimization, never as an implicit M1/M2 exclusion.
- Claiming support from compilation, microbenchmarks, or ANE utilization alone.

## Scope and Constraints

- **Scope:** Offline packaging from this repo's merged screenshot SFT export;
  W6 target-only inference; Core ML/ANE image encoding; optional official MTP;
  resident framed protocol/CLI; Apple7-Apple10 qualification.
- **Constraints:** Gemma 4 currently requires Transformers 5.5+ in this repo;
  development uses Xcode 26+, but the packaged Metal 3 baseline must deploy to
  and run on the inventoried macOS 15.7.9 M1/M2 hosts. A separately compiled
  Metal 4 library may be selected on compatible OS/device tuples after parity
  and performance proof. Weights remain governed by the Gemma license;
  selectively reused Splash code remains Apache-2.0 with attribution and
  modification notices.
- **Guardrails:** The existing `export` command continues to produce standard
  Hugging Face/SafeTensors directories. Native packing is a downstream command.
  Existing training, export, and integrity behavior must remain stable.

## Ground Truth Contracts (Do Not Violate)

- **Quality winner:** The user's tested screenshot-to-text winner is E4B 6-bit.
  W6 is the primary decoder format; W4 is not substituted merely because Splash
  currently implements Q4.
- **Quantization identity:** “6-bit” includes quantizer algorithm, group size,
  scale/zero-point semantics, tensor exemptions, activation/accumulator dtype,
  model revision, and packing order. The manifest binds all of them.
- **Reference semantics:** Pinned Hugging Face processor and checkpoint
  semantics are the oracle until the native stage passes frozen tensor/token
  comparisons. Do not reproduce a backend defect merely because it appears in
  a receipt: the PyTorch/MPS gather for E4B's 5.64 GB per-layer embedding table
  wraps beyond a 32-bit byte offset, so reference gathers for that table run on
  CPU and feed the otherwise unchanged BF16/MPS layer path.
- **Per-layer embeddings:** E4B's 256-wide per-layer token/context inputs are
  applied at all 42 decoder layers exactly as the pinned implementation does.
- **Hybrid attention:** Five sliding layers followed by one full-attention layer,
  with different local/global head dimensions, RoPE behavior, and a 512-token
  sliding window, must remain exact.
- **Shared KV:** The final shared-KV region reuses state by attention type. Cache
  ownership, eviction, speculative commit, and rollback must not invent one KV
  pair per layer.
- **Vision boundary:** Screenshot preprocessing, patch positions, pooling,
  valid-token stripping, language projection, and placeholder insertion remain
  reference-equivalent. The Core ML package returns 2,560-wide soft tokens.
- **ANE proof:** `.all` or `.cpuAndNeuralEngine` is a scheduling request. Release
  receipts require `MLComputePlan` device usage plus physical profiling and
  warmed wall-clock timing.
- **Speculative correctness:** The target verifies every proposal. Target-only
  and assisted generation must produce identical greedy tokens and equivalent
  sampled distributions under the chosen deterministic test settings.
- **Performance truth:** A kernel, encoder, or accelerator result cannot stand
  in for end-to-end mode latency. Cold load/compile and warmed inference are
  reported separately.
- **Build versus promotion:** Human screenshot review and an idle matched
  benchmark are promotion gates, not prerequisites for package, graph, kernel,
  or ANE implementation. Missing rewrite/audio evidence is outside this plan.
- **No pipeline redesign:** This project does not reorder or overlap requests;
  it accelerates the already-selected order of operations.
- **Compatibility before optimization:** A newer SDK or Metal language version
  is not a hardware requirement. The runtime must load the Metal 3 baseline on
  qualified M1/M2 tuples and select a Metal 4 library only after an explicit
  OS/device capability check; both lanes preserve identical model semantics.

## Already Shipped (Do Not Re-Solve)

- **Gemma 4 training support:** `gemma_tuner/models/gemma/family.py` and the
  family-aware loader already support E2B/E4B multimodal fine-tuning/export.
- **Merged export:** `gemma_tuner/scripts/export.py` already detects PEFT
  adapters, loads the correct multimodal base, calls `merge_and_unload()`, and
  saves a self-contained Hugging Face/SafeTensors checkpoint and processor.
- **Integrity manifests:** `gemma_tuner/utils/integrity.py` already hashes
  exported artifacts. The runtime package manifest should link to, not replace,
  that upstream evidence.
- **Gemma processors/collators:** Existing family-aware processor and multimodal
  tests capture training-time token/mask behavior that the runtime fixtures can
  reuse.
- **Splash feasibility probe:** Splash commit `298852e` has been inspected, and
  its complete Metal test suite passed locally on an M2 Ultra after changing two
  explicit Apple9 policy assertions to Apple8. This is substrate evidence only.

## Fresh Baseline (Current State)

- **Architecture:** Python trainer/exporter; no native runtime. Phase 0 now has
  a frozen 20-row screenshot manifest, private source fixtures, a Transformers
  tensor oracle, benchmark and idle-gate tooling, an acceptance schema, and a
  private blinded image-review packet. `gemma_generate`, `gemma_profiler`, and
  `inference_common` still gate out Gemma 4 even though fine-tuning/export
  support it.
- **Model facts:** E4B has 42 text layers, hidden width 2,560, MLP width 10,240,
  vocabulary 262,144, eight query heads, two KV heads, 18 shared-KV layers,
  seven full-attention layers, and 280 default image soft tokens.
- **Metrics:** The exact W6 reference replay completed all 20 screenshot rows
  with provisional 18.795/22.442-second p50/p95, including 3.438 seconds image
  encoder plus prefill and 14.194 seconds decode, at 8.887 GB peak allocation.
  All payloads parsed inside Markdown fences but violated the raw-JSON contract.
  The run was not idle-qualified, so it is development evidence rather than a
  promotion benchmark.
- **Known gaps:** No screenshot SFT package is currently promoted; blinded
  screenshot review, a quiet matched final benchmark, physical ANE placement,
  and M1/M3/M4/M5 receipts remain promotion work. None blocks native Phase 1-4
  implementation against the frozen stock W6 package and screenshot fixtures.

## Solution Overview

Use a stable resident process with one screenshot request mode and one model
instance. Keep the accelerator boundary explicit and the package deterministic.

```text
HF/SafeTensors export or merged SFT
              |
              v
 deterministic runtime packer -----------------------------+
   | W6 target | processor | assistant | Core ML vision |  |
              |                                           |
              v                                           |
      content-addressed package manifest                   |
              |                                           |
              v                                           |
+-------------------- resident runtime --------------------+
| image: screenshot -> Core ML/ANE vision+projection       |
|                           -> FP16 soft tokens --+         |
|                                                        vv|
|      W6 Metal E4B target <-> optional official MTP draft |
|                         -> tokens/text                    |
+----------------------------------------------------------+
```

The target runtime starts with a BF16/FP16 reference path, then introduces W6
one operator family at a time. The packer emits one hardware-independent weight
package. The distribution includes a Metal 3 compatibility library and may
include a parity-tested Metal 4 optimization library. Startup probes OS and
device capabilities, `MTLGPUFamily`, recommended working-set size, available
memory, Core ML package compatibility, and approved tuning profiles before
choosing a shader/tuning policy.

## Build vs Buy and Dependency Cost

- **Capability checked:** Native batch-one Apple Silicon inference with fused
  low-bit kernels, exact model geometry, multimodal front ends, and speculative
  decoding.
- **Candidates considered:** Splash, MLX/MLX-LM, llama.cpp/GGUF, stock
  Transformers/MPS, and a new engine.
- **Decision:** Selectively vendor and adapt Splash's low-level Metal/backend,
  operator, memory-mapping, and native-test substrate at pinned commit
  `298852e`; build the Gemma 4 graph, W6 schema/kernels, multimodal contracts,
  package converter, and MTP integration in this repository.
- **Why:** Splash demonstrates the correct specialization strategy but documents
  that its schemas encode Qwen Q4 layouts and do not accept ordinary HF models.
  A generic backend minimizes initial work but cannot consume this exact W6 and
  ANE split without the same model-specific engineering.
- **Dependency cost note:** The native runtime adds an Xcode/Metal/Core ML build
  surface and pinned Apache-2.0 source. Packaged users should need neither Python
  nor Xcode. Core ML packages add per-model compile/load state and must not
  duplicate the decoder weights.

## Implementation Phases

> Do one phase at a time. Verify before proceeding.
>
> `execute-plan` and `phase-audit` apply to every phase.

### Phase 0: Freeze Evidence, Formats, and Kill Gates

**Goal:** Freeze the current screenshot-to-text target, fixtures, and mechanical
contracts needed to begin native implementation. Keep human review and quiet
timing as later promotion gates.

**Skills:** `research-planning`

**Tasks:**

- [x] Add `README/notes/gemma4-e4b-runtime-baseline.md` recording the exact stock
  W6 revision, screenshot SFT eligibility state, W6 quantizer/recipe, group
  size, tensor exemptions, prompt/generation contract, reference engine/version,
  and machine/OS tuple.
- [x] Add the frozen, reversible screenshot manifest at
  `tests/runtime/fixtures/image/manifest.jsonl`; keep private source media
  outside Git and store content hashes plus expected outputs/metrics.
- [x] Add `tools/runtime/capture_reference.py` to save processor tensors,
  encoder outputs, selected layer states, logits, cache transitions, and tokens
  from the pinned Hugging Face revision.
- [x] Add `tools/runtime/benchmark_reference.py` with cold/warm separation and
  stage timing for preprocessing, encoder, handoff, prefill, first token,
  decode, and postprocessing.
- [x] Add `README/notes/gemma4-e4b-runtime-acceptance.md` defining the screenshot
  quality floor and p50/p95/peak-memory receipt schema; never promote a faster
  artifact that loses the frozen screenshot winner.
- [x] Record available physical Apple7/8/9/10 hosts and block a family support
  claim until its exact OS/GPU tuple runs a supported shader lane, the native
  suite, and the screenshot product receipt.

**Verification:** The W6 artifact is reconstructible by exact Hub revision and
recorded hashes; the screenshot manifest and private sidecars validate; the
reference tensor/token smoke reproduces. Human review and idle timing remain
explicit Phase 6 promotion gates and do not hold Phase 1.

---

### Phase 1: Pin the Native Substrate and Define the Package ABI

**Goal:** Establish a minimal, licensed native build and a deterministic runtime
package downstream of the existing Hugging Face export.

**Skills:** `documentation`

**Tasks:**

- [x] Add `runtime/THIRD_PARTY_NOTICES.md` and `runtime/third_party/splash/README.md`
  with commit `298852e`, copied-file inventory, Apache-2.0 license/NOTICE, and
  modification policy; vendor only files required by the runtime.
- [x] Add `runtime/Makefile`, `runtime/include/`, `runtime/src/`, and native
  CPU/Metal smoke targets without importing Splash's server, agent, or Qwen
  request stack.
- [x] Replace the scaffold's hard-coded macOS 26.4/Metal 4 deployment floor
  with a Metal 3 compatibility library that compiles and runs on the available
  macOS 15.7.9 M2 Air. Keep any Metal 4 library optional and capability-selected;
  record the exact deployment target and shader-language version in diagnostics.
- [x] Add `runtime/src/device/DeviceCapabilities.*` that records Metal/OS
  versions, `supportsFamily` for Apple7-Apple10, recommended working-set size,
  and selected policy; fail with a diagnostic rather than guessing.
- [x] Add `gemma_tuner/runtime/package_schema.py` and
  `tests/test_runtime_package_schema.py` defining schema version, Gemma geometry,
  tokenizer/processor hashes, upstream export manifest hash, W6 recipe, tensor
  inventory, assistant revision, Core ML package hash, engine ABI, and checksums.
- [x] Add `gemma_tuner/runtime/packer.py` plus a
  `gemma-macos-tuner pack-runtime` command in `gemma_tuner/cli_typer.py`; accept
  stock or offline-merged SFT exports and reject incompatible geometry.
- [x] Add `tests/test_runtime_packer.py` with deterministic byte-for-byte output,
  tensor-name/layout validation, corruption failures, and stock/SFT fixtures.

**Verification:** `make -C runtime check-native-cpu` passes; native CPU/Metal
smokes run from the same runtime distribution on the primary M2 Ultra and the
macOS 15.7.9 M2 Air through their supported shader lanes; packing the same
export twice produces identical manifests/hashes; corrupt, mismatched, or
geometry-changing inputs fail before any Metal allocation.

---

### Phase 2: Implement the Target-Only Reference Decoder

**Goal:** Reproduce E4B text semantics in a slow, inspectable native path before
adding low-bit or speculative optimizations.

**Skills:** `debug`

**Tasks:**

- [x] Add `runtime/src/gemma4/Gemma4Config.*`, `Gemma4Weights.*`, and
  `Gemma4Decoder.*` for the exact 42-layer schedule, local/global dimensions,
  Q/K normalization, RoPE variants, RMSNorm, `gelu_pytorch_tanh`, and logit cap.
- [x] Add `runtime/src/gemma4/PerLayerEmbedding.*` for packed per-token inputs,
  context projection, layer gates/projections, normalization, and injection.
- [x] Add `runtime/src/gemma4/Gemma4Cache.*` with explicit owners for ordinary
  and shared KV, sliding-window eviction, position tracking, snapshot, commit,
  and rollback primitives.
- [x] Add reference FP16/BF16 Metal operators under `runtime/src/ops/` and keep
  CPU reference implementations for small deterministic fixtures.
- [ ] Add `runtime/tests/gemma4_reference_test.*` comparing processor inputs,
  embeddings, selected layers, cache transitions, logits, and greedy tokens to
  `tools/runtime/capture_reference.py` receipts.
- [ ] Add `runtime/tests/gemma4_boundaries_test.*` for the first/full sixth layer,
  token 511/512/513, entry into the 18-layer shared-KV region, multimodal block
  masks, empty prompts, EOS, and maximum product context.

**Verification:** CPU and Metal reference paths pass the approved tensor
tolerances and produce exact greedy tokens for the frozen screenshot oracle
fixture set; no quantized kernel or MTP path is enabled.

**Evidence so far:** All 42 complete 6,210-token decoder transitions run in the
BF16 MPSGraph against the corrected real five-view screenshot oracle. The
teacher-forced gate passes on 41/42 layers across local/global attention and
ordinary/shared K/V. Layer 41's raw output and an exact-input final-RMSNorm
diagnostic pass; its propagated normalized output misses only the elementwise
gate (ratio 1.33). A slow accumulated prefill now carries its own hidden state
and owner-22/23 K/V through all 42 layers, computes tied-embedding capped
logits, and selects the exact oracle token 2717. It remains a failed gate:
final hidden MAE/RMSE/cosine are 0.08861/0.15912/0.99856 versus declared
0.03/0.08/0.9999, and logit MAE/RMSE are 0.25551/0.31550 versus
0.05/0.15. The one-token decode path then passes teacher-forced parity on all
42 layers while reading real retained caches and routing candidate shared K/V;
its accumulated path selects the exact second token 3723. Its final hidden
MAE/RMSE and logit MAE/RMSE still miss the same aggregate bounds at
0.12803/0.16186 and 0.14660/0.18609. Phase 2 therefore remains in progress:
two exact token decisions and all transition-layer passes do not silently
convert the failed cross-backend aggregate receipts into passes.

---

### Phase 3: Make W6 Native and Fast

**Goal:** Consume the winning 6-bit artifact without widening it before compute,
then tune the dominant exact shapes by GPU family.

**Skills:** `debug`

**Tasks:**

- [x] Add `runtime/src/package/W6Tensor.*` and packer support for the exact
  quantizer blocks, scales/zero points, endian/alignment rules, mmap offsets,
  and tensor-specific precision exceptions captured in Phase 0.
- [x] Add fused W6A16 matvec/matmul kernels for E4B attention/MLP geometry under
  `runtime/src/metal/gemma4_w6.metal`; prove from counters and allocation logs
  that the hot path does not materialize W8/FP16 weight copies.
- [x] Implement and benchmark separate W6 paths for the tied LM head, normal
  token embedding, and per-layer embedding gather instead of assuming dense
  matvec tuning transfers to them.
- [ ] Add optional Q8 KV storage behind a package/runtime flag; promote it only
  after FP16-cache token/quality parity on longest product contexts.
- [ ] Add `runtime/src/device/TuningPolicy.*` with measured Apple7, Apple8,
  Apple9, and Apple10 tile/threadgroup choices in one runtime distribution and
  a conservative unqualified fallback. Key policies by GPU family and shader
  capability lane, not marketing name or a blanket OS-version cutoff.
- [ ] Add `runtime/dev/tune_kernels.py` and checked JSON policy receipts under
  `runtime/tuning/`; keep raw profiles and machine-local paths out of Git.
- [ ] Add `tools/runtime/compare_target.py` to report target-only prefill,
  first-token, decode, peak allocation, and quality versus the exact Phase 0 W6
  baseline on the same idle host.

**Verification:** Native W6 passes the frozen screenshot corpus and produces a
positive target-only decode win against the best pinned qualifying baseline on
the primary M2 Ultra. Record the exact result rather than requiring an
unjustified 1.5x kernel-only multiplier; unsupported family policies cannot
masquerade as tuned.

**Evidence so far:** The runtime now validates all 347 affine W6/group-64 tensor
triples in the pinned artifact and reads byte-addressed payloads without unsafe
alignment assumptions; 344/347 packed tensors are not naturally aligned. The
first fused Metal 3.1 W6A16 matvec consumes packed bytes directly and passes
synthetic exactness plus real layer-0 projection checks without a W8/FP16
weight copy. The actual package is now exposed as two page-aligned, no-copy
Metal shard buffers (7.014 GB total); kernels consume original unaligned tensor
offsets through byte addressing, and report zero copied weight bytes. On a
non-idle M2 Ultra, the resulting matvec Metal interval is 1.27-1.58x faster than
the same-source dense-BF16 comparator on the dominant attention/MLP shapes and
1.20x on the tied LM head; the tiny per-layer projection is a measured 0.96x
non-win rather than being hidden. The tiled full-6,210-token matmul is
1.12-1.15x faster across attention Q, MLP gate, and MLP down shapes. Dedicated
packed token and per-layer embedding gathers also pass real-weight correctness
and process the fixture in 0.451 ms and 0.048 ms of GPU time respectively.
These are directional
microbenchmarks, not a target-only or screenshot speedup claim; the compact
receipt is
`README/notes/receipts/plan-004/phase-3-w6-matvec-development.json`. The same
Metal 3.1 kernel compiled and passed on the macOS 15.7.9 M1, and the precompiled
library passed on the macOS 15.7.9 M2 Air. The M2 Air currently lacks Xcode 26's
optional Metal Toolchain component, so on-device shader compilation there is a
toolchain-installation gap rather than a runtime or M2 capability failure. A
physical-device schedule A/B then falsified the idea that one matvec schedule is
best across Apple Silicon: Wide8 wins every measured M1 and M2 Ultra shape, while
the 10-core M2 Air needs Narrow4 for 2,560-column Q/gate projections and Wide8
for the 10,240-column down projection. `TuningPolicy` encodes only that measured
Apple8/10-core shape rule and otherwise falls back conservatively to Wide8;
Apple9 and Apple10 remain explicitly unqualified. The cross-device receipt is
`runtime/tuning/apple7-apple8-w6-development.json`.

---

### Phase 4: Convert and Integrate the Core ML/ANE Vision Path

**Goal:** Run screenshot feature extraction on ANE and hand one validated
language-space tensor to the Metal decoder.

**Skills:** `debug`, `research-debugging`

**Tasks:**

- [ ] Add `gemma_tuner/runtime/export_vision_coreml.py` that exports the 16-layer
  vision tower, pooling, pre-projection RMSNorm, and 768-to-2,560
  `embed_vision` projection as one ML Program with fixed/enumerated screenshot
  buckets.
- [ ] Add `tests/runtime/test_vision_preprocessing.py` for RGB conversion,
  `1/255` rescaling, model-side `[-1,1]` transform, aspect-ratio resize, patch
  positions, padding, pool-by-9 counts, and the 280-soft-token ceiling.
- [ ] Add an FP16 Core ML reference package first; compare pooled/projected soft
  tokens and downstream greedy tokens to pinned Transformers before attempting
  palettization.
- [ ] Produce 6-bit and 8-bit Core ML palettized candidates independently of the
  decoder W6 format; use the frozen screenshot set to select precision per
  vision tensor rather than applying one global rule.
- [ ] Add `runtime/src/vision/CoreMLVision.*` to load once, request
  `.cpuAndNeuralEngine`/`.all` by measured policy, return FP16
  `[max_soft_tokens,2560]` plus a valid-token mask/count, and synchronize exactly
  once before Metal prefill.
- [ ] Add `tools/runtime/inspect_coreml_compute_plan.swift` and a profiling
  recipe that captures per-op preferred/supported devices, Instruments or
  `powermetrics` evidence, cold compile/load, warmed prediction, handoff time,
  and Metal-only comparison.
- [ ] Keep a Metal-only vision fallback and make ANE the default only on tuples
  where the complete screenshot-to-text path passes quality and latency gates.

**Verification:** The shipped `.mlpackage`/`.mlmodelc` passes screenshot quality,
has physical ANE evidence, and makes warmed `image_to_text` at least 1.2x faster
end-to-end than the best qualifying reference. If the ANE path loses after
handoff, it remains packaged for investigation but is not the default.

---

### Phase 5: Add the Official MTP Assistant Behind an Acceptance Gate

**Goal:** Accelerate decode without making speculative execution a correctness
or SFT performance dependency.

**Skills:** `debug`

**Tasks:**

- [ ] Extend the packer/schema for the pinned E4B assistant revision, its
  four-layer 256-wide graph, target pre/post projections, ordered clustered
  vocabulary data, and generation configuration.
- [ ] Add `runtime/src/gemma4/Gemma4Assistant.*` reproducing target embedding and
  shared-KV inputs, bidirectional local/global masks, six-token proposal blocks,
  and clustered top-k vocabulary scoring.
- [ ] Add transactional multi-token target verification using Phase 2 cache
  snapshot/commit/rollback; keep the target-only function callable for every
  request and after any assistant failure.
- [ ] Add `runtime/tests/gemma4_speculative_test.*` for all accepted, partial,
  first-token rejected, EOS-in-block, window-boundary, and shared-KV rollback
  cases; require exact greedy output and deterministic sampled-distribution
  checks against target-only execution.
- [ ] Benchmark BF16/W8 assistant candidates before lower precision; record
  proposal latency, verification latency, accepted tokens, rejected work, and
  combined tokens/second separately for stock and each SFT package.
- [ ] Persist a package-level `assistant_enabled` decision only when combined
  p50 improves at least 1.25x over native target-only with no p95 regression;
  otherwise ship target-only for that package.

**Verification:** Assisted and target-only outputs satisfy the correctness
contract, and every enabled stock/SFT package has a positive, reproducible
combined-throughput receipt.

---

### Phase 6: Integrate, Qualify Apple Families, and Roll Out

**Goal:** Ship one observable resident runtime with honest per-family support,
safe fallback, and complete documentation.

**Skills:** `documentation`

**Tasks:**

- [ ] Add `runtime/src/service/ResidentRuntime.*` with a local length-prefixed
  `image_to_text` protocol; bound input sizes, serialize the initial batch-one
  implementation, and expose stage timings without logging private screenshots
  or generated descriptions.
- [ ] Add `gemma_tuner/runtime/client.py` and CLI smoke commands so this repo can
  launch, query, stop, and compare the resident process without inventing an
  HTTP compatibility layer.
- [ ] Add `runtime/tests/end_to_end_test.*` and `tools/runtime/bakeoff.py` that
  replay the same frozen screenshot inputs/prompts/settings against reference
  and native engines and emit machine-readable JSON receipts.
- [ ] Run the full suite on physical Apple7/M1, Apple8/M2, Apple9/M3-M4, and
  Apple10/M5 hosts; record chip, GPU cores, RAM, OS, Xcode, engine/package hash,
  selected Metal language lane, thermal/idle gate, p50/p95, memory, energy,
  quality, and failures in `README/notes/gemma4-e4b-device-matrix.md`.
- [ ] Add feature flag `GEMMA_E4B_NATIVE_RUNTIME=0|1` defaulting off until the
  primary-host canary passes; fall back to the pinned existing engine per mode
  on package, Core ML, capability, allocation, or runtime failure.
- [ ] Update root `README.md`, `README/guides/README.md`, and release notes with
  supported tuples, exact limitations, pack/run commands, license notices,
  rollback steps, and links to retained receipts.
- [ ] Remove downloaded weights, temporary converted packages, raw profiles,
  build products, and the temporary Splash clone after retaining source changes,
  package manifests, test fixtures, and JSON receipts.

**Verification:** All advertised families pass native CPU/Metal, Core ML,
frozen screenshot quality, raw-output contract, and end-to-end image gates;
unqualified families fail closed to the reference path; disabling the flag
restores prior behavior without data changes.

## Executable Memory

- Regression test: `python3 -m pytest tests/test_runtime_package_schema.py tests/test_runtime_packer.py tests/runtime -q`
- Native CPU/Metal: `make -C runtime check-native-cpu && make -C runtime check-native-metal`
- Reference parity: capture with `tools/runtime/capture_reference.py`, index the split private receipts with `tools/runtime/index_safetensors.py`, then run `make -C runtime check-layer-parity ...` and `make -C runtime check-prefill-parity ...`.
- Core ML placement: `swift tools/runtime/inspect_coreml_compute_plan.swift --model <vision.mlmodelc>` followed by the documented sustained physical-device profile.
- End-to-end bakeoff: `python3 tools/runtime/bakeoff.py --modes image_to_text --warmups 5 --runs 30 --output artifacts/runtime-receipts/device.json`
- Not testable automatically: human screenshot-description usefulness remains a blinded promotion gate over the frozen corpus.

## Success Criteria

### Hard Requirements (Must Pass)

- W6 stock and SFT packages reproduce the approved quality winner and all
  required processor/model/cache contracts.
- Core ML vision includes the language projection, has physical ANE placement
  evidence, and does not regress end-to-end screenshot latency after handoff.
- On each advertised physical tuple, warmed `image_to_text` p50 improves at
  least 1.2x against the fastest pinned reference that passes the same
  screenshot-quality and raw-output floor; p95 may not regress.
- MTP is enabled only where combined throughput beats native target-only by
  1.25x; correctness never depends on the assistant.
- Every advertised Apple family has its own end-to-end physical receipt. Passing
  on M2 does not authorize an M1, M3/M4, or M5 support claim.
- One engine distribution and package schema serve all qualified families;
  shader-language selection, tuning, allocation, Core ML, and assistant
  policies vary only by measured tuple/package. Metal 4 is never required for
  correctness when the tuple is advertised through the Metal 3 lane.
- Existing fine-tune/export tests pass, and the standard HF export remains a
  valid standalone artifact.

### Definition of Done

- All unit, parity, native, Core ML, quality, and physical-device gates pass for
  each advertised tuple.
- Source and package reviews find no untracked Splash license/NOTICE obligations
  and no model/package revision ambiguity.
- The internal screenshot canary completes without fallback surprises, payload
  logging, memory-pressure failures, or sustained thermal collapse.
- The feature flag, per-mode fallback, and package rollback are exercised from
  the shipped build.
- Documentation states measured results separately from projections and lists
  unsupported hardware/modes explicitly.

## Open Questions

### Resolved

- **Q:** Does quantization amount matter to the engine?
- **A:** Yes. W6 determines the package ABI, bandwidth, unpack/fusion kernels,
  memory residency, and quality gates. It is the primary target because it is
  the tested screenshot-to-text winner. Vision, KV, and assistant precision are
  separate decisions.
- **Q:** Is the ANE vision conversion included?
- **A:** Yes. The plan exports and integrates the full vision tower plus
  multimodal projection, verifies actual ANE use, measures its boundary, and
  retains a Metal fallback.
- **Q:** Do stock and SFT models need different engines?
- **A:** No, provided geometry is unchanged. Merge LoRA offline, quantize with
  the pinned W6 recipe, and emit a separately hashed package.
- **Q:** Do we need one inference engine per chipset?
- **A:** No. Use one runtime distribution and package with per-`MTLGPUFamily`
  tuning and capability policies. It may contain Metal 3 and Metal 4 shader
  libraries while retaining one engine implementation. Split only if physical
  evidence reveals an unavoidable semantic/toolchain incompatibility.
- **Q:** Is the design fundamentally M3+?
- **A:** No source-verified requirement forces Apple9. The v1 design avoids
  placement-sparse memory so Apple7/M1 and Apple8/M2 remain candidates; support
  is earned by physical receipts on each advertised OS/GPU tuple. Metal 3 is
  the compatibility baseline; Metal 4 is an optional optimization lane, not a
  product gate.
- **Q:** Must M1/M2 upgrade to macOS 26.4 for this engine?
- **A:** No. That floor was a scaffold choice, not a proven Gemma or hardware
  requirement. The runtime must first prove its Metal 3 baseline on the
  available macOS 15.7.9 M1/M2 hosts; newer Metal 4 kernels are additive.

### Unresolved

- **Q:** What exact tool and recipe produced the winning E4B 6-bit artifact?
- **Options:** Preserve its native schema if reproducible; translate losslessly
  into the runtime W6 schema; or re-quantize the same source and re-run the
  frozen quality set. Current lean: preserve semantics, not a tool-specific
  container.
- **Q:** What is the best qualifying general-engine baseline?
- **Options:** Current production runner, MLX/MLX-LM, Transformers/MPS, or another
  existing local engine. Phase 0 selects the fastest one that can run the exact
  W6/SFT artifact and pass the same corpus.
- **Q:** Which physical hosts are available for release qualification?
- **Options:** M1/Apple7, M2/Apple8, M3-M4/Apple9, M5/Apple10. Current lean:
  develop and set gates on M2 Ultra, but advertise only the tuples actually run.

## References

### Internal

- [E4B Metal/ANE inference guide](../guides/apple-silicon/gemma4-e4b-metal-inference-engine.md)
- [Gemma 4 multimodal LoRA guide](../guides/apple-silicon/gemma4-guide.md)
- [Research brief](../notes/gemma4-e4b-metal-inference-research-brief.md)
- [Gemma 4 upgrade plan](gemma4-upgrade.md)
- [`export.py`](../../gemma_tuner/scripts/export.py)
- [`family.py`](../../gemma_tuner/models/gemma/family.py)

### External

- [Google Gemma 4 overview](https://ai.google.dev/gemma/docs/core)
- [Gemma 4 E4B configuration](https://huggingface.co/google/gemma-4-E4B-it/blob/main/config.json)
- [Hugging Face Gemma 4 implementation](https://github.com/huggingface/transformers/blob/main/src/transformers/models/gemma4/modeling_gemma4.py)
- [Gemma 4 E4B assistant](https://huggingface.co/google/gemma-4-E4B-it-assistant)
- [Apple Metal feature-set tables](https://developer.apple.com/metal/Metal-Feature-Set-Tables.pdf)
- [Apple Core ML optimization overview](https://apple.github.io/coremltools/docs-guides/source/opt-overview.html)
- [Splash at evaluated commit](https://github.com/incoai/splash/tree/298852ec603a5ef3848e8fb6d58d6d81746713ac)

## Modules

### User Flow

1. Export a stock or merged SFT model with the existing `export` command.
2. Run `gemma-macos-tuner pack-runtime` to produce a content-addressed package
   containing W6 target weights, processor assets, optional assistant, and Core
   ML vision package.
3. Start one resident runtime; it validates hashes, capabilities, memory, and
   per-family/package policies before reporting ready.
4. Submit an `image_to_text` request through the local framed protocol.
5. Receive output text plus optional non-sensitive stage timing; fallback is
   explicit, never silent.

### Data Model and Schema Changes

```json
{
  "schema": "gemma4-e4b-runtime-v1",
  "model": {
    "source_revision": "<commit>",
    "export_manifest_sha256": "<sha256>",
    "geometry": "e4b-dense-42l-h2560",
    "variant": "stock-or-sft-id"
  },
  "target": {
    "format": "packed-w6-v1",
    "recipe": {
      "algorithm": "<pinned>",
      "group_size": 0,
      "scale_dtype": "<pinned>",
      "activation_dtype": "fp16",
      "exceptions": []
    },
    "artifacts": []
  },
  "vision": {
    "coreml_artifact": "vision.mlpackage",
    "precision_policy": "<measured>",
    "buckets": []
  },
  "assistant": {
    "revision": "<commit-or-null>",
    "enabled_by_default": false
  },
  "engine_abi": 1,
  "files": []
}
```

### API Contracts

**Local request envelope:**

```json
{
  "request_id": "uuid",
  "mode": "image_to_text",
  "prompt": "mode-specific prompt",
  "input_path": "validated local media path or null",
  "max_new_tokens": 128,
  "generation": {"temperature": 0, "seed": 0}
}
```

**Local response envelope:**

```json
{
  "request_id": "uuid",
  "text": "generated output",
  "engine": "native | reference-fallback",
  "stages_ms": {
    "preprocess": 0,
    "encoder": 0,
    "handoff": 0,
    "prefill": 0,
    "decode": 0
  }
}
```

### Performance and Latency Budget

| Operation | p50 promotion target | p95 guardrail | Current |
| --- | --- | --- | --- |
| `image_to_text` end-to-end | At least 1.2x faster | No regression versus qualifying reference | Provisional MLX W6 p50 18.795 s; not promotion-grade |
| Native W6 target-only decode | Positive measured win | Stable sustained rate | Unimplemented; no universal multiplier assumed |
| MTP over native target-only | At least 1.25x faster | Disable on non-win | Unimplemented |
| ANE vision over best vision baseline | Positive after handoff | Disable as default on non-win | Unimplemented |

### Error Handling and Edge Cases

| Scenario | Behavior | Fallback |
| --- | --- | --- |
| Manifest/hash/geometry mismatch | Refuse package before allocation | Existing pinned engine |
| No qualified family policy | Emit exact family/OS diagnostic | Conservative reference path |
| Core ML compile/load/placement failure | Mark ANE path unavailable for tuple | Metal vision path |
| Screenshot exceeds buckets | Resize with pinned processor rule or reject | Reference processor/engine |
| Audio sample rate/duration invalid | Normalize only per contract or reject | Reference processor/engine |
| Native allocation pressure | Reject before partial execution | Existing pinned engine |
| MTP acceptance/verification anomaly | Disable assistant for process/package | Native target-only |
| Native/ref quality mismatch | Quarantine artifact and receipt | Last qualifying package |

### Degradation and Rollback

**Degradation Modes:**

- **If ANE vision is unavailable or slower:** use the qualifying Metal vision
  path while retaining the same image soft-token contract.
- **If the assistant is unavailable or unprofitable:** run native target-only.
- **If the native package/runtime is invalid:** use the existing pinned engine
  for the same mode and prompt; never silently change models or quantization.

**Rollback Plan:**

- **How to revert:** Set `GEMMA_E4B_NATIVE_RUNTIME=0` and select the last
  content-addressed qualifying package/reference runner.
- **Time to rollback:** One process restart; no model retraining or data repair.
- **Data recovery needed:** No. Packages and receipts are immutable; request
  inputs/outputs are not migrated.

### Rollout and Gates

- **Feature flag:** `GEMMA_E4B_NATIVE_RUNTIME`, default `0` until canary passes.
- **Rollout strategy:** Developer fixture replay → primary M2 Ultra internal
  canary → one physical host per GPU family → opt-in product mode → default.
- **Kill switch:** Disable the flag or package-specific assistant/ANE policy and
  restart the resident process.

### Monitoring and Observability

**Metrics to Track:**

- `runtime_request_latency_ms{mode,stage,chip_family,package}` — p50/p95 stage and full-path latency.
- `runtime_decode_tokens_per_second{target_only,assisted}` — sustained decode rate.
- `runtime_mtp_accepted_tokens` and `runtime_mtp_rejected_tokens` — assistant utility.
- `runtime_coreml_vision_ms{compute_policy,bucket}` — warmed vision and handoff time.
- `runtime_peak_allocated_bytes{metal,process}` — memory pressure and regression.
- `runtime_fallback_total{mode,reason}` — any native, assistant, or ANE fallback.
- `runtime_quality_receipt{corpus,package}` — link/hash of the approved offline result, not live user content.

## Critical Reminder

> SIMPLER IS BETTER. Keep one resident batch-one engine, one package schema, one
> ANE-to-Metal boundary, and one distribution with capability-selected shader
> libraries and measured family policies. A generic server, extra accelerator
> splits, or per-SKU forks require physical evidence that they beat this design
> without weakening parity or rollback.
