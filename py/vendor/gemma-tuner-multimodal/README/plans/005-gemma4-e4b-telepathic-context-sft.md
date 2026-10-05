# Gemma 4 E4B Telepathic Context SFT Plan

**Date:** 2026-09-20
**Status:** Complete
**Progress model:** Phase task checkboxes only

**Final outcome (2026-09-20):** The rank-8 compact and conditioned arms showed
some training and image signal, but their NLL and Markdown-fence diagnostics
did not establish production value. Raw JSON validity was later confirmed to be
the wrong product gate because the downstream consumer accepts the response as
an opaque context blob. The conditioned rank-64 follow-up then trained for 20
epochs / 640 steps. Its first 20 training-row outputs, generated with the full
original system prompt, received 0 Excellent, 1 VeryGood, 7 Good, 10
NeedsImprovement, and 2 Fail grades from the frozen Terra/high evaluator. The
historical stock distribution came from a different frozen 20, so the result
proves neither regression nor improvement. No downstream transcript/editor
impact was measured. The rank-8 retraining attempt, GCP VM, and watcher were
stopped. No adapter was promoted, and no 256-row or corpus-scale training was
run.

**Disposition:** KILL this training program. This plan is complete as a record
of the stopped experiment; it does not authorize further training. Any new
attempt must first define a matched local evaluation using identical examples,
full production prompt, preprocessing, decoding, and runtime, with a metric that
measures downstream transcript/editor value. Raw JSON structure, training loss,
and image-permutation NLL may be diagnostics but cannot serve as product gates.

## Executive Summary

Supervised-fine-tune two matched arms of the pinned Gemma 4 E4B Instruct source
on the 1,407-row TalkTastic telepathic-context corpus. Both receive one global
screenshot, four deterministic quadrant views, accurate Apple Vision OCR, no
thinking trace, and the unchanged `context_analysis` JSON target. The only arm
difference is whether the owner-supplied cut-down intent system prompt is present
or the system role is absent. A deployable candidate must reach at least 70%
Excellent and 90% Excellent-or-VeryGood on both the complete 100-row validation
split and the once-opened 61-row sealed test.

The owner-supplied cut-down intent section from the original full system prompt
is not replaced by a one-line pseudo system message or misrepresented as the full
prompt. It is frozen byte-for-byte for both the conditioned stock control and
the conditioned SFT arm. The compact arm has no system message and one short
user instruction. Training begins from identical BF16 Hugging Face weights,
selects a shared LoRA recipe through bounded learning proofs, checkpoints both
arms by epoch, and quantizes only the quality winner to six-bit MLX after BF16
quality passes.

## Problem Statement

- **Symptom:** Stock E4B is the first local model with credible screenshot-to-JSON
  ability, but the best matched no-thinking, five-view, OCR-assisted frozen-20
  result still contained seven Needs Improvement and one Fail response.
- **Root Cause:** The stock model can read much of the evidence but has not learned
  TalkTastic's narrow `context_analysis` semantics, field selection, inference
  policy, or output style. A long repeated task prompt also adds input cost without
  proving that it can be removed safely.
- **Impact:** Shipping stock leaves an unacceptable bad tail; repeating the failed
  LFM recipe would spend compute on a weaker model. An unbounded Gemma run could
  instead overfit 1,246 synthetic labels, damage stock visual capability, or teach
  formatting without improving grounded semantics.

## Mode Definitions

| Mode | Behavior | Why it matters |
| --- | --- | --- |
| Conditioned stock control | Stock E4B receives exactly the owner-supplied cut-down intent system prompt with `{USER_FULL_NAME}` and `{APPLICATION_NAME}` rendered, plus the v3 user context and OCR. No omitted portion of the original full prompt is reconstructed. | Measures what the explicitly retained intent instructions contribute without pretending this is the deployable ABI or the original full prompt. |
| Compact stock baseline | Stock E4B receives no system role and the exact v3 user message. | Isolates the quality cost of prompt deletion before training. |
| Conditioned BF16 SFT | The pinned BF16 source plus selected LoRA trains with the exact cut-down intent prompt as its system message. | Tests whether keeping explicit task intent improves learned semantic quality. |
| Compact BF16 SFT | The identical BF16 source and LoRA recipe train with no system role and the exact v3 user message. | Tests whether SFT can internalize the omitted intent without losing quality. |
| Six-bit deployment | The winning merged checkpoint is converted to MLX six-bit and run with its matched conditioned or compact ABI. | Tests the best-quality arm on a 16 GB M1 Mac; an actual tie favors compact. |

## Goals and Non-Goals

### Goals

- Prove whether Gemma 4 E4B SFT materially improves screenshot semantics and
  whether the cut-down intent prompt changes that result under otherwise matched
  training.
- Preserve the stock winner's global-plus-four-quadrant visual evidence and
  accurate OCR in both training and inference.
- Select one arm, checkpoint, and deployable precision using blinded semantic
  quality, not training loss, epoch number, or JSON validity alone.
- Produce a resumable, content-addressed training run and an M1-qualified MLX
  artifact only if absolute quality gates pass.

### Non-Goals

- No full-parameter training as the first experiment; 1,246 training examples do
  not justify immediately moving every E4B weight.
- No reasoning-trace generation or thinking-mode SFT. The desired runtime emits
  the final JSON directly.
