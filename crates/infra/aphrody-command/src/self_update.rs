// SPDX-License-Identifier: Apache-2.0
// `aphrody self update` — selects the immutable release published in `latest.json` once, runs the
// installer of that same release (checksum-verified, binary run before activation) and rolls back to the
// previous binary when the new one does not start. Timer / scheduled-task entry point of the auto-release
// chain (docs/operations/infra/AUTO-RELEASE.md).

use aphrody_proc::NoWindow as _;
use std::path::{Path, PathBuf};

use async_trait::async_trait;
use miette::{IntoDiagnostic, WrapErr};
use serde::{Deserialize, Serialize};

use crate::context::{GoogleContext, TerminalCommand};

const DEFAULT_BASE: &str = "https://downloads.aphrody.com";
const KEEP_RELEASES: usize = 3;

pub(crate) struct UpdateCommand {
    pub base: Option<String>,
    pub components: String,
    pub check: bool,
    pub force: bool,
    pub rollback: bool,
}

#[derive(Serialize, Deserialize, Default, Debug)]
struct State {
    release: String,
    bin: Option<PathBuf>,
    previous_release: Option<String>,
    previous_bin: Option<PathBuf>,
}

fn state_path() -> miette::Result<PathBuf> {
    let dir = dirs::data_local_dir()
        .ok_or_else(|| miette::miette!("no local data directory"))?
        .join("aphrody");
    std::fs::create_dir_all(&dir).into_diagnostic()?;
    Ok(dir.join("self-update.json"))
}

