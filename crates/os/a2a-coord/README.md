<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-a2a-coord

File-based A2A coordination and its HTTP bridge for the Aphrody agent fleet. It builds on
[`aphrody-a2a`](https://crates.io/crates/aphrody-a2a) (protocol types) and
[`aphrody-a2a-server`](https://crates.io/crates/aphrody-a2a-server) (JSON-RPC and REST routers).

## Install

```toml
[dependencies]
aphrody-a2a-coord = "1.0.0-canary"
```

The Rust import path is `aphrody_a2a_coord`.

## What it provides

| Item | Role |
| --- | --- |
| `AiManifest`, `CoordConfig`, `PeerDef`, `find_repo_root` | Parse the `ai.json` agent manifest and locate the repository that holds it. |
| `Envelope`, `EnvelopeKind` | The v1 JSONL mailbox record exchanged through a `.coord` directory. |
| `mailbox::Mailbox` | Append, read and heartbeat per-peer JSONL inboxes. |
| `CoordProxy` | Serve a `.coord` mailbox as an NDJSON or SSE snapshot, or follow it as a stream. |
| `PeerInvoker`, `PeerId` | Headless dispatch to the native peer CLIs (Claude Code, Grok, agy). |
| `PeerRegistry` | HTTP peer endpoints resolved from `APHRODY_A2A_PEER_<ID>_URL`, then from a peer catalog file (`APHRODY_A2A_PEERS_FILE`). |
| `CoordPeerExecutor` | An `aphrody_a2a_server::AgentExecutor` that routes A2A tasks to the peers. |
| `listener::serve`, `serve_profile`, `router_for_profile` | An axum listener exposing `/ping`, `/msg`, `/coord`, the A2A JSON-RPC and REST bindings and the agent card. |
| `task_api::task_api_router` | Durable namespaced task CRUD and envelope mailbox routes used by serverless product agents. |

## Durable agent storage API

The active listener exposes an agent-scoped API under `/coord/{agent}/`:

| Method | Route | Contract |
| --- | --- | --- |
| `GET` | `/coord/{agent}/tasks?target=&limit=` | `{ tasks, total }` |
| `POST` | `/coord/{agent}/tasks` | Create a task object with an `id`; returns `201`, duplicate IDs return `409`. |
| `GET` | `/coord/{agent}/tasks/{task_id}` | Read a stored task object. |
| `PUT` | `/coord/{agent}/tasks/{task_id}` | Replace a task object while retaining the path ID. |
| `PATCH` | `/coord/{agent}/tasks/{task_id}` | Merge top-level task fields. |
| `DELETE` | `/coord/{agent}/tasks/{task_id}` | Delete a task record. |
| `GET` | `/coord/{agent}/envelopes?limit=` | `{ envelopes, total }`, newest first. |
| `POST` | `/coord/{agent}/envelopes` | Append one canonical v1 envelope; domain extension fields are preserved. |

Records are stored beneath `<coord-dir>/agents/<agent>/tasks/` and
`<coord-dir>/agents/<agent>/mailbox/`. Agent and task path segments accept only
ASCII letters, digits, `_` and `-`. Set `APHRODY_A2A_COORD_TOKEN` on the listener
to require `Authorization: Bearer <token>` on these routes. The legacy A2A and
mailbox routes keep their existing contracts.

Shenron's server routes use this API when `APHRODY_A2A_COORD_API` is set to the
Aphrody listener base URL, with optional `APHRODY_A2A_COORD_TOKEN`. They address
the `shenron-dragonball` namespace. Without that setting, the Shenron process
uses request-local memory only; it does not write task snapshots or envelopes to
its own filesystem.

## Quick start

```rust,no_run
use aphrody_a2a_coord::{AiManifest, ListenerConfig, serve};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    // Walks up from the current directory to the first `ai.json`.
    let (manifest, repo_root) = AiManifest::load_repo_default()?;
    let cfg = ListenerConfig {
        bind: "127.0.0.1:8788".parse()?,
        manifest,
        repo_root,
        dry_run: true, // do not spawn peer CLIs
    };
    serve(cfg).await
}
```

## Environment

| Variable | Effect |
| --- | --- |
| `APHRODY_A2A_PUBLIC_URL` | Base URL advertised in the agent card (default `http://<bind>`). |
| `APHRODY_A2A_DRY_RUN` | Never spawn peer CLIs, even when `ListenerConfig::dry_run` is false. |
| `APHRODY_A2A_COORD_TOKEN` | Require a bearer token on `/coord/{agent}/tasks` and `/coord/{agent}/envelopes`. |
| `APHRODY_A2A_PEERS_FILE` | Peer catalog JSON read by `PeerRegistry::from_env`. |
| `APHRODY_A2A_PEER_<ID>_URL` | Per-peer HTTP endpoint override. |
| `APHRODY_AGY_BIN` | Path of the `agy` executable used by `PeerInvoker`. |

## Platform support

Native targets only (Linux, Windows, macOS): the crate uses `tokio` networking, process spawning
and the file system.

## License

Apache-2.0.