- No new label generation, target rewriting, or admission re-grading.
- No ANE optimization in this plan. The existing fixed-shape encoder is only about
  8% faster than MLX on base M1 and about 7.6x slower on M2 Ultra; quality comes
  first and the complete five-view runtime stays MLX until a separate measured
  optimization is justified.
- No artificial 400-row evaluation made by drawing model-selection rows from the
  training split. This corpus has exactly 100 validation and 61 sealed test rows.

## Scope and Constraints

- **Scope:** Consume the immutable v3 corpus from `../perfect-dictator`; add exact
  five-view image SFT support and deterministic resume to this trainer; freeze
  matched stock controls; prove learning on 32 examples; run matched conditioned
  and compact 256-row pilots; train both surviving 1,246-row arms for a maximum
  of three epochs; select and quantize on validation; open the sealed test once;
  and qualify the selected artifact on the 16 GB Irvine M1.
- **Constraints:**
  - Base source is `google/gemma-4-E4B-it` at source revision
    `fee6332c1abaafb77f6f9624236c63aa2f1d0187` unless Phase 0 discovers that the
    exact revision is unavailable or incompatible.
  - Deployment reference is `mlx-community/gemma-4-e4b-it-6bit` revision
    `7b781e6489f260b3a24ff38aebb6313b2db516d7`.
  - Dataset authority is v3 SHA-256
    `890a88ea7124796dcc6f30bc428b0015314ce8c67ac7be51e4d418e6bf9eff35`:
    1,246 train, 100 validation, 61 test, 491 owners, zero owner overlap.
  - Every example uses one untouched global screenshot followed by four
    deterministic non-overlapping quadrants and the existing accurate-mode Apple
    Vision OCR block.
  - Every GCP command must name project `gist-is-backend` and account
    `whisper-gcp-sft-runner@gist-is-backend.iam.gserviceaccount.com` explicitly.
    Retry once as `matt@gist.is` only after a recorded permission denial.
  - The historical $500 program ceiling is not silently reset. Before paid work,
    Phase 0 must record remaining authorized budget, current accelerator price,
    an experiment estimate, an idle timeout, and a maximum wall-clock lease.
- **Guardrails:** Private screenshots, OCR, context, names, paths, targets,
  prompts, model outputs, and grade ledgers stay ignored and encrypted or access
  controlled. Git receives only code, aggregate counts, hashes, and redacted
  receipts. Stock remains the active model until every promotion gate passes.

## Ground Truth Contracts (Do Not Violate)

- **Matched arm ABIs:** The compact arm has no system role and no
  library-default system text. Its user message begins with exactly `Use the
  screenshot, context, and OCR. Return valid JSON with exactly one top-level key:
  context_analysis.` followed by canonical `<context>` and
  `<first_pass_screenshot_ocr>` blocks. The conditioned arm adds only the frozen
  cut-down intent system prompt; its images, user bytes, targets, initialization,
  row order, optimizer, horizon, decoding, and evaluator are otherwise identical.
- **Conditioned control identity:** The owner-supplied cut-down intent section is
  exactly
  `../perfect-dictator/data/datasets/tt_screenshot_telepathic_v3/intent_system_prompt.txt`,
  SHA-256 `45f3cf423cbe28c55865496ed63a7bf019d0dbac6bb418ad44a0cff2ec610ed3`.
  Render both placeholders per row and fail if either remains unresolved. Do not
  append, infer, or reconstruct any omitted part of the original full prompt.
- **Visual ABI:** View order is global, top-left, top-right, bottom-left,
  bottom-right. Quadrants are deterministic, non-overlapping, and cover every
  source pixel exactly once apart from unavoidable integer boundary assignment.
  Training, Transformers generation, MLX generation, and M1 inference use the
  same order and processor image-token policy.
- **OCR ABI:** Use only the v3 accurate Apple Vision OCR already bound to the
  screenshot hash. Do not rerun, summarize, reorder, truncate, or omit spans.
- **Target ABI:** The assistant response is the unchanged `target_json`, which
  has exactly one top-level `context_analysis` key. Supervise assistant tokens
  plus EOS only; image, system, user, delimiter, padding, and any hidden-thought
  tokens contribute no loss. Any input or target truncation fails closed.
- **No-thinking ABI:** Training contains no reasoning trace and promoted
  inference runs with native thinking disabled. A thinking result may be kept as
  historical context but cannot select the production checkpoint.
- **Split integrity:** Owner-disjoint v3 assignments are immutable. Validation
  selects prompt, recipe, checkpoint, and quantization. Test stays sealed until
  all of those choices and thresholds are frozen, then opens once.
- **Evaluation authority:** Independent GPT-5.6 Terra agents at high reasoning
  use the exact frozen `Scratchpad/screenshot-JSON-eval-prompt.md` contract and
  see neither model identity, arm, checkpoint, target, nor competing output.
  Allowed grades are Excellent, VeryGood, Good, NeedsImprovement, or
  `Fail - <brief reason>`.
- **Ratcheting:** Every arm uses one deterministic validation order. Grade the
  cumulative first 20 only; expand at most the two strongest final contenders to
  all 100. Reuse prior grades and never rerate to seek a favorable outcome.
