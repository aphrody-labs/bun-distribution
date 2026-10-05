# Gemma Fine-Tuning Debug Notes

Institutional memory for Gemma (especially Gemma 4) LoRA fine-tuning on Apple Silicon: MPS memory, text collators, and long-input summarization. Multiple related issues live in this file; each issue is self-contained.

**Quick filter:** `grep -n "— Active" README/notes/debug-notes.md`

---

## Issue: Gemma 4 pre-load PEFT patch corrupts encoder initialization — Resolved

**First spotted:** 2026-09-20
**Resolved:** 2026-09-20
**Status:** Resolved; corrected LoRA experiment subsequently KILLed at its Phase 2 gate

### Summary

Replacing `Gemma4ClippableLinear` before `from_pretrained` silently changed
expected checkpoint keys from `*.linear.weight` to `*.weight`. Transformers
reported the published vision/audio weights as unexpected and the replacement
weights as missing, so the first apparent smoke/overfit evidence used randomly
initialized encoder linears and was invalid. The loader now instantiates the
native architecture, loads published weights, and only then replaces each
wrapper with an `nn.Linear` subclass that reuses the exact same `Parameter`.

The rank-8 runs and rank-64 follow-up did not establish production value. The
rank-8 arms showed learning and image sensitivity, but the original raw-JSON
gate was invalid for the opaque context-blob consumer. Rank-64 received no
Excellent grades on its first 20 training rows under the full system prompt;
those rows differed from the stock comparison, so regression was not
established. The downstream transcript/editor effect was not measured. Training
was stopped and no adapter was promoted.

### Symptom

```text
load report: native *.linear.weight keys unexpected; replacement *.weight keys missing
corrected compact:     41.6% whole-target NLL reduction on two rows
corrected conditioned: 54.2% whole-target NLL reduction on two rows
rank-64 full-prompt first 20: 0 Excellent; not same rows as stock baseline
production transcript/editor effect: not measured
```

### Root Cause

PEFT needs target modules to be `nn.Linear`, but changing the class before
checkpoint loading changes the module state-dict ABI. The safe seam is after
native checkpoint loading. The later quality failure is not attributable to
this bug: an exact SafeTensors equality probe passed before both corrected runs.

### Related Guides

- [Gemma 4 E4B telepathic-context SFT plan](../plans/005-gemma4-e4b-telepathic-context-sft.md)
- [Phase 2 KILL receipt](../receipts/gemma4-e4b-telepathic-phase2-overfit-kill.json)

### Fix

**Files:**

- `gemma_tuner/models/gemma/gemma4_patches.py` — converts already-loaded native
  wrappers in place and preserves `Parameter` identity and forward behavior.
- `gemma_tuner/models/gemma/base_model_loader.py` — requires at least one native
  clippable conversion for real multimodal Gemma 4 while allowing synthetic
  text-only family-routing fixtures.
- `tools/eval_tt_telepathic_hf.py` — binds frozen generation and optional
  learning diagnostics; formatting is not a product-quality gate.
- `gemma_tuner/utils/checkpoints.py` and `gemma_tuner/utils/integrity.py` — seal
  complete checkpoints and keep repeated stop/resume finalization verifiable.

No adapter was promoted. The rank-8 retraining attempt was stopped, its VM and
watcher were stopped, and no corpus-scale run was launched. Private screenshot
and CSV bundles remain local and are excluded from Git.

### Verification

```bash
.venv/bin/pytest -q
# 287 passed, 1 skipped
.venv/bin/ruff check gemma_tuner tools/eval_tt_telepathic_hf.py tests
../perfect-dictator/scripts/validate-plan.sh README/plans/005-gemma4-e4b-telepathic-context-sft.md
```

The remote exact-load probe compared a representative vision weight and audio
weight byte-for-byte with the pinned source SafeTensors tensors after loading
and before conversion; both matched and no clippable keys were missing or
unexpected.

### Executable Memory

Regression tests: `tests/test_gemma4_patches.py`,
`tests/test_eval_tt_telepathic_hf.py`, `tests/test_finetune_resume.py`, and
`tests/test_integrity.py`.

### If This Recurs

- [ ] Never patch a checkpoint module's state-dict shape before `from_pretrained`.
- [ ] Inspect missing/unexpected keys and compare a loaded tensor to its pinned
      SafeTensors source before accepting any training metric.
