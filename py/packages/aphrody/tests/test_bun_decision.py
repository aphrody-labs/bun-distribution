# SPDX-License-Identifier: Apache-2.0
"""Consumer adapter fixtures; native execution is qualified by the runtime SDK."""

import asyncio
import json

import pytest
from pydantic import ValidationError
from pydantic_ai.messages import ModelResponse

from aphrody.decision import (
    Action,
    BunTransport,
    DecisionInput,
    YoloDecision,
    decide_async_json,
    decide_json,
)
from aphrody.decision.backend import bind_response
from aphrody.decision.contracts import JevResponse, LabeledDecision
from aphrody.decision.evals import evaluation_dataset, training_jsonl


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


def fixture_response(selection="read", usage=None):
    return {
        "model": "synthetic-fixture",
        "answers": {
            "action": {
                "type": "choice",
                "choice": "read",
                "confidence": 0.9,
                "probabilities": {"read": 0.9, "search": 0.1},
            }
        },
        "usage": usage,
        "selections": {"action": selection},
    }


@pytest.mark.parametrize("selection", ["read", None])
@pytest.mark.parametrize(
    "usage",
    [
        None,
        {"input_tokens": 12, "output_tokens": 3},
        {"input_tokens": 0, "output_tokens": 0},
    ],
)
def test_bun_adapter_preserves_native_selection_and_existing_graph_contract(
    selection, usage
):
    calls = []
    raw = fixture_response(selection, usage)

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
    graph_output = asyncio.run(YoloDecision.from_bun(transport.client).decide(inputs()))
    assert graph_output.action_id == selection
    assert graph_output.model_dump()["usage"] == usage
    assert json.loads(graph_output.model_dump_json())["usage"] == usage
    assert len(calls) == 1


@pytest.mark.parametrize(
    "usage",
    [
        {},
        {"input_tokens": 12},
        {"output_tokens": 3},
        {"input_tokens": -1, "output_tokens": 0},
    ],
)
def test_missing_or_partial_usage_cannot_become_measured_zero(usage):
    with pytest.raises(ValidationError):
        JevResponse.model_validate(fixture_response(usage=usage))


def test_usage_requires_explicit_unknown_or_counts():
    raw = fixture_response()
    raw.pop("usage")
    with pytest.raises(ValidationError):
        JevResponse.model_validate(raw)


def test_agent_accounting_labels_unreported_usage_without_changing_proposal():
    class Client:
        async def inspect_async(self, *_args, **_options):
            return fixture_response()

    graph = YoloDecision.from_bun(Client())
    result = asyncio.run(graph.agent.run(inputs().model_dump_json()))
    assert result.output.usage is None
    assert result.usage.details["aphrody_provider_usage_missing"] == 1
    replies = [
        message
        for message in result.all_messages()
        if isinstance(message, ModelResponse)
    ]
    assert replies[-1].metadata == {"aphrody_provider_usage": None}


def test_public_json_helpers_borrow_bun_client_without_http_or_environment_fallback(
    monkeypatch,
):
    import httpx

    calls = []

    class Client:
        async def inspect_async(self, state, questions, **options):
            calls.append((state, questions, options))
            return fixture_response()

    def refuse_http(*_args, **_kwargs):
        pytest.fail("a borrowed Bun client must not create an HTTP client")

    monkeypatch.setattr(httpx, "AsyncClient", refuse_http)
    monkeypatch.setenv(
        "APHRODY_YOLO_DECISION_ENDPOINT", "https://unused.invalid/v1/systemone"
    )
    client = Client()
    argument = inputs().model_dump_json()
    asynchronous = asyncio.run(decide_async_json(argument, bun_client=client))
    synchronous = decide_json(argument, bun_client=client)
    assert asynchronous == synchronous
    assert json.loads(asynchronous)["usage"] is None
    assert json.loads(asynchronous)["executed"] is False
    assert len(calls) == 2
    with pytest.raises(ValueError, match="select either"):
        asyncio.run(
            decide_async_json(
                argument, "https://unused.invalid/v1/systemone", bun_client=client
            )
        )
    with pytest.raises(ValueError, match="select either"):
        asyncio.run(decide_async_json(argument, token="synthetic", bun_client=client))
    with pytest.raises(ValueError, match="explicit borrowed"):
        asyncio.run(decide_async_json(argument))
    assert len(calls) == 2


def test_bun_graph_deadline_joins_client_cancellation():
    stopped = asyncio.Event()

    class Client:
        async def inspect_async(self, *_args, **_options):
            try:
                await asyncio.Event().wait()
            finally:
                stopped.set()

    with pytest.raises(TimeoutError):
        asyncio.run(YoloDecision.from_bun(Client()).decide(inputs()))
    assert stopped.is_set()


def test_bun_graph_remains_compatible_with_heldout_evals_and_curated_export():
    class Client:
        async def inspect_async(self, *_args, **_options):
            return fixture_response(None)

    rows = [
        LabeledDecision(
            id=split,
            split=split,
            source="synthetic",
            inputs=inputs(),
            expected_action=None,
        )
        for split in ("train", "validation", "test")
    ]
    graph = YoloDecision.from_bun(Client())

    async def infer(value):
        result = await graph.decide(value)
        assert result.usage is None
        assert result.executed is False
        return result.action_id

    report = asyncio.run(evaluation_dataset(rows).evaluate(infer, progress=False))
    assert len(report.cases) == 1
    assert report.cases[0].output is None
    assert [json.loads(line)["id"] for line in training_jsonl(rows).splitlines()] == [
        "train"
    ]
