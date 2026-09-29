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
| `APHRODY_A2A_PEERS_FILE` | Peer catalog JSON read by `PeerRegistry::from_env`. |
| `APHRODY_A2A_PEER_<ID>_URL` | Per-peer HTTP endpoint override. |
| `APHRODY_AGY_BIN` | Path of the `agy` executable used by `PeerInvoker`. |

## Platform support

Native targets only (Linux, Windows, macOS): the crate uses `tokio` networking, process spawning
and the file system.

## License

Apache-2.0.
