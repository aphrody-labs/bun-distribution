# Gemma 4 E4B Full-Prompt Rank-64 One-Epoch Plan

**Date:** 2026-09-20
**Status:** Complete
**Disposition:** Withdrawn after accidental execution
**Verdict:** WITHDRAWN — NOT DECISION-BEARING
**Progress model:** Phase task checkboxes only

## Executive Summary

> **Withdrawal notice (2026-09-21):** The owner states that this plan was
> executed by accident. Its execution history and artifacts are retained for
> auditability, but its result, metrics, and former KILL verdict are withdrawn
> and must not guide model selection, baselines, future training, or product
> claims. No continuation is authorized.

Run one production-proxy experiment comparing pinned BF16 stock Gemma 4 E4B with rank-64 LoRA checkpoints after approximately half an epoch and exactly one epoch on all 1,246 training rows. All candidates use the same frozen 20 owner-disjoint validation examples, original full system prompts, five-view screenshots, accurate OCR, no thinking, decoding, runtime, and a blinded frozen rubric; this deletes the prior 32-row memorization and 256-row pilot stages.

## Problem Statement

- **Symptom:** The prior rank-64 experiment memorized 32 training rows but did not measure improvement against stock on identical unseen examples.
- **Root Cause:** Its stock reference used a different frozen set and prompt contract, so the grades proved neither regression nor improvement.
- **Impact:** More overfit or subset experiments spend compute without answering whether SFT improves production-like held-out screenshot analysis.

## Mode Definitions

| Mode | Behavior | Why it matters |
| --- | --- | --- |
| Stock | Pinned BF16 E4B with no adapter; full per-row production system prompt, five views, accurate OCR, thinking off. | Exact control for both learned checkpoints. |
| Half epoch | Rank-64 adapter at optimizer step 78, after approximately 624 row exposures with gradient accumulation eight. | Detects early improvement or overtraining. |
| Full epoch | Rank-64 adapter at optimizer step 156, after all 1,246 rows; the final accumulation may contain six rows. | Tests the owner-approved one-epoch candidate. |

## Goals and Non-Goals

### Goals

- Determine whether half-epoch or one-epoch rank-64 LoRA improves held-out semantic quality over matched stock E4B.
- Produce immutable, resumable step-78 and step-156 checkpoints plus private generation and grading ledgers.
- Report Excellent, Excellent-or-VeryGood, NeedsImprovement-or-Fail, paired movements, latency, output length, malformed outputs, and runaways for all candidates.

### Non-Goals

- Do not run another 32-row overfit proof or 256-row pilot; they do not answer the production question.
- Do not train beyond one epoch. Epoch two requires the one-epoch candidate to meet the frozen improvement rule and separate authorization.
- Do not quantize, convert to MLX, or claim M1 deployment quality. This plan isolates BF16 learning quality before deployment conversion.
- Do not open the 61-row sealed test or tune on the 100-row validation tail.

## Scope and Constraints

- **Scope:** Prepare the full-prompt train and validation projection, run one rank-64 LoRA epoch on all 1,246 train rows, generate 60 matched outputs, blind-grade them with Cursor Grok 4.6 medium as primary and Composer 2.5 non-fast as secondary, publish a redacted comparison receipt, and clean up paid compute.
- **Constraints:** Batch size one, gradient accumulation eight, rank 64, alpha 128, LoRA dropout 0.05, constant learning rate `1e-4`, BF16, completion-only assistant/EOS loss, five views, accurate OCR, no thinking, greedy decoding, and an 8,192-token ceiling.
- **Guardrails:** Stock and both checkpoints share exact row IDs, prompt bytes, image bytes/views, OCR, decoding, evaluator prompt, and runtime. Private screenshots, prompts, OCR, targets, and outputs remain ignored and access-controlled.

## Ground Truth Contracts (Do Not Violate)

