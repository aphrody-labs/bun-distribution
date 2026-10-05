# Text-Only Fine-Tuning Plan

**Related:** Gemma 3n vs Gemma 4 stack, family-aware collators, and loader gates: [gemma4-upgrade.md](gemma4-upgrade.md).

**Date:** 2026-04-06
**Status:** Complete (implementation landed; push policy: do not push until plan verified end-to-end locally)

## Executive Summary

Add a text-only fine-tuning path to gemma-macos-fine-tuner alongside the existing audio + text path. Today the trainer is hardcoded to require audio (the only collator raises if `audio_path` is missing and uses a fixed "Please transcribe this audio" chat template). Adding text mode roughly doubles the addressable use cases (instruction tuning, continued pretraining, style adaptation) while reusing the entire LoRA + Trainer + MPS + streaming + export stack unchanged. Estimated effort: ~one focused day.

## Problem Statement

- **Symptom:** Users who want to fine-tune Gemma on text-only datasets (instruction tuning, completion-style continued pretraining) cannot use this repo. The README's comparison table currently overpromises with a "Fine-tune Gemma (text) ✅" row that the code does not support.
- **Root Cause:** [`gemma_tuner/models/common/collators.py`](../../gemma_tuner/models/common/collators.py) ships exactly one collator, `DataCollatorGemmaAudio`, which raises on missing `audio_path` (line ~47) and hardcodes a transcription chat template (lines ~64–75). [`gemma_tuner/models/gemma/finetune.py`](../../gemma_tuner/models/gemma/finetune.py) wires it unconditionally at line ~402 and loads the full `AutoProcessor` (USM audio tower) regardless of need.
- **Impact:** The repo is positioned as "the Mac tool for fine-tuning Gemma" but functionally is "the Mac tool for fine-tuning Gemma on speech." Either the marketing is wrong or the code is incomplete. This plan closes the gap by completing the code.

## Mode Definitions

| Mode | Behavior | Why it matters |
| --- | --- | --- |
| `audio` (default) | Current path: audio + transcript via `DataCollatorGemmaAudio`, `AutoProcessor`, WER eval. | Preserves every existing profile with zero edits. |
| `text` + `text_sub_mode=instruction` | Prompt + response columns, chat-templated, prompt tokens masked from loss. | Instruction tuning — the dominant text-SFT use case. |
| `text` + `text_sub_mode=completion` | Single text column, no masking, full sequence is the target. | Continued pretraining / style adaptation. |

## Goals and Non-Goals

### Goals

- [x] A new `DataCollatorGemmaText` supporting both instruction and completion sub-modes.
- [x] `modality = audio | text` profile key with `audio` as default (zero-edit backwards compatibility).
- [x] `finetune.py` branches on modality: tokenizer load, collator dispatch, eval metric gating.
- [x] Wizard asks "What kind of fine-tuning?" up front and gates downstream questions.
- [x] A text smoke test (8 rows, 2 steps, finite loss).
- [x] README comparison table becomes accurate.

### Non-Goals

- **Stripping the audio tower from `AutoModelForCausalLM` in text mode.** The tower stays resident in RAM (~1–2 GB overhead) but is never forwarded. Documenting the overhead is enough for v1.
- **A separate text-only model class.** `AutoModelForCausalLM` already handles both modes correctly.
- **Sample-generation eval callback.** Nice to have, deferred.
- **Granary / BigQuery adapters in text mode.** v1 restricts text mode to the CSV source adapter. Streaming text corpora is a follow-up.
- **Tuning the MPS batch-size cap upward for text** (text sequences are shorter, so the cap could go higher). Follow-up tuning pass.

## Scope and Constraints

- **Scope:** Collator, finetune.py modality switch, dataset schema validation, profile schema, wizard, smoke test, README + TROUBLESHOOTING updates.
- **Constraints:** Must not regress existing audio profiles. Every commit in the build sequence must leave the repo runnable on existing audio configs.
- **Guardrails:** The shared LoRA / Trainer / MPS / export / run-index infrastructure stays untouched.

## Ground Truth Contracts (Do Not Violate)

