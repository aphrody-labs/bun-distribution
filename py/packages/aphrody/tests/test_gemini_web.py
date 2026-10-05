# SPDX-License-Identifier: Apache-2.0
"""Unit tests for aphrody.gemini_web and aphrody.spark."""

from __future__ import annotations

import json
import os
import re
from pathlib import Path

import httpx
import pytest

from aphrody import _paths
from aphrody.gemini_web import (
    PATH_BATCH_EXECUTE,
    PATH_STREAM_GENERATE,
    GeminiWebAuthError,
    GeminiWebClient,
    GeminiWebRpcError,
    SessionTokens,
    build_batchexecute_data,
    build_batchexecute_params,
    build_chat_payload,
    encode_batchexecute_f_req,
    extract_chunks,
    extract_text_from_chat_response,
    extract_wiz_global_data,
    first_envelope,
    format_batchexecute_body_raw,
    format_cookie_header,
    load_cookies,
    parse_envelopes,
    strip_xssi,
    validate_session_cookies,
)
from aphrody.spark import SparkClient

SAMPLE_WIZ_HTML = """
<!DOCTYPE html>
<html>
<head>
<script nonce="xyz">
window.WIZ_global_data = {
  "SNlM0e": "mock_xsrf_token_12345",
  "cfb2h": "boq-bard-web_20260912.01_p0",
  "FdrFJe": "session_sid_67890",
  "qKvxvd": "some_other_key"
};
</script>
</head>
<body><div id="app"></div></body>
</html>
"""

SAMPLE_BOQ_BATCH_RESPONSE = (
    ")]}'\n"
    "85\n"
    '[["wrb.fr","otAQ7b","[[\\"conv_id_123\\",\\"resp_id_456\\"],'
    'null,null,null,[[\\"choice_789\\",[\\"Hello, I am Gemini!\\"]]]]",'
    'null,null,null,"generic"]]'
)


def test_load_cookies_from_dict() -> None:
    raw = {"__Secure-1PSID": "val1", "SAPISID": "val2"}
    cookies = load_cookies(raw)
    assert cookies["__Secure-1PSID"] == "val1"
    assert cookies["SAPISID"] == "val2"
    assert validate_session_cookies(cookies) is True


def test_load_cookies_from_cookie_editor_list() -> None:
    raw = [
        {"name": "__Secure-1PSID", "value": "sec1", "domain": ".google.com"},
        {"name": "SAPISID", "value": "sap2", "domain": ".google.com"},
        {"name": "NID", "value": "nid3", "domain": ".google.com"},
    ]
    cookies = load_cookies(raw)
    assert cookies["__Secure-1PSID"] == "sec1"
    assert cookies["SAPISID"] == "sap2"
    assert cookies["NID"] == "nid3"
    assert "SAPISID=sap2" in format_cookie_header(cookies)


def test_load_cookies_from_json_string() -> None:
    raw_json = json.dumps([{"name": "__Secure-1PSID", "value": "from_json"}])
    cookies = load_cookies(raw_json)
    assert cookies["__Secure-1PSID"] == "from_json"


def test_load_cookies_from_cookie_header_string() -> None:
    header_str = "__Secure-1PSID=val_header; SAPISID=val_sapisid"
    cookies = load_cookies(header_str)
    assert cookies["__Secure-1PSID"] == "val_header"
    assert cookies["SAPISID"] == "val_sapisid"


def test_load_cookies_from_file(tmp_path: Path) -> None:
    cookie_file = tmp_path / "test-cookies.json"
    cookie_file.write_text(
        json.dumps([{"name": "__Secure-1PSID", "value": "file_val"}]),
        encoding="utf-8",
    )
    cookies = load_cookies(cookie_file)
    assert cookies["__Secure-1PSID"] == "file_val"