- **Model identity:** Start from `google/gemma-4-E4B-it` revision `fee6332c1abaafb77f6f9624236c63aa2f1d0187`; no different base or quantized checkpoint enters the comparison.
- **Training corpus:** Use exactly the 1,246 `train` rows from `tt_screenshot_telepathic_v2/gold.jsonl`, SHA-256 `61989be21337925ca8213e89fe72bd07f2bb8e2ff453ab7e99be8073d27f961a`. Cross-check IDs, owners, splits, screenshots, and targets against v3 SHA-256 `890a88ea7124796dcc6f30bc428b0015314ce8c67ac7be51e4d418e6bf9eff35`.
- **Full prompt:** Preserve each v2 row's rendered `system_prompt` and `user_prompt` bytes. Do not substitute the cut-down intent prompt or reconstruct omitted sections.
- **Visual and OCR ABI:** Use the original screenshot plus deterministic top-left, top-right, bottom-left, and bottom-right non-overlapping crops. Preserve the accurate Apple Vision OCR already embedded in each user message.
- **Loss ABI:** Supervise assistant target tokens plus EOS only. Prompt, image, padding, and hidden-thought tokens contribute no loss; input or target truncation fails closed.
- **Checkpoint boundaries:** With 1,246 examples, batch size one, and accumulation eight, seal complete checkpoints at optimizer steps 78 and 156. Step 78 corresponds to approximately 624 row exposures; step 156 is the completed epoch, including the final partial accumulation.
- **Validation identity:** Use the same deterministic first 20 owner-disjoint validation IDs for stock, step 78, and step 156. No candidate sees validation targets during generation.
- **Generation ABI:** BF16 Transformers runtime for all candidates, five views, full prompt, accurate OCR, greedy decoding, thinking disabled, and `max_new_tokens=8192`. Record natural stop, elapsed seconds, prompt tokens, output tokens, and peak GPU memory.
- **Blind evaluation:** Create 60 blinded work items using `Scratchpad/screenshot-JSON-eval-prompt.md` SHA-256 `afb58a57173811636a44aa37b18a445c7790d0b338a291a887ae9887a6416cbb`. Neither Cursor judge sees model, arm, checkpoint, target, competing output, OCR, or the other judge's vote.
- **Improvement rule:** A checkpoint improves only when it has more Excellent-or-VeryGood results than stock, fewer NeedsImprovement-or-Fail results than stock, more paired improvements than regressions, and no increase in Fail count. Mixed evidence is inconclusive and does not authorize epoch two.
- **Cloud identity:** Every GCP operation names project `gist-is-backend` and account `whisper-gcp-sft-runner@gist-is-backend.iam.gserviceaccount.com`. Retry once as `matt@gist.is` only after a recorded permission denial.
- **Evidence durability:** Checkpoints, manifests, configs, generation ledgers, grade ledgers, and receipts are content-hashed and append-only. Upload only complete sealed checkpoints.

## Already Shipped (Do Not Re-Solve)

- **Five-view completion-only trainer:** `gemma_tuner/models/common/collators.py` and `gemma_tuner/models/gemma/finetune.py` already provide five deterministic image views and completion-only loss.
- **Checkpoint durability:** `gemma_tuner/utils/checkpoints.py` and `tools/courier_checkpoint.py` seal and verify resumable immutable checkpoints.
- **Pinned dataset:** `../perfect-dictator/data/datasets/tt_screenshot_telepathic_v2/gold.jsonl` contains the full rendered prompts; v3 preserves the same IDs, owner-disjoint splits, screenshots, and targets.
- **Blind graders:** Cursor CLI model `cursor-grok-4.6-medium` is the primary paired directional judge. Cursor CLI selector `composer-2.5[fast=false]` is the secondary sensitivity judge. The evaluator prompt remains frozen; Terra is forbidden by the owner because its prior calibration was weaker and its marginal cost is unnecessary.
- **Pre-grade amendment (2026-09-20):** The owner replaced Terra/high before any semantic grade was read. Existing mixed-100 evidence showed Grok-medium tracked historical Sonnet materially better than Terra while avoiding Terra's false-Excellent rate. Generation inputs, outputs, candidate ordering, rubric, comparison metrics, and stop rules remain unchanged. Grok decides direction; Composer reports sensitivity. If their paired directions materially disagree, the result is inconclusive and epoch-two eligibility is withheld.
- **Prior failure record:** `005-gemma4-e4b-telepathic-context-sft.md` preserves the rejected overfit experiment and must remain unchanged.

## Fresh Baseline (Current State)

- **Architecture:** Stock E4B and LoRA adapters can use the same BF16 Transformers path with full prompts, five views, OCR, and thinking disabled.
- **Metrics:** Prior full-prompt rank-64 memorization output scored 0 Excellent, 1 VeryGood, 7 Good, 10 NeedsImprovement, and 2 Fail on 20 training examples, but its stock reference was unmatched.
- **Known gaps:** No stock, half-epoch, and one-epoch comparison exists on the same unseen 20 validation rows. Staging supports compact and cut-down prompts but needs a content-bound full-prompt projection.
- **External state:** The prior A100 80 GB instance is terminated. No live trainer exists; starting compute is an implementation action, not part of planning.

## Solution Overview

Create one immutable full-prompt projection, train one adapter once, and compare two checkpoints with stock on the same unseen rows.

