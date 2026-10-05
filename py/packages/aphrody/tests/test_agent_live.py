# SPDX-License-Identifier: Apache-2.0
"""Opt-in integration with the real Rust binary and a local HTTP model fixture.

Set APHRODY_TEST_BINARY to a freshly built executable. Only model responses are
scripted: CLI parsing, providers, SSE parsing, engine, tools, rollouts, app-server
and SDK transports execute their production implementations.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import pytest

from aphrody.agent import AgentClient

TOOL_MARKER = "aphrody-tool-process-confirmed"


@pytest.fixture
def agent_binary():
    configured = os.environ.get("APHRODY_TEST_BINARY")
    if not configured:
        pytest.skip("Set APHRODY_TEST_BINARY to run real Rust integration")
    binary = Path(configured).resolve(strict=True)
    assert binary.is_file(), "APHRODY_TEST_BINARY must point to a file"
    return str(binary)


@pytest.fixture
def model_endpoint():
    requests = []
    streaming = threading.Event()
    release = threading.Event()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, _format, *_args):
            pass

        def do_POST(self):
            if self.path != "/v1/chat/completions":
                self.send_error(404)
                return
            body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
            requests.append(body)
            self.send_response(200)
            self.send_header("Content-Type", "text/event-stream; charset=utf-8")
            self.send_header("Connection", "close")
            self.end_headers()
            messages = body["messages"]
            latest_user = next(
                (
                    message
                    for message in reversed(messages)
                    if message["role"] == "user"
                ),
                {},
            )
            text = str(latest_user.get("content", ""))

            def frame(delta, finish=None):
                payload = {
                    "choices": [{"index": 0, "delta": delta, "finish_reason": finish}]
                }
                self.wfile.write(
                    (
                        "data: " + json.dumps(payload, ensure_ascii=False) + "\n\n"
                    ).encode()
                )
                self.wfile.flush()

            try:
                if "SDK_TOOL_LOOP" in text and messages[-1]["role"] != "tool":
                    frame(
                        {
                            "tool_calls": [
                                {
                                    "index": 0,
                                    "id": "fixture-shell-call",
                                    "type": "function",
                                    "function": {
                                        "name": "shell",
                                        "arguments": json.dumps(
                                            {
                                                "command": [
                                                    sys.executable,
                                                    "-c",
                                                    f"print({TOOL_MARKER!r})",
                                                ]
                                            }
                                        ),
                                    },
                                }
                            ]
                        }
                    )
                    frame({}, "tool_calls")
                else:
                    frame({"content": "fixture response: été 日本語"})
                    if "SDK_INTERRUPT" in text:
                        streaming.set()
                        release.wait(timeout=20)
                    frame({}, "stop")
                self.wfile.write(b"data: [DONE]\n\n")
                self.wfile.flush()
            except (
                BrokenPipeError,
                ConnectionResetError,
                ConnectionAbortedError,
            ):
                pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    worker = threading.Thread(target=server.serve_forever, daemon=True)
    worker.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}/v1", requests, streaming
    finally:
        release.set()
        server.shutdown()
        server.server_close()
        worker.join(timeout=3)


@pytest.fixture
def isolated_agent(tmp_path, model_endpoint):
    endpoint, _, _ = model_endpoint
    home = tmp_path / "home"
    home.mkdir()
    (home / "config.toml").write_text(
        'model = "fixture-model"\n'
        'model_provider = "local"\n'
        'approval_policy = "never"\n'
        'sandbox_mode = "danger-full-access"\n'
        "[model_providers.local]\n"
        'name = "Local integration fixture"\n'
        f'base_url = "{endpoint}"\n'
        'wire_api = "chat"\n',
        encoding="utf-8",
    )
    return {
        "APHRODY_HOME": str(home),
        "APHRODY_LOCAL_MODEL_URL": endpoint,
    }, tmp_path


def _start(binary, environment, cwd):
    client = AgentClient(binary, env=environment, cwd=str(cwd), request_timeout=30)
    try:
        client.initialize()
    except BaseException:
        client.close()
        raise
    return client


def _complete(client, thread_id, text):
    events = list(client.start_turn(thread_id, text).events(timeout=30))
    assert events[-1]["method"] == "turn/completed"
    assert events[-1]["params"]["turn"]["status"] == "completed", events[-1]
    deltas = [
        event["params"]["delta"]
        for event in events
        if event["method"] == "item/agentMessage/delta"
    ]
    assert "été 日本語" in "".join(deltas)
    return events


def test_real_app_server_streaming(agent_binary, isolated_agent, model_endpoint):
    env, cwd = isolated_agent
    with _start(agent_binary, env, cwd) as client:
        thread = client.start_thread(cwd=str(cwd))["thread"]["id"]
        _complete(client, thread, "SDK_HELLO")
    assert len(model_endpoint[1]) == 1
    assert model_endpoint[1][0]["stream"] is True


def test_real_app_server_resume_after_process_restart(
    agent_binary, isolated_agent, model_endpoint
):
    env, cwd = isolated_agent
    with _start(agent_binary, env, cwd) as client:
        thread = client.start_thread(cwd=str(cwd))["thread"]["id"]
        _complete(client, thread, "SDK_DURABLE_FIRST")
    assert list((Path(env["APHRODY_HOME"]) / "sessions").rglob("*.jsonl"))
    with _start(agent_binary, env, cwd) as client:
        resumed = client.request("thread/resume", {"threadId": thread})
        assert resumed["thread"]["id"] == thread
        _complete(client, thread, "SDK_DURABLE_SECOND")
    history = model_endpoint[1][-1]["messages"]
    assert any(
        "SDK_DURABLE_FIRST" in str(message.get("content")) for message in history
    )
    assert any(
        message["role"] == "assistant"
        and "fixture response" in str(message.get("content"))
        for message in history
    )


def test_real_app_server_interrupt_active_model(
    agent_binary, isolated_agent, model_endpoint
):
    env, cwd = isolated_agent
    with _start(agent_binary, env, cwd) as client:
        thread = client.start_thread(cwd=str(cwd))["thread"]["id"]
        turn = client.start_turn(thread, "SDK_INTERRUPT")
        assert model_endpoint[2].wait(timeout=10), "Model request did not start"
        turn.interrupt()
        events = list(turn.events(timeout=10))
        assert events[-1]["method"] == "turn/completed"
        assert events[-1]["params"]["turn"]["status"] == "interrupted"


def test_real_cli_executes_tool_and_returns_result_to_model(
    agent_binary, isolated_agent, model_endpoint
):
    env, cwd = isolated_agent
    completed = subprocess.run(
        [
            agent_binary,
            "--cd",
            str(cwd),
            "exec",
            "--json",
            "--skip-git-repo-check",
            "--max-tool-iterations",
            "3",
            "SDK_TOOL_LOOP",
        ],
        input="",
        capture_output=True,
        text=True,
        encoding="utf-8",
        env={**os.environ, **env},
        cwd=cwd,
        timeout=60,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    events = [
        json.loads(line) for line in completed.stdout.splitlines() if line.strip()
    ]
    assert any(event["type"] == "turn.completed" for event in events), events
    requests = model_endpoint[1]
    assert len(requests) == 2
    tool_results = [
        message for message in requests[-1]["messages"] if message["role"] == "tool"
    ]
    assert any(
        TOOL_MARKER in str(message.get("content")) for message in tool_results
    ), tool_results


def test_real_bun_sdk_streaming(agent_binary, isolated_agent, model_endpoint):
    bun = shutil.which("bun")
    if not bun:
        pytest.skip("Bun executable is required for the Bun SDK integration")
    env, cwd = isolated_agent
    configured_sdk = os.environ.get("APHRODY_TEST_BUN_SDK")
    if not configured_sdk:
        pytest.skip("Set APHRODY_TEST_BUN_SDK to the AgentClient module")
    sdk = Path(configured_sdk).expanduser().resolve()
    assert sdk.is_file(), f"Missing configured Bun SDK: {sdk}"
    script = (
        f"import {{ AgentClient }} from {json.dumps(sdk.as_uri())};\n"
        + """
const client = new AgentClient({executable: Bun.env.APHRODY_TEST_BINARY});
try {
    await client.initialize();
    const {thread} = await client.startThread({cwd: Bun.env.APHRODY_TEST_CWD});
    const turn = await client.startTurn(thread.id, "SDK_BUN_HELLO");
    const events = await Array.fromAsync(turn.events());
    console.log(JSON.stringify(events));
} finally {
    await client.close();
}
"""
    )
    completed = subprocess.run(
        [bun, "--eval", script],
        input="",
        capture_output=True,
        text=True,
        encoding="utf-8",
        env={
            **os.environ,
            **env,
            "APHRODY_TEST_BINARY": agent_binary,
            "APHRODY_TEST_CWD": str(cwd),
        },
        cwd=cwd,
        timeout=60,
        check=False,
    )
    assert completed.returncode == 0, completed.stderr
    events = json.loads(completed.stdout)
    assert events[-1]["method"] == "turn/completed"
    assert events[-1]["params"]["turn"]["status"] == "completed"
    assert any(
        event.get("params", {}).get("delta") == "fixture response: été 日本語"
        for event in events
    )
    assert len(model_endpoint[1]) == 1
