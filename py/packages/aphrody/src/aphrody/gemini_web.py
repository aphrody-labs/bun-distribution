# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors
"""Keyless authenticated Gemini Web and Spark client via Google Boq / batchexecute.

This module provides a robust headless client for gemini.google.com that leverages
browser session cookies (from var/secrets/google-cookies.json or ~/.aphrody/)
without requiring API keys or Google Cloud projects.

It handles:
1. Loading and validating session cookies (Cookie-Editor JSON, dict, or header).
2. Fetching the web app shell and extracting WIZ_global_data (SNlM0e XSRF token,
   cfb2h build label, FdrFJe session ID).
3. Encoding and decoding Google Boq batchexecute RPC payloads.
4. Calling Gemini and Spark chat/streaming endpoints with conversation state.
"""

from __future__ import annotations

import contextlib
import json
import os
import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any
from urllib.parse import quote_plus

from aphrody import _paths
from aphrody.errors import AphrodyError
from aphrody.google_runtime import runtime as google_runtime

if TYPE_CHECKING:
    import httpx

XSSI_PREFIX = ")]}'\n"
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/133.0.0.0 Safari/537.36"
)
DEFAULT_BASE_URL = "https://gemini.google.com"
RPC_CHAT_DEFAULT = "otAQ7b"
PATH_BATCH_EXECUTE = "/_/BardChatUi/data/batchexecute"
PATH_STREAM_GENERATE = (
    "/_/BardChatUi/data/assistant.lamda.BardFrontendService/StreamGenerate"
)

# Core cookies required for a functional Google Web session
ESSENTIAL_SESSION_COOKIES = frozenset({"__Secure-1PSID", "SAPISID", "__Secure-3PSID"})


class GeminiWebError(AphrodyError):
    """Base error for Gemini Web client operations."""


class GeminiWebAuthError(GeminiWebError):
    """Raised when authentication, cookie loading, or WIZ extraction fails."""


class GeminiWebRpcError(GeminiWebError):
    """Raised when a Boq batchexecute or RPC request fails."""


@dataclass
class SessionTokens:
    """Session tokens extracted from gemini.google.com WIZ_global_data.

    Attributes:
        at: The SNlM0e XSRF token required for batchexecute requests.
        bl: The cfb2h build label (e.g. boq-bard-web_2026...).
        fsid: The FdrFJe session ID (optional).
        language: Browser language hint (default "en").
    """

    at: str
    bl: str
    fsid: str | None = None
    language: str = "en"


@dataclass
class GeminiWebResponse:
    """Parsed response from a Gemini Web / Spark chat turn.

    Attributes:
        text: The generated response text.
        conversation_id: Persistent conversation thread ID.
        response_id: ID of the response turn.
        choice_id: Selected candidate choice ID.
        raw_payload: Inner unparsed payload for advanced introspection.
    """

    text: str
    conversation_id: str | None = None
    response_id: str | None = None
    choice_id: str | None = None
    raw_payload: Any = None