- [ ] Freeze a matched local product evaluation before training; do not use
      raw JSON validity as a gate when the consumer accepts an opaque blob.
- [ ] Do not compare semantic grade distributions across different examples.

---

## Issue: Gemma 4 instruction tuning trains on prompt tokens (wrong `control_token`) — Resolved

**First spotted:** 2026-04-08
**Resolved:** 2026-04-08
**Status:** Resolved

### Summary

End-to-end Gemma 4 text instruction tuning on the bundled `sample-text` dataset "completed successfully" but the adapter learned nothing: `eval_loss ≈ 14.59`, `train_loss ≈ 14.62` (near random-init CE for a 256K vocab: `ln(256000) ≈ 12.4`). **Both** label-masking paths were silently broken for Gemma 4 and the collator fell through to an unsafe "leave labels unmasked" state — every row was training on **prompt + response** instead of response only.

Separate from (and stacked on top of) the earlier "Zero loss from degenerate `assistant_masks`" bug below. That fix made the collator fall through to `mask_gemma_prompt_tokens` when the primary path returned a degenerate mask. This bug is that the fallback itself was broken for Gemma 4 because of a wrong control-token string.

### Symptom

```log
DataCollatorGemmaText: assistant_masks has no supervised tokens for 1/1 row(s);
  using mask_gemma_prompt_tokens fallback (often: chat template missing the Jinja
  `generation` keyword so HF cannot build assistant spans).
mask_gemma_prompt_tokens: at least one sample has no control-token span '<|turn|>';
  skipping prompt masking for those rows.
{'eval_loss': '14.59', 'eval_runtime': '2.035', ...}
{'train_runtime': '30.17', 'train_loss': '14.62', 'epoch': '1'}
✅ Training completed successfully!
```

`loss` is not zero here (unlike the earlier degenerate-mask bug) — it is near the random-init baseline because the model is being penalized for failing to predict its own prompt.

### Root Cause

Two independent bugs that compounded:

1. **Wrong `control_token` string in `family.py:71`.** The file declared `"control_token": "<|turn|>"` (bars on both sides). **That string does not exist in the real Gemma 4 tokenizer at all.** `tokenizer.encode("<|turn|>", add_special_tokens=False)` returns a 4-subword sequence `[236820, 236909, 887, 111038]` that never appears in any rendered chat. The actual start-of-turn marker in Gemma 4 is `<|turn>` (single pipe, no trailing bar), a single token with id `105`. The closing marker is the asymmetric `<turn|>` (id 106). Both the declaration and the surrounding comments had the wrong string.

2. **Primary `assistant_masks` path is always degenerate for Gemma 4.** Gemma 4's shipped chat template (as of transformers 5.5.0) does not wrap assistant replies in the Jinja `{% generation %}` block that HF requires to build assistant spans. `apply_chat_template(return_assistant_tokens_mask=True)` returned a correctly-shaped but all-zeros `assistant_masks` tensor **and** printed a noisy per-batch HF warning. The previous fix correctly detected this and fell through — straight into bug 1.

Chain of failures:

- Primary: `return_assistant_tokens_mask=True` → all-zeros mask (bug 2) → per-row degenerate detection → fallback.
- Fallback: `mask_gemma_prompt_tokens` searches for the `control_token` as a token subsequence → the wrong string never matches → warns and **leaves labels untouched** for every row.
- Training: unmodified labels = full sequence, so CE loss is computed over prompt + response. For a 16-sample / 4-optimizer-step smoke run with `lr=1e-5`, loss stays stuck near the random-init level and nothing useful is learned.

### Verification that BOTH bugs were required for the failure

`tests/test_gemma_text_collator.py::test_instruction_gemma4_degenerate_all_zero_assistant_masks_uses_fallback` was **passing the whole time** because its fake tokenizer defined `encode("<|turn|>") = [50]` (matching the wrong string in family.py). The test was self-consistent but had nothing to do with real Gemma 4 behavior. The regression check below now catches this.

### Related Guides

- [Gemma 4 on Apple Silicon](../guides/apple-silicon/gemma4-guide.md) — Text SFT and label masking.

### Fix

**Files:**

