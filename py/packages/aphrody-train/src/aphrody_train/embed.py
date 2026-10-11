# SPDX-License-Identifier: Apache-2.0
"""Train dense embeddings from triples and export a verified ONNX model."""

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
    force_cpu: bool = False,
) -> None:
    """Fine-tune a sentence-embedding model on query/positive/negative triples.

    The trained model is exported to ONNX and checked for embedding parity
    against the PyTorch model before the artifact is reported.
    """
    triples = load_triples(triples_file)
    if steps < 1:
        raise ValueError("steps must be greater than zero")
    if len(triples) < 2:
        raise ValueError(
            "embedding training needs at least two triples for contrastive negatives"
        )
    try:
        import numpy as np
        from datasets import Dataset
        from sentence_transformers import (
            SentenceTransformer,
            SentenceTransformerTrainer,
            SentenceTransformerTrainingArguments,
            losses,
        )
    except ImportError as exc:
        raise RuntimeError(
            "embedding training dependency import failed; run "
            "uv sync --package aphrody-train --extra full; "
            f"underlying error: {exc}"
        ) from exc

    destination = Path(output_dir)
    destination.mkdir(parents=True, exist_ok=True)
    model_dir = destination / "model"
    model = SentenceTransformer(base_model, device="cpu" if force_cpu else None)
    if "e5" in base_model.lower():
        triples = [
            {
                "query": f"query: {row['query']}",
                "positive": f"passage: {row['positive']}",
                "negative": f"passage: {row['negative']}",
            }
            for row in triples
        ]
    dataset = Dataset.from_list(triples)
    args = SentenceTransformerTrainingArguments(
        output_dir=str(destination / "checkpoints"),
        max_steps=steps,
        per_device_train_batch_size=min(8, len(triples)),
        logging_steps=1,
        save_strategy="no",
        report_to="none",
        use_cpu=force_cpu,
    )
    trainer = SentenceTransformerTrainer(
        model=model,
        args=args,
        train_dataset=dataset,
        loss=losses.CachedMultipleNegativesRankingLoss(model),
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
    onnx_export.export(
        model.transformers_model, model.tokenizer, onnx_path, "last_hidden_state"
    )
    probe = [triples[0]["query"], triples[0]["positive"]]
    reference = model.encode(probe, convert_to_numpy=True)
    # The ONNX graph replaces the transformer; pooling and normalization stay in torch.
    hidden, feeds = onnx_export.run(onnx_path, model.tokenizer, probe)
    features = {
        "token_embeddings": torch.from_numpy(hidden),
        "attention_mask": torch.from_numpy(feeds["attention_mask"]),
    }
    with torch.no_grad():
        for module in list(model)[1:]:
            features = module(features)
    exported = features["sentence_embedding"].numpy()
    cosine = np.sum(reference * exported, axis=1) / (
        np.linalg.norm(reference, axis=1) * np.linalg.norm(exported, axis=1)
    )
    if not np.all(np.isfinite(cosine)) or np.min(cosine) < 0.999:
        raise RuntimeError(
            f"ONNX embedding parity failed: minimum cosine={np.min(cosine):.6f}"
        )
    payload = onnx_path.read_bytes()
    emitter.eval(steps, {"onnx_min_cosine": float(np.min(cosine))})
    emitter.artifact(
        "embed_onnx",
        str(onnx_path),
        hashlib.sha256(payload).hexdigest(),
        len(payload),
    )
    emitter.done(
        f"Trained {base_model} on {len(triples)} triples; verified {onnx_path}"
    )


@click.command()
@click.option("--job-id", default="job-embed")
@click.option("--triples-file", required=True)
@click.option("--base-model", default="intfloat/multilingual-e5-small")
@click.option("--output-dir", required=True)
@click.option("--steps", default=10, type=int)
def main(
    job_id: str, triples_file: str, base_model: str, output_dir: str, steps: int
) -> None:
    """Fine-tune an embedding model on triples and export it to ONNX."""
    emitter = TrainEmitter(job_id)
    emitter.start(
        "embed_training",
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
