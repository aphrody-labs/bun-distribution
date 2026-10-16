# SPDX-License-Identifier: Apache-2.0
"""Tests for :class:`aphrody.client.AphrodyClient` retry/refresh behavior."""

from __future__ import annotations

import httpx
import pytest

from aphrody.auth import credential_store
from aphrody.auth.tokens import OAuthToken
from aphrody.client import AphrodyClient
from aphrody.errors import AphrodyError, ApiError, UnsupportedPlatformError


def test_get_json_success(httpx_mock) -> None:
    httpx_mock.add_response(json={"ok": True})
    with httpx.Client() as http:
        client = AphrodyClient(token=OAuthToken("acc", "ref"), http=http)
        assert client.get_json("https://example.com/x") == {"ok": True}


def test_retry_on_401_refreshes_from_store(httpx_mock, monkeypatch) -> None:
    monkeypatch.setattr(
        credential_store, "read_token", lambda: OAuthToken("fresh", "ref")
    )
    httpx_mock.add_response(status_code=401, json={"error": "unauth"})
    httpx_mock.add_response(json={"ok": True})
    with httpx.Client() as http:
        client = AphrodyClient(
            token=OAuthToken("acc", "ref"), http=http, persist_refresh=False
        )
        assert client.get_json("https://example.com/x") == {"ok": True}
    assert client.token.access_token == "fresh"


def test_non_2xx_raises_api_error(httpx_mock) -> None:
    httpx_mock.add_response(status_code=500, text="boom")
    with httpx.Client() as http:
        client = AphrodyClient(token=OAuthToken("acc"), http=http)
        with pytest.raises(ApiError):
            client.get_json("https://example.com/x")


def test_constructor_failure_closes_only_owned_transport(monkeypatch) -> None:
    from aphrody.auth import credentials

    owned = httpx.Client()
    monkeypatch.setattr(httpx, "Client", lambda **kwargs: owned)

    def missing_token(**kwargs):
        raise UnsupportedPlatformError("missing token")

    monkeypatch.setattr(credentials, "load_token", missing_token)
    with pytest.raises(UnsupportedPlatformError):
        AphrodyClient()
    assert owned.is_closed


def test_constructor_failure_preserves_borrowed_transport(monkeypatch) -> None:
    from aphrody.auth import credentials

    def missing_token(**kwargs):
        raise UnsupportedPlatformError("missing token")

    monkeypatch.setattr(credentials, "load_token", missing_token)
    with httpx.Client() as http:
        with pytest.raises(UnsupportedPlatformError):
            AphrodyClient(http=http)
        assert not http.is_closed


def test_close_is_terminal_but_preserves_borrowed_transport() -> None:
    with httpx.Client() as http:
        client = AphrodyClient(token=OAuthToken("acc"), http=http)
        client.close()
        client.close()
        assert not http.is_closed
        with pytest.raises(AphrodyError, match="closed"):
            client.get_json("https://example.com/x")
        with pytest.raises(AphrodyError, match="closed"):
            client.__enter__()


def test_retry_rereads_store_without_refresh_token(httpx_mock, monkeypatch) -> None:
    monkeypatch.setattr(credential_store, "read_token", lambda: OAuthToken("fresh"))
    httpx_mock.add_response(status_code=401)
    httpx_mock.add_response(json={"ok": True})
    with httpx.Client() as http:
        client = AphrodyClient(token=OAuthToken("old"), http=http)
        assert client.get_json("https://example.com/x") == {"ok": True}
    assert [
        request.headers["authorization"] for request in httpx_mock.get_requests()
    ] == [
        "Bearer old",
        "Bearer fresh",
    ]


def test_explicit_token_can_refresh_without_local_store(
    httpx_mock, monkeypatch
) -> None:
    from aphrody.auth import oauth

    def missing_token():
        raise UnsupportedPlatformError("missing token")

    monkeypatch.setattr(credential_store, "read_token", missing_token)
    monkeypatch.setattr(
        oauth, "refresh", lambda token, **kwargs: OAuthToken("fresh", "ref")
    )
    httpx_mock.add_response(status_code=401)
    httpx_mock.add_response(json={"ok": True})
    with httpx.Client() as http:
        client = AphrodyClient(
            token=OAuthToken("old", "ref"), http=http, persist_refresh=False
        )
        assert client.get_json("https://example.com/x") == {"ok": True}


def test_auth_failure_without_fresher_token_keeps_api_error(
    httpx_mock, monkeypatch
) -> None:
    def missing_token():
        raise UnsupportedPlatformError("missing token")

    monkeypatch.setattr(credential_store, "read_token", missing_token)
    httpx_mock.add_response(status_code=403, text="forbidden")
    with httpx.Client() as http:
        client = AphrodyClient(token=OAuthToken("old"), http=http)
        with pytest.raises(ApiError) as failure:
            client.get_json("https://example.com/x")
    assert failure.value.status == 403
    assert len(httpx_mock.get_requests()) == 1