- `gemma_tuner/models/gemma/family.py` — `family_capabilities(GEMMA_4)`: `control_token` changed from `"<|turn|>"` → `"<|turn>"`. Added new capability `supports_assistant_mask: bool` (False for Gemma 4, True for Gemma 3n) so collators can skip the primary HF path entirely when they know it will be degenerate. Extensive docstring explaining both traps for future maintainers.
- `gemma_tuner/models/common/collators.py` — `DataCollatorGemmaText._collate_instruction`: reads `self._caps["supports_assistant_mask"]` and only passes `return_assistant_tokens_mask=True` when supported. For Gemma 4 the call is skipped entirely, silencing the per-batch HF warning. The degenerate-row branch from the earlier fix is retained as belt-and-suspenders for any future tokenizer release that volunteers an all-zero mask without the flag. `_control_token_subsequence_ids` comments and fast-path updated to `<|turn>`.
- `tests/test_family.py` — `test_family_capabilities_keys` asserts `c4["control_token"] == "<|turn>"` and `c4["supports_assistant_mask"] is False`. Comment explains the `<|turn|>` vs `<|turn>` trap inline.
- `tests/test_gemma_text_collator.py` — fake tokenizers updated to mirror real Gemma 4 behavior (`<|turn>` → single token 50; `<|turn|>` → 4-subword sequence [900, 901, 902, 903] that never matches). Added three new tests:
  - `test_mask_gemma_prompt_tokens_gemma4_wrong_marker_warns_and_leaves_labels_unmasked` — regression guard: using the old wrong `<|turn|>` marker triggers the skip-masking warning and leaves labels unchanged.
  - `test_instruction_gemma4_skips_primary_assistant_mask_path` — spy tokenizer verifies the collator never requests `return_assistant_tokens_mask=True` for Gemma 4.
  - `test_instruction_gemma3n_still_uses_primary_assistant_mask_path` — matching spy test ensures Gemma 3n keeps using the primary path (no regression).
- `tests/test_gemma_image_collator.py` — `_TokenizerMaskingGemma4` fake updated to the same `<|turn>` / `<|turn|>` split; image-collator mask test now passes `control_token="<|turn>"`.

### Verification

End-to-end with the **real** Gemma 4 tokenizer (not a fake):

```bash
.venv/bin/python -c "
import warnings, torch
from transformers import AutoTokenizer
from gemma_tuner.models.common.collators import DataCollatorGemmaText
from gemma_tuner.models.gemma.family import GemmaFamily
from gemma_tuner.models.gemma.constants import GemmaTrainingConstants

tok = AutoTokenizer.from_pretrained('google/gemma-4-E2B-it')
collator = DataCollatorGemmaText(tok, text_column='response', family=GemmaFamily.GEMMA_4,
                                  prompt_column='prompt', max_length=128, sub_mode='instruction')
with warnings.catch_warnings(record=True) as caught:
    warnings.simplefilter('always')
    out = collator([
        {'prompt': 'Translate to French: Good morning.', 'response': 'Bonjour.'},
        {'prompt': 'What is the capital of Japan?', 'response': 'Tokyo.'},
    ])
assert len(caught) == 0, f'expected 0 warnings, got {[str(w.message) for w in caught]}'
ignore = GemmaTrainingConstants.IGNORE_TOKEN_ID
for i in range(out['input_ids'].size(0)):
    sup = [(p, int(t)) for p, t in enumerate(out['labels'][i].tolist()) if t != ignore]
    span = tok.decode([out['input_ids'][i, p].item() for p, _ in sup], skip_special_tokens=False)
    print(f'row {i}: {len(sup)} supervised tokens -> {span!r}')
"
```

Expected output (silence from warnings; response + end-of-turn supervised; prompt masked):

```
row 0: 4 supervised tokens -> 'Bonjour.<turn|>\n'
row 1: 4 supervised tokens -> 'Tokyo.<turn|>\n'
```

Plus the unit tests:

```bash
.venv/bin/python -m pytest tests/test_family.py tests/test_gemma_text_collator.py tests/test_gemma_image_collator.py -q
# Expect: 39 passed
```

### Follow-ups / things to watch

