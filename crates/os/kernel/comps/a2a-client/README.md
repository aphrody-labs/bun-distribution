<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-a2a-client

## What is `aphrody-a2a-client`?

`aphrody-a2a-client` is the high-level Rust client for the A2A v1 protocol. It
sends messages (and the full A2A message / task / push-config surface) to a
peer agent and returns typed responses. The crate provides a `Transport`
trait, JSON-RPC and REST implementations (gRPC comes from the companion
`aphrody-a2a-grpc` crate), middleware hooks, and an `AgentCard` resolver that
auto-selects the correct transport for a remote agent. It is imported in Rust
as `aphrody_a2a_client` and also ships the native `a2a_duel_loop` example (`cargo run -p aphrody-a2a-client --example a2a_duel_loop`).

## Install

```toml
[dependencies]
aphrody-a2a-client = "0.1"
aphrody-a2a = "0.3"
```

## Quick start

```rust,no_run
use aphrody_a2a_client::{A2AClient, rest::RestTransport};
use reqwest::Client;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let http = Client::builder().build()?;
    let transport = RestTransport::new(http, "http://localhost:8788/msg".into());
    let client = A2AClient::new(transport);
    // client.send_message(&req).await? ...
    Ok(())
}
```

## Public API

Source of truth: `crates/aphrody-a2a-client/src/lib.rs`. The crate exports
`A2AClient`, the `Transport` and `TransportFactory` traits, `ServiceParams`,
and the `BoxStream` alias (which becomes `LocalBoxStream` on `wasm32`).
Submodules `auth`, `client`, `middleware`, and `transport` are available on
every target; `agent_card`, `factory`, `jsonrpc`, and `rest` are gated off
`target_os = "wasi"` because they pull in `reqwest`. `A2AClientFactory` is the
re-exported entry point for agent-card-driven transport selection on native
and `wasm32-unknown-unknown` targets.

## Transports

- HTTP via `RestTransport` (RESTful endpoints, default) and
  `JsonRpcTransport` (JSON-RPC 2.0 envelope).
- gRPC via `GrpcTransport` from the companion `aphrody-a2a-grpc` crate.
- File-based JSONL inbox fallback: implement `Transport` against an `.coord`
  mailbox directory for offline peer-to-peer scenarios.

## Cross-platform

Linux and Windows are fully supported through `reqwest` over
`tokio` / `mio`. `wasm32-unknown-unknown` uses the browser `fetch` backend,
SSE streaming via `bytes_stream`, and `LocalBoxStream` because reqwest
futures are `!Send` in the single-threaded JS runtime. `wasm32-wasip1` builds
the trait definitions and data types only — the HTTP modules are
`cfg`-stripped until `wasi-http` (WASI Preview 2) lands.

## License

Apache-2.0. Copyright AGNTCY Contributors; aphrody-code packaging.

## Related

- `aphrody-a2a-server` — server-side counterpart.
- `aphrody-a2a-pb` — generated protobuf bindings.
- `aphrody-a2a-grpc` — gRPC transport binding.
