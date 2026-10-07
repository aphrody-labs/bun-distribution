# SPDX-License-Identifier: Apache-2.0
"""Real 4-bit Gemma LoRA training on a private, held-out Bun corpus."""

import argparse
import hashlib
import json
from pathlib import Path


def train(base: Path, corpus: Path, output: Path, steps: int) -> dict:
    if steps < 1:
        raise ValueError("Training steps must be positive")
    import torch
    from datasets import Dataset
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
        Trainer,
        TrainingArguments,
        default_data_collator,
    )

    if output.exists():
        raise ValueError("Training output must be new; never overwrite a checkpoint")
    if not torch.cuda.is_available():
        raise RuntimeError("This recipe requires CUDA for 4-bit training")
    manifest = json.loads((corpus / "manifest.json").read_text())
    for split in ["train", "eval"]:
        if (
            hashlib.sha256((corpus / f"{split}.jsonl").read_bytes()).hexdigest()
            != manifest["splits"][split]["sha256"]
        ):
            raise ValueError("Corpus checksum mismatch")
    tokenizer = AutoTokenizer.from_pretrained(base, local_files_only=True)
    tokenizer.padding_side = "right"
    if tokenizer.pad_token_id is None:
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        base,
        local_files_only=True,
        device_map={"": 0},
        dtype=torch.bfloat16,
        quantization_config=BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_use_double_quant=True,
            bnb_4bit_compute_dtype=torch.bfloat16,
        ),
        attn_implementation="sdpa",
    )
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    model = get_peft_model(
        model,
        LoraConfig(
            r=8,
            lora_alpha=16,
            lora_dropout=0.05,
            target_modules=["q_proj", "v_proj"],
            task_type="CAUSAL_LM",
        ),
    )
    model.config.use_cache = False
    maximum = 512

    def load(split: str) -> Dataset:
        rows = []
        for raw in (corpus / f"{split}.jsonl").read_text().splitlines():
            messages = json.loads(raw)["messages"]
            prefix = tokenizer.apply_chat_template(
                messages[:-1], tokenize=True, add_generation_prompt=True
            )
            tokens = tokenizer.apply_chat_template(
                messages, tokenize=True, add_generation_prompt=False
            )
            if tokens[: len(prefix)] != prefix:
                raise ValueError(
                    "Chat template prefix mismatch; refusing incorrect loss masking"
                )
            if len(prefix) >= maximum - 16:
                continue
            # A truncated answer teaches incomplete code; preserve complete targets.
            if len(tokens) > maximum:
                continue
            padding = maximum - len(tokens)
            rows.append(
                {
                    "input_ids": tokens + [tokenizer.pad_token_id] * padding,
                    "attention_mask": [1] * len(tokens) + [0] * padding,
                    "labels": [-100] * len(prefix)
                    + tokens[len(prefix) :]
                    + [-100] * padding,
                }
            )
        if not rows:
            raise ValueError("No supervised examples remain after tokenization")
        return Dataset.from_list(rows)

    training, evaluation = load("train"), load("eval")
    output.mkdir(parents=True, mode=0o700)
    args = TrainingArguments(
        output_dir=str(output / "checkpoints"),
        max_steps=steps,
        per_device_train_batch_size=1,
        per_device_eval_batch_size=1,
        gradient_accumulation_steps=4,
        learning_rate=2e-4,
        warmup_ratio=0.05,
        bf16=True,
        gradient_checkpointing=True,
        optim="adamw_torch",
        logging_steps=1,
        save_steps=50,
        save_total_limit=2,
        report_to="none",
        seed=42,
    )
    trainer = Trainer(
        model=model,
        args=args,
        train_dataset=training,
        eval_dataset=evaluation,
        data_collator=default_data_collator,
    )
    baseline = trainer.evaluate()
    initial = {
        name: tensor.detach().cpu().clone()
        for name, tensor in model.named_parameters()
        if tensor.requires_grad
    }
    result = trainer.train()
    changed = sum(
        not torch.equal(initial[name], tensor.detach().cpu())
        for name, tensor in model.named_parameters()
        if tensor.requires_grad
    )
    if not changed:
        raise RuntimeError("Training changed no adapter tensors")
    final = trainer.evaluate()
    adapter = output / "adapter"
    model.save_pretrained(adapter)
    tokenizer.save_pretrained(adapter)
    report = {
        "fork_revision": manifest["fork_revision"],
        "steps": result.global_step,
        "train_rows": len(training),
        "eval_rows": len(evaluation),
        "baseline": baseline,
        "final": final,
        "changed_adapter_tensors": changed,
        "adapter_sha256": hashlib.sha256(
            (adapter / "adapter_model.safetensors").read_bytes()
        ).hexdigest(),
        "limits": "Loss evaluation is not executable Bun correctness or proof of exclusive Bun knowledge; deployment remains gated on task evaluation.",
    }
    (output / "report.json").write_text(json.dumps(report, indent=2) + "\n")
    print(json.dumps(report), flush=True)
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", type=Path, required=True)
    parser.add_argument("--corpus", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--steps", type=int, default=144)
    args = parser.parse_args()
    if args.steps < 1:
        parser.error("steps must be positive")
    train(args.base, args.corpus, args.output, args.steps)
