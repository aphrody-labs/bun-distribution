# SPDX-License-Identifier: Apache-2.0
"""Public adapters share actual loopback inference, errors and provider usage."""

import asyncio
import json
import os
import subprocess
import sys
import threading

import httpx
import pytest

from aphrody.gemma4 import Gemma4Client, Gemma4McpManager, Gemma4Sampler, Gemma4Server
from aphrody.gemma4.mcp import gemma4_chat, gemma4_inspect
from aphrody.gemma4.sampler import Gemma4SamplingParams
from aphrody.gemma4.service import describe_model
from aphrody.inference import UnifiedInferenceClient, UnifiedInferenceRequest


def test_sdk_sampler_mcp_and_cli_use_the_same_provider(native_provider):
    assert Gemma4Client().chat("same prompt") == "42"
    assert Gemma4Sampler().sample("same prompt").token_count == 2
    assert gemma4_chat("same prompt") == "42"
    # The CLI is the separate aphrody-cli distribution: absent in the isolated SDK wheel gate.
    pytest.importorskip("aphrody_cli")
    result = subprocess.run(
        [sys.executable, "-m", "aphrody_cli.main", "gemma4", "chat", "same prompt"],
        capture_output=True,
        text=True,
        timeout=15,
        env=os.environ.copy(),
    )
    assert result.returncode == 0, result.stderr
    assert "42" in result.stdout
    assert len(native_provider["requests"]) == 4
    assert all(
        r[1]["messages"] == [{"role": "user", "content": "same prompt"}]
        for r in native_provider["requests"]
    )


def test_sampling_and_history_are_preserved(native_provider):
    params = Gemma4SamplingParams(
        temperature=0.2,
        top_k=12,
        top_p=0.8,
        max_tokens=17,
        stop_tokens=("STOP",),
        presence_penalty=0.4,
        frequency_penalty=-0.2,
    )
    result = Gemma4Sampler(params=params).sample(
        "next", history=[{"role": "assistant", "content": "previous"}]
    )
    assert result.finish_reason == "stop" and result.usage_source == "provider"
    body = native_provider["requests"][0][1]
    assert body["messages"][0] == {"role": "assistant", "content": "previous"}
    assert {
        key: body[key]
        for key in (
            "temperature",
            "top_k",
            "top_p",
            "max_tokens",
            "stop",
            "presence_penalty",
            "frequency_penalty",
        )
    } == {
        "temperature": 0.2,
        "top_k": 12,
        "top_p": 0.8,
        "max_tokens": 17,
        "stop": ["STOP"],
        "presence_penalty": 0.4,
        "frequency_penalty": -0.2,
    }


def test_mcp_and_sdk_model_description_share_the_owner():
    assert json.loads(gemma4_inspect("gemma4-e2b")) == describe_model("gemma4-e2b")
    manager = Gemma4McpManager()
    assert manager.call_tool("gemma4_inspect", {}) == gemma4_inspect()


def test_stream_first_delta_arrives_before_provider_finishes(native_provider):
    native_provider["continue"] = threading.Event()
    stream = Gemma4Client().stream_chat("stream")
    try:
        assert next(stream) == "4"
        assert not native_provider["continue"].is_set()
        native_provider["continue"].set()
        assert "".join(stream) == "2"
    finally:
        stream.close()


def test_async_stream_does_not_block_event_loop(native_provider):
    native_provider["continue"] = threading.Event()

    async def run():
        stream = Gemma4Client().astream_chat("stream")
        assert await anext(stream) == "4"
        pending = asyncio.create_task(anext(stream))
        await asyncio.sleep(0.01)
        assert not pending.done()
        native_provider["continue"].set()
        assert await pending == "2"
        await stream.aclose()

    asyncio.run(run())


@pytest.mark.parametrize(
    "events,match",
    [
        (["data: {bad}\n\n"], "Expecting"),
        (['data: {"choices":[{"delta":{"content":"x"}}]}\n\n'], "completion marker"),
        (['data: {"error":{"message":"failed"}}\n\n'], "Invalid"),
        (["data: " + "x" * 1_048_577 + "\n\n"], "budget"),
        (["data: [DONE]"], "Truncated"),
    ],
)
def test_stream_errors_are_not_completed_as_success(native_provider, events, match):
    native_provider["events"] = events
    with pytest.raises(ValueError, match=match):
        list(Gemma4Client().stream_chat("stream"))


