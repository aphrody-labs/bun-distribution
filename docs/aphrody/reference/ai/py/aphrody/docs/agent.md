<!-- SPDX-License-Identifier: Apache-2.0 -->
# Python agent client

`aphrody.agent.AgentClient` starts an owned Aphrody app-server process and uses
the Codex v2 stdio protocol. It has no third-party Python dependencies and does
not read Codex credentials or select a cloud provider implicitly.

```python
from aphrody.agent import AgentClient

with AgentClient(executable="aphrody") as client:
    client.initialize()
    thread = client.start_thread(model="your-installed-model")["thread"]["id"]
    turn = client.start_turn(thread, "Explain the current workspace.")
    for event in turn.events():
        if event["method"] == "item/agentMessage/delta":
            print(event["params"]["delta"], end="", flush=True)
```

The server loads provider configuration from `$APHRODY_HOME/config.toml`.
Select an executable, working directory, environment overrides and launch
arguments through `AgentClient(executable=..., cwd=..., env=..., args=...)`.
The default arguments are `("app-server",)`.

`client.request(method, params)` exposes additional server methods, including
`thread/resume`. `turn.interrupt()` works while another thread consumes
`turn.events()`. Each thread supports one active event consumer. Notifications
arriving before the start response remain available. Completed turns include
their terminal `turn/completed` event; inspect its `turn.status` and `turn.error`
to distinguish completion, interruption and model failure.

Requests time out after 30 seconds by default (`request_timeout`). Turn streams
have no implicit duration limit; `turn.events(timeout=...)` optionally bounds
idle waits. A request timeout does not cancel server execution. Use interruption
for an active turn, and always close the client or use its context manager.
Unexpected server approval requests receive an explicit unsupported error.

## Source and validation

The single-reader transport, response routing and failure propagation are
adapted from OpenAI Codex
[`client.py` and `_message_router.py`](https://github.com/openai/codex/tree/78245b47af2a7aafcabe025828ceecca69db4df1/sdk/python/src/openai_codex)
at revision `78245b47af2a7aafcabe025828ceecca69db4df1`, under Apache-2.0.
The SDK does not copy the upstream cloud login or package downloader.

- FAIT: stdio handshake, requests, thread/turn helpers, streaming, interruption,
  structured RPC errors, process shutdown. Nine subprocess tests cover early
  notifications, Unicode, reversed responses, crashes, malformed frames,
  timeouts, unsolicited approval requests and stderr draining.
- INCOMPLET: complete Codex SDK method/type coverage, browser transport and
  generated protocol models. Generic requests preserve the server's supported
  subset; they do not make unsupported server methods available.

From the Python workspace, run:

```text
uv run --no-sync pytest aphrody/tests/test_agent.py
uv run --no-sync pytest aphrody/tests/test_agent_live.py
```

The second suite skips unless `APHRODY_TEST_BINARY` points to a built Rust
executable. It runs the real CLI and app-server with a local HTTP SSE model
fixture, isolated state and actual tool execution. It checks streaming,
durable resume after process restart, interruption, and a shell tool round-trip.
When Bun is installed, it also checks the Bun SDK against the same real Rust
server and HTTP model fixture.
It downloads no weights and requires no account; passing it demonstrates
protocol integration, not model quality or production deployment.
