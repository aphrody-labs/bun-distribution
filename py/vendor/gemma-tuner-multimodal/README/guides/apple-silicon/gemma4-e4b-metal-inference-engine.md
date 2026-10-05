# Gemma 4 E4B on Apple Silicon: Metal Decoder and ANE Vision Guide

**Date:** 2026-09-19

> **Scope:** Engineering contracts for a product-specific Gemma 4 E4B runtime on
> Apple Silicon. The primary deployment is a 6-bit E4B target decoder on Metal,
> with the image encoder and image-to-language projection compiled through Core
> ML for ANE execution. This is a build and validation guide, not a claim that a
> particular speedup has already been measured.

## Related Documentation

- [Gemma 4 multimodal LoRA field guide](gemma4-guide.md)
- [Hugging Face Transformers on Apple Silicon](HF-transformers-MPS-guide.md)
- [Implementation plan](../../plans/004-gemma4-e4b-metal-inference-engine.md)
- [Research brief](../../notes/gemma4-e4b-metal-inference-research-brief.md)
- [Gemma 4 upgrade plan](../../plans/002-gemma4-upgrade.md)

## Research Provenance

This guide is the checked, condensed ingestion of a Deep Research Max report:

`/Users/mm/Documents/GitHub/llm-workflows/outputs/create-guide/gemma-4-e4b-shape-specialized-metal-inference-on-apple-silicon/2026-09-20T05-40-38-233Z/raw-report.md`

The raw report is research input, not canonical truth. Claims about undocumented
Apple hardware, universal quantization rules, and target/assistant state sharing
were removed or narrowed. The contracts below are anchored to current Google,
Hugging Face, Apple, and Splash primary sources; hardware performance remains a
physical-device question.

## Executive Summary

The runtime is feasible. It is not a small port of Splash: Splash provides a
valuable Metal substrate, packaging pattern, and test harness, while Gemma 4
requires a different decoder graph, per-layer embeddings, shared-KV behavior,
multimodal front ends, vocabulary projection, and official MTP assistant.

Quantization is part of the engine architecture. The product's current quality
winner is E4B 6-bit, so the primary Metal path must implement a native packed
W6 kernel rather than silently widening 6-bit weights to 8 or 16 bits. A 6-bit
model moves 25% fewer weight bits than W8 and 62.5% fewer than BF16, but 50% more
than W4. Those ratios are ceilings on weight-traffic reduction, not end-to-end
speedups. Unpacking, activations, KV traffic, synchronization, preprocessing,
and the output projection all reduce the realized gain.

The vision encoder belongs in the same product runtime but not in the same
execution engine. Compile the vision tower **and** `embed_vision` projection as
one Core ML package and return language-space soft tokens. Keep the autoregressive
decoder on Metal. This creates one explicit boundary of approximately
`[valid_image_tokens, 2560]` FP16 values rather than moving the 768-wide encoder
states and then launching another projection. Verify ANE placement with a Core
ML compute plan and physical telemetry; `.all` and `.cpuAndNeuralEngine` are
requests, not proof.

There is no source-verified Gemma semantic dependency on M3. Apple's current
feature tables list Metal 4, tensors, and machine-learning encoding for Apple7
(M1) and later. M1 lacks placement-sparse buffers, while Apple8/M2 adds them.
The first version can avoid placement-sparse memory and select tuned schedules
by `MTLGPUFamily`: Apple7/M1, Apple8/M2, Apple9/M3-M4, and Apple10/M5. Every
supported family still needs an end-to-end physical-device receipt.

The honest planning target is roughly 1.5-2.5x end-to-end improvement over a
pinned, optimized general-purpose baseline for the narrow workloads. That range
is a forecast. Promotion gates should be lower and measured separately for
image encoding, audio encoding, prefill, target-only decode, speculative decode,
and complete request latency.

## Product Workloads and Boundaries

| Mode | Inputs | Accelerator split | Output |
| --- | --- | --- | --- |
| `image_to_text` | Screenshot + prompt | Core ML/ANE vision package, then Metal E4B decoder | Compact screenshot description |
| `audio_to_text` | Audio + prompt | Audio feature path and E4B runtime; initial implementation may remain on Metal | Raw or enriched transcript |
| `text_to_text` | Screenshot description + raw ASR text | Metal E4B decoder only | Clean transcript and contextual rewrite |