def load_cookies(
    source: str | Path | dict[str, str] | list[dict[str, Any]] | None = None,
) -> dict[str, str]:
    """Load and normalize Google session cookies from various representations.

    Supports:
    - ``None``: Reads from $GEMINI_COOKIES, $GOOGLE_COOKIES,
      ``$BXC_COOKIES_DIR/google.json`` (the canonical BXC/Aphrody Web store),
      then Aphrody's private fallback stores.
    - ``Path`` or filename: JSON file in Cookie-Editor format or key-value mapping.
    - ``list``: Cookie-Editor exported array of dicts with 'name' and 'value'.
    - ``dict``: Direct name -> value mapping.
    - ``str``: Raw Cookie header string or JSON string.

    Args:
        source: Optional cookie data source.

    Returns:
        A dict mapping cookie names to cookie values.

    Raises:
        GeminiWebAuthError: When no cookies could be found or parsed.
    """
    if source is None:
        env_val = os.environ.get("GEMINI_COOKIES") or os.environ.get("GOOGLE_COOKIES")
        if env_val:
            return load_cookies(env_val)

        # BXC is the canonical Web/Gemini cookie owner. Keep this path
        # host-local and read-only from the caller's perspective so the
        # Python, Bun, MCP and Aphrody OS surfaces share one contract.
        bxc_dir = os.environ.get("BXC_COOKIES_DIR") or str(
            google_runtime().home / "cookies"
        )
        if bxc_dir:
            for bxc_name in ("google.json", "gemini.json"):
                bxc_p = Path(bxc_dir).expanduser() / bxc_name
                if bxc_p.exists():
                    return load_cookies(bxc_p)

        # Try repo-relative var/secrets first via _paths
        secret_p = _paths.secret_file("google-cookies.json")
        if secret_p.exists():
            return load_cookies(secret_p)

        # Fallback to user home directory
        home_p = Path.home() / ".aphrody" / "google-cookies.json"
        if home_p.exists():
            return load_cookies(home_p)

        raise GeminiWebAuthError(
            "No Google cookies found. Expected at "
            f"$BXC_COOKIES_DIR/google.json, {secret_p} or {home_p}, "
            "or via $GEMINI_COOKIES."
        )

    if isinstance(source, Path):
        if not source.exists():
            raise GeminiWebAuthError(f"Cookie file not found: {source}")
        raw_text = source.read_text(encoding="utf-8")
        return load_cookies(raw_text)

    if isinstance(source, list):
        cookies: dict[str, str] = {}
        for item in source:
            if isinstance(item, dict) and "name" in item and "value" in item:
                cookies[str(item["name"])] = str(item["value"])
        if not cookies:
            raise GeminiWebAuthError("Empty or invalid cookie list provided.")
        return cookies

    if isinstance(source, dict):
        if "cookies" in source and isinstance(source["cookies"], list):
            return load_cookies(source["cookies"])
        return {str(k): str(v) for k, v in source.items()}

    if isinstance(source, str):
        trimmed = source.strip()
        if (trimmed.startswith("[") and trimmed.endswith("]")) or (
            trimmed.startswith("{") and trimmed.endswith("}")
        ):
            try:
                parsed = json.loads(trimmed)
                return load_cookies(parsed)
            except json.JSONDecodeError as exc:
                raise GeminiWebAuthError(f"Malformed cookie JSON: {exc}") from exc

        # Might be a path to a file
        candidate_path = Path(trimmed)
        if candidate_path.exists():
            return load_cookies(candidate_path)

        # Might be a raw Cookie header: "foo=bar; baz=qux"
        if "=" in trimmed:
            cookies = {}
            for raw_part in trimmed.split(";"):
                cookie_item = raw_part.strip()
                if not cookie_item:
                    continue
                if "=" in cookie_item:
                    key, val = cookie_item.split("=", 1)
                    cookies[key.strip()] = val.strip()
            if cookies:
                return cookies

        raise GeminiWebAuthError(
            "String source could not be parsed as JSON, path, or Cookie header."
        )

    raise GeminiWebAuthError(f"Unsupported cookie source type: {type(source)}")


def validate_session_cookies(cookies: dict[str, str]) -> bool:
    """Check whether essential Google authentication cookies are present.

    Args:
        cookies: Cookie dictionary.

    Returns:
        True if at least one primary session cookie is present.
    """
    return any(c in cookies for c in ESSENTIAL_SESSION_COOKIES)


def format_cookie_header(cookies: dict[str, str]) -> str:
    """Format cookie dictionary into an HTTP Cookie header string.

    Args:
        cookies: Key-value cookies.

    Returns:
        Semicolon-separated cookie header string.
    """
    return "; ".join(f"{k}={v}" for k, v in cookies.items())


def extract_wiz_global_data(html: str) -> SessionTokens:
    """Extract SNlM0e, cfb2h, and FdrFJe tokens from the Gemini Web HTML page.

    Args:
        html: Raw HTML string returned by gemini.google.com/app.

    Returns:
        Extracted SessionTokens.

    Raises:
        GeminiWebAuthError: When the SNlM0e token cannot be found or if
            the response indicates an unauthenticated redirect.
    """
    if "ServiceLogin" in html and "SNlM0e" not in html:
        raise GeminiWebAuthError(
            "Gemini Web session redirected to ServiceLogin. "
            "Your cookies are expired or invalid."
        )

    # Primary regex: direct key lookup in JS object literals
    snlm0e_match = re.search(r'"SNlM0e"\s*:\s*"([^"]+)"', html)
    cfb2h_match = re.search(r'"cfb2h"\s*:\s*"([^"]+)"', html)
    fdrfje_match = re.search(r'"FdrFJe"\s*:\s*"([^"]+)"', html)

    at_token = snlm0e_match.group(1) if snlm0e_match else None
    bl_token = cfb2h_match.group(1) if cfb2h_match else "boq-bard-web_20260101"
    fsid_token = fdrfje_match.group(1) if fdrfje_match else None

    # Fallback: attempt to parse WIZ_global_data block if regex missed
    if not at_token:
        wiz_match = re.search(r"WIZ_global_data\s*=\s*(\{.+?\});", html, re.DOTALL)
        if wiz_match:
            try:
                data = json.loads(wiz_match.group(1))
                at_token = data.get("SNlM0e")
                bl_token = data.get("cfb2h", bl_token)
                fsid_token = data.get("FdrFJe", fsid_token)
            except Exception:
                pass

    if not at_token:
        raise GeminiWebAuthError(
            "Failed to extract SNlM0e XSRF token from Gemini Web HTML. "
            "Ensure valid logged-in cookies are configured."
        )

    return SessionTokens(at=at_token, bl=bl_token, fsid=fsid_token)