```text
pinned BF16 E4B + 1,246 full-prompt rows
                  |
          rank-64 LoRA, one epoch
             /             \
        step 78          step 156
             \             /
       stock + same validation 20
                  |
        60 blinded Grok-medium grades + 60 blinded Composer non-fast grades
                  |
         stop / select / epoch-2 eligibility
```

## Build vs Buy and Dependency Cost

- **Capability checked:** Multiview training, immutable checkpoints, BF16 generation, and blinded Cursor CLI evaluation.
- **Candidates considered:** Existing repo trainer and evaluator only.
- **Decision:** Reuse and minimally extend existing tools.
- **Why:** Required primitives already exist; a new framework adds risk without improving the experiment.
- **Dependency cost note:** No new dependency.

## Implementation Phases

> Do one phase at a time. Verify before proceeding.
>
> Each phase lists **Skills:** an implementer must read before starting.
> Reuse existing skills. Do not create a new skill per phase unless unique
> policy exists that no current skill covers. `execute-plan` and
> `phase-audit` apply to every phase; do not repeat them unless they are the
> only skills that phase needs.

### Phase 0: Freeze the Matched Contract

**Goal:** Make the experiment byte-identical across stock and learned candidates before paid work.

**Skills:** `ilya-sutskever`, `phase-audit`

**Tasks:**

- [x] Add a content-bound full-prompt projection to `tools/prepare_tt_telepathic_sft.py` preserving v2 per-row system/user bytes and verifying v2/v3 identity.
- [x] Add the full-prompt rank-64 one-epoch profile to `tools/package_tt_telepathic_gcp.py` with accumulation eight and save steps 78 and 156.
- [x] Extend `tools/eval_tt_telepathic.py` and `tools/eval_tt_telepathic_hf.py` to accept the full-prompt arm without changing existing modes.
- [x] Add regression tests for prompt provenance, five-view/OCR preservation, completion-only masking, frozen validation order, and checkpoint schedule.
- [x] Record bundle, source, code, model, prompt, evaluator, validation-order, and config hashes in a redacted preregistration receipt.
- [x] Record remaining compute and evaluation budget plus the maximum VM lease before paid work.

**Verification:** Targeted tests and plan validator pass; private bundle contains 1,246 train and 100 validation rows; frozen first-20 IDs match; no test target is staged.

---

### Phase 1: Train and Seal One Epoch

**Goal:** Produce complete, resumable rank-64 checkpoints at half-epoch and one-epoch boundaries.

**Skills:** `elon-musk`, `botnet`, `phase-audit`

**Tasks:**

- [x] Start or recreate one bounded A100 80 GB VM with explicit project and service-account identity; never launch a duplicate trainer.
- [x] Run a one-batch preflight proving finite completion-only loss, finite gradient norm, no truncation, and nonzero vision, projector, and decoder gradients.
- [x] Train rank-64 LoRA for exactly one epoch over all 1,246 rows with batch size one and accumulation eight.
- [x] Seal, hash, and courier checkpoint 78 before training proceeds beyond its durability gate.
- [x] Seal, hash, and courier checkpoint 156 plus final trainer state, redacted metrics, and trainable-parameter receipt.
- [x] Verify finite metrics, row exposure count, data order, checkpoint completeness, GCS ledger, and resumability without restarting.

**Verification:** Exactly one trainer consumed every training row once; checkpoints 78 and 156 verify locally and durably; no non-finite metric, truncation, duplicate trainer, or privacy leak occurred.

---

### Phase 2: Generate and Blind-Grade the Matched 60

**Goal:** Measure held-out semantic movement against an exact stock control.

**Skills:** `ilya-sutskever`, `phase-audit`

**Tasks:**

- [x] Generate stock outputs for the frozen first 20 validation rows under the full matched inference ABI.
- [x] Generate checkpoint-78 outputs for the identical 20 rows under the same runtime and settings.
- [x] Generate checkpoint-156 outputs for the identical 20 rows under the same runtime and settings.
- [x] Verify 60 unique generation records with latency, token counts, output length, malformed status, peak memory, and natural-stop or runaway classification.
- [x] Randomize and blind all 60 work items so neither Cursor judge can infer candidate identity or see targets, competing outputs, OCR, or the other vote.
- [x] Run resumable Cursor Grok 4.6 medium grading and verify exactly 60 unique parseable primary grade records bound to the evaluator hash.
- [x] Run resumable Composer 2.5 non-fast grading and verify exactly 60 unique parseable secondary grade records bound to the same evaluator hash.

**Verification:** Each candidate has one output and grade for every identical ID; no work item contains candidate identity, target, or competing output.

---

### Phase 3: Compare, Decide, and Clean Up

**Goal:** Make the frozen stop/select decision and retain only durable evidence.

