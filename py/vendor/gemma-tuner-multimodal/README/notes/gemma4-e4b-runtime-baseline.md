# Gemma 4 E4B Runtime Baseline

**Recorded:** 2026-09-21
**Plan:** [Gemma 4 E4B W6 Metal inference engine](../plans/004-gemma4-e4b-metal-inference-engine.md)
**State:** Screenshot-to-text Phase 0 evidence frozen for implementation; human
review and quiet timing remain promotion gates, not native-engine build blockers.

## Mechanical Problem

The current engine must make the selected screenshot-to-text request faster
without changing its prompt or quality boundary. The baseline therefore binds
model bytes, processor bytes, generation settings, screenshot fixtures,
runtime, and host. A result from another prompt, precision, host, accelerator
split, audio task, or rewrite task is not a speedup comparison.

## Winning W6 Artifact

| Field | Frozen value |
| --- | --- |
| Repository | `mlx-community/gemma-4-e4b-it-6bit` |
| Artifact revision | `7b781e6489f260b3a24ff38aebb6313b2db516d7` |
| Google source revision | `fee6332c1abaafb77f6f9624236c63aa2f1d0187` |
| Quantizer | affine, 6 bits, group size 64 |
| Model tensor inventory | 2,770 tensors: 2,423 BF16 and 347 packed U32 tensors |
| Quantized module inventory | 345 language-model modules, `embed_vision.embedding_projection`, and `embed_audio.embedding_projection` |
| Encoder precision | vision tower BF16; audio tower BF16 |
| Weight-set digest | `7151090349265ffa9986a1f1754ff2cdbb4c7e2b19ca23bf869a633b491926e6` |
| Shard 1 SHA-256 | `7500984eb5f0bd2cbbc447505ce68136e0cf92d0d1f5d5afcc38ea571bdceb35` |
| Shard 2 SHA-256 | `97461393720e4a0f0d538dd31ae88917e80c20a5a857c94635eb0d0f8f74622c` |
| Config SHA-256 | `16741375caa9be356eb2d5c78235c33a83c6fae08caf6f50172a737e529f6260` |
| Processor config SHA-256 | `de3e580aebdc98272d4c4547daffe6525fcbae18a83a0e0bcf0d7444d4ee6f37` |
| Tokenizer SHA-256 | `cc8d3a0ce36466ccc1278bf987df5f71db1719b9ca6b4118264f45cb627bfe0f` |
| Chat template SHA-256 | `2f1b4d75d067bae3fe44e676721c7f077d243bc007156cb9c2f8b5836613d082` |

The digest convention is the filename plus each shard's SHA-256, matching
`tools/eval_screenshot_judge_mlx.py`. The artifact is reconstructible by exact
Hub revision and verified by the file hashes above. Its model card does not
record the source checkout commit or full conversion command, so re-quantizing
from Google BF16 is **not** currently asserted to reproduce these bytes. The
first package path must consume this frozen artifact as the quality reference;
a later re-quantization is a new candidate and must rerun the corpus.

The config sets model dtype to BF16. The measured reference runtime was Python
3.11.15, MLX 0.32.2, and `mlx-vlm` 0.7.1. Accumulation behavior belongs to that
pinned MLX kernel implementation; it is not inferred from the word “6-bit.”

## SFT Package State

No SFT package is currently eligible for this runtime baseline. Plan 006's
rank-64 artifacts were explicitly withdrawn and are non-decision-bearing; they
must not be packed or used as quality evidence. The newer Plan 29 candidate has
not produced a promoted, offline-merged, content-addressed checkpoint. Its base
revision is the same Google source revision above, but that is not an SFT
revision. Phase 1 must therefore support shape-compatible merged exports in the
package ABI without pretending that a qualifying SFT weight package already
exists. When one is promoted, its export-manifest hash becomes a new required
baseline field and it reruns every applicable mode gate.

## Existing Quality and Runtime Evidence

The screenshot quality winner used five views (global screenshot plus four
non-overlapping quadrants), greedy temperature zero, native thinking, and an
8,192-token ceiling. On the frozen 20 it scored 19/20 Good-or-better, four
Excellent, one NeedsImprovement, and zero Fail. On the M2 Ultra it measured
22.397 seconds p50, 39.138 seconds p95, and 8.888 GB peak MLX allocation.
That result remains the model-selection evidence for W6, but its private work
items are no longer present locally and its thinking-enabled prompt differs
from the current product contract. It is not misrepresented as a directly
replayable native-engine promotion corpus.