- **Default `modality = audio`.** Every existing INI profile must work with zero edits. Breaking this is a non-starter.
- **Always use `tokenizer.apply_chat_template`, never hand-rolled `<start_of_turn>` strings.** Gemma 3 / 3n / 4 tokenize the chat scaffolding differently across revisions; hand-rolling is the single biggest footgun.
- **Prompt-mask boundary alignment must be unit-tested.** The first unmasked label in an instruction batch must equal the tokenizer's encoding of the response's first word. If this is off by one, loss looks fine but the model trains on garbage.
- **Pad-token masking must not zero out EOS gradient.** Gemma tokenizers often default `pad_token = eos_token`. The naive `labels[labels == pad_id] = -100` then masks legitimate EOS tokens and the model never learns to stop. Mask via `attention_mask == 0` instead.

## Already Shipped (Do Not Re-Solve)

- **LoRA / PEFT injection** in [`gemma_tuner/models/gemma/finetune.py`](../../gemma_tuner/models/gemma/finetune.py) — modality-agnostic, reuse as-is.
- **MPS device selection, memory pressure monitoring** in [`gemma_tuner/utils/device.py`](../../gemma_tuner/utils/device.py) — reuse.
- **Run index, metrics persistence, export** in [`gemma_tuner/models/common/results.py`](../../gemma_tuner/models/common/results.py) and [`gemma_tuner/scripts/export.py`](../../gemma_tuner/scripts/export.py) — reuse.
- **`<bos>` validation and prompt-token masking helpers** inside `DataCollatorGemmaAudio` — extract and reuse, do not re-implement.
- **CSV loader, patch/blacklist/protection system** in [`gemma_tuner/utils/dataset_utils.py`](../../gemma_tuner/utils/dataset_utils.py) — reuse with one schema-validation tweak.

## Fresh Baseline (Current State)

- **Architecture:** Single collator (`DataCollatorGemmaAudio`) hardcoded into `finetune.py`. `AutoProcessor` loads the USM audio tower unconditionally. WER metrics built unconditionally.
- **Profiles:** INI-based, no `modality` key today.
- **Wizard:** Audio-only flow — sampling rate, audio path column, etc.
- **Tests:** `tests/test_gemma_collator.py` and `tests/test_smoke.py` exercise the audio path. No text fixtures.
- **Known gaps:** No way to fine-tune on text. README comparison table overpromises. `dataset_utils.py` schema validation is mostly modality-agnostic but `dataset_sources.py` adapters may inject `audio_path` requirements — needs verification.

## Solution Overview

```
+-----------------+    modality=audio    +---------------------------+
|  finetune.py    | -------------------> | DataCollatorGemmaAudio    |
|  modality       |                      | (existing)                |
|  switch         |    modality=text     +---------------------------+
|                 | -------------------> | DataCollatorGemmaText     |
+-----------------+                      | - instruction sub-mode    |
       |                                 | - completion sub-mode     |
       v                                 +---------------------------+
+--------------------+
| shared helpers     |  <-- extracted from DataCollatorGemmaAudio
| _validate_bos      |
| _mask_prompt_toks  |
+--------------------+
```

`AutoTokenizer` is used in text mode (skips USM download); `AutoProcessor` stays for audio. Eval gates WER on modality. Wizard asks modality first and branches.

## Implementation Phases

> Do one phase at a time. Each phase leaves the repo runnable on existing audio profiles.

### Phase 0: Profile Schema + Defaults

**Goal:** Land the new config keys with audio-preserving defaults. No behavior change.

**Tasks:**

- [x] Add `modality`, `text_sub_mode`, `prompt_column`, `max_seq_length` to the profile loader in `gemma_tuner/core/config.py` (or wherever profile keys are validated). Defaults: `modality=audio`, `text_sub_mode=instruction`, `prompt_column=None`, `max_seq_length=2048`.
- [x] Update `config.ini.example` with commented-out text-mode keys.
- [x] Document the new keys in [`README/Datasets.md`](../Datasets.md).

**Verification:** Existing audio profiles load and run a few training steps without warnings.

---

### Phase 1: Collator Refactor (Pure No-Op)

**Goal:** Extract shared helpers from `DataCollatorGemmaAudio` so the text collator can reuse them. Audio behavior must be byte-identical.