**Skills:** `elon-musk`, `ilya-sutskever`, `phase-audit`

**Tasks:**

- [x] Publish a redacted receipt with requested grade, paired, latency, length, malformed-output, runaway, and artifact-hash metrics.
- [x] A KILL result was recorded during the accidental execution; it is now
  historical only and superseded by the withdrawal receipt.
- [x] If checkpoint 78 improves and checkpoint 156 regresses, select checkpoint 78 for diagnosis without training further. Not applicable: checkpoint 78 regressed against stock.
- [x] If quality improves through checkpoint 156, record epoch-two eligibility; do not launch it under this plan. Not applicable: checkpoint 156 improved formatting but regressed semantically.
- [x] Stop and delete paid compute after durable checkpoint and receipt verification; retain only policy-approved artifacts.
- [x] Mark this plan Complete only after comparison and cleanup evidence exist.

**Verification:** Historical hashes verify, no Plan 006 paid VM remains running,
and the withdrawal receipt makes the run non-decision-bearing.

## Executable Memory

- Regression test: `.venv/bin/python -m pytest -q tests/test_package_tt_telepathic_gcp.py tests/test_eval_tt_telepathic.py tests/test_eval_tt_telepathic_hf.py tests/test_tt_telepathic_contract.py tests/test_gemma_image_collator.py`
- Plan validation: `../perfect-dictator/scripts/validate-plan.sh README/plans/006-gemma4-e4b-full-prompt-r64-one-epoch-plan.md`
- Cloud inventory: `gcloud compute instances list --project=gist-is-backend --account=whisper-gcp-sft-runner@gist-is-backend.iam.gserviceaccount.com`
- Not testable: Cursor judge semantic quality is external; prove its contract through blinded work-item hashes, exact counts, model selectors, and aggregate receipts.

## Success Criteria

### Hard Requirements (Must Pass)

- Stock, checkpoint 78, and checkpoint 156 each produce one output for the same 20 frozen owner-disjoint examples under the identical ABI.
- Exactly 60 blinded Grok-medium primary grades and 60 blinded Composer non-fast secondary grades exist with no candidate leakage.
- Both checkpoints are complete, immutable, resumable, and durably uploaded.
- Comparison reports every requested quality, pairing, latency, length, malformed-output, and runaway metric.
- No candidate advances unless it satisfies the frozen improvement rule; this plan never launches epoch two.

### Definition of Done

- Redacted comparison receipt binds all private ledgers and inputs by SHA-256.
- Stop/select/epoch-two-eligible decision is recorded without opening sealed test.
- Relevant regression tests and plan validator pass.
- Paid training infrastructure is stopped and cleaned after durable verification.

## Open Questions

### Resolved

- **Q:** Why not another overfit test or 256-row pilot?
- **A:** They do not measure held-out production movement; delete both and train once on all 1,246 rows.
- **Q:** Which prompt is used?
- **A:** Exact per-row full rendered system and user prompts from immutable v2, not the cut-down intent prompt.
- **Q:** Where is the midpoint with accumulation eight?
- **A:** Optimizer step 78, after approximately 624 row exposures. The completed epoch is step 156 after all 1,246 rows.
- **Q:** Is epoch two authorized?
- **A:** No. Improvement only makes it eligible for separate authorization.

### Unresolved

- **Q:** Does rank-64 LoRA improve E4B on unseen production-like screenshots?
- **Options:** Both checkpoints fail or stay flat; checkpoint 78 peaks early; checkpoint 156 improves through one epoch. This experiment resolves it.

## References

### Internal

- [Prior Gemma 4 E4B telepathic SFT plan](005-gemma4-e4b-telepathic-context-sft.md)
- [Gemma 4 field guide](../guides/apple-silicon/gemma4-guide.md)
- [Withdrawn historical result](../receipts/gemma4-e4b-full-prompt-r64-one-epoch-result.json)
- [Plan 006 withdrawal receipt](../receipts/gemma4-e4b-full-prompt-r64-one-epoch-withdrawal.json)
- `../perfect-dictator/data/datasets/tt_screenshot_telepathic_v2/receipt.json`
- `../perfect-dictator/data/datasets/tt_screenshot_telepathic_v3/receipt.json`
- `../perfect-dictator/Scratchpad/screenshot-JSON-eval-prompt.md`

### External

- [Gemma 4 E4B model card](https://huggingface.co/google/gemma-4-E4B-it)

## Critical Reminder

> SIMPLER IS BETTER. One full-corpus epoch, two checkpoints, one matched stock control, and one frozen 20-row evaluation. Do not reintroduce overfit or pilot stages.
