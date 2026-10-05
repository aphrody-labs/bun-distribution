# Gemma 4 E4B Runtime Acceptance Contract

**Recorded:** 2026-09-21
**Plan:** [Gemma 4 E4B W6 Metal inference engine](../plans/004-gemma4-e4b-metal-inference-engine.md)
**State:** Screenshot-to-text schema and stop rules frozen for implementation;
blinded review and an idle matched benchmark remain promotion gates.

## Rule

A faster engine is rejected if it changes the selected request contract or
falls below the current qualifying quality result. Component speed is
diagnostic only. Promotion uses complete warmed mode latency on the same idle
physical host, plus cold load/compile reported separately.

## Receipt Schema

Every baseline and candidate receipt must bind:

```json
{
  "schema_version": "gemma4-e4b-mode-receipt-v1",
  "mode": "image_to_text",
  "engine": {"name": "...", "revision": "...", "package_sha256": "..."},
  "model": {"id": "...", "revision": "...", "weights_sha256": "..."},
  "contract": {
    "manifest_sha256": "...",
    "prompt_sha256": "...",
    "processor_sha256": "...",
    "generation_sha256": "..."
  },
  "host": {
    "chip": "...",
    "gpu_family": "Apple7 | Apple8 | Apple9 | Apple10",
    "gpu_cores": 0,
    "memory_bytes": 0,
    "macos": "...",
    "xcode": "...",
    "thermal_gate": "pass | fail",
    "idle_gate": "pass | fail"
  },
  "cold": {"load_compile_ms": 0, "first_request_ms": 0},
  "warmed": {
    "warmups": 5,
    "runs": 30,
    "p50_ms": 0,
    "p95_ms": 0,
    "stages_ms": {
      "preprocess": {}, "encoder": {}, "handoff": {}, "prefill": {},
      "first_token": {}, "decode": {}, "postprocess": {}
    },
    "peak_memory_bytes": 0,
    "energy_joules": null
  },
  "quality": {},
  "fallbacks": [],
  "privacy": "hashes and aggregates only"
}
```

The raw receipt remains local when it contains machine paths or per-example
outputs. A checked compact receipt may contain only aggregate metrics and
content hashes.

## Frozen Promotion Gates

| Mode | Quality floor | Latency gate on primary M2 Ultra | Stop condition |
| --- | --- | --- | --- |
| `image_to_text` | On the frozen 20-row Plan 29 product corpus, match or exceed the W6 reference's Good-or-better count without increasing Fail or material omissions under blinded review | warmed p50 at least 1.2x faster than the fastest engine passing that floor; p95 may not regress | Any matched-corpus regression, prompt/view drift, raw-output contract failure, or unblinded review |
The historical thinking-enabled W6 result—19/20 Good-or-better and zero
Fail—selects the target precision. Its raw private work items are not retained
locally and its prompt is not the Plan 29 product prompt, so it is not silently
combined with the replayable 20-row promotion corpus above.

## Runtime and Tensor Gates

- Processor integer tensors and placeholder counts: exact equality.
- BF16/FP16 reference selected states and projected soft tokens: tolerance must
  be declared per tensor before the candidate is read; greedy tokens are exact.
- Complete BF16 teacher-forced layer final states on the 6,210-token screenshot fixture:
  MAE at most 0.03, RMSE at most 0.08, every element within the larger of
  0.75 or three BF16 ULPs of its oracle value, and cosine similarity at least
  0.9999. The elementwise rule preserves the original 0.75 layer-0 floor at
  its worst 33-valued activation while scaling correctly at larger BF16
  exponents. It was calibrated on the first global-attention layer; layer 23 is
  the held-out global-attention check. The reference uses a CPU gather for
  the 5.64 GB per-layer embedding table because PyTorch/MPS wraps its byte
  offsets above row 199,728; all other layer operations remain BF16/MPS.
- Accumulated 42-layer prefill must preserve the same final-hidden aggregate
  bounds. Its capped final logits must have MAE at most 0.05, RMSE at most
  0.15, cosine similarity at least 0.999, and an exact greedy token. These
  bounds were declared before the first accumulated native run. Exact greedy
  agreement alone does not promote a numerically failing reference path.
- W6 target: same frozen task quality; no hot-path W8/FP16 weight materialization.
- Cache: exact logical lengths, owners, eviction, and shared-KV transitions;
  token 511/512/513 and shared region entry are mandatory boundary cases.
- ANE vision: projected 2,560-wide soft tokens pass parity, `MLComputePlan` and
  a physical trace show real ANE participation, and complete image-to-text wins
  after handoff. Placement alone never promotes it.
- MTP: target-only and assisted greedy outputs are identical; enable only when
  combined warmed p50 is at least 1.25x target-only with no p95 regression.

## Timing Protocol

1. Use the exact same content-addressed package and fixture order.
2. Record cold process start, model/package load, Core ML compile/load, and
   first request separately.
3. Before and after the run, require two consecutive five-second samples with
   at least 90% aggregate CPU idle, no unrelated process consuming more than
   one full core, zero swap-in/swap-out delta, no other ML job, and no thermal
   or performance warning. A failed preflight may produce a diagnostic receipt
   but never a promotion number.
4. Require five untimed warmups followed by 30 measured runs per fixture unless
   a preregistered larger sample is used.
5. Reject the run if thermal or idle gates fail; do not remove slow samples.
6. Report p50, p95, peak allocation/RSS, and stage boundaries. A zero handoff
   value is valid only for a same-backend reference where handoff is explicitly
   included in encoder/prefill.
7. Repeat the pinned baseline in the same session. The candidate speedup is
   computed against that qualifying repeat, not an older best-case number.

`tools/runtime/run_idle_gated.py` enforces the preflight and postflight portions
of this protocol around a benchmark command. It writes a private machine
receipt, refuses to start the benchmark after a failed preflight, and returns a
failure after a bad postflight so a noisy run cannot be promoted accidentally.

## Human Review

Reviewers see original screenshots and blinded outputs in randomized order.
They do not see engine, precision, latency, or competing scores. Review grades
description usefulness and material omissions.

For screenshot review, `tools/runtime/build_image_review.py` produces the
private randomized packet and `tools/runtime/score_image_review.py` refuses
incomplete or mismatched exports before unblinding and aggregating results.

## Privacy and Failure Rules

- No screenshot, audio, prompt body, generated text, person identifier, or
  absolute private path enters Git.
- A hash mismatch, missing private sidecar, non-finite timing, fallback, or
  changed generation setting invalidates the run before comparison.
- A fallback is always reported and never counted as native success.
- An unqualified Apple family remains unsupported even if another family
  passes or the same binary compiles there.

Audio transcription and transcript cleanup/rewrite are separate future
workloads. Their corpora, review exports, and performance receipts are not
prerequisites or promotion evidence for this screenshot-to-text runtime.