fn read_state(path: &Path) -> State {
    std::fs::read_to_string(path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn write_state(path: &Path, state: &State) -> miette::Result<()> {
    let tmp = path.with_extension("json.tmp");
    std::fs::write(&tmp, serde_json::to_vec_pretty(state).into_diagnostic()?).into_diagnostic()?;
    std::fs::rename(&tmp, path).into_diagnostic()
}

fn valid_release_id(id: &str) -> bool {
    let mut chars = id.chars();
    id.len() <= 128
        && chars.next().is_some_and(|c| c.is_ascii_alphanumeric())
        && chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-'))
}

fn runs(bin: &Path) -> bool {
    std::process::Command::new(bin).no_window()
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

fn relink(bin: &Path) -> miette::Result<()> {
    let status = std::process::Command::new(bin).no_window()
        .args(["self", "install-path", "--bin"])
        .arg(bin)
        .status()
        .into_diagnostic()?;
    if status.success() {
        Ok(())
    } else {
        Err(miette::miette!("install-path failed for {}", bin.display()))
    }
}

/// Keeps the newest `KEEP_RELEASES` installed directories (never the active or previous one).
fn prune(active: &Path, previous: Option<&Path>) {
    let Some(root) = active.parent().and_then(Path::parent) else { return };
    let Ok(read) = std::fs::read_dir(root) else { return };
    let mut dirs: Vec<(std::time::SystemTime, PathBuf)> = read
        .filter_map(Result::ok)
        .filter(|e| e.path().is_dir())
        .filter_map(|e| Some((e.metadata().ok()?.modified().ok()?, e.path())))
        .collect();
    dirs.sort_by_key(|entry| std::cmp::Reverse(entry.0));
    for (_, path) in dirs.into_iter().skip(KEEP_RELEASES) {
        if active.starts_with(&path) || previous.is_some_and(|p| p.starts_with(&path)) {
            continue;
        }
        let _ = std::fs::remove_dir_all(path);
    }
}

#[async_trait]
impl TerminalCommand for UpdateCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        let path = state_path()?;
        let lock = std::fs::OpenOptions::new()
            .create(true)
            .write(true)
            .truncate(false)
            .open(path.with_extension("lock"))
            .into_diagnostic()?;
        lock.lock().into_diagnostic()?;
        let state = read_state(&path);

        if self.rollback {
            let (Some(prev), Some(prev_release)) =
                (state.previous_bin.clone(), state.previous_release.clone())
            else {
                return Err(miette::miette!("no previous release recorded"));
            };
            if !runs(&prev) {
                return Err(miette::miette!("previous binary {} does not run", prev.display()));
            }
            relink(&prev)?;
            println!("rolled back to {prev_release}");
            return write_state(
                &path,
                &State {
                    release: prev_release,
                    bin: Some(prev),
                    previous_release: Some(state.release),
                    previous_bin: state.bin,
                },
            );
        }

        let base = self
            .base
            .clone()
            .or_else(|| std::env::var("APHRODY_DOWNLOAD_URL").ok())
            .unwrap_or_else(|| DEFAULT_BASE.to_string());
        let base = base.trim_end_matches('/').to_string();
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(120))
            .build()
            .into_diagnostic()?;
        let latest: serde_json::Value = client
            .get(format!("{base}/latest.json"))
            .send()
            .await
            .into_diagnostic()?
            .error_for_status()
            .into_diagnostic()?
            .json()
            .await
            .into_diagnostic()
            .wrap_err("latest.json")?;
        let id = latest["release"]["id"].as_str().unwrap_or_default().to_string();
        if !valid_release_id(&id) {
            return Err(miette::miette!("latest.json has no valid release id"));
        }
        let installed = if state.release.is_empty() { "unknown" } else { state.release.as_str() };
        if state.release == id && !self.force {
            println!("up to date: {id}");
            return Ok(());
        }
        println!("installed {installed}, published {id}");
        if self.check {
            return Ok(());
        }

        let windows = cfg!(windows);
        let name = if windows { "install.ps1" } else { "install.sh" };
        let script = client
            .get(format!("{base}/{name}"))
            .send()
            .await
            .into_diagnostic()?
            .error_for_status()
            .into_diagnostic()?
            .text()
            .await
            .into_diagnostic()?;
        let tmp = tempfile::tempdir().into_diagnostic()?;
        let script_path = tmp.path().join(name);
        std::fs::write(&script_path, script).into_diagnostic()?;

        let mut cmd = if windows {
            let mut c = std::process::Command::new("powershell").no_window();
            c.args(["-NoProfile", "-ExecutionPolicy", "Bypass", "-File"]).arg(&script_path);
            c
        } else {
            let mut c = std::process::Command::new("sh").no_window();
            c.arg(&script_path);
            c
        };
        let previous_bin = std::env::current_exe().ok().and_then(|p| p.canonicalize().ok());
        let out = cmd
            .env("APHRODY_DOWNLOAD_URL", &base)
            .env("APHRODY_RELEASE", &id)
            .env("APHRODY_COMPONENTS", &self.components)
            .output()
            .into_diagnostic()
            .wrap_err("installer")?;
        let stdout = String::from_utf8_lossy(&out.stdout);
        print!("{stdout}");
        if !out.status.success() {
            eprint!("{}", String::from_utf8_lossy(&out.stderr));
            return Err(miette::miette!("installer failed; the active binary is unchanged"));
        }
        let new_bin = stdout.lines().find_map(|l| {
            let rest = l.strip_prefix("aphrody installed in ")?;
            let dir = rest.split(" (").next()?.trim();
            Some(Path::new(dir).join(if windows { "aphrody.exe" } else { "aphrody" }))
        });
        let Some(new_bin) = new_bin else {
            return Err(miette::miette!("installer did not report the aphrody directory"));
        };
        if !runs(&new_bin) {
            let restored = match previous_bin.as_deref().filter(|p| runs(p)) {
                Some(prev) => {
                    relink(prev)?;
                    true
                }
                None => false,
            };
            return Err(miette::miette!(
                "new binary {} does not start; {}",
                new_bin.display(),
                if restored { "rolled back" } else { "no previous binary to restore" }
            ));
        }
        let next = State {
            release: id.clone(),
            bin: Some(new_bin.clone()),
            previous_release: (!state.release.is_empty()).then(|| state.release.clone()),
            previous_bin: previous_bin.filter(|p| *p != new_bin),
        };
        write_state(&path, &next)?;
        prune(&new_bin, next.previous_bin.as_deref());
        println!("updated to {id}");
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::valid_release_id;

    #[test]
    fn release_ids() {
        assert!(valid_release_id("20261008T215500Z-99342e09b866"));
        assert!(!valid_release_id("../x"));
        assert!(!valid_release_id(""));
        assert!(!valid_release_id(".hidden"));
    }
}