- **Absolute success:** Complete validation and sealed test must each reach at
  least 70% Excellent and 90% Excellent-or-VeryGood. Raw-valid JSON, loss,
  hallucinated-leaf rate, exact fields, and Good-or-better are diagnostics, not
  substitutes.
- **Checkpoint and resume:** Sample order, optimizer, scheduler, RNG, LoRA,
  processor, and trainer state are atomic and restorable. A courier uploads only
  complete immutable checkpoints and an append-only ledger; resumption must
  reproduce an uninterrupted smoke within declared numerical tolerance.
- **Epoch schedule:** The 256-row pilots run exactly two epochs with immutable
  epoch-1 and epoch-2 checkpoints. A surviving full arm runs at most three epochs
  with checkpoints at 0.5, 1, 2, and 3 epochs. The last epoch never wins by
  default. One epoch-4 extension is allowed only for the single leading arm when
  epoch 3 is its best checkpoint, the paired first-20 semantic result is still
  improving without a new Fail, and the frozen budget covers the extension.
- **Precision separation:** Select the BF16 checkpoint first. Quantization is a
  later validation intervention and may not hide a failed BF16 candidate.
- **Evidence:** Every source snapshot, config, prompt, dataset, view fixture,
  checkpoint, generation ledger, grade ledger, conversion, and device receipt is
  SHA-256-bound and immutable.

## Already Shipped (Do Not Re-Solve)

- **No-system v3 corpus:** `../perfect-dictator/data/datasets/tt_screenshot_telepathic_v3/`
  deterministically derives the 1,407 accepted v2 rows, omits `system_prompt`,
  repairs two malformed embedded context objects, retains OCR and targets, and
  emits a redacted receipt.
- **Conditioned intent prompt:** The owner-supplied cut-down intent section is
  tracked beside v3 and content-hashed independently of private rendered rows.
  It is intentionally incomplete relative to the original full system prompt.
- **Gemma 4 image SFT:** `gemma_tuner/models/gemma/finetune.py` and
  `DataCollatorGemmaImage` already provide completion-only image VQA LoRA,
  family-aware loading, RGB normalization, image-token-budget persistence, and
  prompt masking for one image per sample.
- **Model export:** `gemma_tuner/scripts/export.py` already merges LoRA into a
  Hugging Face/SafeTensors tree and preserves processor metadata.
- **Local E4B runtime:** The existing private MLX runner supports E4B six-bit,
  multiple images, thinking disabled, greedy decoding, latency, and peak-memory
  receipts.
- **Terra grader:** `../lfm2-vl-ane/training/grade_terra_ratcheted.py` already
  provides isolated, blinded, append-only Terra/high grading and resume.

## Fresh Baseline (Current State)

- **Dataset:** v3 has 1,407 rows from one label model
  (`claude-3-5-sonnet-20241022`), split 1,246/100/61 over 491 owners with no
  owner leakage. It carries a mean 64.52 OCR spans inherited from v2; 11 images
  have zero spans.
- **Best relevant stock signal:** On the earlier frozen 20, E4B six-bit with
  five views, accurate OCR, no thinking, and greedy decoding scored 7 Excellent,
  3 VeryGood, 2 Good, 7 NeedsImprovement, and 1 Fail. It used 8.888 GB peak MLX
  allocation and measured 6.725 seconds p50 / 18.141 seconds p95 end-to-end.
  This is directional because it is not the v3 validation subset or compact ABI.
- **Higher-ceiling historical signal:** E4B six-bit with five views and thinking
  but no OCR reached 19/20 Good-or-better, confirming that the model family can
  use high-resolution evidence; it does not satisfy the no-thinking product ABI.
- **Trainer gap:** Image SFT accepts exactly one image per row, has no explicit
  global-plus-quadrants policy, does not expose deterministic checkpoint resume,
  and has not trained Gemma 4 E4B on this long-output private corpus.
- **Scientific uncertainty:** 1,246 synthetic Excellent labels may be enough to
  internalize a narrow contract, or may merely teach Sonnet's style. No matched
  compact stock, conditioned stock, or E4B SFT result exists on v3 validation.

## Solution Overview

Preserve the interventions that already helped—E4B capacity, five visual views,
and accurate OCR—while teaching only the missing task contract. Spend semantic
evaluation only after the training and resume path proves itself.

```text
immutable v3 rows (one screenshot + OCR + final JSON)
                         |
              deterministic five-view collator
                         |
        +----------------+----------------+
        |                                 |
conditioned stock control          compact stock baseline
        |                                 |
        +---------------+-----------------+
                        |
             shared 32-row overfit proof
                        |
          +-------------+-------------+
          |                           |
 conditioned 256-row pilot     compact 256-row pilot
          |                           |
          +----- Terra/high first 20--+
                        |
          KILL or matched surviving full arms
                        |
          0.5 / 1 / 2 / 3 epoch checkpoints
                        |
       strongest one or two -> 100 validation
                        |
           winner -> merge -> six-bit gate
                        |
             sealed 61 test -> M1 gate
```

## Build vs Buy and Dependency Cost

- **Capability checked:** Gemma 4 multimodal LoRA, multi-image preprocessing,
  deterministic resume, MLX conversion, and blinded semantic evaluation.
