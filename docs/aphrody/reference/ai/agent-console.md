<!-- SPDX-License-Identifier: Apache-2.0 -->
# Local agent: CLI, API, web and desktop

These surfaces share the Rust model client, engine, production tools and session
rollouts. They implement a subset of the Codex interfaces. The Python transport
and Bun port adapt upstream Codex SDK source; the attribution and exact revision
are recorded in [THIRD_PARTY_CODEX.md](./THIRD_PARTY_CODEX.md).

## CLI

Build the executable with retrieval and the separate training commands:

```sh
cargo build -p aphrody --features rag,train --locked --offline
aphrody --oss --model file:/models/coder.gguf exec --json "Inspect the workspace and run its tests"
aphrody exec --json resume --last "Continue from the recorded results"
aphrody exec --json fork --last "Try a different approach"
```

Use an existing absolute GGUF path for `file:`. Managed inference needs an
installed `llama-server`; select its directory with `[llama].runtime_dir` or
`APHRODY_LLAMA_BIN`. The CLI prepares a managed local server and keeps it alive
throughout the session. Existing external Ollama, LM Studio and vLLM providers
remain available through configuration. Provider setup errors are explicit.

`exec` reads a piped prompt from stdin, writes Codex-shaped JSONL with `--json`,
and accepts `--output-last-message PATH`. `--ephemeral` skips persistence.
`--max-tool-iterations 0` means no fixed tool-iteration cap and is the default.
This does not remove the selected model's context window, available RAM/VRAM,
shell timeouts, disk capacity or provider limits. Before model requests, the
engine structurally compacts old history at the configured
`model_auto_compact_token_limit`, or at 80% of the advertised context window.
It retains recent messages and model/tool groups verbatim and records a
restorable rollout checkpoint. Token counting is conservative and heuristic.

Rollouts retain the session ID on resume; forks receive a new ID and record
their parent. Canonical history uses backpressure and is flushed before a
completed turn is announced. Interrupted model streams can be cancelled;
already-running tools follow their own completion or timeout behavior.

The existing interactive terminal remains available with `aphrody agent --tui`.
`aphrody agy` and `aphrody codex` are separate forwarding commands; they do not
turn those external applications into open-weight inference engines.

## Retrieval

```sh
aphrody rag --db /data/project/index.db index /work/project
aphrody rag --db /data/project/index.db search "session persistence"
aphrody rag --db /data/project/index.db context "session persistence" --token-budget 2000
aphrody rag --db /data/project/index.db stats
aphrody -c rag.enabled=true -c 'rag.db_path="/data/project/index.db"' exec "Find the relevant implementation"
```

The CLI index/search path defaults to lexical retrieval and follows `[rag].mode`
(`lexical`, `hybrid`, `hybrid+rerank`) or an explicit `--mode` (`lexical`,
`vector`, `hybrid`, `hybrid-rerank`). Vector modes need `[rag].embed_backend`
(local ONNX, llama-server or an OpenAI-compatible `/v1/embeddings`); reranking
needs `[rag].rerank_endpoint` and `[rag].rerank_model`. Nothing is configured
implicitly, and a missing embedder degrades the served mode explicitly rather
than failing silently. Agent tools `rag_search` and `rag_context` use the configured index;
missing indexes fail explicitly. Source context escapes XML delimiters and
respects its approximate token budget, including an oversized first chunk.

## API and web

```sh
aphrody app-server
aphrody app-server --http --addr 127.0.0.1:8765
```

Stdio supplies request/response frames and streaming notifications. HTTP serves
the console at `/` and JSON-RPC at `/rpc`; the console polls turn events. See
the [protocol and lifecycle](../../../../crates/aphrody-app-server/README.md) for the
initialization handshake and supported methods.

The API accepts the same managed open-weight selection as the CLI. For example,
`thread/start` with `{"oss":true}` resolves installed weights, starts the
loopback-only `llama-server`, and retains its lease for the thread lifetime.
`localProvider` selects an external Ollama, LM Studio, or vLLM endpoint. You can
also configure an explicit endpoint in `~/.aphrody/config.toml`:

```toml
model = "coder"
model_provider = "local"
approval_policy = "never"
sandbox_mode = "danger-full-access"

[model_providers.local]
name = "Existing local model server"
base_url = "http://127.0.0.1:8080/v1"
wire_api = "chat"

[rag]
enabled = true
db_path = "/data/project/index.db"
```

`initialize.params.profile`, `APHRODY_PROFILE`, and the top-level `profile`
configuration select an isolated `workspace-<profile>` state root, in that
order. Sessions and the default RAG index stay under that root. HTTP binds only
to loopback and rejects foreign browser origins. This is not a hosted,
authenticated multi-user service. The runtime uses full local permissions;
unsupported restrictive policies are rejected instead of silently ignored.

## Desktop and SDKs

`bun run desktop:dev` (Windows and Linux) builds
and launches the same console in Tauri. The desktop calls `aphrody_rpc` directly
in Rust; existing `aphrody_exec` commands still use the in-process CLI. Its
binary can host the managed llama daemon before Tauri initialization, so desktop
threads use the same provider lifecycle as CLI and API. The independent desktop
workspace retains its own lockfile. The optional legacy `desktop-react` and
`desktop-ui` frontends remain selectable by the scripts.

The console supports model/workspace/index selection for new sessions, text
turns, streamed output, interruption and session replay. It is an initial agent
console, not the full Codex desktop interface or the planned project-profile
dashboard. Native application launch and installer validation are separate
from a successful Rust compilation.

Client examples and executable integration tests:

- [Python client](./py/aphrody/docs/agent.md)
- [Bun client](../../../../packages/aphrody-bun/AGENT.md)
- Real binary tests

The implementation status and outstanding parity work remain tracked in the
[Codex integration plan](../../plans/ai/plans/codex-oss.md).