The latency-critical architecture is one resident target model and three thin
request modes. A generic OpenAI-compatible server, multi-tenant scheduler,
256K-context optimization, and raw joint image-plus-audio inference are not
required to accelerate these paths.

## Source-Verified E4B Contract

The values below come from the current
[`google/gemma-4-E4B-it` configuration](https://huggingface.co/google/gemma-4-E4B-it/blob/main/config.json)
and the current Hugging Face
[`modeling_gemma4.py`](https://github.com/huggingface/transformers/blob/main/src/transformers/models/gemma4/modeling_gemma4.py).

### Text decoder

| Property | E4B value | Runtime consequence |
| --- | ---: | --- |
| Layers | 42 | Exact-shape layer schedule can be compiled in advance. |
| Hidden width | 2,560 | Fixes residual, projection, and ANE handoff width. |
| MLP width | 10,240 | Dominant dense matvec geometry. |
| Vocabulary | 262,144 | Tied embedding/output matrix is a major memory and decode cost. |
| Attention heads | 8 | Query geometry is fixed. |
| KV heads | 2 | Grouped-query cache geometry is fixed. |
| Local head dimension | 256 | Used by sliding-attention layers. |
| Global head dimension | 512 | Full-attention layers require separate kernels/layout. |
| Attention schedule | Five sliding layers, then one full layer | Seven full-attention layers across 42 total layers. |
| Sliding window | 512 | Local cache/mask semantics must match the reference. |
| Shared-KV layers | 18 | The final layers reuse KV by attention type; they do not own independent KV projections. |
| Per-layer input width | 256 | Token identity/context is injected into every layer. |
| Activation | `gelu_pytorch_tanh` | Do not substitute a different GELU approximation without parity evidence. |
| Final logit soft cap | 30 | Apply before sampling/argmax. |
| Input/output embeddings | Tied | Packing must preserve weight identity and output semantics. |

Two details are easy to miss:

1. Gemma 4 computes a packed per-layer embedding for each input token and
   injects a 256-wide value into every decoder layer. Treating E4B as a normal
   Gemma/Llama stack produces plausible but wrong tokens.
2. Once execution reaches the shared-KV region, attention retrieves the KV state
   associated with the corresponding layer type (`sliding_attention` or
   `full_attention`). Cache ownership and commit/rollback logic must reproduce
   that behavior exactly.

### Vision tower and handoff

| Property | E4B value | Runtime consequence |
| --- | ---: | --- |
| Vision layers | 16 | Export a fixed graph per supported image bucket. |
| Vision hidden width | 768 | Internal Core ML representation. |
| Vision MLP width | 3,072 | ANE-heavy static compute. |
| Heads / head dimension | 12 / 64 | Fixed attention geometry. |
| Patch size | 16 | Preprocessing and position IDs must match. |
| Pooling kernel | 3 | Pooled soft-token count is patch count divided by 9. |
| Default maximum soft tokens | 280 | Use as the first static bucket/upper bound. |
| Language-space output width | 2,560 | Include `embed_vision` in the Core ML package. |

The official processor converts screenshots to RGB, rescales by `1/255`, does
not apply a separate mean/std normalization, creates padded 2D patch-position
IDs, and expands the prompt with the exact number of image soft tokens. The
vision model itself maps pixel values from `[0, 1]` to `[-1, 1]`. Preserve that
division of responsibility; duplicating normalization is a common parity bug.

The proposed Core ML function contract is:

```text
inputs:
  pixel_values        fixed/enumerated image bucket
  image_position_ids  matching padded (x, y) patch positions
outputs:
  image_embeddings    [1, max_soft_tokens, 2560] fp16
  valid_token_count   scalar or fixed-width mask
```

The host inserts only the valid rows into image placeholder positions and then
runs the Metal decoder. Keep preprocessing and placeholder expansion in a
single reference-tested module shared by the baseline and native path.

### Audio tower

E4B uses 16 kHz input, 128-bin features, a 12-layer 1,024-wide audio encoder,
and two stride-2 subsampling convolutions. The official processor derives the
number of audio placeholders from the encoder mask and caps the result at 750.
Audio support therefore needs its own encoder-output, mask, and placeholder-count
goldens; it cannot be reduced to “feed a spectrogram to the decoder.”

## Quantization Is a Per-Component Contract

“The model is 6-bit” is not enough to reproduce an artifact. Record the method,
group size, scale/zero-point scheme, tensor exemptions, activation dtype,
accumulator dtype, calibration/QAT lineage, and packing order in the manifest.

| Component | Initial policy | Why |
| --- | --- | --- |
| E4B decoder dense weights | Native packed W6A16 | Preserve the tested quality winner while reducing weight traffic. |
| Tied embedding / LM head | W6 candidate with exact-output quality gate | Very large and read on every generated token; also unusually quality-sensitive. |
| Per-layer embedding table | W6 candidate; benchmark gather path separately | Large resident footprint, but only selected rows are read per token. |
| Norms, scales, biases, soft-cap constants | FP16/FP32 as the reference requires | Tiny memory win is not worth accumulated error. |
| KV cache | Q8 candidate after BF16/FP16 parity | Independent of weight precision; saves context memory and bandwidth. |
| Official MTP assistant | BF16 or W8 first; compress only after acceptance receipt | Draft errors are verification-safe but can erase speed through lower acceptance. |
| Core ML vision package | FP16 reference, then 6-bit and 8-bit palettization bakeoff | Core ML's 6-bit LUT format is not the Metal decoder's W6 format. |
| Vision-to-language projection | Keep inside the Core ML package; test FP16 before compression | Avoids a second device boundary and isolates quantization drift. |

Apple documents 1, 2, 3, 4, 6, and 8-bit weight palettization for Core ML
ML Programs and recommends measuring the exact model/device because the runtime
may decompress weights differently by hardware and compute unit. Apple's
[optimization overview](https://apple.github.io/coremltools/docs-guides/source/opt-overview.html)
specifically notes that 6- and 8-bit palettization are often low-risk starting
points and that ANE is commonly the best target for LUT weights.

### What 6-bit changes in the custom Metal engine

- Splash's public packages are Q4 and its Q4 loaders/kernels are not a drop-in
  W6 implementation.
- W6 needs its own block schema, vectorized unpack path, fused scale application,
  and exact-shape matvec/matmul kernels. If weights are widened to 8 bits before
  multiplication, most of the bandwidth advantage is lost.
- A shape-compatible SFT uses the same kernels and graph. Merge LoRA offline,
  quantize the merged target with the pinned W6 recipe, and build a new package.
  Runtime LoRA overlays are intentionally out of scope.
- Quantizing the target changes quality. Quantizing only the assistant changes
  proposal quality and acceptance, not verified target output. Test them with
  different metrics.

## Official MTP Assistant

Google publishes a matched E4B assistant. Its current configuration is four
layers, hidden width 256, MLP width 2,048, four attention heads, two KV heads,
and a six-token draft schedule. The current Hugging Face implementation receives
target input embeddings and the target's shared KV states, projects from target
hidden width to assistant width, and limits the vocabulary projection using
2,048 centroids with an intermediate top-k of 32. See the official
[`configuration`](https://huggingface.co/google/gemma-4-E4B-it-assistant/blob/main/config.json),
[`generation configuration`](https://huggingface.co/google/gemma-4-E4B-it-assistant/blob/main/generation_config.json),
and
[`modeling_gemma4_assistant.py`](https://github.com/huggingface/transformers/blob/main/src/transformers/models/gemma4_assistant/modeling_gemma4_assistant.py).

Do not describe the assistant as “sharing one KV pool with no state cost.” It
consumes target shared-KV tensors under a specific mask contract and still
performs its own four-layer computation. Implement target-only decoding first,
then add draft, parallel verification, and transactional cache commit/rollback.

For an SFT target, speculative verification remains correctness-preserving, but
acceptance can fall because the assistant was trained against the stock target.
Promote the assistant only when median accepted tokens, target-verification cost,
rejected work, and combined tokens/second beat target-only decoding. Training a
new assistant is a separate project, not a prerequisite for the first engine.

## Apple GPU Families and the M3 Question

Apple maps M1 to Apple7, M2 to Apple8, M3/M4 to Apple9, and M5 to Apple10.
The current
[Metal feature-set tables](https://developer.apple.com/metal/Metal-Feature-Set-Tables.pdf)
list Metal 4, tensors, and machine-learning encoding beginning with Apple7.
Apple's API contract is to query `supportsFamily(_:)` using the documented
[`MTLGPUFamily`](https://developer.apple.com/documentation/metal/mtlgpufamily)
values rather than infer capabilities from a marketing model name.

| Family | Mac generation | Initial policy |
| --- | --- | --- |
| Apple7 | M1 | Conservative tiles; no placement-sparse dependency; smaller residency budget. |
| Apple8 | M2 | Separate tuned tiles; placement-sparse remains optional, not required. |
| Apple9 | M3/M4 | Use measured family policy; do not conflate family support with a universal M3 requirement. |
| Apple10 | M5 | Separate tuning record; no unverified “NAX” or private feature assumptions. |

Splash's current M3+ requirement is a product support and implementation choice,
not evidence that Gemma 4 cannot execute on M1/M2. A local M2 Ultra run has
already passed Splash's complete Metal test suite after lowering two explicit
family policy assertions from Apple9 to Apple8. That proves the low-level test
substrate can execute on that M2; it does **not** prove Gemma correctness,
speed, memory fit, or M1 support. M1 remains unqualified until a host is on the
required macOS/toolchain and passes the full runtime suite.

## Core ML / ANE Vision Rules

1. Export a numerically trusted FP16 package before compressing it.
2. Use fixed or enumerated screenshot buckets; preserve patch positions and
   valid-token masks exactly.
3. Include pooling and the 768-to-2,560 multimodal projection in the package.
4. Benchmark `.cpuAndNeuralEngine`, `.all`, and `.cpuAndGPU` on each target Mac.
5. Inspect `MLComputePlan` preferred/supported devices per operation and capture
   Instruments or `powermetrics` evidence during sustained inference.
6. Measure package load/compile separately from warmed prediction.
7. Compare the full ANE-to-Metal path against a Metal-only vision baseline. ANE
   residency is not a win if synchronization and tensor handoff cost more.

Apple's
[`MLComputePlanDeviceUsage`](https://developer.apple.com/documentation/coreml/mlcomputeplandeviceusage)
exposes preferred and supported compute devices for operations. Treat it as
placement evidence, then corroborate it with physical runtime telemetry.

## Splash Reuse Boundary

The evaluation used Splash commit
[`298852e`](https://github.com/incoai/splash/tree/298852ec603a5ef3848e8fb6d58d6d81746713ac).
Splash is Apache-2.0; copied or modified files require retained license and
attribution notices, plus prominent modification notices where the license
requires them.

| Reuse or adapt | Replace for Gemma 4 |
| --- | --- |
| Metal device/capability wrapper | Qwen model graph and tensor registry |
| Command-buffer and allocation utilities | Q4-only package schema for the W6 target |
| Generic normalization, sampling, RoPE, and attention kernels after parity review | Qwen attention/KV semantics |
| Packed-file validation and memory mapping pattern | DFlash draft and vocabulary logic |
| Native CPU/Metal test harness | Qwen tokenizer, prompt, vision, and tool-call behavior |
| Memory accounting and resident-process patterns | Generic HTTP server/scheduler for this product's first version |

Splash's own
[`DEVELOPMENT.md`](https://github.com/incoai/splash/blob/298852ec603a5ef3848e8fb6d58d6d81746713ac/DEVELOPMENT.md)
states that its package schemas encode its supported Qwen layouts and that plain
Transformers checkpoints do not work. Adopt the substrate selectively and pin
the source revision; do not call the result a model conversion.

## Validation Ladder

Never debug the whole product path first. Promote one boundary at a time.

| Level | Required comparison | Promotion condition |
| --- | --- | --- |
| 1. Processor | IDs, placeholder counts, masks, pixel/audio features | Exact equality where integer; documented tolerance where float. |
| 2. ANE vision FP16 | Pooled/projected image soft tokens | Frozen screenshots pass tensor and downstream-token parity. |
| 3. BF16/FP16 Metal decoder | Layer outputs, logits, cache state | Greedy token parity on short and boundary cases. |
| 4. W6 target | Frozen screenshot, ASR, and rewrite corpus | Meets approved task-quality floor and beats the optimized reference. |
| 5. Q8 KV | Longest product context and window transitions | No cache drift or task-quality regression. |
| 6. Assistant | Target-only versus speculative tokens/distribution | Identical verified output; positive combined throughput. |
| 7. Full modes | End-to-end p50/p95, peak memory, energy | Meets mode-specific gates on every supported chip family. |

Capture timings for preprocessing, encoder, handoff, prefill, first-token,
target decode, draft, verification, and postprocessing. Report warmed and cold
rows separately. A kernel microbenchmark or nonzero ANE power is not an
end-to-end result.

## Failure Signatures

| Symptom | First suspects |
| --- | --- |
| Plausible but consistently different tokens | PLE injection, global/local head dimensions, Q/K normalization, final soft cap. |
| Screenshot token-count mismatch | Resize bucket, patch positions, pool-by-9 rule, padded-position stripping. |
| ANE package runs but is not faster | GPU/CPU fallback, layout conversions, handoff synchronization, cold compile. |
| W6 is no faster than W8 | Widen-before-compute path, non-fused scales, unaligned reads, output-head bottleneck. |
| Divergence after 512 tokens | Sliding-window mask or cache eviction error. |
| Divergence entering final 18 layers | Shared-KV ownership/type error. |
| Speculative output differs from target-only | Verification or cache transaction bug; stop immediately. |
| Speculative output matches but slows down | Low acceptance, expensive clustered projection, oversized verification blocks. |
| Stock model is fast; SFT is slow | Assistant acceptance collapse or quantizer/calibration drift after merge. |

## Do / Avoid

| Do | Avoid |
| --- | --- |
| Make the exact winning W6 artifact and recipe the baseline. | Treat “6-bit” as a portable file format. |
| Tune one binary by GPU family and measured memory limits. | Maintain independent engines for every Mac SKU. |
| Keep vision Core ML and decoder Metal as explicit components. | Ask Core ML to partition the entire multimodal autoregressive graph. |
| Keep a target-only decode path permanently. | Make speculative decoding mandatory before it wins on the SFT. |
| Compare against the best pinned general engine on the same hardware. | Claim speedup against an intentionally weak PyTorch baseline. |
| Require physical M1/M2/M3+/M5 receipts before support claims. | Infer capability from a passing compiler or another chip. |

## Primary Sources

1. [Google Gemma 4 model overview](https://ai.google.dev/gemma/docs/core)
2. [Google Gemma 4 E4B configuration](https://huggingface.co/google/gemma-4-E4B-it/blob/main/config.json)
3. [Hugging Face Gemma 4 implementation](https://github.com/huggingface/transformers/blob/main/src/transformers/models/gemma4/modeling_gemma4.py)
4. [Hugging Face Gemma 4 processor](https://github.com/huggingface/transformers/blob/main/src/transformers/models/gemma4/processing_gemma4.py)
5. [Gemma 4 E4B assistant configuration](https://huggingface.co/google/gemma-4-E4B-it-assistant/blob/main/config.json)
6. [Gemma 4 assistant implementation](https://github.com/huggingface/transformers/blob/main/src/transformers/models/gemma4_assistant/modeling_gemma4_assistant.py)
7. [Apple Metal feature-set tables](https://developer.apple.com/metal/Metal-Feature-Set-Tables.pdf)
8. [Apple Core ML optimization overview](https://apple.github.io/coremltools/docs-guides/source/opt-overview.html)
9. [Apple Core ML palettization performance](https://apple.github.io/coremltools/docs-guides/source/opt-palettization-perf.html)
10. [Splash source at the evaluated revision](https://github.com/incoai/splash/tree/298852ec603a5ef3848e8fb6d58d6d81746713ac)