- **Candidates considered:** Existing `gemma-tuner-multimodal`; the proven MLX
  E4B runner; the Plan 25 Terra dispatcher; a new TRL/Unsloth/Axolotl pipeline.
- **Decision:** Extend this trainer with the smallest multi-view and resume
  seams, then reuse the existing MLX and Terra tools. Do not introduce a second
  training framework.
- **Why:** This repo already loads the exact Gemma 4 multimodal architecture,
  applies LoRA, masks prompts, exports merged weights, and has image-collator
  tests. The missing behavior is bounded and testable.
- **Dependency cost note:** No new Python dependency is expected. Paid costs are
  accelerator time, durable checkpoint storage, and cumulative 20 then 100
  Terra/high evaluations; all require a Phase 0 estimate under the remaining
  owner-approved ceiling.

## Implementation Phases

> Do one phase at a time. Verify before proceeding.
>
> Each phase lists **Skills:** an implementer must read before starting.

### Phase 0: Freeze the Cross-Repository Experiment

**Goal:** Bind exact model, dataset, messages, views, evaluation order, storage,
budget, and stop rules before any new model output is read.

**Skills:** `ilya-sutskever`, `build-vs-buy`

**Tasks:**

- [x] Add a private dataset profile and staging manifest that consumes v3 SHA
  `890a88ea…`, maps `user_prompt` to the VQA prompt and `target_json` to the
  assistant answer, and preserves inherited split and owner IDs.
- [x] Freeze the BF16 source revision, license, processor/tokenizer/config files,
  every weight shard hash, LoRA target policy, and intended trainable parameter
  count by subsystem.
- [x] Freeze exact compact and conditioned message renderings, prove the compact
  rendering has no system role/default text, and prove the conditioned rendering
  resolves both placeholders without altering the frozen cut-down intent prompt
  or adding omitted full-prompt material.
- [x] Freeze the paired-arm contract: identical base weights, LoRA targets/rank,
  optimizer, learning rate, row order, seeds, views, OCR, targets, batch geometry,
  checkpoint steps, decoding, and evaluator; only system-prompt presence differs.
- [x] Freeze the global-plus-four-quadrant algorithm, view order, interpolation,
  image-token budget, RGB conversion, and largest input/target bounds.
- [x] Freeze a deterministic validation ordering and its cumulative first 20;
  bind the exact Terra/high evaluator prompt and parser.
- [x] Freeze the epoch schedule: two pilot epochs; full checkpoints at 0.5, 1,
  2, and 3 epochs; and the single-arm conditional epoch-4 extension rule.
- [x] Record the remaining authorized budget, current GCP accelerator availability
  and price, expected and maximum cost by phase, idle shutdown, maximum lease,
  checkpoint bucket/prefix, retention period, and cleanup owner.
- [x] Emit one redacted Phase 0 receipt containing only counts, configurations,
  identities, hashes, estimates, and the preregistered advance/KILL rules.

**Verification:** The complete experiment can be reconstructed from public code
and private content-addressed inputs; paid execution is impossible without the
frozen budget and identity receipt.

---

### Phase 1: Add Exact Five-View Training and Resume

**Goal:** Make training consume the same visual and message ABI as deployment,
with no silent truncation and no restart-from-scratch failure mode.

**Skills:** `ilya-sutskever`

**Tasks:**

- [x] Add a validated `image_view_policy` profile field whose only new value is
  `global_plus_four_nonoverlapping_quadrants`; preserve current one-image behavior
  as the default.
- [x] Extend `DataCollatorGemmaImage` to create the five deterministic RGB views
  from one source image and pass them as one ordered image list per example.
- [x] Add fixture tests for odd dimensions, one-pixel edges, orientation, exact
  quadrant coverage, view order, processor image count, and batching.
- [x] Add message-ABI tests proving exact conditioned intent bytes versus no
  system content, exact shared user bytes, all five images, complete OCR,
  complete target, assistant-only loss, and EOS.
- [x] Fail closed when any prompt, OCR block, image view, or assistant target is
  truncated, when a v3 row contains a `system_prompt` field, or when the
  conditioned arm's separately injected intent prompt differs from its hash.
- [x] Add explicit resume-from-checkpoint configuration and restore model, LoRA,
  optimizer, scheduler, scaler, sampler/order, RNG, epoch, and step state.
- [x] Adapt the proven immutable checkpoint courier pattern from
  `../lfm2-vl-ane/training/` so only complete checkpoints upload and an
  append-only content-hash ledger controls resume.
- [x] Prove interrupted/resumed and uninterrupted tiny runs produce the same row
  order and numerically equivalent adapter weights and metrics.

**Verification:** Unit/integration tests prove exact five-view collation,
completion-only masking, fail-closed bounds, atomic checkpoint closure, and
deterministic resume.

---

### Phase 2: Establish Matched Stock Baselines and Prove Learning

**Goal:** Measure prompt deletion on v3 and prove the selected LoRA can learn the
task before any corpus-scale run.

**Skills:** `ilya-sutskever`

**Tasks:**

- [x] Run the conditioned and compact stock controls on the same frozen first 20
  validation rows with identical five views, OCR, no thinking, greedy decoding,
  and output ceiling; grade both with blinded Terra/high.
- [x] Run the largest-fixture BF16 forward/backward smoke and require finite loss,
  finite gradient norm, no truncation, bounded memory, and nonzero gradients in
  every intended LoRA subsystem.
