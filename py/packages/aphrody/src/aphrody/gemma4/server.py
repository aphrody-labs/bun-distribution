# SPDX-License-Identifier: Apache-2.0
# SPDX-FileCopyrightText: 2026 aphrody contributors & Google DeepMind
"""Compatibility HTTP adapter over the same inference owner as SDK, CLI and MCP."""

from __future__ import annotations

import contextlib
import http.server
import json
import os
import threading
import time
from collections.abc import Sequence
from typing import Any, cast
from urllib.parse import urlsplit

import httpx

from aphrody.gemma4.models import list_models
from aphrody.inference.unified import (
    InferenceBackend,
    UnifiedInferenceClient,
    UnifiedInferenceRequest,
    UnifiedInferenceResult,
)


def _response(result: UnifiedInferenceResult) -> dict[str, Any]:
    now = int(time.time())
    return {
        "id": f"chatcmpl-gemma4-{time.time_ns()}",
        "object": "chat.completion",
        "created": now,
        "model": result.model,
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": result.text,
                    **({"reasoning_content": result.thought} if result.thought else {}),
                },
                "finish_reason": result.finish_reason,
            }
        ],
        "usage": result.usage,
        "usage_source": result.usage_source,
        "latency_seconds": result.latency_ms / 1000,
    }


def create_chat_completion_response(
    prompt: str,
    model: str = "gemma4-e2b",
    backend: str = "local",
    temperature: float = 0.7,
    max_tokens: int = 2048,
    *,
    history: Sequence[dict[str, str]] | None = None,
    system_prompt: str | None = None,
    top_p: float = 0.95,
) -> dict[str, Any]:
    return _response(
        UnifiedInferenceClient(model).infer(
            UnifiedInferenceRequest(
                prompt=prompt,
                backend=InferenceBackend(backend),
                temperature=temperature,
                max_tokens=max_tokens,
                history=history,
                system_prompt=system_prompt,
                top_p=top_p,
            )
        )
    )


def create_models_response() -> dict[str, Any]:
    """Describe repository model profiles; this does not claim weights are loaded."""
    return {
        "object": "list",
        "data": [
            {
                "id": m["name"],
                "object": "model",
                "created": 1740000000,
                "owned_by": "google-deepmind",
                "permission": [],
                "root": m["name"],
                "parent": None,
                "specs": m,
            }
            for m in list_models()
        ],
    }


def _request(data: Any) -> UnifiedInferenceRequest:
    if not isinstance(data, dict):
        raise ValueError("Request body must be an object")
    if type(data.get("stream", False)) is not bool:
        raise ValueError("stream must be boolean")
    messages = data.get("messages")
    if messages is not None:
        if (
            not isinstance(messages, list)
            or not messages
            or not isinstance(messages[-1], dict)
            or messages[-1].get("role") != "user"
        ):
            raise ValueError("messages must end with a user text message")
        prompt = messages[-1].get("content")
        history = messages[:-1]
    else:
        prompt, history = data.get("prompt"), None
    if not isinstance(prompt, str):
        raise ValueError("prompt must be text")
    # Reject unsupported generation fields rather than silently dropping their behavior.
    supported = {
        "messages",
        "prompt",
        "model",
        "temperature",
        "max_tokens",
        "top_p",
        "top_k",
        "stop",
        "presence_penalty",
        "frequency_penalty",
        "stream",
    }
    if set(data) - supported:
        raise ValueError(
            "Unsupported completion fields: " + ", ".join(sorted(set(data) - supported))
        )
    return UnifiedInferenceRequest(
        prompt=prompt,
        model=data.get("model", "gemma4-e2b"),
        history=history,
        temperature=data.get("temperature", 0.7),
        max_tokens=data.get("max_tokens", 2048),
        top_p=data.get("top_p", 0.95),
        top_k=data.get("top_k"),
        stop=data.get("stop", ()),
        presence_penalty=data.get("presence_penalty", 0),
        frequency_penalty=data.get("frequency_penalty", 0),
    )


