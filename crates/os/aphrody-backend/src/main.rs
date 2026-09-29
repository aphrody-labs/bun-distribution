// SPDX-License-Identifier: Apache-2.0
use aphrody_backend::Md3Mirror;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let mirror = Md3Mirror::new()?;
    mirror.start_mirroring().await?;
    println!("MD3 mirror completed successfully.");
    Ok(())
}