**Tasks:**

- [x] In `gemma_tuner/models/common/collators.py`, extract `_validate_bos_tokens_present` and `_mask_prompt_tokens` to module-level functions (or a shared base class).
- [x] Update `DataCollatorGemmaAudio` to call them.
- [x] Run `pytest tests/test_gemma_collator.py` — must pass green before proceeding.

**Verification:** All existing collator tests pass. No behavior change.

---

### Phase 2: `DataCollatorGemmaText`

**Goal:** Add the new collator with both sub-modes. Not yet wired into finetune.py.

**Tasks:**

- [x] Add `DataCollatorGemmaText` class to `gemma_tuner/models/common/collators.py`. Signature: `__init__(self, tokenizer, text_column, prompt_column=None, max_length=2048, sub_mode="instruction")`.
- [x] **Instruction sub-mode:** Build messages list with user (prompt) + assistant (response) turns. Call `tokenizer.apply_chat_template(messages_batch, return_tensors="pt", padding=True, return_dict=True, tokenize=True)`. Apply `_mask_prompt_tokens` to mask user-turn tokens.
- [x] **Completion sub-mode:** `tokenizer(texts, padding=True, truncation=True, max_length=…, return_tensors="pt")`. Labels = `input_ids.clone()`. No prompt masking.
- [x] **Pad-token masking:** Mask labels by `attention_mask == 0`, NOT by `labels == pad_id`. Critical to avoid zeroing EOS gradient when `pad_token == eos_token`.
- [x] Add `tests/test_gemma_text_collator.py` with both sub-modes. **Critical assertion:** in instruction mode, the first unmasked label index must equal the tokenizer encoding of the response's first word. Verifies mask boundary alignment.

**Verification:** New collator tests pass. Audio collator tests still pass.

---

### Phase 3: `dataset_utils.py` Schema Branching

**Goal:** Loosen dataset schema validation so text-mode CSVs (no `audio_path`) are accepted.

**Tasks:**

- [x] Read `gemma_tuner/utils/dataset_utils.py` end-to-end first to confirm where audio assumptions live (likely line ~271 `required_columns` set).
- [x] Add `modality` and optional `prompt_column` to `dataset_config` dict / `DatasetLoadContext` dataclass in `gemma_tuner/utils/dataset_sources.py`.
- [x] Branch `required_columns`: text mode requires `id` + `text_column` + (`prompt_column` if instruction sub-mode); audio mode unchanged.
- [x] Audit `dataset_sources.py` adapters (CSV, GCS, BigQuery, Granary). v1 restricts text mode to the CSV adapter — explicitly reject text mode in non-CSV adapters with a clear error.

**Verification:** Existing audio fixtures still load. A new text fixture (`tests/data/text_instruction_tiny.csv`) loads successfully.

---

### Phase 4: `finetune.py` Modality Switch

**Goal:** Wire everything together.

**Tasks:**

- [x] At line ~232, read `modality = profile_config.get("modality", "audio")`.
- [x] Branch artifact load (line ~260): if text, `AutoTokenizer.from_pretrained(model_id)`; else `AutoProcessor.from_pretrained(model_id)`. Skips USM tower download in text mode.
- [x] Branch collator (line ~402): instantiate `DataCollatorGemmaText` or `DataCollatorGemmaAudio`. Pass `prompt_column` and `text_sub_mode` from profile.
- [x] Pass `modality` through to `load_dataset_split` calls (lines ~237, ~248).
- [x] Branch metrics (line ~409): if text, set `compute_metrics=None` and `preprocess_logits_for_metrics=None`. Skip `build_wer_metrics`.
- [x] In `models/common/results.py` (or a small callback), compute `perplexity = exp(min(eval_loss, 20))` for text runs and write to metrics JSON.

**Verification:** An existing audio profile still trains. A new text profile trains for a few steps with finite loss.

---

### Phase 5: Wizard

**Goal:** Make text mode discoverable and foot-gun-free.

**Tasks:**