def encode_batchexecute_f_req(rpc_id: str, payload: Any) -> str:
    """Encode an inner payload into the Google Boq f.req JSON structure.

    Args:
        rpc_id: The Boq RPC identifier (e.g. 'otAQ7b').
        payload: JSON-serializable Python payload.

    Returns:
        Serialized f.req outer JSON string.
    """
    inner_str = json.dumps(payload, separators=(",", ":"))
    outer = [[[rpc_id, inner_str, None, "generic"]]]
    return json.dumps(outer, separators=(",", ":"))


def build_batchexecute_params(
    rpc_id: str,
    tokens: SessionTokens,
    req_id: int = 100000,
    source_path: str = "/app",
) -> dict[str, str]:
    """Construct URL query parameters for a Boq batchexecute request.

    Args:
        rpc_id: The RPC identifier.
        tokens: Active session tokens.
        req_id: Monotonic request sequence ID.
        source_path: Application source path.

    Returns:
        Dict of query parameters.
    """
    params: dict[str, str] = {
        "rpcids": rpc_id,
        "source-path": source_path,
        "bl": tokens.bl,
        "hl": tokens.language,
        "_reqid": str(req_id),
        "rt": "c",
    }
    if tokens.fsid:
        params["f.sid"] = tokens.fsid
    return params


def build_batchexecute_data(rpc_id: str, payload: Any, at_token: str) -> dict[str, str]:
    """Construct form data payload for a batchexecute POST request.

    Args:
        rpc_id: RPC identifier.
        payload: The inner payload.
        at_token: SNlM0e XSRF token.

    Returns:
        Form body dictionary with 'f.req' and 'at'.
    """
    return {
        "f.req": encode_batchexecute_f_req(rpc_id, payload),
        "at": at_token,
    }


def format_batchexecute_body_raw(rpc_id: str, payload: Any, at_token: str) -> str:
    """Format URL-encoded batchexecute body string.

    Args:
        rpc_id: The RPC identifier.
        payload: The inner payload.
        at_token: SNlM0e token.

    Returns:
        Encoded query string: 'f.req=...&at=...'.
    """
    f_req = encode_batchexecute_f_req(rpc_id, payload)
    return f"f.req={quote_plus(f_req)}&at={quote_plus(at_token)}"


def strip_xssi(raw: str) -> str:
    r"""Strip Google's anti-XSSI safety prefix )]}'\n from response text.

    Args:
        raw: Raw response body.

    Returns:
        Body without XSSI prefix.
    """
    if raw.startswith(XSSI_PREFIX):
        return raw[len(XSSI_PREFIX) :]
    if raw.startswith(")]}'"):
        return raw[4:].lstrip("\r\n ")
    return raw


def extract_chunks(body: str) -> list[Any]:
    """Extract JSON chunks from length-prefixed or line-delimited Boq stream.

    Args:
        body: Stripped response body text.

    Returns:
        List of parsed JSON chunk objects.
    """
    chunks: list[Any] = []
    lines = body.split("\n")
    i = 0
    total = len(lines)
    while i < total:
        line = lines[i].strip()
        if not line:
            i += 1
            continue

        if line.isdigit():
            length = int(line)
            if i + 1 < total:
                next_line = lines[i + 1].strip()
                if next_line:
                    try:
                        chunks.append(json.loads(next_line))
                        i += 2
                        continue
                    except json.JSONDecodeError:
                        pass
            # Multi-line chunk fallback
            accumulated: list[str] = []
            cur_bytes = 0
            j = i + 1
            while j < total and cur_bytes < length:
                accumulated.append(lines[j])
                cur_bytes += len(lines[j]) + 1
                j += 1
            chunk_str = "\n".join(accumulated).strip()
            if chunk_str:
                with contextlib.suppress(json.JSONDecodeError):
                    chunks.append(json.loads(chunk_str))
            i = j
        else:
            with contextlib.suppress(json.JSONDecodeError):
                chunks.append(json.loads(line))
            i += 1
    return chunks


