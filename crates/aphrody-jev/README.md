<!-- SPDX-License-Identifier: Apache-2.0 -->
# aphrody-jev

Bun owns this shared Rust implementation of the Jev System One protocol.
The default core depends only on `serde`, `serde_json` and `thiserror`.
`client` enables the existing endpoint router and local chat adapter;
`server` additionally enables the compatible HTTP routes and CLI entrypoint.
Product configuration, process discovery and model loading remain with the caller.

## Protocol

`Entry` follows the official `@typesafe-ai/sdk` 0.6.0 declarations: text,
JSON objects, JSON arrays or null. Instructions are optional. Choice criteria
and Score legends retain structured entries; usage is a token object or explicit null.
The declaration digest and imported source hashes are in `provenance.json`.

`protocol` contains the validator used by Bun's Yolo bindings and the typed
`check_request` / `check_response` adapters. It preserves Bun's 1 MiB JSON limit,
64-question limit, Choice and Score bounds, prototype-name guards, complete
probability keys, matching Score legends and safe token counts. JSC prototype
checks stay at the JavaScript boundary.

```rust
use aphrody_jev::{Question, Request, check_request};

let request = Request::new(serde_json::json!({"ticket": "refund"}))
    .question("accepted", Question::noul(serde_json::Value::Null));
check_request(&request)?;
# Ok::<(), aphrody_jev::JevError>(())
```

`confident_choice` and `confident_choices` validate the request and response,
return a supplied candidate at or above the confidence threshold, and abstain
below it. They retain raw answers and distributions. `decision_output` shares
that policy with agent tools, MCP, the optional CLI and HTTP backend.

## Product integration

Enable `client` in the consumer's dependency. Aphrody resolves its canonical
chat setting and managed server before constructing the shared router:

```rust,ignore
fn configured_jev_router() -> Result<aphrody_jev::JevRouter, aphrody_jev::JevError> {
    let mut endpoint = aphrody_config::ai_env::CHAT_BASE_URL.resolve();
    #[cfg(not(target_arch = "wasm32"))]
    if endpoint.is_none() {
        endpoint = aphrody_llama_server::discover_running(aphrody_llama_server::Role::Chat)
            .map(|server| server.base_url());
    }
    aphrody_jev::JevRouter::from_env_with_native_endpoint(endpoint.as_deref())
}
```

`APHRODY_JEV_ENGINE_URL` takes precedence over that injected endpoint. Existing
TypeSafe, Cloudflare and self-hosted gateway configuration remains supported.
`NativeEngine` sends constrained completion requests to the injected HTTP
endpoint; it does not load weights or create another inference service.

The coordinated Aphrody cutover consists of:

- Root `Cargo.toml`: replace `crates/ai/jev` workspace ownership with the pinned
  Bun crate and enable `client` for its consumers; align the product's serde
  requirement with Bun's `=1.0.228` owner pin, then regenerate the product lock.
- `crates/ai/agent-tools`: keep `JevDecideTool` and its authorization/profile
  behavior; construct its router through the product adapter above.
- `crates/ai/mcp`: keep `aphrody_jev_decide` and cache successful router creation
  through the same adapter; update schema text for optional structured instructions.
- `crates/ai/agent-runtime`: retain tool registration and profile checks; point
  its test dependency at the shared crate.
- CLI/HTTP consumers: enable `server` only where those entrypoints are needed.

Retire the original Aphrody source owner only after these consumers and the
changed Bun binary pass their gates. No product paths or configuration secrets
are compiled into this crate.

## Verification and licensing

```powershell
bun scripts/build/rust/cargo-serial.ts --msvc test -p aphrody-jev --no-default-features --locked -- --test-threads=1
bun scripts/build/rust/cargo-serial.ts --msvc test -p aphrody-jev --features server --locked -- --test-threads=1
```

Tests use local mock servers and require no provider calls or credentials.
The fourteen imported Aphrody files carry Apache-2.0 (`LICENSE-APACHE`, `NOTICE`).
The Bun protocol adapter retains its MIT origin and notice in `LICENSE-BUN-MIT.md`.
