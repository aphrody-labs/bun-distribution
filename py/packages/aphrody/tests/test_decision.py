# SPDX-License-Identifier: Apache-2.0
"""Synthetic, offline contract qualification; no real model accuracy claims."""

import asyncio
import json

import httpx
import pytest
from pydantic import ValidationError

from aphrody.decision import Action, DecisionInput, LabeledDecision, YoloDecision
from aphrody.decision.backend import JevHTTP, bind_response
from aphrody.decision.contracts import JevResponse
from aphrody.decision.evals import evaluation_dataset, training_jsonl


def inputs(**overrides):
    return DecisionInput(
        goal="Find the configured capability owner",
        model="synthetic-fixture",
        actions=[
            Action(id="read", description="Read the owner docs"),
            Action(id="search", description="Search the native graph"),
        ],
        **overrides,
    )


def response(selection="read"):
    return {
        "model": "synthetic-fixture",
        "usage": {"input_tokens": 12, "output_tokens": 3},
        "answers": {
            "action": {
                "type": "choice",
                "choice": "read",
                "confidence": 0.9,
                "probabilities": {"read": 0.9, "search": 0.1},
            }
        },
        "selections": {"action": selection},
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("selection", ["read", None])
async def test_graph_delegates_policy_to_native_owner(selection):
    calls = []

    async def transport(value):
        calls.append(value)
        return JevResponse.model_validate(response(selection))

    output = await YoloDecision(transport).decide(inputs())
    assert len(calls) == 1
    assert output.action_id == selection
    assert output.candidate == "read"
    assert output.executed is False
    assert output.status == ("abstained" if selection is None else "selected")
    assert output.usage.input_tokens == 12


@pytest.mark.asyncio
async def test_http_passes_exact_jev_contract_and_threshold():
    def handler(request):
        assert request.url.path == "/v1/systemone"
        assert request.url.params["minimum_confidence"] == "0.8"
        assert json.loads(request.content) == inputs().jev_request()
        return httpx.Response(200, json=response())

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        output = await YoloDecision(
            JevHTTP("http://127.0.0.1:8787/v1/systemone", client)
        ).decide(inputs())
    assert output.action_id == "read"


@pytest.mark.asyncio
@pytest.mark.parametrize("token", [None, "synthetic-auth-fixture"])
async def test_json_helper_uses_only_explicit_backend_auth(monkeypatch, token):
    from aphrody.decision.workflow import decide_async_json

    def handler(request):
        if request.headers.get("Authorization") != "Bearer synthetic-auth-fixture":
            return httpx.Response(401, json={"error": "fixture auth rejected"})
        return httpx.Response(200, json=response())

    constructor = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: constructor(
            transport=httpx.MockTransport(handler),
            **kwargs,
        ),
    )
    if token is None:
        with pytest.raises(RuntimeError, match="HTTP 401"):
            await decide_async_json(
                inputs().model_dump_json(), "http://127.0.0.1/v1/systemone"
            )
    else:
        raw = await decide_async_json(
            inputs().model_dump_json(), "http://127.0.0.1/v1/systemone", token=token
        )
        assert json.loads(raw)["action_id"] == "read"


@pytest.mark.parametrize(
    "patch",
    [
        {"minimum_confidence": float("nan")},
        {"minimum_confidence": 1.1},
        {"deadline_seconds": 0},
        {"deadline_seconds": float("inf")},
        {"observations": {"invalid": float("nan")}},
    ],
)
def test_invalid_inputs(patch):
    with pytest.raises(ValidationError):
        inputs(**patch)


def test_duplicate_actions_and_labels():
    with pytest.raises(ValidationError):
        DecisionInput(
            goal="test",
            model="fixture",
            actions=[
                Action(id="read", description="one"),
                Action(id="read", description="two"),
            ],
        )
    with pytest.raises(ValidationError):
        LabeledDecision(
            id="invalid",
            split="test",
            source="synthetic",
            inputs=inputs(),
            expected_action="execute",
        )


@pytest.mark.parametrize(
    "mutate",
    [
        lambda raw: raw.pop("selections"),
        lambda raw: raw["answers"]["action"].update(choice="execute"),
        lambda raw: raw["answers"]["action"].update(confidence=float("nan")),
        lambda raw: raw["selections"].update(action="search"),
        lambda raw: raw["answers"]["action"]["probabilities"].update(execute=0.0),
    ],
)
def test_malformed_backend_is_not_actionable(mutate):
    raw = response()
    mutate(raw)
    with pytest.raises((ValidationError, ValueError)):
        bind_response(inputs(), JevResponse.model_validate(raw))


@pytest.mark.asyncio
async def test_deadline_cancels_transport():
    stopped = asyncio.Event()

    async def transport(_value):
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    with pytest.raises(TimeoutError):
        await YoloDecision(transport).decide(inputs(deadline_seconds=1.0))
    assert stopped.is_set()