def test_stream_supports_crlf_multiline_comments_and_unicode(native_provider):
    native_provider["events"] = [
        ': comment\r\ndata: {"choices":\r\ndata: [{"delta":{"content":"é猫"},"finish_reason":"stop"}]}\r\n\r\n',
        "data: [DONE]\r\n\r\n",
    ]
    assert "".join(Gemma4Client().stream_chat("stream")) == "é猫"


def test_http_adapter_preserves_history_usage_and_stream(native_provider):
    server = Gemma4Server(port=0)
    server.start(blocking=False)
    try:
        url = f"http://127.0.0.1:{server.port}/v1/chat/completions"
        payload = {
            "model": "gemma4-e2b",
            "messages": [
                {"role": "system", "content": "system"},
                {"role": "assistant", "content": "earlier"},
                {"role": "user", "content": "question"},
            ],
        }
        response = httpx.post(url, json=payload).raise_for_status().json()
        assert response["usage"] == native_provider["response"]["usage"]
        assert response["usage_source"] == "provider"
        assert native_provider["requests"][-1][1]["messages"] == payload["messages"]
        stream = (
            httpx.post(url, json={**payload, "stream": True}).raise_for_status().text
        )
        assert '"content": "4"' in stream and '"content": "2"' in stream
        assert stream.endswith("data: [DONE]\n\n")
        assert httpx.post(url, json={**payload, "tools": []}).status_code == 400
        native_provider["status"] = 503
        assert httpx.post(url, json=payload).status_code == 502
    finally:
        server.stop()


def test_backend_failure_does_not_fall_back_to_local(native_provider, monkeypatch):
    from aphrody.gemini_web import GeminiWebClient

    def fail(*args, **kwargs):
        raise RuntimeError("provider unavailable")

    monkeypatch.setattr(GeminiWebClient, "chat", fail)
    # Avoid credentials during construction: the failure itself is the adapter contract.
    monkeypatch.setattr(GeminiWebClient, "__enter__", lambda self: self)
    monkeypatch.setattr(GeminiWebClient, "__init__", lambda self: None)
    monkeypatch.setattr(GeminiWebClient, "__exit__", lambda *args: None)
    with pytest.raises(RuntimeError, match="provider unavailable"):
        Gemma4Client(backend="gemini_web").chat("question")
    assert not native_provider["requests"]


def test_all_native_adapters_require_a_provider(monkeypatch):
    monkeypatch.delenv("APHRODY_INFERENCE_ENDPOINT", raising=False)
    for action in [
        lambda: Gemma4Sampler().sample("question"),
        lambda: Gemma4Client().chat("question"),
        lambda: gemma4_chat("question"),
        lambda: UnifiedInferenceClient().infer(
            UnifiedInferenceRequest(prompt="question")
        ),
    ]:
        with pytest.raises(ValueError, match="Configure"):
            action()


def test_http_adapter_refuses_recursive_upstream(monkeypatch):
    server = Gemma4Server(port=0)
    server.start(blocking=False)
    try:
        url = f"http://127.0.0.1:{server.port}/v1"
        monkeypatch.setenv("APHRODY_INFERENCE_ENDPOINT", url)
        response = httpx.post(url + "/chat/completions", json={"prompt": "question"})
        assert response.status_code == 400 and "itself" in response.text
    finally:
        server.stop()


def test_async_stream_cancellation_closes_after_active_read(native_provider):
    native_provider["continue"] = threading.Event()

    async def run():
        stream = Gemma4Client().astream_chat("stream")
        assert await anext(stream) == "4"
        pending = asyncio.create_task(anext(stream))
        await asyncio.sleep(0.01)
        pending.cancel()
        native_provider["continue"].set()
        with pytest.raises(asyncio.CancelledError):
            await pending
        with pytest.raises(StopAsyncIteration):
            await anext(stream)

    asyncio.run(run())