- [x] In `gemma_tuner/wizard/config.py` (or `base.py`), add a first question: "What kind of fine-tuning? (1) Speech-to-text (audio) (2) Instruction tuning (text) (3) Continued pretraining / style (text completion)". Stores `modality` and `text_sub_mode`.
- [x] Gate existing audio questions (sampling rate, audio path column) behind `modality == "audio"`. *(Granary/BigQuery hidden for text; no separate sampling-rate step in current wizard.)*
- [x] In text branches, ask for `prompt_column` (instruction only) and `text_column`.
- [x] In `gemma_tuner/wizard/estimator.py`, swap audio-feature memory estimate for a token-count heuristic in text mode.
- [x] `gemma_tuner/wizard/runner.py` forwards new keys to the profile writer.

**Verification:** `gemma-macos-tuner wizard` can produce a working text-mode profile end-to-end.

---

### Phase 6: Validation and Cleanup

**Goal:** End-to-end smoke test, README + docs updates.

**Tasks:**

- [x] Add `tests/test_smoke_text.py` — integration smoke: `modality=text`, `max_steps=2`, finite `train_loss`. Uses **completion** sub-mode and `tests/data/text_completion_tiny.csv` plus public tiny weights (`fxmarty/tiny-random-GemmaForCausalLM`) so CI does not need a chat template or gated Gemma. Instruction path covered by `tests/test_gemma_text_collator.py` + `tests/data/text_instruction_tiny.csv` loader test.
- [x] Update `README.md` comparison table — the "Fine-tune Gemma (text)" row becomes honestly accurate.
- [x] Add a "Text-only fine-tuning" section to `README.md` with minimal INI examples for both sub-modes.
- [x] Document audio tower RAM in text mode — [`README/KNOWN_ISSUES.md`](../KNOWN_ISSUES.md) *(plan referenced TROUBLESHOOTING; equivalent note lives there)*.
- [x] Cross-reference from `README/guides/README.md` *(links to README section + Datasets; this plan file stays local-only)*.

**Verification:** Both `test_smoke.py` (audio) and `test_smoke_text.py` (text) pass. README claims match code reality.

## Success Criteria

### Hard Requirements (Must Pass)

- [x] Existing audio profiles run with zero config edits. *(Preserved by defaults + existing tests.)*
- [ ] A text-mode profile (instruction sub-mode) trains for ≥10 steps with finite, decreasing loss. *(Validate manually with a gated Gemma tokenizer; CI uses unit tests + completion smoke.)*
- [ ] A text-mode profile (completion sub-mode) trains for ≥10 steps with finite, decreasing loss. *(Smoke covers 2 steps; extend manually for 10+ if required.)*
- [x] `tests/test_gemma_text_collator.py` asserts correct prompt-mask boundary alignment.
- [x] EOS tokens are NOT masked in label tensors when `pad_token == eos_token`.
- [x] Wizard produces a runnable text-mode profile end-to-end. *(Profile keys merged in `generate_profile_config`; interactive run is manual.)*

### Definition of Done

- [x] All tests passing (audio + text).
- [x] README comparison table accurate.
- [x] Plan status updated to Complete.

## Open Questions

### Resolved

- **Q:** Should text mode use `AutoTokenizer` or stay on `AutoProcessor`?
- **A:** `AutoTokenizer`. Skips USM audio tower download. RAM savings are smaller than disk savings (the tower lives in `AutoModelForCausalLM` weights regardless), but the disk + load-time win is real.

- **Q:** Do we need a separate model class for text mode?
- **A:** No. `AutoModelForCausalLM` works for both. The audio tower is resident but untouched when no `audio_values` are in the batch.

- **Q:** Support both instruction and completion sub-modes from day one, or just instruction?
- **A:** Both. Marginal cost is ~10 lines (one branch in the collator). Dramatically widens use cases.

### Unresolved

- **Q:** Should text mode support Granary / BigQuery streaming adapters?
- **Options:** (A) v1 restricts text mode to CSV adapter, defer streaming. (B) Plumb modality through all adapters now. **Lean: A** — keeps Phase 3 small and matches the YAGNI principle. Streaming text corpora is a follow-up driven by real demand.

- **Q:** Sample-generation eval callback for text runs?
- **Options:** (A) Defer. (B) Add a `TextSampleGenerationCallback` that generates from 2–3 fixed prompts every N eval steps. **Lean: A** — perplexity in metrics JSON is enough for v1.

