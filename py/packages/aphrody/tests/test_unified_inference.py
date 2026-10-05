# SPDX-License-Identifier: Apache-2.0
"""Real loopback transport checks; no weights, credentials or external provider."""

import httpx
import pytest

from aphrody.inference import (
    InferenceBackend,
    OpenAICompatibleReasoningClient,
    UnifiedInferenceClient,
    UnifiedInferenceRequest,
)


@pytest.mark.parametrize("backend", ["local", "jan", "harmony", "openai"])
def test_native_provider_turn_preserves_model_history_and_sampling(provider, backend):
    url, state = provider
    history = [{"role": "assistant", "content": "previous"}]
    client = UnifiedInferenceClient("custom-model", base_url=url, api_key="fixture")
    result = client.infer(
        UnifiedInferenceRequest(
            prompt="Question",
            backend=InferenceBackend(backend),
            system_prompt="System",
            history=history,
            temperature=0.2,
            max_tokens=32,
            top_p=0.8,
        )
    )
    assert result.model == "custom-model"
    assert result.text == "42" and result.thought == "reason"
    assert result.usage_source == "provider" and result.usage["total_tokens"] == 12
    assert result.backend == backend and result.latency_ms >= 0
    path, body, auth = state["requests"][0]
    assert path == "/v1/chat/completions" and auth == "Bearer fixture"
    assert body == {
        "model": "custom-model",
        "messages": [
            {"role": "system", "content": "System"},
            *history,
            {"role": "user", "content": "Question"},
        ],
        "temperature": 0.2,
        "top_p": 0.8,
        "max_tokens": 32,
    }
    assert history == [{"role": "assistant", "content": "previous"}]


def test_existing_harmony_owner_and_unified_facade_agree(provider, monkeypatch):
    url, state = provider
    state["response"] = {
        "choices": [
            {"message": {"content": "<|start|><|channel|>final<|message|>\nanswer"}}
        ]
    }
    direct = OpenAICompatibleReasoningClient(base_url=url).generate("Question")
    monkeypatch.setenv("APHRODY_INFERENCE_ENDPOINT", url + "/chat/completions/")
    result = UnifiedInferenceClient().infer(
        UnifiedInferenceRequest(prompt="Question", model="other")
    )
    assert result.text == direct.final == "answer"
    assert result.model == "other" and result.usage_source == "estimate"
    assert result.usage["total_tokens"] == sum(
        result.usage[k] for k in ("prompt_tokens", "completion_tokens")
    )


@pytest.mark.parametrize(
    "payload",
    [None, {}, {"choices": []}, {"choices": [{"message": {"content": None}}]}],
)
def test_malformed_provider_response_does_not_become_simulated_success(
    provider, payload
):
    url, state = provider
    state["response"] = payload
    with pytest.raises(ValueError, match="response"):
        UnifiedInferenceClient(base_url=url).infer(
            UnifiedInferenceRequest(prompt="Question")
        )


def test_provider_http_error_is_propagated(provider):
    url, state = provider
    state["status"] = 503
    with pytest.raises(httpx.HTTPStatusError):
        UnifiedInferenceClient(base_url=url).infer(
            UnifiedInferenceRequest(prompt="Question")
        )


@pytest.mark.parametrize(
    "usage",
    [
        {"total_tokens": 1},
        {"prompt_tokens": True, "completion_tokens": 0, "total_tokens": 1},
        [1],
    ],
)
def test_malformed_usage_is_not_claimed_as_provider_counts(provider, usage):
    url, state = provider
    state["response"]["usage"] = usage
    with pytest.raises(ValueError, match="token usage"):
        UnifiedInferenceClient(base_url=url).infer(
            UnifiedInferenceRequest(prompt="Question")
        )


@pytest.mark.parametrize(
    "override,match",
    [
        ({"prompt": ""}, "prompt"),
        ({"thought": "prefill"}, "prefill"),
        ({"model": ""}, "model"),
        ({"temperature": float("nan")}, "temperature"),
        ({"top_p": 0}, "top_p"),
        ({"max_tokens": True}, "max_tokens"),
        ({"history": [{"role": "invalid", "content": "text"}]}, "history"),
    ],
)
def test_invalid_request_is_rejected_before_transport(override, match):
    with pytest.raises(ValueError, match=match):
        UnifiedInferenceClient(base_url="http://127.0.0.1:1/v1").infer(
            UnifiedInferenceRequest(**({"prompt": "Question"} | override))
        )


def test_missing_endpoint_and_unsupported_protocol_fail_explicitly(monkeypatch):
    monkeypatch.delenv("APHRODY_INFERENCE_ENDPOINT", raising=False)
    with pytest.raises(ValueError, match="Configure"):
        UnifiedInferenceClient().infer(UnifiedInferenceRequest(prompt="Question"))
    with pytest.raises(NotImplementedError, match="GeminiWebClient"):
        UnifiedInferenceClient().infer(
            UnifiedInferenceRequest(
                prompt="Question", backend=InferenceBackend.GEMINI_WEB
            )
        )
    with pytest.raises(ValueError, match="base URL"):
        UnifiedInferenceClient(
            base_url="https://user:password@example.invalid/v1"
        ).infer(UnifiedInferenceRequest(prompt="Question"))
