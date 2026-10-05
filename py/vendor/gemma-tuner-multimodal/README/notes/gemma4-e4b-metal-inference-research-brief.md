# Research Brief: Gemma 4 E4B Shape-Specialized Metal Inference

## Topic

Implementation and debugging contracts for a shape-specialized Apple Silicon inference engine for Google Gemma 4 E4B, including merged SFT checkpoints, image and audio encoders, and the official MTP assistant.

## Context

The target repository, `gemma-tuner-multimodal`, already fine-tunes Gemma 4 E2B/E4B with text, image, audio, and joint audiovisual examples on Apple Silicon. It exports LoRA adapters as merged Hugging Face/SafeTensors checkpoints. It does not yet ship a native inference runtime.

The product workloads are narrow:

1. Screenshot input to a compact screenshot text description.
2. Voice dictation input to raw or enriched transcript text.
3. Screenshot description plus raw ASR transcript to cleaned transcript text and a contextually appropriate rewrite.

Request timing and order of operations are already optimized. The research question is strictly how to make the Gemma E4B portions faster without changing model quality or the chosen product pipeline.

The intended runtime is model-specific rather than generic. It should support stock Gemma 4 E4B and shape-compatible merged SFT variants through different packed weight packages, not separate runtime implementations. It should use one shared engine with Apple GPU family policies for Apple7/M1, Apple8/M2, Apple9/M3-M4, and Apple10/M5 rather than separate engines for every SKU.

Splash (`incoai/splash`, Apache-2.0) is the principal reference design: exact-shape fused Metal kernels, packed Q4 weights mapped zero-copy, paged KV/prefix cache, speculative decoding as the normal decode path, and a machine-specific memory plan. Local feasibility work on an M2 Ultra running macOS 26.6.2 found that Splash's complete Metal test suite passed after changing only its two explicit Apple-family policy checks from family 9 to family 8. This is substrate evidence, not end-to-end Gemma correctness or performance evidence.

The current Gemma 4 E4B public model is a dense multimodal decoder with dedicated image and audio encoders, hybrid local/global attention, per-layer embeddings, shared KV behavior, and a very large vocabulary. Google also publishes a matched lightweight MTP assistant that consumes target activations and shares target embeddings. A merged SFT target may change assistant acceptance even when speculative verification remains lossless.

## Primary Research Goal

Produce an evidence-backed implementation and debugging reference for engineers building and validating this runtime. Establish the exact external contracts that must be reproduced, identify hardware/toolchain boundaries, and distinguish documented facts from hypotheses requiring measurement.

Do not make product, roadmap, staffing, or phase-order decisions. Those belong in the implementation plan.

## Questions to Answer

### Gemma 4 E4B execution contract

- What is the exact E4B decoder graph and tensor geometry in the current official checkpoint and Transformers implementation: layer count, hidden sizes, PLE inputs, local/global layer schedule, head dimensions, Q/K normalization, shared KV ownership, RoPE variants, activation functions, normalization placement, logit soft-capping, tied embeddings, and vocabulary projection?
- What state must persist across prefill and decode for each layer? Which KV layers are physically shared, and what cache layout is semantically valid?
- What is the precise causal/sliding-window mask behavior for normal decoding and multi-token verification?
- Which operations are most likely bandwidth-bound versus compute-bound at batch one on Apple Silicon?

### Image and audio front ends

- What are the exact official input preprocessing, encoder graphs, output tensor shapes, projection steps, modality token placement, token-type tensors, supported resolution/audio duration rules, and ordering constraints?
- Which preprocessing steps are host-side and which are model operations?
- Which encoder outputs can be cached or reused without changing semantics?
- What correctness traps cause a native implementation to appear plausible while producing different tokens?

### MTP/speculative decoding

