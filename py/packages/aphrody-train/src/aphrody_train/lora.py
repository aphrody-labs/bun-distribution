# SPDX-License-Identifier: Apache-2.0
"""Train a PEFT LoRA adapter from guarded rollouts and export a verified GGUF adapter."""

import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

import click

from .dataset import redact
from .gates import GoldIndex
from .protocol import TrainEmitter


def load_examples(rollout_dir: Path, gold_file: Path) -> list[tuple[str, str]]:
    """Accept only prepared rollout examples after a second gold and secret check."""
    source = rollout_dir / "rollouts.jsonl"
    if source.is_symlink() or not source.is_file():
        raise ValueError(f"prepared rollouts dataset is missing: {source}")
    gold = GoldIndex.from_file(gold_file)
    examples = []
    with source.open(encoding="utf-8") as stream:
        for number, raw in enumerate(stream, 1):
            if not raw.strip():
                continue
            try:
                row = json.loads(raw)
            except json.JSONDecodeError as exc:
                raise ValueError(
                    f"invalid prepared rollout JSON at line {number}"
                ) from exc
            if not isinstance(row, dict) or not isinstance(row.get("messages"), list):
                raise ValueError(f"invalid prepared rollout at line {number}")
            row = redact(row)
            if gold.match_row(row):
                raise ValueError(
                    f"prepared rollout overlaps untouched gold at line {number}"
                )
            prompt = row.get("prompt")
            answers = [
                part.get("text")
                for message in row["messages"]
                if isinstance(message, dict) and message.get("role") == "model"
                for part in message.get("parts", [])
                if isinstance(part, dict) and isinstance(part.get("text"), str)
            ]
            answer = next(
                (
                    text
                    for text in reversed(answers)
                    if isinstance(text, str) and text.strip()
                ),
                None,
            )
            if not isinstance(prompt, str) or not prompt.strip() or answer is None:
                raise ValueError(
                    f"prepared rollout lacks a prompt or assistant answer at line {number}"
                )
            examples.append((prompt.strip(), answer.strip()))
    if not examples:
        raise ValueError(f"prepared rollouts dataset is empty: {source}")
    return examples


def validate_converter(converter: Path) -> None:
    """Require the official llama.cpp script and its bundled GGUF reader."""
    if not converter.is_file() or converter.name != "convert_lora_to_gguf.py":
        raise ValueError(
            "set APHRODY_LLAMA_CPP_CONVERTER to llama.cpp/convert_lora_to_gguf.py"
        )
    if not (converter.parent / "gguf-py" / "gguf" / "__init__.py").is_file():
        raise ValueError("llama.cpp converter is missing its gguf-py package")
    if not (converter.parent / "conversion" / "__init__.py").is_file():
        raise ValueError("llama.cpp converter is missing its conversion package")


def validate_gguf(path: Path, converter: Path) -> int:
    """Read the GGUF adapter and verify paired LoRA tensors."""
    sys.path.insert(0, str(converter.parent / "gguf-py"))
    try:
        from gguf import GGUFReader
    finally:
        sys.path.pop(0)
    reader = GGUFReader(path)
    if "adapter.type" not in reader.fields or "adapter.lora.alpha" not in reader.fields:
        raise RuntimeError("GGUF export lacks adapter metadata")
    adapter_type = reader.fields["adapter.type"]
    if bytes(adapter_type.parts[adapter_type.data[0]]) != b"lora":
        raise RuntimeError("GGUF export is not a LoRA adapter")
    alpha = float(reader.fields["adapter.lora.alpha"].parts[-1][0])
    if not 0.0 < alpha < float("inf"):
        raise RuntimeError("GGUF export has invalid LoRA alpha")
    names = [tensor.name for tensor in reader.tensors]
    a = {name.removesuffix(".lora_a") for name in names if name.endswith(".lora_a")}
    b = {name.removesuffix(".lora_b") for name in names if name.endswith(".lora_b")}
    if not a or a != b or len(names) != len(a) + len(b):
        raise RuntimeError("GGUF export lacks paired LoRA tensors")
    return len(names)