- The wizard default `learning_rate=1e-5` is very conservative — even with correct masking a 16-row / 4-step smoke run will not move loss noticeably. Consider bumping the wizard default to `5e-5` or `1e-4` for instruction tuning specifically, or offer a "smoke test" mode that picks aggressive defaults.
- If a future transformers release adds `{% generation %}` to Gemma 4's chat template, `supports_assistant_mask` can be flipped to True — but keep the regression guard test for the `<|turn>` marker either way.
- `<bos>` presence check: the Gemma 4 rendered chat starts with `<bos><|turn>user...`, so `validate_bos_tokens_present` still passes. Not related to this bug but worth noting alongside it.

---

## Issue: Zero loss from degenerate `assistant_masks` (all zeros) — Resolved

**First spotted:** 2026-04-07
**Resolved:** 2026-04-07
**Status:** Resolved

### Summary

`apply_chat_template(..., return_assistant_tokens_mask=True)` can return `assistant_masks` with **no supervised positions** (often when the chat template lacks the Jinja `generation` keyword; HF logs a warning). The old collator path did `labels[am == 0] = ignore`, which masks **every** token when `am` is all zeros → `loss=0`, `grad_norm=0`. **Fix:** per row, use `assistant_masks` only when `am[i].sum() > 0`; otherwise call `mask_gemma_prompt_tokens` for that row. One-time warning when fallback triggers.

### Symptom

```log
{'loss': '0', 'grad_norm': '0', 'learning_rate': '9.981e-06', 'epoch': '0.01363'}
return_assistant_tokens_mask==True but chat template does not contain `{% generation %}` keyword.
```

### Root Cause

`assistant_masks` present with correct shape but **all zeros**; combined with unconditional `labels[am == 0]` masking, every label became `IGNORE_TOKEN_ID`.

### Related Guides

- [Gemma 4 on Apple Silicon](../guides/apple-silicon/gemma4-guide.md) — Text SFT and label masking.

### Fix

**Files:**

- `gemma_tuner/models/common/collators.py` — `DataCollatorGemmaText._collate_instruction`: per-row degenerate `assistant_masks` handling + `_warned_degenerate_assistant_mask`.
- `tests/test_gemma_text_collator.py` — `test_instruction_gemma4_degenerate_all_zero_assistant_masks_uses_fallback`.

### Verification

```bash
.venv/bin/python -m pytest tests/test_gemma_text_collator.py -q
```

---

## Issue: Long-input summarization — truncation drops assistant span — Resolved

**First spotted:** 2026-04-07
**Resolved:** 2026-04-07
**Status:** Resolved

### Summary

For summarization, **right-side truncation** at `max_length` keeps the **beginning** of the chat; very long user prompts can fill the entire window so the `<|turn>model` / assistant content never appears. That is separate from the degenerate-mask bug. **Fix:** before `apply_chat_template`, measure token length per row and **left-truncate the user prompt** (drop characters from the start) until the chat fits `max_length`, then apply the usual HF truncation as a safety net. Optional `instruction_truncation="none"` restores tokenizer-only truncation. Very long assistant targets still need a smaller response or a larger `max_seq_length`; the collator may **prefix-truncate** the assistant string if the pair still does not fit. Chunking / hierarchical summarization for multi-window documents remains a data-pipeline concern.

### Root Cause

Tokenizer `truncation=True` + `max_length` applies to the full rendered chat; long prompts crowd out the assistant turn.

### Fix

**Files:**

- `gemma_tuner/models/common/collators.py` — `instruction_truncation` (default `"left_user"`), `_instruction_seq_len`, `_fit_instruction_pair_to_max_length`, and integration in `_collate_instruction`.
- `tests/test_gemma_text_collator.py` — `_FakeLongPromptTokenizer` plus tests for `left_user` vs `none`.

### Verification

```bash
.venv/bin/python -m pytest tests/test_gemma_text_collator.py -q
```

---

## Issue: MPS OOM during Gemma 4 multimodal text LoRA training — Resolved

**First spotted:** 2026-04-07
**Resolved:** 2026-04-07
**Status:** Resolved

### Summary