A different one-image screenshot-judge prompt measured W6 at 15.603 seconds
p50 and 20.225 seconds p95 with 7.980 GB peak MLX allocation. It is useful
precision/runtime evidence but is not the screenshot-description product
baseline and must not be substituted for it.

The already-built BF16 Core ML vision-only package is also not an end-to-end
baseline. Its `624x1008` encoder measured approximately 1.089x faster than MLX
on the base M1 and 7.6x slower than MLX on the M2 Ultra. This is the forcing
function for per-family policy: ANE is enabled only where the full path wins.

## Frozen Fixture State

| Mode | Tracked contract | Private local material | Current state |
| --- | --- | --- | --- |
| `image_to_text` | 20 opaque rows in `tests/runtime/fixtures/image/manifest.jsonl` | Exact first-20 Plan 29 prompts, expected outputs, global screenshots, and four deterministic quadrants under ignored `tests/runtime/private/` | W6 replay and BF16 tensor-oracle capture complete; private blinded review packet awaiting scores |

The image manifest freezes the current Plan 29 prompt contract with thinking
disabled. That is distinct from the older W6 compression winner's
thinking-enabled evaluation and is labeled separately so the two cannot be
silently combined.

## Screenshot Reference Oracle

The tensor oracle is `google/gemma-4-E4B-it` at the same source revision
`fee6332c1abaafb77f6f9624236c63aa2f1d0187`, Transformers 5.5.0, PyTorch
2.11.0, eager attention, and BF16 on MPS, with the oversized per-layer
embedding gather performed on CPU as described below.

One real five-view screenshot fixture emitted processor tensors, projected
image soft tokens, all 43 decoder hidden states, final and transition logits,
greedy token, and cache edges. The prefill cache held 24 physical layers plus
shared states owned by indexes 22 and 23, then advanced from sequence length
6,210 to 6,211. To keep a failed large write from destroying the cache/logit
oracle, the private receipt is split. The primary 85,539,712 byte artifact has
SHA-256
`dc1c2d1a91a2fcee94bb61f33a68807d0fa64ab4addc9eec06b5ab7122b49ccf`;
the 1,367,197,736 byte all-hidden artifact has SHA-256
`6c48b7df4a4377790a41cf06c8c6cea319cd17d539768a194e50548f54ad2337`.
A third 245,376,992 byte full-cache artifact has SHA-256
`3dbccf8298382f91dd093aa7ba56ba6a22eec5be98ad403fa5d0ce65d79e3c12`.
Together they contain the 43 BF16 prefill states, 43 one-token transition
states, two 262,144-wide logit rows, two greedy tokens, processor and prepared
generation tensors, full physical/shared cache states, and cache edges. This
is a correctness oracle, not a timing or quality receipt.

Layer-0 work exposed a PyTorch/MPS large-buffer gather defect in the initial
capture. `embed_tokens_per_layer.weight` is 5.64 GB; its BF16 row stride is
21,504 bytes, so row 199,729 begins beyond the 32-bit byte-offset boundary.
On the unguarded MPS path all fixture lookups above ID 199,728 became zero
(2,353 text tokens), although the checkpoint rows are nonzero. Native work
must match the checkpoint semantics, not this backend corruption. The full
oracle was regenerated with that table gathered on CPU before entering the
otherwise unchanged BF16/MPS model, including the decode transition. Large
per-stage dumps are generated only for diagnosis and are not retained.

Teacher-forced native transitions pass the declared bound on 41 of 42 layers,
covering every local/global and ordinary/shared-KV regime. Layer 41's raw
decoder output passes, and feeding the exact oracle raw output through the
native final RMSNorm nearly bit-matches (maximum error 0.0625); propagating the
candidate raw state through that norm misses the elementwise bound by one BF16
band (ratio 1.33).