def test_load_cookies_from_env(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv(
        "GEMINI_COOKIES",
        json.dumps([{"name": "__Secure-1PSID", "value": "env_val"}]),
    )
    cookies = load_cookies()
    assert cookies["__Secure-1PSID"] == "env_val"


def test_load_cookies_missing_raises_error(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.delenv("GEMINI_COOKIES", raising=False)
    monkeypatch.delenv("GOOGLE_COOKIES", raising=False)
    monkeypatch.setenv("APHRODY_SECRETS_DIR", str(tmp_path / "empty_dir"))
    monkeypatch.setenv("APHRODY_HOME", str(tmp_path / "empty_state"))
    monkeypatch.setenv("BXC_COOKIES_DIR", str(tmp_path / "empty_cookies"))
    monkeypatch.setattr(Path, "home", lambda: tmp_path / "empty_home")

    with pytest.raises(GeminiWebAuthError, match="No Google cookies found"):
        load_cookies()


def test_load_cookies_from_bxc_store(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    bxc = tmp_path / "bxc-cookies"
    bxc.mkdir()
    (bxc / "google.json").write_text('{"SAPISID": "bxc-value"}', encoding="utf-8")
    monkeypatch.setenv("BXC_COOKIES_DIR", str(bxc))
    monkeypatch.delenv("GEMINI_COOKIES", raising=False)
    monkeypatch.delenv("GOOGLE_COOKIES", raising=False)
    assert load_cookies() == {"SAPISID": "bxc-value"}


@pytest.mark.integration
@pytest.mark.skipif(
    os.environ.get("APHRODY_RUN_INTEGRATION_TESTS") != "1",
    reason="set APHRODY_RUN_INTEGRATION_TESTS=1 to inspect configured cookie files",
)
def test_load_cookies_real_secrets_if_present() -> None:
    secret_path = _paths.secret_file("google-cookies.json")
    if not secret_path.exists():
        pytest.skip("No real var/secrets/google-cookies.json present")
    cookies = load_cookies()
    assert isinstance(cookies, dict)
    assert len(cookies) > 0
    assert validate_session_cookies(cookies) is True


def test_extract_wiz_global_data_success() -> None:
    tokens = extract_wiz_global_data(SAMPLE_WIZ_HTML)
    assert tokens.at == "mock_xsrf_token_12345"
    assert tokens.bl == "boq-bard-web_20260912.01_p0"
    assert tokens.fsid == "session_sid_67890"
    assert tokens.language == "en"


def test_extract_wiz_global_data_missing_at_raises() -> None:
    html_without_at = "<html><body>No tokens here</body></html>"
    with pytest.raises(GeminiWebAuthError, match="Failed to extract SNlM0e"):
        extract_wiz_global_data(html_without_at)


def test_extract_wiz_global_data_service_login_redirect() -> None:
    html_login = "<html>ServiceLogin redirect to accounts.google.com</html>"
    with pytest.raises(GeminiWebAuthError, match="ServiceLogin"):
        extract_wiz_global_data(html_login)


def test_encode_batchexecute_f_req() -> None:
    payload = ["hello", 123]
    f_req = encode_batchexecute_f_req("otAQ7b", payload)
    outer = json.loads(f_req)
    assert isinstance(outer, list)
    assert outer[0][0][0] == "otAQ7b"
    inner_parsed = json.loads(outer[0][0][1])
    assert inner_parsed == ["hello", 123]
    assert outer[0][0][3] == "generic"


def test_build_batchexecute_params_and_data() -> None:
    tokens = SessionTokens(at="my_at", bl="my_bl", fsid="my_fsid", language="fr")
    params = build_batchexecute_params("otAQ7b", tokens, req_id=200000)
    assert params["rpcids"] == "otAQ7b"
    assert params["bl"] == "my_bl"
    assert params["hl"] == "fr"
    assert params["f.sid"] == "my_fsid"
    assert params["_reqid"] == "200000"
    assert params["rt"] == "c"

    data = build_batchexecute_data("otAQ7b", ["payload"], "my_at")
    assert "f.req" in data
    assert data["at"] == "my_at"

    raw_body = format_batchexecute_body_raw("otAQ7b", ["payload"], "my_at")
    assert raw_body.startswith("f.req=")
    assert "&at=my_at" in raw_body


def test_strip_xssi_variants() -> None:
    assert strip_xssi(")]}'\n[1, 2]") == "[1, 2]"
    assert strip_xssi(")]}'[1, 2]") == "[1, 2]"
    assert strip_xssi("[1, 2]") == "[1, 2]"


def test_extract_chunks_length_prefixed() -> None:
    body = '18\n[["wrb.fr", 123]]\n'
    chunks = extract_chunks(body)
    assert len(chunks) == 1
    assert chunks[0] == [["wrb.fr", 123]]


def test_parse_envelopes_and_first_envelope() -> None:
    envelopes = parse_envelopes(SAMPLE_BOQ_BATCH_RESPONSE)
    assert len(envelopes) == 1
    first = first_envelope(SAMPLE_BOQ_BATCH_RESPONSE)
    assert isinstance(first, list)
    assert first[0] == ["conv_id_123", "resp_id_456"]

    text, conv_id, resp_id, choice_id = extract_text_from_chat_response(first)
    assert text == "Hello, I am Gemini!"
    assert conv_id == "conv_id_123"
    assert resp_id == "resp_id_456"
    assert choice_id == "choice_789"


def test_first_envelope_empty_raises_rpc_error() -> None:
    with pytest.raises(GeminiWebRpcError, match=r"No wrb\.fr envelope found"):
        first_envelope(")]}'\n[]")


def test_build_chat_payload_spark_mode() -> None:
    normal_payload = build_chat_payload("Hi", spark_mode=False)
    assert normal_payload[10] == 0

    spark_payload = build_chat_payload("Hi", spark_mode=True, model="spark")
    assert spark_payload[10] == 1
    assert spark_payload[-1] == ["spark"]


def test_client_init_session_and_generate(httpx_mock) -> None:
    cookies = {"__Secure-1PSID": "dummy_sec", "SAPISID": "dummy_sap"}

    # Mock GET /app for session bootstrap
    httpx_mock.add_response(
        method="GET",
        url="https://gemini.google.com/app",
        text=SAMPLE_WIZ_HTML,
        status_code=200,
    )

    # Mock POST /_/BardChatUi/data/batchexecute
    httpx_mock.add_response(
        method="POST",
        url=re.compile(
            rf"^https://gemini\.google\.com{re.escape(PATH_BATCH_EXECUTE)}.*"
        ),
        text=SAMPLE_BOQ_BATCH_RESPONSE,
        status_code=200,
    )

    with httpx.Client() as http:
        client = GeminiWebClient(cookies=cookies, http=http)
        tokens = client.init_session()
        assert tokens.at == "mock_xsrf_token_12345"

        resp = client.generate("Hello world")
        assert resp.text == "Hello, I am Gemini!"
        assert resp.conversation_id == "conv_id_123"
        assert resp.response_id == "resp_id_456"
        assert resp.choice_id == "choice_789"


def test_client_stream_generate(httpx_mock) -> None:
    cookies = {"__Secure-1PSID": "dummy_sec", "SAPISID": "dummy_sap"}

    httpx_mock.add_response(
        method="GET",
        url="https://gemini.google.com/app",
        text=SAMPLE_WIZ_HTML,
        status_code=200,
    )

    stream_chunk1 = ')]}\'\n80\n[["wrb.fr","stream",null,null,null,null,"generic"]]'
    stream_chunk2 = SAMPLE_BOQ_BATCH_RESPONSE

    httpx_mock.add_response(
        method="POST",
        url=re.compile(
            rf"^https://gemini\.google\.com{re.escape(PATH_STREAM_GENERATE)}.*"
        ),
        text=stream_chunk1 + "\n" + stream_chunk2,
        status_code=200,
    )

    with httpx.Client() as http:
        client = GeminiWebClient(cookies=cookies, http=http)
        deltas = list(client.stream_generate("Stream test"))
        assert len(deltas) > 0
        full_text = "".join(deltas)
        assert full_text == "Hello, I am Gemini!"


def test_spark_client_generate(httpx_mock) -> None:
    cookies = {"__Secure-1PSID": "dummy_sec", "SAPISID": "dummy_sap"}

    httpx_mock.add_response(
        method="GET",
        url="https://gemini.google.com/app",
        text=SAMPLE_WIZ_HTML,
        status_code=200,
    )
    httpx_mock.add_response(
        method="POST",
        url=re.compile(
            rf"^https://gemini\.google\.com{re.escape(PATH_BATCH_EXECUTE)}.*"
        ),
        text=SAMPLE_BOQ_BATCH_RESPONSE,
        status_code=200,
    )

    with httpx.Client() as http:
        client = SparkClient(cookies=cookies, http=http)
        resp = client.spark_generate("Think deeply about this")
        assert resp.text == "Hello, I am Gemini!"
        assert resp.conversation_id == "conv_id_123"
