# SPDX-License-Identifier: Apache-2.0
"""Small CPU training run that verifies the embedding and ONNX pipeline."""

import json
import tempfile
from pathlib import Path

import click

from .embed import train
from .protocol import TrainEmitter


def write_probe_triples(path: Path) -> None:
    """Create deterministic distinct examples for a pipeline smoke run."""
    with path.open("w", encoding="utf-8") as stream:
        for number in range(50):
            row = {
                "query": f"Find the training probe passage numbered {number}.",
                "positive": f"Training probe passage {number} contains the matching identifier {number}.",
                "negative": f"Unrelated training probe passage {number + 100} has a different identifier.",
            }
            stream.write(json.dumps(row) + "\n")


@click.command()
@click.option("--job-id", default="dry-run-001")
@click.option("--steps", default=10, type=int)
@click.option("--output-dir", default="./artifacts")
def main(job_id: str, steps: int, output_dir: str) -> None:
    """Train all-MiniLM on 50 local triples and verify the resulting ONNX model."""
    emitter = TrainEmitter(job_id)
    emitter.start(
        "dry_run",
        steps,
        {
            "device": "cpu",
            "base_model": "sentence-transformers/all-MiniLM-L6-v2",
        },
    )
    try:
        with tempfile.TemporaryDirectory(prefix="aphrody-train-probe-") as scratch:
            triples_file = Path(scratch) / "triples.jsonl"
            write_probe_triples(triples_file)
            train(
                str(triples_file),
                "sentence-transformers/all-MiniLM-L6-v2",
                output_dir,
                steps,
                emitter,
                force_cpu=True,
            )
    except Exception as exc:
        emitter.error(str(exc))
        raise click.ClickException(str(exc)) from exc


if __name__ == "__main__":
    main()