def parse_envelopes(raw: str) -> list[Any]:
    """Parse all wrb.fr envelopes in a raw Boq batchexecute response.

    Args:
        raw: Raw HTTP response text.

    Returns:
        List of inner JSON payloads.
    """
    stripped = strip_xssi(raw)
    chunks = extract_chunks(stripped)
    results: list[Any] = []
    for chunk in chunks:
        if not isinstance(chunk, list):
            continue
        for env in chunk:
            if not isinstance(env, list) or len(env) < 3:
                continue
            if env[0] == "wrb.fr":
                inner_raw = env[2]
                if isinstance(inner_raw, str):
                    try:
                        results.append(json.loads(inner_raw))
                    except json.JSONDecodeError:
                        results.append(inner_raw)
                else:
                    results.append(inner_raw)
    return results


def first_envelope(raw: str) -> Any:
    """Extract the first inner payload from a batchexecute response.

    Args:
        raw: Raw response string.

    Returns:
        The first inner parsed envelope.

    Raises:
        GeminiWebRpcError: When no wrb.fr envelope is present in the response.
    """
    envelopes = parse_envelopes(raw)
    if not envelopes:
        raise GeminiWebRpcError("No wrb.fr envelope found in Boq response.")
    return envelopes[0]


def build_chat_payload(
    prompt: str,
    conversation_id: str | None = None,
    response_id: str | None = None,
    choice_id: str | None = None,
    language: str = "en",
    spark_mode: bool = False,
    model: str | None = None,
) -> list[Any]:
    """Construct nested inner payload for Gemini Web / Spark chat.

    Args:
        prompt: User text prompt.
        conversation_id: Optional existing conversation ID.
        response_id: Optional previous response ID.
        choice_id: Optional previous choice ID.
        language: Language code.
        spark_mode: If True, activates Spark reasoning/creative parameters.
        model: Optional model identifier.

    Returns:
        Nested list representing the inner chat request.
    """
    chat_state: list[Any] = [conversation_id, response_id, choice_id, None, None, []]
    inner: list[Any] = [
        [prompt, 0, None, None, None, None, 0],
        [language],
        chat_state,
        None,
        None,
        None,
        [1],
        0,
        [],
        [],
        1 if spark_mode else 0,
        0,
    ]
    if model:
        inner.append([model])
    return inner


def extract_text_from_chat_response(
    payload: Any,
) -> tuple[str, str | None, str | None, str | None]:
    """Extract candidate text and turn IDs from a parsed chat envelope.

    Args:
        payload: Parsed JSON envelope from Gemini chat RPC.

    Returns:
        Tuple of (text, conversation_id, response_id, choice_id).
    """
    text = ""
    conv_id = None
    resp_id = None
    choice_id = None

    if not isinstance(payload, list):
        if payload is None:
            return ("", None, None, None)
        return (str(payload), None, None, None)

    # In Gemini Boq chat responses, index 0 or 1 usually holds metadata IDs:
    # payload[1] = [conversation_id, response_id]
    for idx in (0, 1):
        if len(payload) > idx and isinstance(payload[idx], list):
            cand = payload[idx]
            if len(cand) >= 2 and isinstance(cand[0], str) and isinstance(cand[1], str):
                conv_id = cand[0]
                resp_id = cand[1]
                break
            if len(cand) == 1 and isinstance(cand[0], str):
                conv_id = cand[0]
                break

    # Index 4 usually holds candidates:
    # payload[4] = [[choice_id, [text_chunk, ...], ...]]
    if len(payload) > 4 and isinstance(payload[4], list) and payload[4]:
        first_candidate = payload[4][0]
        if isinstance(first_candidate, list):
            if len(first_candidate) > 0 and isinstance(first_candidate[0], str):
                choice_id = first_candidate[0]
            if (
                len(first_candidate) > 1
                and isinstance(first_candidate[1], list)
                and first_candidate[1]
            ):
                text_part = first_candidate[1][0]
                if isinstance(text_part, str):
                    text = text_part

    # Fallback recursive text search if standard indices are null
    if not text:

        def _search_strings(node: Any) -> list[str]:
            found: list[str] = []
            if isinstance(node, str) and len(node) > 2:
                found.append(node)
            elif isinstance(node, list):
                for item in node:
                    found.extend(_search_strings(item))
            return found

        candidates = [s for s in _search_strings(payload) if len(s) > 10]
        if candidates:
            text = max(candidates, key=len)

    return (text, conv_id, resp_id, choice_id)