- [x] Overfit the same 32 training rows under both prompt arms using a bounded
  rank/learning-rate matrix selected in Phase 0; require at least 90%
  assistant-loss reduction, 31/32 raw-valid JSON, direct evidence of image
  dependence, and exact resume equivalence. Before reading adapter outputs,
  direct image dependence is frozen as correct-image target NLL beating a
  cyclically permuted-image target NLL on at least 22/32 paired rows (one-sided
  exact sign-test p <= 0.0251) with a positive mean permuted-minus-correct NLL;
  OCR remains unchanged, so this measures visual contribution beyond OCR.
  **KILL:** both arms reached finite 160-step training, but the cumulative
  two-row ratchet was already 0/2 raw-valid and only 41.6% / 54.2% loss
  reduction, so neither arm could satisfy the frozen gate.
- [x] Resolve the lowest-complexity LoRA recipe gate; no recipe was selected
  because rank 8 / `1e-4` failed before any larger rank was scientifically
  justified. Record
  trainable parameters by vision, projector, decoder, and output head rather than
  referring to it ambiguously as frozen or full vision tuning. The failed shared
  recipe trained 2,260,992 vision, 26,624 projector, 18,350,080 decoder, and zero
  output-head parameters (20,637,696 total).
- [ ] Generate both selected 32-row checkpoints on held-out validation only as a
  plumbing smoke; do not claim generalization from the overfit experiment.
  **Canceled:** there was no selected checkpoint after the KILL.
- [x] Stop if the model ignores images/OCR, intended parameters receive no
  gradients, outputs truncate, resume diverges, or memory/cost exceeds the frozen
  envelope. The actual stop boundary was stronger: two raw-invalid outputs per
  arm made the raw-valid gate impossible and whole-target loss reduction was far
  below threshold. No pilot or full training was launched.
- [ ] Run the owner-authorized conditioned rank-64 follow-up on the same 32 rows
  for 20 epochs at constant `1e-4`; preserve step-160, step-320, and step-640
  checkpoints and compare all 32 rows without changing data, targets, views,
  OCR, or prompt bytes.
- [ ] Record strict raw-valid JSON and fence-normalized JSON only as historical
  diagnostics. Neither may stop or promote the model because downstream consumes
  the response as an opaque context blob; semantic Terra/high grades govern.

**Verification:** Matched stock controls are frozen, the selected adapter has a
measured learning path through the intended multimodal subsystems, and the run is
safe to scale to 256 examples.

---

### Phase 3: Run Paired Pilots and Conditional Full SFTs

**Canceled by the Phase 2 KILL. No task in this phase was run.**

**Goal:** Determine whether SFT works and whether the cut-down intent prompt
matters, then preserve only arms and epochs that improve held-out semantics.

**Skills:** `ilya-sutskever`, `botnet`

**Tasks:**

- [ ] Train conditioned and compact arms from identical BF16 initialization on
  the same deterministic 256-row owner-diverse subset for exactly two epochs,
  saving immutable epoch-1 and epoch-2 checkpoints and redacted metric ledgers.
- [ ] Generate all four pilot checkpoints on the frozen first 20 validation rows
  and grade them blind with Terra/high using the same ordering as both stock
  controls.
- [ ] Advance an arm only if its best pilot checkpoint reaches at least 40%
  Excellent, 70% Excellent-or-VeryGood, no more than one Fail, at least 99%
  raw-valid JSON, and a clear paired improvement over its matched stock baseline.
  If neither arm passes, record KILL and cancel all later training and grading.
- [ ] Compare the two pilot arms pairwise. Prompt presence is causal evidence only
  because every other frozen input and training variable is identical; report
  improved/same/worse counts and the grade distribution, not only mean loss.
- [ ] Train every surviving arm on all 1,246 training rows for at most three
  epochs, saving immutable 0.5-, 1-, 2-, and 3-epoch checkpoints with finite
  metric monitoring, exact resume, idle shutdown, max-duration enforcement, and
  the frozen cost cap.
- [ ] Generate the same first 20 validation rows at every full checkpoint; use
  the preregistered paired Terra/high rule to eliminate regressing arms and
  epochs rather than assuming the final epoch is best.
- [ ] Allow one epoch-4 extension for the single leader only when epoch 3 is that
  arm's best semantic checkpoint, improves the paired first-20 result without a
  new Fail, shows no structural or validation-loss regression, and remains under
  the frozen budget. Otherwise stop at epoch 3.
- [ ] Stop on non-finite loss/gradient, missing trainer or courier, incomplete
  durable checkpoint, repeated semantic regression, disk pressure, deadline risk,
  privacy-boundary violation, or spend ceiling.

**Verification:** At least one immutable BF16 checkpoint survives the 20-row
gate by a large margin and the conditioned-versus-compact result is measured, or
the experiment ends with a content-bound negative result before unnecessary
full-validation and deployment work.

---

### Phase 4: Select Precision, Open Test Once, and Qualify M1

**Canceled by the Phase 2 KILL. Validation was not expanded, the sealed test
remained sealed, and no deployment artifact was produced.**

**Goal:** Confirm full validation quality, freeze a deployable artifact, then
measure sealed generalization and physical-device behavior once.

