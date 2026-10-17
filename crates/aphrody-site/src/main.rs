// SPDX-License-Identifier: Apache-2.0
use clap::Parser;
use std::{net::SocketAddr, path::PathBuf};

#[derive(Parser)]
#[command(about = "Serve the native Aphrody product site")]
struct Cli {
    /// Repository containing the canonical M3 templates.
    #[arg(long, env = "APHRODY_WORKSPACE_ROOT")]
    root: Option<PathBuf>,
    #[arg(long, default_value = "127.0.0.1:3000", env = "APHRODY_SITE_BIND")]
    bind: SocketAddr,
    /// Separate Bun WebOS origin. This is a redirect, never a host proxy.
    #[arg(long, env = "BUN_WEBOS_URL")]
    webos_url: Option<String>,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    let root = cli.root.map_or_else(std::env::current_dir, Ok)?;
    aphrody_site::serve(&root, cli.bind, cli.webos_url.as_deref()).await?;
    Ok(())
}
