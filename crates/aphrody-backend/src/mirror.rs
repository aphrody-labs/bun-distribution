// SPDX-License-Identifier: Apache-2.0
//! MD3 asset mirror and the `aphrody-backend` entry point (host-only: disk and network).

use std::path::Path;

use anyhow::{Result, anyhow};
use reqwest::Client;
use tokio::fs;
use tracing::{error, info};

use crate::base::Vfs;

pub struct Md3Mirror {
    client: Client,
    target_dir: std::path::PathBuf,
}

impl Md3Mirror {
    pub fn new() -> Result<Self> {
        let target_dir =
            match std::env::var_os("APHRODY_MIRROR_DIR").filter(|value| !value.is_empty()) {
                Some(path) => std::path::PathBuf::from(path),
                None => {
                    let vfs = Vfs::new()?;
                    vfs.resolve("/var/mirror")?
                }
            };
        std::fs::create_dir_all(&target_dir)?;
        let client = Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()?;
        Ok(Self { client, target_dir })
    }

    pub async fn start_mirroring(&self) -> Result<()> {
        info!("Starting MD3 mirror in {}", self.target_dir.display());

        // Liste des composants/assets à synchroniser
        let assets = [
            (
                "https://raw.githubusercontent.com/material-components/material-web/main/README.md",
                "README.md",
            ),
            (
                "https://fonts.googleapis.com/css2?family=Google+Sans:wght@400;500;700&display=swap",
                "google_sans.css",
            ),
        ];

        let mut failures = Vec::new();
        for (url, filename) in assets {
            match self.download_asset(url, filename, &self.target_dir).await {
                Ok(()) => info!("Mirrored {filename}"),
                Err(error) => {
                    error!("Failed to mirror {filename}: {error}");
                    failures.push(filename);
                }
            }
        }
        if failures.is_empty() {
            Ok(())
        } else {
            Err(anyhow!("failed to mirror: {}", failures.join(", ")))
        }
    }

    async fn download_asset(&self, url: &str, filename: &str, target_dir: &Path) -> Result<()> {
        let response = self.client.get(url).send().await?.error_for_status()?;
        let content = response.bytes().await?;
        let dest_path = target_dir.join(filename);
        fs::write(dest_path, content).await?;
        Ok(())
    }
}

/// Entry point of the former `aphrody-backend` binary, now reached through the `aphrody` multi-call binary.
/// `args[0]` is the program name (argv convention). Returns the process exit code.
pub fn cli_main(_args: Vec<std::ffi::OsString>) -> i32 {
    let _ = tracing_subscriber::fmt().try_init();
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("Error: {error}");
            return 1;
        }
    };
    let outcome: Result<()> = runtime.block_on(async {
        let mirror = Md3Mirror::new()?;
        mirror.start_mirroring().await
    });
    match outcome {
        Ok(()) => {
            println!("MD3 mirror completed successfully.");
            0
        }
        Err(error) => {
            eprintln!("Error: {error:?}");
            1
        }
    }
}