**Skills:** `ilya-sutskever`, `botnet`

**Tasks:**

- [ ] Expand at most the two strongest BF16 arm/checkpoint contenders from 20 to
  all 100 validation rows and require at least 70 Excellent, at least 90
  Excellent-or-VeryGood, at most one Fail, at least 99% raw-valid JSON, and
  bounded hallucinated-leaf error.
- [ ] Select one arm/checkpoint by the frozen semantic ordering. If conditioned
  and compact are within two Excellent rows, have the same Excellent-or-VeryGood
  count, and introduce no different Fail, select compact; otherwise select the
  higher-quality arm even if it retains the cut-down intent prompt.
- [ ] Merge the winning LoRA into the pinned BF16 source and verify generation
  equivalence before conversion.
- [ ] Convert the merged checkpoint to MLX six-bit with pinned conversion code;
  generate the identical 100 validation rows and reject quantization if it loses
  more than two Excellent rows, introduces a Fail, changes the message/image ABI,
  or breaks JSON validity.
- [ ] Freeze checkpoint, winning prompt ABI, view policy, OCR policy, decoding,
  quantization, evaluator, and thresholds; only then open all 61 sealed test rows
  once.
- [ ] Require sealed test to reach at least 43/61 Excellent and 55/61
  Excellent-or-VeryGood, with no more than one Fail and at least 60/61 raw-valid
  JSON outputs.
- [ ] Run the exact selected six-bit artifact on `mattmireles@irvine-m1.local`;
  report warmed p50/p95 latency, peak memory, swap, thermal/load state, natural
  stops, and output equivalence without imposing a new latency KILL after quality
  succeeds.
- [x] Publish a redacted promotion or rejection receipt. The Phase 2 KILL receipt
  is `README/receipts/gemma4-e4b-telepathic-phase2-overfit-kill.json`; no
  promotion manifest was created and the pinned stock artifact was untouched.

**Verification:** One six-bit checkpoint with its matched prompt ABI passes
complete validation, once-opened sealed test, and reproducible 16 GB M1
execution, or stock remains active with the failing boundary identified.

---

### Phase 5: Validation and Cleanup

**Goal:** Leave durable evidence, no paid stragglers, and no unnecessary private
or regenerable artifacts.

**Skills:** `write-notes`

**Tasks:**

- [x] Run the focused dataset, configuration, collator, masking, resume, courier,
  generation, evaluation, export, and integrity test suites plus this plan's
  validator.
- [x] Update both repositories' consolidated notes with stock controls, pilot,
  exact ratchet stops, selected recipe/checkpoint, quantization delta, sealed
  result, M1 measurements, and rejected hypotheses. For this KILL, pilot,
  quantization, sealed-test, and M1 fields are explicitly recorded as not run.
- [x] Verify every retained checkpoint, grade ledger, conversion, and receipt is
  durable and hash-bound before removing transient VM disks, copied private data,
  credentials, caches, non-selected checkpoints, and downloaded duplicate weights.
  No failed checkpoint was retained; the redacted receipt was validated before
  all three exact experiment VMs and their auto-delete disks were removed.
- [x] Stop all GCP compute, couriers, evaluators, and watchers; remove any monitor
  only after durable completion or KILL is verified. No matching GCP instance
  remains.

**Verification:** Tests and plan validation pass, paid processes are stopped,
private transient data is removed, and the plan is `Complete` with either a
qualified artifact or an explicit KILL.

## Executable Memory

- Regression test: `cd ../perfect-dictator && python3 data/datasets/tt_screenshot_telepathic_v3/test_build.py`
- Regression test: `cd ../perfect-dictator && python3 data/datasets/tt_screenshot_telepathic_v3/build.py`
- Regression test: `pytest -q tests/test_gemma_image_collator.py tests/test_finetune_peft_targets.py tests/test_generation_prompts.py`
- Regression test: `../perfect-dictator/scripts/validate-plan.sh README/plans/005-gemma4-e4b-telepathic-context-sft.md`
- Not testable: Screenshot semantic correctness requires blinded Terra/high
  judgments, and warmed M1 latency/memory requires physical-device measurement.
  Preserve hashes and redacted receipts for both.

## Success Criteria

### Hard Requirements (Must Pass)

- Dataset, model, prompts, five-view preprocessing, loss mask, sample order,
  checkpoints, evaluator, and conversion are immutable and reproducible.
- At least one conditioned or compact pilot reaches 40% Excellent and 70%
  Excellent-or-VeryGood on the frozen first 20 before a full run is authorized;
  both arms use the same two-epoch pilot schedule.
- Complete validation reaches at least 70% Excellent and 90%
  Excellent-or-VeryGood; sealed test reaches at least 43/61 Excellent and 55/61
  Excellent-or-VeryGood.
- Selected BF16 and six-bit outputs are at least 99% raw-valid JSON, and six-bit
  loses no more than two Excellent validation rows or introduces no Fail.
- Neither arm contains a default or reconstructed system message or a thinking
  trace. The conditioned arm contains exactly the frozen cut-down intent prompt;
  the compact arm contains no system role.
- Full training stops at the best measured checkpoint among 0.5, 1, 2, and 3
  epochs. Epoch 4 is run only under the frozen single-leader improvement rule.