First training step crashed with `RuntimeError: MPS backend out of memory` (~41 GiB allocated) while fine-tuning `gemma-4-e2b-it` with LoRA on text CSV data. Mitigations: **MPS + text** forces `per_device_train_batch_size=1` and `per_device_eval_batch_size=1`, enables **gradient checkpointing** by default for MPS text (opt out via `GEMMA_MPS_ALLOW_NO_GRADIENT_CHECKPOINTING`), passes `gradient_checkpointing` into `TrainingArguments`, calls `enable_input_require_grads()` when checkpointing is on, and caps `max_seq_length` on MPS text using `GEMMA_MPS_MAX_SEQ_LENGTH` (default 2048). Added profile `gemma-csv-gemma4-mps-text` in `config/config.ini`.

### Symptom

```log
RuntimeError: MPS backend out of memory (MPS allocated: 40.96 GiB, ... max allowed: 41.47 GiB).
```

### Root Cause

Unified memory pressure from **Gemma 4 multimodal** weights + **LoRA** + **eager attention** + **micro-batch > 1** and **no gradient checkpointing** on long sequences. Confirmed by stack trace in attention softmax during the first step.

### Related Guides

- [Gemma 4 on Apple Silicon](../guides/apple-silicon/gemma4-guide.md) — MPS allocator, `PYTORCH_MPS_HIGH_WATERMARK_RATIO`, gradient checkpointing tradeoffs.

### Fix

**Files:**

- `gemma_tuner/models/gemma/finetune.py` — MPS text batch clamp, gradient checkpointing wiring, optional `GEMMA_MPS_ALLOW_NO_GRADIENT_CHECKPOINTING`, `GEMMA_MPS_MAX_SEQ_LENGTH` cap, `enable_input_require_grads`.
- `config/config.ini` — `[profile:gemma-csv-gemma4-mps-text]` with conservative batch/accumulation settings.

### Verification

```bash
gemma-macos-tuner finetune gemma-csv-gemma4-mps-text --json-logging
# Expect first training steps to progress without immediate MPS OOM (still subject to seq length / data).
```

---

## Issue: Six-mode renderer rejects the literal v3 prompt layout — Resolved

**Date:** 2026-09-24. **Plan:** 007 (Plan 33, E2B literal v3 SFT).

### Symptom

`without_ocr()` in `gemma_tuner/models/common/plan31_input_modes.py` accepted
only the literal v1 layout: `Return valid JSON only.` before a trailing OCR
block. Literal v3 moves the instruction after `</first_pass_screenshot_ocr>`,
so every v3 row would raise `ValueError` in `no_ocr` rendering. The failure is
closed, not silent, but it blocks training.

### Root Cause

The Plan 31 renderer hard-coded the pre-v3 prompt ABI.

### Fix

Accept exactly two frozen layouts. v1 is unchanged: OCR is cut from the end.
For v3, the OCR block is excised and the byte-exact
`"\n\nReturn valid JSON only."` suffix (optionally newline-terminated) is kept
as the last text. Anything else, such as a duplicated, extended, or leading
instruction, still fails closed. Named tests:
`test_v3_instruction_stays_single_and_last_in_every_mode` and
`test_v3_instruction_drift_fails_closed`. Across all 3,064 real v3 rows and six
modes, every text-bearing render has exactly one instruction as its last text,
and image-only renders carry no text.

### If This Recurs

Any change to the user-prompt ABI must be rendered through all six modes on
the full corpus before training. The frozen v1 Plan 32 bytes must still render
identically.

## Issue: Gemma 4 E2B reproduces the 5.5.0 shared-K/V defect — Guarded

**Date:** 2026-09-24. **Model:** `google/gemma-4-E2B-it@3e22461f`.

### Evidence

`tools/probe_plan33_shared_kv.py` teacher-forces preregistered frozen v3 rows
(full mode, real collator, BF16, MPS) and toggles only `use_cache`.

| Transformers | Row | Target tokens | NLL cache on | NLL cache off | Top-1 agreement |
| --- | --- | ---: | ---: | ---: | ---: |
| 5.5.2 | 4 rows | 275–373 | identical | identical | 1.000 |
| 5.5.0 | train 0 | — | 1.0818 | 13.3119 | 0.023 |
| 5.5.0 | validation 0 | 275 | 2.7132 | 15.5421 | 0.015 |

