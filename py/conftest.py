# SPDX-License-Identifier: Apache-2.0
"""Opt-in loopback inference fixtures; no autouse patches or external requests."""

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest


@pytest.fixture
def provider(monkeypatch):
    monkeypatch.delenv("APHRODY_INFERENCE_ENDPOINT", raising=False)
    state = {
        "status": 200,
        "response": {
            "choices": [
                {
                    "message": {"content": "42", "reasoning_content": "reason"},
                    "finish_reason": "stop",
                }
            ],
            "usage": {"prompt_tokens": 10, "completion_tokens": 2, "total_tokens": 12},
        },
        "requests": [],
        "events": [
            'data: {"choices":[{"delta":{"content":"4"},"finish_reason":null}]}\n\n',
            'data: {"choices":[{"delta":{"content":"2"},"finish_reason":"stop"}]}\n\n',
            "data: [DONE]\n\n",
        ],
    }

    class Handler(BaseHTTPRequestHandler):
        def do_POST(self):
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            state["requests"].append(
                (self.path, body, self.headers.get("Authorization"))
            )
            streaming = body.get("stream") and state["status"] == 200
            response = json.dumps(state["response"]).encode()
            self.send_response(state["status"])
            self.send_header(
                "Content-Type", "text/event-stream" if streaming else "application/json"
            )
            if not streaming:
                self.send_header("Content-Length", str(len(response)))
            self.end_headers()
            try:
                if streaming:
                    for index, event in enumerate(state["events"]):
                        self.wfile.write(event.encode())
                        self.wfile.flush()
                        if index == 0 and "continue" in state:
                            state["continue"].wait(timeout=2)
                else:
                    self.wfile.write(response)
            except (BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, *_args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1", state
    finally:
        if "continue" in state:
            state["continue"].set()
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)


@pytest.fixture
def native_provider(provider, monkeypatch):
    monkeypatch.setenv("APHRODY_INFERENCE_ENDPOINT", provider[0])
    return provider[1]
