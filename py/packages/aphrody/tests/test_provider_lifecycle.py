# SPDX-License-Identifier: Apache-2.0
"""Provider resource ownership without host credentials or live requests."""

from types import SimpleNamespace
from unittest.mock import Mock

import httpx
import pytest

from aphrody import vertex
from aphrody.errors import AphrodyError
from aphrody.gemini_web import (
    GeminiWebAuthError,
    GeminiWebClient,
    SessionTokens,
)
from aphrody.google_docs import AuthenticatedDocsClient
from aphrody.google_drive import AuthenticatedDriveClient
from aphrody.spark import SparkClient


def make_provider(kind, http=None):
    if kind == "drive":
        return AuthenticatedDriveClient(token_provider=lambda: "test-token", http=http)
    if kind == "docs":
        return AuthenticatedDocsClient(token_provider=lambda: "test-token", http=http)
    cls = GeminiWebClient if kind == "web" else SparkClient
    return cls(cookies={"SAPISID": "test-cookie"}, http=http)


def invoke_provider(provider, kind):
    if kind == "drive":
        return provider.list_files()
    if kind == "docs":
        return provider.get_document("test-document")
    return provider.init_session()


@pytest.mark.parametrize("kind", ["drive", "docs", "web", "spark"])
def test_owned_http_closes_once_and_context_is_terminal(monkeypatch, kind):
    http = httpx.Client(
        transport=httpx.MockTransport(lambda request: pytest.fail("unexpected request"))
    )
    original_close = http.close
    http.close = Mock(wraps=original_close)
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: http)
    provider = make_provider(kind)
    with pytest.raises(RuntimeError, match="caller failure"), provider:
        raise RuntimeError("caller failure")
    provider.close()
    assert http.is_closed
    assert http.close.call_count == 1
    with pytest.raises(AphrodyError, match="closed"):
        invoke_provider(provider, kind)
    with pytest.raises(AphrodyError, match="closed"):
        provider.__enter__()


@pytest.mark.parametrize("kind", ["drive", "docs", "web", "spark"])
def test_borrowed_http_stays_open_after_provider_closes(kind):
    with httpx.Client(
        transport=httpx.MockTransport(lambda request: pytest.fail("unexpected request"))
    ) as http:
        provider = make_provider(kind, http=http)
        provider.close()
        provider.close()
        assert not http.is_closed
        with pytest.raises(AphrodyError, match="closed"):
            invoke_provider(provider, kind)


@pytest.mark.parametrize("kind", ["web", "spark"])
def test_closed_web_provider_cannot_reuse_cached_session(kind):
    with httpx.Client() as http:
        provider = make_provider(kind, http=http)
        provider._tokens = SessionTokens(at="test", bl="test", fsid="test")
        provider.close()
        with pytest.raises(AphrodyError, match="closed"):
            provider.generate("test")
        with pytest.raises(AphrodyError, match="closed"):
            next(provider.stream_generate("test"))


def test_closed_drive_upload_does_not_read_local_file():
    with httpx.Client() as http:
        provider = make_provider("drive", http=http)
        provider.close()
        with pytest.raises(AphrodyError, match="closed"):
            provider.upload_file("nonexistent-input")


def test_closed_docs_provider_rejects_empty_batch():
    with httpx.Client() as http:
        provider = make_provider("docs", http=http)
        provider.close()
        with pytest.raises(AphrodyError, match="closed"):
            provider.batch_update("test-document", [])


@pytest.mark.parametrize("cls", [GeminiWebClient, SparkClient])
def test_invalid_cookies_fail_before_http_allocation(monkeypatch, cls):
    def unexpected_client(**kwargs):
        pytest.fail("invalid cookies allocated an HTTP client")

    monkeypatch.setattr(httpx, "Client", unexpected_client)
    with pytest.raises(GeminiWebAuthError):
        cls(cookies={"irrelevant": "test"})


@pytest.fixture
def genai_client(monkeypatch):
    from google import genai

    client = SimpleNamespace(
        close=Mock(),
        models=SimpleNamespace(
            generate_content=Mock(return_value=SimpleNamespace(text="Hello")),
            generate_content_stream=Mock(
                return_value=iter([SimpleNamespace(text="Hi")])
            ),
        ),
    )
    monkeypatch.setattr(genai, "Client", lambda **kwargs: client)
    return client


def test_vertex_context_closes_owned_genai_client_once(genai_client):
    with vertex.GeminiVertex(creds=object()) as provider:
        assert provider.generate("test") == "Hello"
        assert provider.client is genai_client
        assert list(provider.stream("test")) == ["Hi"]
    provider.close()
    assert genai_client.close.call_count == 1
    for operation in (
        lambda: provider.generate("test"),
        lambda: provider.generate_content("test"),
        lambda: provider.generate_think("test"),
        lambda: next(provider.stream("test")),
        lambda: provider.client,
        provider.__enter__,
    ):
        with pytest.raises(AphrodyError, match="closed"):
            operation()
    assert genai_client.models.generate_content.call_count == 1


def test_vertex_context_closes_on_generation_failure(genai_client):
    genai_client.models.generate_content.side_effect = RuntimeError("generation failed")
    with (
        pytest.raises(RuntimeError, match="generation failed"),
        vertex.GeminiVertex(creds=object()) as provider,
    ):
        provider.generate("test")
    genai_client.close.assert_called_once_with()


@pytest.mark.parametrize("fails", [False, True])
def test_vertex_one_shot_generation_closes_resources(monkeypatch, genai_client, fails):
    constructor = vertex.GeminiVertex
    monkeypatch.setattr(
        vertex,
        "GeminiVertex",
        lambda **kwargs: constructor(creds=object(), **kwargs),
    )
    if fails:
        genai_client.models.generate_content.side_effect = RuntimeError(
            "generation failed"
        )
        with pytest.raises(RuntimeError, match="generation failed"):
            vertex.generate("test")
    else:
        assert vertex.generate("test") == "Hello"
    genai_client.close.assert_called_once_with()