Under 5.5.2 the logits are bitwise identical (max delta 0.0). E2B has 20
shared-K/V layers of 35. Under 5.5.2 those layers own no K/V projections, so
the actual LoRA inventory is 318 targets: 205 decoder, 112 vision, and 1
projector. Receipts are in `README/notes/receipts/plan-007/`.

### Lesson

The local default `.venv` still pins Transformers 5.5.0 for historical
Plan 29 reproduction. Any E2B/E4B training or loss probe must run from the
5.5.2 environment (`.venv-plan33` locally, or the corrected lock on CUDA).
The 5.5.0 run is a positive control proving that the probe has power.

## Issue: Merged vision LoRA is not equivalent to the trained Gemma 4 model — Resolved for Plan 33

**Date:** 2026-09-25. **Evidence:** `README/notes/receipts/plan-007/phase-1-merge-canary-*.json`.

### Symptom

On frozen real screenshots, PEFT unmerged (training form) and
`merge_and_unload` (MLX inference form) of the Plan 33 E2B step-704 adapter
shift projected image embeddings by about 5% (mean relative), in both BF16
and FP32. 64-token greedy continuations diverge in 2 of 4 samples, at tokens
33 and 59.

### Root Cause

Gemma 4 vision linears clamp input and output (`Gemma4ClippableLinear`). The
PEFT LoRA path on a clamped base layer is added outside those clamps, but a
merged weight puts the delta inside them. The decoder and projector have no
clamps and merge exactly. A zero-delta control is bit-identical, and FP32
removes the separate early-training BF16 rounding effect seen at 2 steps.

### Consequence

Any MLX model built by merging every LoRA target, including the Plan 29–32
E4B conversions, runs a vision tower that training never optimized. Before
evaluating such a model, merge only the decoder/projector targets. Keep the
vision adapters as an unmerged, unclamped side path in MLX, and verify that
path against HF unmerged on real rows.

### Fix (Plan 33)

`tools/build_plan33_mlx_candidate.py` merges only the 205 decoder targets and
the 1 projector target. The 112 vision adapters go into
`plan33-vision-lora.safetensors`, which `tools/plan33_mlx_vision_lora.py`
applies at load time as `clip_out(W clip_in(x)) + scale * B A x`.

On the step-616 candidate (4 rows × full/image-only, 64 greedy tokens), HF
training form vs this MLX build matched exactly on 4/8 samples. Stock HF vs
stock MLX matched on only 3/8, which is the cross-runtime floor. Dropping the
vision adapters gave 0/8. Receipt:
`receipts/plan-007/phase-5-mlx-parity-step616.json`.

## Issue: Fresh LoRA init ignored `seed` and `full_determinism` — Resolved

**Date:** 2026-09-24. **Found by:** the Plan 33 exact-resume smoke.

### Symptom

Two independent fresh E2B runs (0->1->2 resumed vs uninterrupted 0->2)
produced identical step-1 loss (B starts at zero) but different grad norms.
Their `lora_A` tensors differed completely: relative Frobenius difference
1.43, which is about sqrt(2) and the signature of two independent draws.
Within the resumed lineage, A moved only 1.4% between steps 1 and 2, so
resume itself was correct.

### Root Cause

`finetune.py` calls `get_peft_model` before the Trainer's `set_seed(args.seed)`.
LoRA A was drawn from torch's unseeded per-process RNG, so every fresh run
(including the Plan 30/31 E4B stock starts) had an unreproducible init,
despite `seed = 42` and `full_determinism = true`.

### Fix

Call `set_seed(profile seed)` immediately before fresh `get_peft_model`. The
init distribution and every hyperparameter are unchanged. Plan 33 amendment:
`README/notes/receipts/plan-007/preregistration-amendment-v1.json`. The first
smoke set is preserved as `failed-plan33-smoke-v1` on the VM.

### If This Recurs

An exact-resume control is valid only when both arms share initial weights.
Compare `lora_A` between arms before interpreting any step-2 difference.

## Issue: Logged stochastic loss is about 8x the per-token loss — Known, frozen recipe

**Date:** 2026-09-24. **Scope:** every corrected Plan 30–33 Gemma run that
uses `CompletionOnlyTrainer` with gradient accumulation 8.

### Symptom