def train(
    rollout_dir: Path,
    gold_file: Path,
    base_model: Path,
    converter: Path,
    output_dir: Path,
    steps: int,
    emitter: TrainEmitter,
) -> None:
    """Train a LoRA adapter on guarded rollout examples and export it to GGUF.

    The adapter is converted with llama.cpp's ``convert_lora_to_gguf.py`` and
    the resulting file is validated before it replaces ``adapter.gguf``.
    """
    if steps < 1:
        raise ValueError("steps must be greater than zero")
    examples = load_examples(rollout_dir, gold_file)
    if not base_model.is_dir() or not (base_model / "config.json").is_file():
        raise ValueError("--base-model must be a local Hugging Face model directory")
    if output_dir.resolve() in {base_model.resolve(), rollout_dir.resolve()}:
        raise ValueError(
            "--output-dir must differ from the base model and prepared dataset"
        )
    validate_converter(converter)
    try:
        import torch
        from datasets import Dataset
        from peft import LoraConfig
        from safetensors.torch import load_file
        from transformers import AutoModelForCausalLM, AutoTokenizer
        from trl import SFTConfig, SFTTrainer
    except ImportError as exc:
        raise RuntimeError(
            "LoRA training dependency import failed; run "
            "uv sync --package aphrody-train --extra full; "
            f"underlying error: {exc}"
        ) from exc

    tokenizer = AutoTokenizer.from_pretrained(str(base_model), local_files_only=True)
    # bf16 straight onto the GPU: fp32 on the host would need ~4x the weights in RAM.
    on_gpu = torch.cuda.is_available()
    model = AutoModelForCausalLM.from_pretrained(
        str(base_model),
        local_files_only=True,
        dtype=torch.bfloat16 if on_gpu else torch.float32,
        device_map="cuda" if on_gpu else None,
        low_cpu_mem_usage=True,
    )
    dataset = Dataset.from_list(
        [
            {
                "text": tokenizer.apply_chat_template(
                    [
                        {"role": "user", "content": prompt},
                        {"role": "assistant", "content": answer},
                    ],
                    tokenize=False,
                )
            }
            for prompt, answer in examples
        ]
    )
    output_dir.mkdir(parents=True, exist_ok=True)
    args = SFTConfig(
        output_dir=str(output_dir / "checkpoints"),
        max_steps=steps,
        per_device_train_batch_size=1,
        max_length=512,
        use_cpu=not torch.cuda.is_available(),
        gradient_checkpointing=torch.cuda.is_available(),
        bf16=torch.cuda.is_available(),
        save_strategy="no",
        report_to="none",
        logging_steps=1,
    )
    # Defaults keep the historical r=4 q/v adapter; APHRODY_LORA_RANK and
    # APHRODY_LORA_TARGETS (comma list) widen it for larger datasets.
    rank = int(os.environ.get("APHRODY_LORA_RANK", "4"))
    targets = [
        name.strip()
        for name in os.environ.get("APHRODY_LORA_TARGETS", "q_proj,v_proj").split(",")
        if name.strip()
    ]
    peft_config = LoraConfig(
        r=rank,
        lora_alpha=rank * 2,
        target_modules=targets,
        task_type="CAUSAL_LM",
    )
    trainer = SFTTrainer(
        model=model,
        args=args,
        train_dataset=dataset,
        processing_class=tokenizer,
        peft_config=peft_config,
    )
    trainer.train()
    for record in trainer.state.log_history:
        if "loss" in record:
            emitter.progress(
                step=int(record["step"]),
                total_steps=steps,
                loss=float(record["loss"]),
                lr=float(record.get("learning_rate", 0.0)),
            )

    adapter_dir = output_dir / "adapter"
    if trainer.model is None:
        raise RuntimeError("LoRA trainer produced no model to save")
    saved_model: Any = trainer.model
    saved_model.save_pretrained(adapter_dir)
    adapter_file = adapter_dir / "adapter_model.safetensors"
    weights = load_file(str(adapter_file))
    if any(not torch.isfinite(weight).all() for weight in weights.values()):
        raise RuntimeError("LoRA training produced non-finite adapter weights")
    updated = sum(
        1
        for name, weight in weights.items()
        if "lora_B" in name
        and torch.isfinite(weight).all()
        and torch.count_nonzero(weight).item() > 0
    )
    if not weights or updated == 0:
        raise RuntimeError("LoRA training produced no finite updated adapter weights")

    staging = output_dir / "adapter.gguf.tmp"
    gguf_file = output_dir / "adapter.gguf"
    try:
        conversion = subprocess.run(
            [
                sys.executable,
                str(converter),
                "--base",
                str(base_model),
                "--outfile",
                str(staging),
                str(adapter_dir),
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        if conversion.returncode != 0:
            detail = (
                conversion.stderr.strip().splitlines()[-1]
                if conversion.stderr.strip()
                else "no error details"
            )
            raise RuntimeError(
                f"llama.cpp GGUF conversion failed (exit {conversion.returncode}): {redact(detail)}"
            )
        tensor_count = validate_gguf(staging, converter)
        os.replace(staging, gguf_file)
    finally:
        staging.unlink(missing_ok=True)
    payload = gguf_file.read_bytes()
    emitter.eval(
        steps,
        {
            "updated_lora_matrices": float(updated),
            "gguf_tensors": float(tensor_count),
        },
    )
    emitter.artifact(
        "lora_gguf",
        str(gguf_file),
        hashlib.sha256(payload).hexdigest(),
        len(payload),
    )
    emitter.done(
        f"Trained LoRA on {len(examples)} guarded examples; verified {gguf_file}"
    )


@click.command()
@click.option("--job-id", default="job-lora")
@click.option("--rollout-dir", required=True, type=click.Path(path_type=Path))
@click.option("--gold-file", required=True, type=click.Path(path_type=Path))
@click.option("--base-model", required=True, type=click.Path(path_type=Path))
@click.option("--output-dir", required=True, type=click.Path(path_type=Path))
@click.option("--steps", default=10, type=int)
def main(
    job_id: str,
    rollout_dir: Path,
    gold_file: Path,
    base_model: Path,
    output_dir: Path,
    steps: int,
) -> None:
    """Train a LoRA adapter from verified rollouts and export it as GGUF."""
    emitter = TrainEmitter(job_id)
    emitter.start(
        "lora_training",
        steps,
        {"base_model": str(base_model), "rollout_dir": str(rollout_dir)},
    )
    try:
        converter = Path(os.environ.get("APHRODY_LLAMA_CPP_CONVERTER", ""))
        train(
            rollout_dir,
            gold_file,
            base_model,
            converter,
            output_dir,
            steps,
            emitter,
        )
    except Exception as exc:
        emitter.error(str(exc))
        raise click.ClickException(str(exc)) from exc


if __name__ == "__main__":
    main()