- What is the exact Gemma 4 E4B assistant contract: shared embeddings, target activation inputs, dimensional projections, assistant KV/state, clustered vocabulary selection, token proposal scheduling, verification, acceptance, and state commit/rollback?
- How should greedy and sampled decoding be implemented so output tokens or the target distribution remain identical to non-speculative target execution?
- Which target hidden states and KV entries are passed to the assistant, and when do they become committed?
- What evidence exists about using the stock E4B assistant with LoRA/SFT-modified target weights? Which effects are correctness-neutral but performance-sensitive?
- What measurements determine whether the assistant remains useful: acceptance length, draft latency, verification latency, rejected work, and combined tokens/second?

### Checkpoint conversion and quantization

- What are the official Hugging Face/SafeTensors tensor names and layouts for E4B target, encoders, PLE tables, and assistant?
- Which official Q4/QAT checkpoints exist, and what exact quantization semantics must a custom packer preserve?
- What is safe for offline LoRA merge, transpose, interleave, block packing, and zero-copy mapping?
- How should manifests bind model revision, tokenizer/processor assets, quantization recipe, tensor hashes, engine ABI, and supported geometry?
- Which parity checks must happen before and after quantization and packing?

### Apple Metal and chipset families

- For Apple7, Apple8, Apple9, and Apple10, which required Metal 4, MPP tensor, bfloat16, low-bit, sparse-placement, SIMD-group, atomic, and threadgroup capabilities are actually available?
- Which capabilities are hardware limits versus macOS/Xcode/Metal language-version limits?
- Does any operation needed by this proposed Gemma engine fundamentally require Apple9/M3+, or can Apple7/M1 and Apple8/M2 use the same semantics with different schedules or memory policies?
- Which tuning dimensions should vary by GPU family, GPU core count, memory bandwidth, and recommended working-set size?
- What commands/APIs reliably report GPU family, working-set limits, shader compilation failures, and Metal validation errors?

### Splash reuse boundary

- Which Splash components are architecture-independent enough to reuse: server, scheduler, memory governor, prefix cache, package format, Metal backend, test harness, and installer?
- Which components are Qwen-specific and must be replaced for Gemma E4B?
- What does Splash's Apache-2.0 license permit, and what notices or source modifications must be retained?
- Are there public packer/converter seams, package specifications, or tests that should be adopted rather than re-created?

### Validation and profiling

- Define a rigorous golden-reference strategy against pinned Transformers for logits, hidden states, encoder outputs, prefill, single-token decode, multi-token verification, greedy tokens, and sampled distribution checks.
- How should numerical tolerances differ for BF16, Q8 KV, and Q4 weights?
- Which physical-device benchmarks isolate image encode, audio encode, prefill, target-only decode, draft, verification, acceptance, and end-to-end throughput?
- What failure signatures distinguish incorrect packing, cache-position errors, mask errors, assistant state drift, quantization loss, and GPU-family tuning problems?

## Source Priorities

Prefer primary sources:

1. Google Gemma 4 documentation, model card, technical report, official checkpoints, and assistant checkpoints.
2. The pinned/current Hugging Face Transformers Gemma 4 and Gemma 4 assistant implementations.
3. Apple Metal Feature Set Tables, Metal 4 documentation, Metal Performance Primitives documentation, WWDC material, and SDK headers.
4. The `incoai/splash` source tree, tests, package documentation, and launch/DFlash technical posts.
5. Original speculative-decoding and DFlash papers or official implementations.

Treat community posts and benchmark claims as secondary evidence. Do not infer undocumented hardware support from marketing names.

## Output Format

- Advanced developer field guide with an executive summary first.
- Evidence-backed facts clearly separated from implementation inferences and unverified hypotheses.
- Exact tensor/shape tables where sources support them.
- Do-this / avoid-this tables.
- Concrete pseudocode or focused code examples for state transitions, packing, and verification.
- Failure modes and debugging section.
- Physical-device profiling commands and receipt schema.
- Numbered references with direct links.
- No charts, generated images, diagrams, or visualizations.
- Leave Related Documentation empty; repository ingestion will add local cross-links.
