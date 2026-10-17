// SPDX-License-Identifier: Apache-2.0
//! Runs the WebSocket PTY backend: `serve [addr]` (default 127.0.0.1:7681); token from
//! `APHRODY_OS_AUTH_TOKEN` or generated and printed.
use aphrody_terminal_backend::{PtyConfig, serve};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let addr = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "127.0.0.1:7681".into());
    serve(addr.parse()?, PtyConfig::default()).await
}