The first accumulated native prefill propagates candidate hidden states and
candidate owner-22/23 K/V across all 42 layers. It selects the exact oracle
greedy token, 2717, but does not pass the preregistered numerical gate: final
hidden MAE/RMSE/cosine are 0.08861/0.15912/0.99856 and final-logit
MAE/RMSE/cosine are 0.25551/0.31550/0.99982. This is useful implementation
evidence, not a Phase 2 pass.

The one-token transition graph reads the real retained physical caches,
updates local/global owners, and routes candidate K/V from owners 22 and 23
through the shared region. All 42 teacher-forced transition layers pass the
same tensor gate. The accumulated transition selects the exact second oracle
token, 3723, but again misses the aggregate numerical gate: final hidden
MAE/RMSE/cosine are 0.12803/0.16186/0.99955 and transition-logit
MAE/RMSE/cosine are 0.14660/0.18609/0.99998. Exact token behavior is proven
for two transitions; the cross-backend aggregate receipt remains failed.

## Provisional W6 Corpus Replays

The exact frozen W6 artifact was replayed through MLX 0.32.2 and `mlx-vlm`
0.7.1 on the local M2 Ultra. The screenshot run was not idle-qualified. It is
quality/debug evidence, not promotion timing.

The 20 image fixtures each completed naturally. Provisional p50/p95 were
18.795/22.442 seconds, split at p50 into 3.438 seconds combined image-encoder
plus prompt prefill and 14.194 seconds decode; peak allocation was 8.887 GB.
All 20 outputs contained a parseable `context_analysis` object, but all 20
wrapped it in a Markdown JSON fence. They therefore fail the raw-JSON product
contract even though the enclosed payload parses. Semantic blinded review is
still pending. This matched product run and the older 19/20 model-selection
result are deliberately reported as separate contracts.

Private ledgers and full machine receipts remain under ignored
`artifacts/runtime-receipts/`. Their checked aggregate bindings are in the
compact Phase 0 receipt.

`tools/runtime/build_image_review.py` generated a 20-case private A/B review
packet with review ID
`892d9ac46bf19f38ed5a55bfd7529601acf470637c857308d07c5ad8b2cd7fe4`.
Its screenshot copies, outputs, and arm key remain ignored under
`artifacts/runtime-reviews/`; no score exists until a reviewer completes and
exports the form. `tools/runtime/score_image_review.py` then validates complete
scores, unblinds against that exact review ID, and computes the matched
non-inferiority result without exposing per-case content.

`tools/runtime/run_idle_gated.py` now enforces the two-sample preflight and
postflight around qualifying benchmark commands. The latest two-sample probe
failed with 67.0% and 75.2% CPU idle, active swap-in deltas, and one active
unrelated ML process; thermal status passed. The gated timing benchmark did not
start. The later 20-row replay was intentionally quality-only and non-gated, so
its provisional timings above were not promoted.

## Phase 1 Packer Input Decision

The exact MLX W6 artifact at revision
`7b781e6489f260b3a24ff38aebb6313b2db516d7` is the immutable initial packer
input and quality reference. Phase 1 must transform its recorded packed tensors
and quantization metadata deterministically into the native package. It must
not silently re-quantize Google BF16 weights. Any separately re-quantized
artifact is a new candidate and reruns every quality gate before it can replace
the reference.

## Physical Host Inventory

| GPU family | Current evidence | Support state |
| --- | --- | --- |
| Apple7 / M1 | `irvine-m1.local`: M1, 8-core GPU, 16 GB, macOS 15.7.9; Metal 3.1 CPU, boundary, package-index, FP16/BF16 reference, and fused W6A16 kernel suite passed 2026-09-22 | Compatibility substrate and W6 kernel execution proven; screenshot product gates remain |
| Apple7 / M1 | `imac-daddy`: historically M1, 8 GB; not freshly reached in this pass | Inventory lead only; not qualified |
| Apple8 / M2 | Local Mac Studio `Mac14,14`: M2 Ultra, 60-core GPU, 64 GB, macOS 26.6.2, Xcode 27.0; Metal 3.1 native suite passed 2026-09-22 | Primary development host; screenshot/W6 product gates remain |
| Apple8 / M2 | `m2-air.local`: MacBook Air `Mac14,15`, M2 with 10-core GPU, 24 GB, macOS 15.7.9, Xcode 26.3, SDK 26.2; Metal 3.1 CPU, boundary, package-index, FP16/BF16 reference, and precompiled fused W6A16 kernel suite passed 2026-09-22 | Runtime compatibility and W6 execution proven; optional Xcode Metal Toolchain install is missing, so local shader compilation remains unqualified |
| Apple9 / M3-M4 | No physical host identified | Unsupported until a host runs every gate |
| Apple10 / M5 | No physical host identified | Unsupported until a host runs every gate |

