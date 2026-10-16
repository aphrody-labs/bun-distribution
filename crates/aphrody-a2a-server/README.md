<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-a2a-server

## What is `aphrody-a2a-server`?

`aphrody-a2a-server` is the server-side counterpart to `aphrody-a2a-client`. It
accepts A2A v1 requests (the full message / task / push-config surface) from
peer agents and dispatches them to a user-supplied `AgentExecutor`. The crate
is built on `axum`, `tower`, `hyper`, and `tokio`, and ships routers for both
the JSON-RPC and REST protocol bindings, middleware hooks for cross-cutting
concerns, in-memory and file-system task stores, and an `AgentCardProducer`
that publishes the canonical `.well-known/agent-card.json` descriptor. It is
imported in Rust as `aphrody_a2a_server`.

## Install

```toml
[dependencies]
aphrody-a2a-server = "0.3"
aphrody-a2a = "0.3"
tokio = { version = "1", features = ["full"] }
axum = "0.8"
```

## Quick start

`MyExecutor` stands for your implementation of `AgentExecutor` (`execute` and
`cancel` return a stream of `StreamResponse` events).

```rust,ignore
use std::sync::Arc;
use aphrody_a2a_server::{DefaultRequestHandler, InMemoryTaskStore, jsonrpc::jsonrpc_router};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let handler = Arc::new(DefaultRequestHandler::new(MyExecutor, InMemoryTaskStore::default()));
    let app = jsonrpc_router(handler);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:8788").await?;
    axum::serve(listener, app).await?;
    Ok(())
}
```

## Public API

Source of truth: `crates/aphrody-a2a-server/src/lib.rs`. Public re-exports cover
`AgentCardProducer`, `StaticAgentCard`, `WELL_KNOWN_AGENT_CARD_PATH`,
`AgentExecutor`, `ExecutorContext`, `DefaultRequestHandler`, `RequestHandler`,
`CallContext`, `CallInterceptor`, `InterceptedHandler`, `ServiceParams`,
`User`, `HttpPushSender`, `InMemoryPushConfigStore`, `PushConfigStore`,
`InMemoryTaskStore`, `FsTaskStore`, and `TaskStore`. Submodules `agent_card`, `executor`,
`handler`, `jsonrpc`, `middleware`, `push`, `rest`, `sse`, and `task_store`
are public; `tls` is gated behind `feature = "rustls"`.

## Routing

Message-type dispatch is performed by the protocol routers. `jsonrpc_router`
mounts a single POST endpoint that routes on the JSON-RPC `method` field
(`message/send`, `message/stream`, `tasks/get`, `tasks/list`, `tasks/cancel`,
push-config CRUD, etc.). `rest_router` exposes the same operations as RESTful
resources (`/message:send`, `/message:stream`, `/extendedAgentCard`, ...).
`CallInterceptor` lets you hook authentication, tracing, and rate-limiting
into every request without rewriting the handler.

## Cross-platform

Linux and Windows are fully supported. The crate emits a
`compile_error!` on `wasm32` targets because `axum` / `hyper` / `tokio::net`
require OS-level TCP sockets — WASM agents should consume the API through
`aphrody-a2a-client` with `RestTransport` instead.

## License

Apache-2.0. Copyright AGNTCY Contributors; aphrody-code packaging.

## Related

- `aphrody-a2a-client` — client-side counterpart.
- `aphrody-a2a-pb` — generated protobuf bindings shared by both peers.
