# SPDX-License-Identifier: Apache-2.0
"""Explicit installed SDK/Bun gate; synthetic native provider, no network."""

import asyncio
import json
import os

import pytest

from aphrody.decision import Action, DecisionInput, YoloDecision, decide_async_json


@pytest.mark.skipif(
    os.environ.get("BUN_YOLO_NATIVE_GATE") != "1",
    reason="Native Bun + SDK ABI1.6 consumer cutover not selected",
)
@pytest.mark.parametrize("usage", [None, {"input_tokens": 12, "output_tokens": 3}])
def test_existing_graph_uses_real_bun_stdio_and_rust_abstention(usage):
    from bun_yolo import Yolo
    from yolo_runtime import Runtime

    executable = os.environ["BUN_YOLO_EXECUTABLE"]
    revision = os.environ["BUN_YOLO_REVISION"]
    inputs = DecisionInput(
        goal="Inspect the supplied synthetic source catalogue",
        actions=[
            Action(id="read", description="Read source"),
            Action(id="search", description="Search graph"),
        ],
        model="synthetic-fixture",
        minimum_confidence=0.8,
        deadline_seconds=5.0,
    )
    raw = {
        "model": "synthetic-fixture",
        "answers": {
            "action": {
                "type": "choice",
                "choice": "read",
                "confidence": 0.6,
                "probabilities": {"read": 0.6, "search": 0.4},
            }
        },
        "usage": usage,
    }
    with Runtime() as runtime:
        client = Yolo(
            runtime, executable, revision=revision, transport_timeout_ms=10000
        )

        class FixtureProvider:
            async def inspect_async(self, state, questions, **options):
                return await client.inspect_async(
                    state,
                    questions,
                    provider={"kind": "code", "response": raw},
                    **options,
                )

        borrowed = FixtureProvider()
        result = asyncio.run(YoloDecision.from_bun(borrowed).decide(inputs))
        assert result.action_id is None
        assert result.candidate == "read"
        assert result.confidence == 0.6
        assert result.probabilities == {"read": 0.6, "search": 0.4}
        assert result.model_dump()["usage"] == usage
        assert result.executed is False
        serialized = asyncio.run(
            decide_async_json(inputs.model_dump_json(), bun_client=borrowed)
        )
        assert json.loads(serialized) == result.model_dump()