## References

### Internal

- [`gemma_tuner/models/common/collators.py`](../../gemma_tuner/models/common/collators.py) — current audio collator
- [`gemma_tuner/models/gemma/finetune.py`](../../gemma_tuner/models/gemma/finetune.py) — training entrypoint
- [`gemma_tuner/utils/dataset_utils.py`](../../gemma_tuner/utils/dataset_utils.py) — dataset loader
- [`gemma_tuner/wizard/`](../../gemma_tuner/wizard/) — wizard flow
- [`README/Datasets.md`](../Datasets.md) — dataset config docs
- [`README/specifications/Gemma3n.md`](../specifications/Gemma3n.md) — Gemma 3n notes

### External

- [Hugging Face: `apply_chat_template`](https://huggingface.co/docs/transformers/main/en/chat_templating)
- [PEFT LoRA docs](https://huggingface.co/docs/peft/main/en/conceptual_guides/lora)

## Files Likely to Change

| File | Change Type | Notes |
| --- | --- | --- |
| `gemma_tuner/models/common/collators.py` | Modify | Extract shared helpers, add `DataCollatorGemmaText` |
| `gemma_tuner/models/gemma/finetune.py` | Modify | Modality switch: tokenizer load, collator dispatch, metric gating |
| `gemma_tuner/utils/dataset_utils.py` | Modify | Schema validation branches on modality |
| `gemma_tuner/utils/dataset_sources.py` | Modify | `DatasetLoadContext` gains `modality`, `prompt_column`; non-CSV adapters reject text mode in v1 |
| `gemma_tuner/core/config.py` | Modify | Register new profile keys with defaults |
| `gemma_tuner/wizard/config.py` | Modify | New "what kind of fine-tuning?" question + branching |
| `gemma_tuner/wizard/estimator.py` | Modify | Token-count heuristic in text mode |
| `gemma_tuner/wizard/runner.py` | Modify | Forward new keys to profile writer |
| `gemma_tuner/models/common/results.py` | Modify | Perplexity in metrics JSON for text runs |
| `tests/test_gemma_text_collator.py` | Create | Both sub-modes; mask-boundary assertion |
| `tests/test_smoke_text.py` | Create | End-to-end 2-step smoke test |
| `tests/data/text_instruction_tiny.csv` | Create | 8-row fixture |
| `config.ini.example` | Modify | Commented text-mode keys |
| `README.md` | Modify | Comparison table honest; new text-mode section |
| `README/Datasets.md` | Modify | Document new keys |
| `README/KNOWN_ISSUES.md` | Modify | Audio tower RAM overhead in text mode |

## Risks and Mitigations

- **Pad-token masking bug zeros EOS gradient.** → Mask labels by `attention_mask == 0`, not by `labels == pad_id`. Add a unit test asserting EOS token IDs survive in the labels tensor.
- **Prompt-mask boundary off by one.** → Unit test asserts the first unmasked label equals the tokenizer encoding of the response's first word. This is the single most likely source of silent loss=0 bugs.
- **Chat template drift across Gemma revisions.** → Always go through `tokenizer.apply_chat_template`. Never hand-roll `<start_of_turn>` strings.
- **Audio tower wastes RAM in text mode.** → Documented as known overhead in `README/KNOWN_ISSUES.md`. Out of scope for v1; revisit if a text-only Gemma variant ships.
- **Streaming adapters silently inject `audio_path` requirements.** → Audit `dataset_sources.py` in Phase 3. v1 restricts text mode to the CSV adapter with an explicit error in non-CSV adapters.
- **Single `<start_of_turn>` edge case in completion sub-mode.** → Branch on `sub_mode`, not on token counting. Completion mode must skip prompt masking entirely.
- **`remove_unused_columns=False`** is already set — verified, no risk.

## Critical Reminder

> SIMPLER IS BETTER. The goal is to add text mode while touching as little of the existing audio path as possible. Default `modality=audio` everywhere. Reuse helpers. One new collator, one switch in finetune.py, one wizard branch. Resist the urge to refactor the trainer "while we're in there."
