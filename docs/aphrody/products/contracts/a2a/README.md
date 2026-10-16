<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody A2A (Agent2Agent)

Community implementation aligned with [A2A Protocol 1.0](https://a2a-protocol.org/latest/specification/)
and the [a2aproject](https://github.com/orgs/a2aproject/repositories) SDK ecosystem.
The crates live in this repository; the `aphrody a2a` command line that drives
them lives in `../aphrody-ai`.

## Layers

| Layer | Crate / artifact | Role |
| --- | --- | --- |
| Data model | `aphrody-a2a`, `aphrody-a2a-pb` | Tasks, messages, parts, agent card, JSON-RPC types (proto-backed), fleet `.coord` envelopes |
| Server framework | `aphrody-a2a-server` | JSON-RPC, REST, SSE, task store, push notifications, `AgentExecutor` |
| gRPC binding | `aphrody-a2a-grpc` | tonic transport for client and server |
| Coordination | `aphrody-a2a-coord` | `ai.json`, JSONL mailboxes, HTTP bridge, native peer dispatch |
| Client / duel | `aphrody-a2a-client`, `a2a_duel_loop` (example) | Remote calls and file-based duel ticks |
| TypeScript client | `@aphrody/a2a` (`packages/os/a2a`) | Agent Card discovery, JSON-RPC and HTTP+JSON bindings, SSE, push configs, legacy-dialect shim; types generated from `a2a.proto` |

## Quick start (from `../aphrody-ai`)

```bash
# HTTP listener: agent card + JSON-RPC + file /msg
aphrody a2a serve --bind 127.0.0.1:8788

# One JSONL envelope (duel / coord loop)
aphrody a2a tick --iteration 1 --side aphrody --peer winclean

# Headless native peer (Claude Code, Grok, agy, bxc)
aphrody a2a invoke "refactor the auth module" --peer grok
aphrody a2a invoke "summarize PLAN.md" --peer agy --dry-run
```

Dry-run for the server executor: `APHRODY_A2A_DRY_RUN=1 aphrody a2a serve`
(`ListenerConfig::dry_run` does the same programmatically).

## `ai.json`

The repository root `ai.json` is the reference manifest of the
`aphrody` agent (parsed by the `aphrody-a2a-coord` tests). It declares:

- A2A **1.0** (`a2a_protocol_version`, `spec: a2a/v1.0`) and the public
  JSON-RPC interface;
- the skills and the file channel (`coord`: `.coord/inbox-from-<peer>.jsonl`,
  default bind `127.0.0.1:8788`);
- no peers: the peer list is owned by `../aphrody-infra`
  (`tools/config/a2a-peers.json`) and resolved at runtime by
  `aphrody_a2a_coord::PeerRegistry::from_env`.
  `APHRODY_A2A_PEERS_FILE` overrides the catalog path and
  `APHRODY_A2A_PEER_<ID>_URL` overrides one peer URL.

## Native peers

| Peer | CLI | Notes |
| --- | --- | --- |
| `grok` | `grok --prompt-file … --always-approve --permission-mode bypassPermissions` | Do **not** pass `--effort` with `grok-build` (HTTP 400) |
| `agy` | `agy -p "…" --dangerously-skip-permissions --add-dir <repo>` | Antigravity / Gemini |
| `claude` | `claude -p "…" --output-format text` | Claude Code |
| `bxc` | `aphrody web search … --json` | Web search (`bxc` is a name of the `aphrody` binary) |

Override binaries: `GROK_BIN`, `APHRODY_AGY_BIN`, `CLAUDE_BIN`, `APHRODY_BIN` (the `bxc` peer).

## Protocol bindings (A2A 1.0)

Served by `aphrody_a2a_coord::listener`:

| Binding | Entry |
| --- | --- |
| Agent Card | `GET /.well-known/agent-card.json` |
| JSON-RPC 2.0 | `POST /` — `SendMessage`, `GetTask`, `ListTasks`, … |
| HTTP+REST | merged from the `aphrody-a2a-server` REST router (same handler) |
| Fleet JSON-RPC | `POST /a2a` — fleet `message/send` (`target`, `sourceAgent`, `instruction`, `yolo`), mirrored as a `.coord` envelope |
| File bridge | `POST /msg` — JSONL envelopes; `GET /ping`, `GET /coord` |

Service headers: `A2A-Version: 1.0`, optional `A2A-Extensions`.

## JSON-RPC routing

`SendMessage` routes through `CoordPeerExecutor`:

- metadata `aphrody_peer` or `peer` selects the CLI;
- a message prefix `@grok:` or `/peer grok` also selects the peer;
- completed tasks include an artifact with the peer's stdout.

## File channel

Envelopes (`ping`, `ask`, `fact`, `ack`, `error`) are appended, one JSON object
per line, to `.coord/inbox-from-<short-id>.jsonl`; `POST /msg` accepts the same
JSON from HTTP peers. The normative shape is the code, not prose:

- `aphrody_a2a::coord::CoordEnvelope` (v1, `deny_unknown_fields`) and its
  `validate()` invariants;
- machine-readable JSON Schemas from `aphrody_a2a::coord::envelope_schema()`,
  `jsonrpc_request_schema()`, `jsonrpc_response_schema()` and
  `agent_card_schema()`.

`GET /coord` reads the `aphrody` mailbox (`inbox-from-aphrody.jsonl`) through
`aphrody_a2a_coord::CoordProxy`: an `application/x-ndjson` snapshot by default,
or `text/event-stream` (`data: <line>\n\n` per envelope) when `Accept` contains
`text/event-stream`. A missing mailbox is an empty `200`, never an error.
`CoordProxy::tail_stream` / `tail_stream_sse` follow the file like `tail -f`
and only emit complete lines, so a concurrent writer never produces half an
envelope. Lines are forwarded verbatim; validating them is the producer's job.

The earlier file-transport specification (`docs/PROTOCOL.md` (not in repo) of the monorepo,
with `type`/`subject` envelopes and a `.well-known/ai.json` copy) no longer
matches the implementation and was removed.

## TypeScript client

`@aphrody/a2a` ([`packages/os/a2a`](../../../../../packages/a2a/README.md)) is the Bun client of
the server above. Its types are generated from `crates/os/kernel/comps/a2a-pb/proto/a2a.proto` (`bun run generate`
in the package), the schema `aphrody-a2a-pb` compiles, and its tests run against an in-process fake
agent and against `aphrody a2a serve` in dry-run mode. It speaks only A2A 1.0 (`SendMessage`,
`GetTask`, ...); `LegacyBridge` (`@aphrody/a2a/legacy`) serves the pre-1.0 dialect (`message/send`,
`tasks/get`, `tasks/update`, `kind`/`type` parts) from a 1.0 agent, with the mapping documented in
the package README. Not published to npm.

## References

- Spec: <https://a2a-protocol.org/latest/specification/>
- Org SDKs: <https://github.com/a2aproject/a2a-rs> (Rust), `a2a-python`, `a2a-js`, `a2a-go`