The Plan 33 E2B smoke logged `stochastic_loss` 15.48 at step 1, while
teacher-forced fixed-panel losses were 1.41 (train) and 1.93 (validation).
Plan 32 E4B showed the same pattern: fixed train 0.375 at step 0, with logged
step losses of 4.03, 2.08, and 1.60.

### Root Cause

`CompletionOnlyTrainer.compute_loss` returns a per-micro-batch token mean and
ignores `num_items_in_batch`. Transformers 5.5.2 skips its
`loss / gradient_accumulation_steps` normalization when the model accepts loss
kwargs and `num_items_in_batch` is set (`trainer.py`, around line 1925). Both
the reported loss and the gradient are therefore the **sum** of per-row means:

- 8x the mean on ordinary steps;
- 4x on each epoch's final four-row partial step;
- each row weighted equally regardless of its token count.

### Decision

This is not the 5.5.0 shared-K/V defect. The corrected 5.5.2 probe shows
cache-on and cache-off parity, and one step lowered validation loss by 31%.
The behavior is part of the E4B-matched recipe that Plan 33 must hold fixed.
AdamW is largely invariant to gradient scale, but `max_grad_norm=1.0` clips
the summed gradient. Divide `stochastic_loss` by `step_exposures` to get an
approximate per-row mean. Never compare it with token-weighted panel losses,
and do not change it mid-lineage.

## Reference: Corrected Gemma A100 trainer VM layout (Plans 30–33)

**Date:** 2026-09-24. The runbook was not previously recorded anywhere.

- **Source snapshot:** `plan31-v4-source-boot-20260923` (300 GB pd-balanced,
  project `gist-is-backend`). Clone a new boot disk per plan; never reuse
  another plan's live disk or VM.
- **VM shape:** `a2-ultragpu-1g`, STANDARD, `--max-run-duration 43200s
  --instance-termination-action STOP --no-restart-on-failure`, with runner
  service account `whisper-gcp-sft-runner@gist-is-backend` and scope
  `cloud-platform`. Creation also requires
  `--discard-local-ssds-at-termination-timestamp=true`, because this shape
  attaches a local SSD.
- **Checkout:** `~/plan29/repo`. Its `.venv` pins Transformers **5.5.0** and
  torch 2.9.1+cu129. The corrected runtime is an overlay: always run with
  `PYTHONPATH=$HOME/plan30-transformers552:$HOME/plan29/repo`, which yields
  exactly 5.5.2. Without the overlay, training silently uses the defective
  shared-K/V path.
- **Editable-install trap:** `gemma_tuner` resolves to `~/plan29/repo`.
  Overlay new code into that checkout by moving the old package aside first,
  then check `gemma_tuner.__file__` and the bundle manifest hashes.
- **Screenshots:** `data/datasets/tt-screenshot-plan28-sft-v1/images` holds
  3,064 row-ID-keyed files. Plan 31+ projections reference
  `tt-screenshot-plan31-mixed-v4-deploy/images`, which is a symlink to that
  cache. Projection verification rehashes every image, so a wrong link fails
  closed.
- **Local gcloud:** Homebrew gcloud needs `CLOUDSDK_PYTHON` pointing at
  Python 3.10+ (for example this repo's `.venv/bin/python`); the default
  Python 3.9 refuses to load.

## Appendix: Practical context limits (64 GB unified RAM, this stack)

**Not a bug ticket** — planning guidance from the same investigation.

- Causal LM **training** uses one sequence budget for **prompt + response** (plus chat template overhead). “8192 input” is not a separate bucket from the summary.
- For **`gemma-4-e2b-it` LoRA on MPS** in this repo, treat **~2k–3k total tokens** as a realistic training target unless proven otherwise; **~10k total** is not a safe default for local training on this hardware (attention memory scales roughly with sequence length squared).
- **Data:** median prompt length on sampled `gemma-csv` rows was on the order of **~8–9k tokens** (prompt-only encode); many rows exceed any single-window cap without **chunking**, **hierarchical summarization**, or **left-truncating** the source only.

<!--
USAGE NOTES (from template):

1. Prefer updating this file before creating new note files for the same domain.
2. New issue? Copy the "Active" template and paste at the top (newest first).
3. Fixed: rename "— Active" to "— Resolved" and add Resolved date.
4. Investigation Log: trim ruled-out hypotheses after resolution.
-->