class GeminiWebClient:
    """Authenticated client for the Gemini Web and Spark Boq interface."""

    def __init__(
        self,
        cookies: (str | Path | dict[str, str] | list[dict[str, Any]] | None) = None,
        base_url: str = DEFAULT_BASE_URL,
        http: httpx.Client | None = None,
        timeout: float = 60.0,
        user_agent: str = DEFAULT_USER_AGENT,
    ) -> None:
        """Initialize GeminiWebClient with cookies and HTTP configuration.

        Args:
            cookies: Cookie source or None for automatic discovery.
            base_url: Gemini web base URL (default: https://gemini.google.com).
            http: Optional pre-configured httpx.Client instance.
            timeout: Timeout in seconds for HTTP requests.
            user_agent: Chrome User-Agent header string.
        """
        self.cookies = load_cookies(cookies)
        if not validate_session_cookies(self.cookies):
            raise GeminiWebAuthError("Google cookies contain no primary session cookie")
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.user_agent = user_agent

        self._owns_http = http is None
        if http is None:
            import httpx

            self._http = httpx.Client(
                timeout=self.timeout,
                headers={
                    "User-Agent": self.user_agent,
                    "Cookie": format_cookie_header(self.cookies),
                    "Origin": self.base_url,
                    "Referer": f"{self.base_url}/app",
                    "X-Same-Domain": "1",
                },
                follow_redirects=True,
            )
        else:
            self._http = http

        self._tokens: SessionTokens | None = None
        self._req_counter = 100000
        self._closed = False

    def _ensure_open(self) -> None:
        if self._closed:
            raise GeminiWebError(f"{type(self).__name__} is closed")

    def _next_req_id(self) -> int:
        """Increment and return the next monotonic request sequence ID."""
        self._req_counter += 100000
        return self._req_counter

    def init_session(self, force: bool = False) -> SessionTokens:
        """Fetch the Gemini Web HTML page and extract session tokens.

        Args:
            force: If True, refetches the page even if tokens are cached.

        Returns:
            The active SessionTokens.

        Raises:
            GeminiWebAuthError: On HTTP error or missing tokens.
        """
        self._ensure_open()
        if self._tokens is not None and not force:
            return self._tokens

        resp = self._http.get(f"{self.base_url}/app")
        if resp.status_code != 200:
            raise GeminiWebAuthError(
                f"Failed to load Gemini Web app: HTTP {resp.status_code}"
            )

        self._tokens = extract_wiz_global_data(resp.text)
        return self._tokens

    def execute_rpc(
        self,
        rpc_id: str,
        payload: Any,
        source_path: str = "/app",
    ) -> Any:
        """Execute a single Boq batchexecute RPC request and return inner result.

        Args:
            rpc_id: Boq RPC identifier (e.g. 'otAQ7b').
            payload: Inner payload to serialize into f.req.
            source_path: Source path query parameter (default: '/app').

        Returns:
            The first parsed inner wrb.fr payload.

        Raises:
            GeminiWebRpcError: On non-200 HTTP response or missing envelope.
        """
        tokens = self.init_session()
        params = build_batchexecute_params(
            rpc_id=rpc_id,
            tokens=tokens,
            req_id=self._next_req_id(),
            source_path=source_path,
        )
        data = build_batchexecute_data(
            rpc_id=rpc_id,
            payload=payload,
            at_token=tokens.at,
        )
        url = f"{self.base_url}{PATH_BATCH_EXECUTE}"

        resp = self._http.post(url, params=params, data=data)
        if resp.status_code != 200:
            raise GeminiWebRpcError(
                f"Batchexecute failed: HTTP {resp.status_code} ({resp.text[:200]})"
            )

        if "UserDisplayableError" in resp.text:
            raise GeminiWebRpcError(
                f"Batchexecute returned UserDisplayableError: {resp.text[:300]}"
            )

        return first_envelope(resp.text)

    def generate(
        self,
        prompt: str,
        conversation_id: str | None = None,
        response_id: str | None = None,
        choice_id: str | None = None,
        spark_mode: bool = False,
        model: str | None = None,
    ) -> GeminiWebResponse:
        """Send a prompt to Gemini / Spark and return the parsed response.

        Args:
            prompt: User message string.
            conversation_id: Thread conversation ID to continue.
            response_id: Prior response ID.
            choice_id: Prior choice ID.
            spark_mode: Activate Spark reasoning mode if True.
            model: Target model identifier.

        Returns:
            GeminiWebResponse containing the generated text and updated IDs.
        """
        tokens = self.init_session()
        payload = build_chat_payload(
            prompt=prompt,
            conversation_id=conversation_id,
            response_id=response_id,
            choice_id=choice_id,
            language=tokens.language,
            spark_mode=spark_mode,
            model=model,
        )
        raw_result = self.execute_rpc(RPC_CHAT_DEFAULT, payload)
        text, conv_id, resp_id, ch_id = extract_text_from_chat_response(raw_result)

        return GeminiWebResponse(
            text=text,
            conversation_id=conv_id or conversation_id,
            response_id=resp_id or response_id,
            choice_id=ch_id or choice_id,
            raw_payload=raw_result,
        )

    def chat(
        self,
        prompt: str,
        *,
        conversation_id: str | None = None,
        spark_mode: bool = False,
        model: str | None = None,
        **kwargs: Any,
    ) -> str:
        """Send a prompt and return the reply string directly."""
        resp = self.generate(
            prompt,
            conversation_id=conversation_id,
            spark_mode=spark_mode,
            model=model,
        )
        return resp.text

    def stream_generate(
        self,
        prompt: str,
        conversation_id: str | None = None,
        response_id: str | None = None,
        choice_id: str | None = None,
        spark_mode: bool = False,
    ) -> Iterator[str]:
        """Stream generated response text tokens from StreamGenerate endpoint.

        Args:
            prompt: User message string.
            conversation_id: Optional conversation ID.
            response_id: Optional response ID.
            choice_id: Optional choice ID.
            spark_mode: Activate Spark reasoning mode.

        Yields:
            Text deltas as received.
        """
        tokens = self.init_session()
        payload = build_chat_payload(
            prompt=prompt,
            conversation_id=conversation_id,
            response_id=response_id,
            choice_id=choice_id,
            language=tokens.language,
            spark_mode=spark_mode,
        )
        f_req = json.dumps([None, json.dumps(payload)])
        data = {"f.req": f_req, "at": tokens.at}
        params = {
            "bl": tokens.bl,
            "hl": tokens.language,
            "_reqid": str(self._next_req_id()),
            "rt": "c",
        }
        if tokens.fsid:
            params["f.sid"] = tokens.fsid

        url = f"{self.base_url}{PATH_STREAM_GENERATE}"
        seen_length = 0

        with self._http.stream("POST", url, params=params, data=data) as stream:
            for raw_chunk in stream.iter_text():
                self._ensure_open()
                if not raw_chunk:
                    continue
                envelopes = parse_envelopes(raw_chunk)
                for env in envelopes:
                    text, _, _, _ = extract_text_from_chat_response(env)
                    if text and len(text) > seen_length:
                        delta = text[seen_length:]
                        seen_length = len(text)
                        yield delta

    def stream_chat(
        self,
        prompt: str,
        *,
        conversation_id: str | None = None,
        spark_mode: bool = False,
        **kwargs: Any,
    ) -> Iterator[str]:
        """Stream generated response text tokens directly."""
        yield from self.stream_generate(
            prompt,
            conversation_id=conversation_id,
            spark_mode=spark_mode,
        )

    def close(self) -> None:
        """Close the underlying HTTP client if owned."""
        if self._closed:
            return
        self._closed = True
        if self._owns_http:
            self._http.close()

    def __enter__(self) -> GeminiWebClient:
        """Context manager entry."""
        self._ensure_open()
        return self

    def __exit__(self, *args: Any) -> None:
        """Context manager exit."""
        self.close()