Compilation, the M2 Splash substrate test, or another family's receipt does not
change these support states.

The former macOS 26.4/Metal 4 floor was a development-scaffold choice, not a
proven Gemma or M1/M2 requirement. Plan 004 now requires a Metal 3 compatibility
library on the available macOS 15.7.9 hosts and treats Metal 4 as an optional,
capability-selected optimization lane.

The compatibility library is compiled as Metal Shading Language 3.1 with a
macOS 15.0 deployment target. The same precompiled library and native binaries
passed on the M2 Ultra development host, the M2 Air, and the M1 host. This proves
the current native substrate and BF16 reference operators, not the unfinished
W6 decoder or end-to-end screenshot product.

The first physical-device W6 tuning pass also shows why this should be one
runtime with family/shape policies rather than separate per-chipset engines.
For single-token matvec, Wide8 beat Narrow4 on every measured M1 and M2 Ultra
shape. On the 10-core M2 Air, Narrow4 changed Q projection from 0.77x to 1.07x
versus dense BF16 and MLP gate from 1.18x to 1.90x, while Wide8 remained better
for MLP down (2.28x versus 2.00x). The checked policy therefore selects Narrow4
only for Apple8 devices with at most 10 reported GPU cores and the measured
2,560-column shapes; missing core counts, Apple7, the 60-core M2 Ultra, and other
shapes fall back to Wide8. Apple9/10 are still unqualified. Full values and the
non-idle development caveat are in
`runtime/tuning/apple7-apple8-w6-development.json`.

Splash's pinned production kernels are a separate case: they import Metal
Performance Primitives `tensor_ops`, and their placement-sparse path is gated on
macOS 26.4. A compile probe against Metal 3.2 rejects those cooperative-tensor
kernels. Plan 004 therefore borrows Splash's specialization strategy and small
device-query substrate, but does not make its Metal 4 kernel implementation a
compatibility dependency.

## Phase 0 and Promotion Boundary

No missing evidence blocks native package, graph, kernel, or ANE implementation
for the screenshot-only Plan 004 scope. The exact stock W6 artifact, screenshot
manifest, private sidecars, screenshot tensor oracle, and provisional stage
timings exist.

Before promotion—not before implementation—complete the blinded screenshot
review, prove the raw-output contract, obtain a passing idle-host window, and
rerun matched cold/warm timing on each advertised physical tuple. A promoted
screenshot SFT package must also be content-addressed and rerun those same
screenshot gates. Audio and rewrite corpora are separate future work and have
no acceptance role here.

## 2026-09-22 Pause Handoff

Plan execution is paused after the Phase 3 kernel-policy boundary. Phase 0 and
Phase 1 are complete. Phase 2 has exact first and second greedy tokens but still
fails its preregistered accumulated hidden/logit bounds. Phase 3 has a no-copy
W6 package view, fused matvec/matmul and embedding-gather kernels, physical
Apple7/Apple8 schedule evidence, and a conservative checked tuning selector.
The next implementation step is to connect these W6 operators and the selector
to the complete decoder graph; do not begin Q8 KV, ANE vision, MTP, or promotion
timing before that integration has a real target-only correctness receipt.

Two large ignored, reproducible Phase 2 tensor caches were removed locally to
recover disk space: `all-hidden.safetensors` and `full-cache.safetensors`. Their
checked receipts and source tooling were not removed; regenerate them before
rerunning accumulated Phase 2 parity.

## Sources

- Exact local model snapshots and file hashes at the revisions above.
- Perfect Dictator redacted receipts:
  `gemma4-precision-runtime-frozen20.json`,
  `gemma4-multiview-frozen20.json`,
  `plan-26/phase-2-inference.json`, and `gemma4-e4b-ane-runtime.json`.
- [E4B Metal/ANE guide](../guides/apple-silicon/gemma4-e4b-metal-inference-engine.md).