class Gemma4RequestHandler(http.server.BaseHTTPRequestHandler):
    def _send_json(self, status: int, data: Any) -> None:
        payload = json.dumps(data).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(payload)))
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(payload)

    def do_GET(self) -> None:
        if self.path == "/healthz":
            self._send_json(
                200, {"status": "ok", "serving": "gemma4", "role": "provider-adapter"}
            )
        elif self.path in ("/v1/models", "/models"):
            self._send_json(200, create_models_response())
        else:
            self._send_json(404, {"error": "Unknown endpoint"})

    def do_POST(self) -> None:
        if self.path not in ("/v1/chat/completions", "/chat/completions"):
            self._send_json(404, {"error": "Unknown endpoint"})
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            if not 0 < length <= 1_048_576:
                raise ValueError("Request body must contain 1..1048576 bytes")
            data = json.loads(self.rfile.read(length))
            request = _request(data)
            upstream = urlsplit(os.environ.get("APHRODY_INFERENCE_ENDPOINT", ""))
            host, port = cast(tuple[str, int], self.server.server_address)
            own_hosts = {"localhost", "127.0.0.1", "::1", host}
            if (
                upstream.hostname in own_hosts
                and (upstream.port or (443 if upstream.scheme == "https" else 80))
                == port
            ):
                raise ValueError(
                    "Inference upstream cannot point to this adapter itself"
                )
            client = UnifiedInferenceClient()
            if data.get("stream", False):
                self._stream(client, request)
            else:
                self._send_json(200, _response(client.infer(request)))
        except (ValueError, TypeError) as exc:
            self._send_json(400, {"error": str(exc)})
        except NotImplementedError as exc:
            self._send_json(501, {"error": str(exc)})
        except httpx.HTTPError:
            self._send_json(502, {"error": "Inference provider request failed"})

    def _stream(
        self, client: UnifiedInferenceClient, request: UnifiedInferenceRequest
    ) -> None:
        with contextlib.closing(client.stream(request)) as stream:
            first = next(
                stream, None
            )  # Validate and contact provider before committing HTTP 200.
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream")
            self.send_header("Cache-Control", "no-cache")
            self.end_headers()
            try:
                if first is not None:
                    self._delta(first, request.model)
                for chunk in stream:
                    self._delta(chunk, request.model)
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except (BrokenPipeError, ConnectionResetError):
                return
            except (ValueError, httpx.HTTPError):
                self.wfile.write(
                    b'data: {"error":{"message":"Inference stream failed"}}\n\n'
                )
                self.wfile.flush()

    def _delta(self, text: str, model: str | None) -> None:
        data = {
            "object": "chat.completion.chunk",
            "model": model,
            "choices": [
                {"index": 0, "delta": {"content": text}, "finish_reason": None}
            ],
        }
        self.wfile.write(f"data: {json.dumps(data)}\n\n".encode())
        self.wfile.flush()

    def log_message(self, format: str, *args: Any) -> None:
        return


class Gemma4Server:
    def __init__(self, host: str = "127.0.0.1", port: int = 8080):
        self.host, self.port = host, port
        self._server: http.server.ThreadingHTTPServer | None = None
        self._thread: threading.Thread | None = None

    def start(self, blocking: bool = True) -> None:
        if self._server is not None:
            raise RuntimeError("Server is already running")
        self._server = http.server.ThreadingHTTPServer(
            (self.host, self.port), Gemma4RequestHandler
        )
        self.port = self._server.server_port
        if blocking:
            try:
                self._server.serve_forever()
            finally:
                self._server.server_close()
                self._server = None
        else:
            self._thread = threading.Thread(
                target=self._server.serve_forever, daemon=True
            )
            self._thread.start()

    def stop(self) -> None:
        if self._server:
            self._server.shutdown()
            self._server.server_close()
            if self._thread:
                self._thread.join()
            self._server, self._thread = None, None
