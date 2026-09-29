# aphrody-train

Training surface for aphrody (P10, docs/plans/codex-oss.md):
- `triples`: Generates dataset triples `(query, positive, negative)` from distinct source chunks with a required, readable gold set when `--gold-file` is supplied.
- `embed`: Fine-tunes dense text embeddings with MultipleNegativesRankingLoss / Matryoshka and exports to ONNX.
- `rerank`: Fine-tunes cross-encoder rerankers and exports to ONNX.
- `lora`: Fine-tunes a PEFT LoRA adapter from guarded `dataset rollouts` output, then converts it to a verified GGUF adapter with llama.cpp. QLoRA and DPO training are not implemented.
- `dry_run`: Runs actual CPU all-MiniLM training on 50 deterministic probe triples and verifies its ONNX export; it requires the full training dependencies.
- `dataset rollouts|dpo`: Exports redacted JSONL from Rust rollout records. Successful turns require a final message and successful tool results. DPO pairs require a failed/denied call followed by a successful same-tool repair in one turn. Both require `--gold-file`; matching queries and URLs are excluded.
- `protocol`: Emits streaming JSONL events (`start`, `progress`, `eval`, `checkpoint`, `artifact`, `done`, `error`) to stdout.

Install `--extra full` before `embed` or `rerank`. Both commands require a
nonempty triples JSONL file, train a checkpoint, export ONNX and verify its
output against the trained model before emitting `artifact` and `done`.

LoRA uses a full precision base model; 4-bit QLoRA is not implemented. It
requires a local Hugging Face base model, a prepared directory containing
`rollouts.jsonl` from `dataset rollouts`, the untouched gold JSONL, and an
official llama.cpp checkout. Set `APHRODY_LLAMA_CPP_CONVERTER` to its
`convert_lora_to_gguf.py` path, then run with `uv run --project py/aphrody-train
--extra full python -m aphrody_train.lora --rollout-dir <prepared-dir>
--gold-file <gold.jsonl> --base-model <local-model-dir> --output-dir <output-dir>`.
The output `adapter.gguf` is a LoRA adapter and needs the matching base model
in GGUF at inference time; it is not a standalone merged model. The trainer
rechecks gold overlap, redacts known secret forms, and verifies nonzero finite
adapter weights and GGUF tensor pairs before reporting success. Model quality
still requires an independent evaluation before promotion.

Dataset extraction is available as `uv run --project py/aphrody-train python -m aphrody_train.dataset rollouts --rollout-dir <dir> --gold-file <gold.jsonl> --output-dir <dir>` (or `dpo`). Redaction covers credential fields and common token forms; review generated datasets before external publication because arbitrary secrets cannot be recognized by patterns alone.
