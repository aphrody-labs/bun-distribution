// SPDX-License-Identifier: Apache-2.0
//! `aphrody-render3d-mcp`: the native 3D subsystem as an MCP stdio plugin.
//!
//! `aphrody-kernel serve` (aphrody-os) spawns this binary and proxies its tools, so the kernel
//! never links this repository (aphrody-infra/docs/REPO-LAYERING.md).

use std::sync::Arc;

use aphrody_kernel::{Kernel, SystemSubsystem, transport::serve_stdio};
use aphrody_render3d::Render3dSubsystem;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let kernel = Kernel::new();
    kernel.register(Arc::new(Render3dSubsystem::new()) as Arc<dyn SystemSubsystem>).await?;
    serve_stdio(kernel).await;
    Ok(())
}
