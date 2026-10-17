// SPDX-License-Identifier: Apache-2.0
//! Open an OVH KVM (noVNC) console through Bun.WebView and optionally type into it.

use std::path::{Path, PathBuf};

use anyhow::{Context, Result, bail};

/// Bun.WebView driver: navigates, waits for the noVNC canvas, focuses it, presses keys.
pub const DRIVER: &str = include_str!("console.ts");

#[derive(Debug, Default, Clone)]
pub struct ConsoleInput {
    pub text: Option<String>,
    pub enter: bool,
    pub screenshot: Option<PathBuf>,
}

/// Run the driver with `bun`. The URL travels in the environment, never on the command line.
pub fn open(url: &str, input: &ConsoleInput) -> Result<String> {
    let dir = std::env::temp_dir().join(format!("aphrody-ovh-console-{}", std::process::id()));
    std::fs::create_dir_all(&dir)?;
    let script = dir.join("console.ts");
    std::fs::write(&script, DRIVER)?;
    let result = run(&script, url, input);
    let _ = std::fs::remove_dir_all(&dir);
    result
}

fn run(script: &Path, url: &str, input: &ConsoleInput) -> Result<String> {
    let bun = std::env::var_os("BUN_EXE").unwrap_or_else(|| "bun".into());
    let mut cmd = std::process::Command::new(bun);
    cmd.arg(script).env("APHRODY_CONSOLE_URL", url);
    if let Some(text) = &input.text {
        cmd.env("APHRODY_CONSOLE_TYPE", text);
    }
    if input.enter {
        cmd.env("APHRODY_CONSOLE_ENTER", "1");
    }
    if let Some(shot) = &input.screenshot {
        cmd.env("APHRODY_CONSOLE_SCREENSHOT", shot);
    }
    let out = cmd
        .output()
        .context("launch bun for the Bun.WebView console driver")?;
    if !out.status.success() {
        // stderr may echo the navigated URL: strip query strings before surfacing it.
        let err = String::from_utf8_lossy(&out.stderr);
        let safe: String = err
            .split_whitespace()
            .map(|w| {
                if w.contains("://") {
                    crate::vps::redact_console_url(w)
                } else {
                    w.into()
                }
            })
            .collect::<Vec<_>>()
            .join(" ");
        bail!("console driver failed ({}): {safe}", out.status);
    }
    Ok(String::from_utf8_lossy(&out.stdout).trim().to_owned())
}

#[cfg(test)]
mod tests {
    #[test]
    fn driver_reads_url_from_environment_only() {
        assert!(super::DRIVER.contains("process.env.APHRODY_CONSOLE_URL"));
        assert!(!super::DRIVER.contains("process.argv"));
    }
}