- Exact interruption/resume is proven before scale; every promoted checkpoint and
  grade ledger is durably uploaded and content-hashed.
- Total new spend remains within the freshly recorded remaining owner-approved
  ceiling, with compute stopping at every KILL, completion, idle timeout, or
  maximum duration.
- The selected six-bit artifact runs on a 16 GB M1 without OOM or sustained swap
  pressure; latency is reported honestly even if slower than the former target.

### Definition of Done

- One Gemma 4 E4B six-bit checkpoint with its matched conditioned or compact ABI
  passes validation, sealed test, and Irvine M1 qualification, or the smallest
  decisive experiment records KILL.
- Stock remains one manifest selection away and is never overwritten.
- Both repositories contain tests, redacted receipts, and consolidated notes;
  neither contains private rows, screenshots, OCR, outputs, or credentials.
- Relevant tests and the canonical plan validator pass.

## Open Questions

### Resolved

- **Q:** Where does this plan live?
- **A:** In `gemma-tuner-multimodal`, which owns training. `perfect-dictator`
  owns only the immutable v3 export and its provenance.
- **Q:** Is the one-line compact instruction a replacement system prompt?
- **A:** No. The compact arm has no system role. The owner-supplied cut-down
  intent section is the only conditioned system prompt and is preserved exactly
  in both conditioned stock and SFT arms; it is not the original full prompt.
- **Q:** How many epochs are trained?
- **A:** Both 256-row pilots train for exactly two epochs. Every surviving full
  arm trains for at most three epochs with checkpoints at 0.5, 1, 2, and 3.
  Only the single leading arm may receive epoch 4, and only when epoch 3 is its
  best still-improving semantic checkpoint under the frozen extension rule.
- **Q:** Are both prompt arms eligible for deployment?
- **A:** Yes. Quality selects the winner. A near-tie favors compact because it is
  simpler and cheaper; a material conditioned win keeps the cut-down intent
  prompt at runtime.
- **Q:** Are reasoning traces required?
- **A:** No. The desired model directly predicts the accepted final JSON, and
  completion-only SFT masks every input token.
- **Q:** Should six-bit weights be trained directly?
- **A:** No. Train and select from the pinned BF16 source; quantize only after
  semantic validation.
- **Q:** Should the earlier 20-to-100-to-400 ladder be reused?
- **A:** Only 20-to-100 on validation. This dataset has 100 validation and 61
  sealed test rows; drawing 400 from train would corrupt model selection.

### Unresolved

- **Q:** Which LoRA rank, learning rate, and subsystem target set should run at
  scale?
- **Options:** Freeze a small bounded matrix in Phase 0, use the 32-row overfit
  and largest-fixture gradient/memory proof to select the lowest-complexity
  passing shared recipe, then spend semantic grades on the two matched 256-row
  prompt arms.
- **Q:** What new paid budget remains after the prior LFM and evaluation work?
- **A:** $500.
- **Q:** Will the source Transformers processor reproduce the existing MLX
  five-view tokenization exactly enough for training/serve equivalence?
- **Options:** Prove tensor/view/message parity on fixtures before training; if
  processor semantics differ, freeze one explicit cross-runtime equivalence
  contract rather than declaring byte-level tensor identity.

## References

### Internal

- [`perfect-dictator` v3 builder](../../../perfect-dictator/data/datasets/tt_screenshot_telepathic_v3/build.py)
- [`perfect-dictator` v3 receipt](../../../perfect-dictator/data/datasets/tt_screenshot_telepathic_v3/receipt.json)
- [Image fine-tuning plan](./003-image-finetuning.md)
- [Gemma 4 upgrade plan](./002-gemma4-upgrade.md)
- [Gemma 4 E4B Metal inference engine](./004-gemma4-e4b-metal-inference-engine.md)
- [`perfect-dictator` screenshot dataset notes](../../../perfect-dictator/README/notes/screenshot-json-dataset.md)

### External

- `google/gemma-4-E4B-it` at source revision
  `fee6332c1abaafb77f6f9624236c63aa2f1d0187`
- `mlx-community/gemma-4-e4b-it-6bit` at revision
  `7b781e6489f260b3a24ff38aebb6313b2db516d7`

## Modules

### Data Model and Schema Changes

The v3 source row remains owned by `perfect-dictator`. This trainer consumes a
private staged projection with no duplicated authority:

```text
id                 stable private row identity
owner_id           split-integrity verification only
split              train | validation | test
image_path         source screenshot path
prompt             exact v3 compact user message
response           unchanged target_json
image_view_policy  global_plus_four_nonoverlapping_quadrants
```

`system_prompt` is forbidden in the compact projection. The conditioned stock
control renders its system message at evaluation time from the separately hashed
cut-down intent template; it never adds omitted full-prompt text or writes that
message into compact training rows.

### Performance and Latency Budget

| Operation | Required boundary | Current evidence |
| --- | ---: | ---: |
| E4B six-bit peak MLX allocation on 16 GB M1 | No OOM; no sustained swap pressure | 8.888 GB on M2 Ultra frozen-20 run; M1 full-model measurement pending |
| Five-view + OCR + no-thinking completion | Report warmed p50/p95; quality takes precedence | 6.725 s p50 / 18.141 s p95 on M2 Ultra frozen-20 run |
| Training checkpoint durability | Complete checkpoint uploaded before local deletion or lease rollover | Missing in this trainer |
| Semantic evaluation | Stop at 20 unless candidate passes continuation gate | Prior ratchet tooling exists |

