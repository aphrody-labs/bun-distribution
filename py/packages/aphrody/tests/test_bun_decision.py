# SPDX-License-Identifier: Apache-2.0
"""Consumer adapter fixtures; native execution is qualified by the runtime SDK."""

import asyncio

import pytest

from aphrody.decision import Action, DecisionInput, YoloDecision
from aphrody.decision.backend import bind_response
from aphrody.decision.bun_transport import BunTransport


def inputs():
    return DecisionInput(
        goal="Find a public owner source",
        observations={"source": {"kind": "curated", "public": True}},
        actions=[
            Action(id="read", description="Read docs"),
            Action(id="search", description="Search graph"),
        ],
        model="synthetic-fixture",
        minimum_confidence=0.8,
        deadline_seconds=1.0,
    )


@pytest.mark.parametrize("selection", ["read", None])
def test_bun_adapter_preserves_native_selection_and_existing_graph_contract(selection):
    calls = []
    raw = {
        "model": "synthetic-fixture",
        "answers": {
            "action": {
                "type": "choice",
                "choice": "read",
                "confidence": 0.9,
                "probabilities": {"read": 0.9, "search": 0.1},
            }
        },
        "usage": {"input_tokens": 12, "output_tokens": 3},
        "selections": {"action": selection},
    }

    class Client:
        async def inspect_async(self, state, questions, **options):
            calls.append((state, questions, options))
            return raw

    transport = BunTransport(Client())
    response = asyncio.run(transport(inputs()))
    assert response.model_dump() == raw
    output = bind_response(inputs(), response)
    assert output.action_id == selection
    assert output.status == ("selected" if selection else "abstained")
    assert output.executed is False
    assert calls[0][2] == {
        "model": "synthetic-fixture",
        "minimum_confidence": 0.8,
        "options": {"timeout": 1000, "maxRetries": 0},
    }
    calls.clear()
    graph_output = asyncio.run(YoloDecision(transport).decide(inputs()))
    assert graph_output.action_id == selection
    assert len(calls) == 1
