# SPDX-License-Identifier: Apache-2.0
"""Train a cross-encoder from labeled triples and export verified ONNX."""

import hashlib
from pathlib import Path

import click

from . import onnx_export
from .protocol import TrainEmitter
from .training_data import load_triples


def train(
    triples_file: str,
    base_model: str,
    output_dir: str,
    steps: int,
    emitter: TrainEmitter,
) -> None:
    """Fine-tune a cross-encoder reranker on query/positive/negative triples.

    The trained model is exported to ONNX and its scores are compared with
    the PyTorch model before the artifact is reported.
    """
    triples = load_triples(triples_file)
    if steps < 1:
        raise ValueError("steps must be greater than zero")
    try:
        import numpy as np
        from datasets import Dataset
        from sentence_transformers.cross_encoder import (
            CrossEncoder,
            CrossEncoderTrainer,
            CrossEncoderTrainingArguments,
            losses,
        )
    except ImportError as exc:
        raise RuntimeError(
            "reranker training dependency import failed; run "
            "uv sync --package aphrody-train --extra full; "
            f"underlying error: {exc}"
        ) from exc

    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    model_dir = destination / "model"
    rows = []
    for triple in triples:
        rows.append(
            {
                "query": triple["query"],
                "document": triple["positive"],
                "label": 1.0,
            }
        )
        rows.append(
            {
                "query": triple["query"],
                "document": triple["negative"],
                "label": 0.0,
            }
        )
    dataset = Dataset.from_list(rows)
    model = CrossEncoder(base_model, num_labels=1)
    args = CrossEncoderTrainingArguments(
        output_dir=str(destination / "checkpoints"),
        max_steps=steps,
        per_device_train_batch_size=min(8, len(rows)),
        logging_steps=1,
        save_strategy="no",
        report_to="none",
    )
    trainer = CrossEncoderTrainer(
        model=model,
        args=args,
        train_dataset=dataset,
        loss=losses.BinaryCrossEntropyLoss(model),
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
    model.save_pretrained(str(model_dir))
    import torch  # installed with sentence-transformers

    model.to("cpu")
    onnx_path = model_dir / "onnx" / "model.onnx"
    onnx_export.export(model.transformers_model, model.tokenizer, onnx_path, "logits")
    queries = [triples[0]["query"], triples[0]["query"]]
    documents = [triples[0]["positive"], triples[0]["negative"]]
    logits, feeds = onnx_export.run(onnx_path, model.tokenizer, queries, documents)
    with torch.no_grad():
        output = model.transformers_model(
            **{name: torch.from_numpy(value) for name, value in feeds.items()}
        )
    reference = output.logits.numpy().reshape(-1)
    exported = np.asarray(logits).reshape(-1)
    if not np.allclose(reference, exported, rtol=1e-3, atol=1e-4):
        raise RuntimeError("ONNX reranker parity failed")
    payload = onnx_path.read_bytes()
    emitter.eval(
        steps,
        {"onnx_max_abs_diff": float(np.max(np.abs(reference - exported)))},
    )
    emitter.artifact(
        "rerank_onnx",
        str(onnx_path),
        hashlib.sha256(payload).hexdigest(),
        len(payload),
    )
    emitter.done(
        f"Trained {base_model} on {len(triples)} triples; verified {onnx_path}"
    )


@click.command()
@click.option("--job-id", default="job-rerank")
@click.option("--triples-file", required=True)
@click.option("--base-model", default="BAAI/bge-reranker-base")
@click.option("--output-dir", required=True)
@click.option("--steps", default=10, type=int)
def main(
    job_id: str, triples_file: str, base_model: str, output_dir: str, steps: int
) -> None:
    """Fine-tune a cross-encoder reranker on triples and export it to ONNX."""
    emitter = TrainEmitter(job_id)
    emitter.start(
        "rerank_training",
        steps,
        {"base_model": base_model, "triples_file": triples_file},
    )
    try:
        train(triples_file, base_model, output_dir, steps, emitter)
    except Exception as exc:
        emitter.error(str(exc))
        raise click.ClickException(str(exc)) from exc


if __name__ == "__main__":
    main()
