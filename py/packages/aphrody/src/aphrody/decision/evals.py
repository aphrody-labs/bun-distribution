# SPDX-License-Identifier: Apache-2.0
"""Curated labeled corpus and Pydantic Evals; no training or telemetry implied."""

import json
from collections.abc import Iterable

from pydantic_evals import Case, Dataset
from pydantic_evals.evaluators import EqualsExpected

from .contracts import DecisionInput, LabeledDecision


def evaluation_dataset(rows: Iterable[LabeledDecision], *, split: str = "test"):
    items = list(rows)
    if len({row.id for row in items}) != len(items):
        raise ValueError("corpus IDs must be unique across splits")
    if split not in {"validation", "test"}:
        raise ValueError("evaluation must use a held-out split")
    return Dataset[DecisionInput, str | None, dict[str, str]](
        name=f"aphrody-yolo-{split}",
        cases=[
            Case(
                name=row.id,
                inputs=row.inputs,
                expected_output=row.expected_action,
                metadata={"source": row.source, "split": row.split},
            )
            for row in items
            if row.split == split
        ],
        evaluators=[EqualsExpected()],
    )


def training_jsonl(rows: Iterable[LabeledDecision]) -> str:
    """Export only caller-supplied train rows, in Jev request/label format.

    The caller owns protected storage and dataset approval. This produces no
    weights and makes no assertion that Yolo has learned a decision policy.
    """
    items = list(rows)
    if len({row.id for row in items}) != len(items):
        raise ValueError("corpus IDs must be unique across splits")
    return "".join(
        json.dumps(
            {
                "id": row.id,
                "source": row.source,
                "request": row.inputs.jev_request(),
                "label": row.expected_action,
            },
            allow_nan=False,
            ensure_ascii=False,
        )
        + "\n"
        for row in items
        if row.split == "train"
    )