Latency is not relaxed into meaninglessness: it must be measured and reported.
However, this experiment deliberately prioritizes an excellent model that fits in
16 GB over a fast model that produces incorrect context.

### Error Handling and Edge Cases

| Scenario | Behavior | Fallback |
| --- | --- | --- |
| Missing/changed v3 hash | Refuse staging or training | Rebuild v3 deliberately and amend the plan with a new hash |
| System content appears in compact row | Fail before collation | Fix the projection; never strip silently in the trainer |
| OCR/view/target truncation | Fail the batch and record offending aggregate bounds without private content | Reduce batch size or raise sequence capacity; do not truncate evidence |
| Odd screenshot dimensions | Deterministic full pixel coverage across four quadrants | Fixture-tested integer boundary assignment |
| Zero OCR spans | Preserve the empty accurate OCR block and all five views | No synthetic OCR text |
| Non-finite training metric | Stop trainer and preserve last complete checkpoint | Diagnose before any resume |
| Incomplete checkpoint upload | Ledger remains uncommitted and checkpoint is ineligible | Retry same immutable archive |
| Terra error | Preserve error separately; do not coerce a grade | Retry the same work item without exposing other arms |

### Degradation and Rollback

**Degradation Modes:**

- **Compact stock collapses versus conditioned stock:** Continue only through the
  preregistered SFT pilot; its purpose is to internalize the omitted contract.
- **Pilot misses its 20-row gate:** KILL without full training or additional
  grading.
- **BF16 passes but six-bit regresses:** Keep the research checkpoint, reject the
  16 GB deployment artifact, and test no new precision without a plan amendment.
- **Sealed test fails:** Reject promotion; validation success becomes research
  evidence only.
- **Quality passes but M1 is slow:** Record quality-pass/performance-result; do
  not lower resolution, drop OCR, or weaken quality thresholds post hoc.

**Rollback Plan:**

- **How to revert:** Select the pinned stock E4B six-bit manifest and compact or
  conditioned stock prompt policy. SFT never overwrites stock weights.
- **Time to rollback:** One manifest selection and process restart.
- **Data recovery needed:** No. Source v3, checkpoints, and receipts remain
  immutable; transient training copies can be regenerated.

### Files Likely to Change

| File | Change Type | Purpose |
| --- | --- | --- |
| `gemma_tuner/core/config.py` | Modify | Validate `image_view_policy` and resume settings |
| `gemma_tuner/core/profile_config.py` | Modify | Carry the new profile fields |
| `gemma_tuner/models/common/collators.py` | Modify | Deterministic five-view image collation and fail-closed bounds |
| `gemma_tuner/models/gemma/finetune.py` | Modify | Resume, exact trainable subsystem receipt, and compact ABI checks |
| `gemma_tuner/scripts/export.py` | Modify | Preserve view policy and verify merged checkpoint identity |
| `gemma_tuner/core/finalization.py` | Modify | Complete-checkpoint closure and immutable receipt hooks |
| `tools/prepare_tt_telepathic_sft.py` | Add | Private v3 projection and redacted staging receipt |
| `tools/courier_checkpoint.py` | Add or adapt | Immutable GCS checkpoint upload and ledger |
| `tools/eval_tt_telepathic.py` | Add | Matched conditioned/compact generation and blinded work items |
| `tests/test_gemma_image_collator.py` | Modify | Five-view order, coverage, masking, batching, and truncation guards |
| `tests/test_finetune_resume.py` | Add | Interrupted/uninterrupted equivalence |
| `tests/test_tt_telepathic_contract.py` | Add | v3 hash, no-system ABI, prompt rendering, and sealed split guards |

### Risks and Mitigations

- **Small synthetic corpus teaches style, not truth:** Require paired semantic
  gains, image dependence, absolute validation/test thresholds, and hallucination
  diagnostics.
- **Five views multiply training memory:** Batch size one, gradient accumulation,
  gradient checkpointing, largest-fixture smoke, and a LoRA-only first run.
- **LoRA target names accidentally span or omit the vision tower:** Receipt
  trainable parameters and gradients by subsystem; never infer from suffix names.
- **Prompt deletion hides target-defining information:** Conditioned and compact
  stock controls quantify the gap; the pilot must recover it.
- **Long OCR overwhelms attention:** Preserve it because it raised the stock
  Excellent ceiling, but stratify validation by OCR length and report failure
  rates rather than truncating.
- **Quantization erases the gain:** Select BF16 first and apply a strict matched
  validation delta gate.
- **Resume claims are false:** Interrupt a real smoke, resume from the durable
  artifact, and compare against uninterrupted execution before scale.
- **Evaluator cost expands automatically:** Cumulative 20 then 100 only; obvious
  failures stop immediately.
- **Private data leaks through logs:** Redact prompts, paths, targets, names, OCR,
  outputs, and exception payloads; receipts carry hashes and aggregates only.

## Critical Reminder

> SIMPLER IS BETTER. Preserve the proven model, five views, OCR, and final JSON.
> Add only the missing multi-view training and resume seams. One pilot earns one
> full run; failure stops the branch.