@pytest.mark.asyncio
async def test_failure_not_retried_or_hidden():
    calls = 0

    async def transport(_value):
        nonlocal calls
        calls += 1
        raise RuntimeError("fixture failure")

    with pytest.raises(RuntimeError, match="fixture failure"):
        await YoloDecision(transport).decide(inputs())
    assert calls == 1


@pytest.mark.parametrize(
    "endpoint",
    [
        "http://example.com/v1/systemone",
        "https://user:password@example.com/v1/systemone",
        "https://example.com/v1/systemone?token=secret",
        "http://127.0.0.1/other",
    ],
)
def test_endpoint_refuses_unqualified_transport(endpoint):
    with pytest.raises(ValueError):
        JevHTTP(endpoint, None)


@pytest.mark.asyncio
async def test_evals_and_training_keep_heldout_data_separate():
    rows = [
        LabeledDecision(
            id=split,
            split=split,
            source="synthetic",
            inputs=inputs(),
            expected_action="read",
        )
        for split in ("train", "validation", "test")
    ]
    training = [json.loads(line) for line in training_jsonl(rows).splitlines()]
    assert [row["id"] for row in training] == ["train"]
    dataset = evaluation_dataset(rows)
    assert [case.name for case in dataset.cases] == ["test"]
    report = await dataset.evaluate(lambda _value: "read", progress=False)
    assert len(report.cases) == 1
    with pytest.raises(ValueError):
        evaluation_dataset(rows, split="train")


def test_typesafe_sdk_sync_three_primitives_and_lifecycle():
    import httpx2
    from typesafe_sdk import SystemOneResponse

    from aphrody.decision.typesafe import Choice, Noul, Score, YoloTypeSafeClient

    class Transport(httpx2.BaseTransport):
        def handle_request(self, request):
            raw = json.loads(request.content)
            assert request.url.path == "/v1/systemone"
            assert raw["questions"]["route"]["criteria"]["read"] == "read"
            return httpx2.Response(
                200,
                json={
                    "model": "fixture",
                    "usage": {"input_tokens": 12, "output_tokens": 3},
                    "answers": {
                        "route": {
                            "type": "choice",
                            "choice": "read",
                            "confidence": 0.9,
                            "probabilities": {"read": 0.9, "search": 0.1},
                        },
                        "ready": {"type": "noul", "noul": 0.7},
                        "quality": {
                            "type": "score",
                            "score": 1.0,
                            "confidence": 0.8,
                            "probabilities": {"0": 0.0, "1": 1.0},
                            "legend": {"0": "bad", "1": "good"},
                        },
                    },
                },
            )

    with YoloTypeSafeClient(
        base_url="http://127.0.0.1:8787/v1",
        api_key="fixture",
        model="fixture",
        transport=Transport(),
    ) as client:
        result = client.system_one(
            "state",
            {
                "route": Choice(criteria={"read": None, "search": "Search"}),
                "ready": Noul(instructions="Ready?"),
                "quality": Score(criteria=["bad", "good"]),
            },
        )
    assert isinstance(result, SystemOneResponse)
    assert result.choices["route"].choice == "read"
    assert result.nouls["ready"].noul == 0.7
    assert result.scores["quality"].score == 1.0


@pytest.mark.asyncio
async def test_typesafe_sdk_async():
    import httpx2

    from aphrody.decision.typesafe import AsyncYoloTypeSafeClient, Choice

    class Transport(httpx2.AsyncBaseTransport):
        async def handle_async_request(self, _request):
            raw = response()
            raw.pop("selections")
            return httpx2.Response(200, json=raw)

    async with AsyncYoloTypeSafeClient(
        base_url="http://127.0.0.1:8787/v1",
        api_key="fixture",
        model="fixture",
        transport=Transport(),
    ) as client:
        result = await client.system_one(
            "state", {"action": Choice(criteria={"read": "Read", "search": "Search"})}
        )
    assert result.choices["action"].choice == "read"


def test_actual_upstream_adapter_comparison_uses_typed_protocol():
    from system_one_adapter.providers import ProviderResult

    from aphrody.decision.typesafe import Choice, comparison_client

    class Provider:
        model_name = "synthetic-comparison"

        def request(self, _messages, *, schema, structured):
            assert structured
            return ProviderResult(
                text='{"answers":{"action":{"read":0.9,"search":0.1}}}',
                input_tokens=12,
                output_tokens=3,
            )

        def translate_error(self, error):
            return error

    with comparison_client(
        structured_outputs=True, llm_answer_mode="probabilities"
    ) as client:
        result = client.system_one(
            "fixture",
            {"action": Choice(criteria={"read": "Read", "search": "Search"})},
            model=Provider(),
        )
    assert result.choices["action"].choice == "read"
    assert result.usage.input_tokens_total == 12
    assert result.usage.n_retries == 0
