// SPDX-License-Identifier: Apache-2.0
// `aphrody self install` — the single install path: canonical layout, PATH, links, manifest, boot.
//
// Layout (docs/operations/infra/INSTALL.md):
//   Windows  %LOCALAPPDATA%\aphrody\{bin,lib,share}
//   Linux    ~/.local/share/aphrody/{bin,lib,share} (root: /opt/aphrody), links in ~/.local/bin
// `share/manifest.json` is the versioned install manifest (every installed file with its SHA-256).

use std::{
    fs,
    path::{Path, PathBuf},
    process::Command,
};

use async_trait::async_trait;
use miette::{IntoDiagnostic, WrapErr};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

use crate::context::{GoogleContext, TerminalCommand};

pub(crate) const DEFAULT_BASE: &str = "https://downloads.aphrody.com";

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub(crate) enum InstallTarget {
    Native,
    Wasm,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, clap::ValueEnum)]
pub(crate) enum InstallHost {
    Local,
    Vps,
    Dbfr,
}

pub(crate) struct InstallCommand {
    pub bin: Option<PathBuf>,
    pub root: Option<PathBuf>,
    pub target: InstallTarget,
    pub host: InstallHost,
    pub url: Option<String>,
    pub no_boot: bool,
    pub keep_legacy: bool,
    pub dry_run: bool,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
pub(crate) struct ManifestFile {
    pub path: String,
    pub sha256: String,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub(crate) struct InstallManifest {
    pub schema_version: u32,
    pub version: String,
    pub target: String,
    pub commit: Option<String>,
    pub installed_at: String,
    pub root: String,
    /// Multi-call link names (not listed in `files`: they are links of `bin/aphrody`).
    pub aliases: Vec<String>,
    pub files: Vec<ManifestFile>,
}

#[async_trait]
impl TerminalCommand for InstallCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        match (self.host, self.target) {
            (InstallHost::Local, InstallTarget::Native) => self.install_native(),
            (InstallHost::Local, InstallTarget::Wasm) => self.install_wasm().await,
            (host, _) => self.install_remote(host),
        }
    }
}

/// Canonical install root of the current user.
pub(crate) fn canonical_root() -> miette::Result<PathBuf> {
    if cfg!(windows) {
        let base = dirs::data_local_dir()
            .ok_or_else(|| miette::miette!("%LOCALAPPDATA% is not available"))?;
        return Ok(base.join("aphrody"));
    }
    if is_root() {
        return Ok(PathBuf::from("/opt/aphrody"));
    }
    let base = dirs::data_dir().ok_or_else(|| miette::miette!("HOME is not set"))?;
    Ok(base.join("aphrody"))
}

#[cfg(unix)]
fn is_root() -> bool {
    std::env::var("USER").is_ok_and(|u| u == "root")
        || std::env::var("EUID").is_ok_and(|u| u == "0")
}
#[cfg(not(unix))]
fn is_root() -> bool {
    false
}

fn exe_name() -> String {
    format!("aphrody{}", std::env::consts::EXE_SUFFIX)
}

fn sha256_file(path: &Path) -> miette::Result<(String, u64)> {
    let data = fs::read(path)
        .into_diagnostic()
        .wrap_err_with(|| format!("read {}", path.display()))?;
    Ok((hex_lower(&Sha256::digest(&data)), data.len() as u64))
}

fn hex_lower(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

fn same_path(a: &Path, b: &Path) -> bool {
    match (fs::canonicalize(a), fs::canonicalize(b)) {
        (Ok(a), Ok(b)) => a == b,
        _ => a == b,
    }
}

fn is_binary(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|n| n.to_str()) else {
        return false;
    };
    if !path.is_file() {
        return false;
    }
    if cfg!(windows) {
        name.ends_with(".exe")
    } else {
        !name.contains('.')
    }
}

/// Copy `src` to `dest` through a temporary name so an interrupted copy never leaves a half
/// binary. A running executable that cannot be removed (Windows) is moved aside first.
fn copy_atomic(src: &Path, dest: &Path) -> miette::Result<()> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent).into_diagnostic()?;
    }
    let tmp = dest.with_extension("new");
    fs::copy(src, &tmp)
        .into_diagnostic()
        .wrap_err_with(|| format!("copy {}", src.display()))?;
    if dest.symlink_metadata().is_ok() && fs::remove_file(dest).is_err() {
        let old = dest.with_extension("old");
        let _ = fs::remove_file(&old);
        fs::rename(dest, &old)
            .into_diagnostic()
            .wrap_err("replace running binary")?;
    }
    fs::rename(&tmp, dest).into_diagnostic()
}

/// Regular binaries (not links) of the source directory.
fn collect_sources(src_dir: &Path) -> Vec<PathBuf> {
    let mut found: Vec<PathBuf> = fs::read_dir(src_dir)
        .into_iter()
        .flatten()
        .flatten()
        .map(|e| e.path())
        .filter(|p| {
            is_binary(p)
                && !p
                    .symlink_metadata()
                    .is_ok_and(|m| m.file_type().is_symlink())
        })
        .collect();
    found.sort();
    found
}

fn copy_tree(src: &Path, dest: &Path) -> miette::Result<()> {
    for entry in fs::read_dir(src).into_diagnostic()?.flatten() {
        let (from, to) = (entry.path(), dest.join(entry.file_name()));
        if from.is_dir() {
            copy_tree(&from, &to)?;
        } else {
            copy_atomic(&from, &to)?;
        }
    }
    Ok(())
}

fn walk_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).into_iter().flatten().flatten() {
        let path = entry.path();
        if path
            .symlink_metadata()
            .is_ok_and(|m| m.file_type().is_symlink())
        {
            continue;
        }
        if path.is_dir() {
            walk_files(&path, out);
        } else {
            out.push(path);
        }
    }
}

/// Manifest of the files under `bin/`, `lib/` and `share/wasm` of `root`.
pub(crate) fn build_manifest(
    root: &Path,
    commit: Option<String>,
) -> miette::Result<InstallManifest> {
    let aliases: Vec<String> = crate::multicall::aliases().map(str::to_string).collect();
    let mut files = Vec::new();
    for sub in ["bin", "lib", "share/wasm"] {
        let mut paths = Vec::new();
        walk_files(&root.join(sub), &mut paths);
        paths.sort();
        for path in paths {
            let name = path
                .file_name()
                .and_then(|n| n.to_str())
                .unwrap_or_default();
            let stem = name
                .strip_suffix(std::env::consts::EXE_SUFFIX)
                .unwrap_or(name);
            if name.ends_with(".new") || name.ends_with(".old") || aliases.iter().any(|a| a == stem)
            {
                continue;
            }
            let rel = path
                .strip_prefix(root)
                .unwrap_or(&path)
                .to_string_lossy()
                .replace('\\', "/");
            let (sha256, size) = sha256_file(&path)?;
            files.push(ManifestFile {
                path: rel,
                sha256,
                size,
            });
        }
    }
    Ok(InstallManifest {
        schema_version: 1,
        version: env!("CARGO_PKG_VERSION").to_string(),
        target: format!("{}-{}", std::env::consts::ARCH, std::env::consts::OS),
        commit,
        installed_at: chrono::Utc::now().to_rfc3339(),
        root: root.to_string_lossy().replace('\\', "/"),
        aliases,
        files,
    })
}

fn write_manifest(root: &Path, manifest: &InstallManifest) -> miette::Result<PathBuf> {
    let dir = root.join("share");
    fs::create_dir_all(&dir).into_diagnostic()?;
    let path = dir.join("manifest.json");
    let tmp = dir.join("manifest.json.new");
    let body = serde_json::to_string_pretty(manifest).into_diagnostic()?;
    fs::write(&tmp, format!("{body}\n")).into_diagnostic()?;
    fs::rename(&tmp, &path).into_diagnostic()?;
    Ok(path)
}

#[cfg_attr(windows, allow(dead_code))]
const PROFILE_BEGIN: &str = "# >>> aphrody >>>";
#[cfg_attr(windows, allow(dead_code))]
const PROFILE_END: &str = "# <<< aphrody <<<";

/// Idempotent PATH block for POSIX shells; `None` when it is already there.
#[cfg_attr(windows, allow(dead_code))]
pub(crate) fn profile_with_path(current: &str) -> Option<String> {
    if current.contains(PROFILE_BEGIN) {
        return None;
    }
    let mut out = current.to_string();
    if !out.is_empty() && !out.ends_with('\n') {
        out.push('\n');
    }
    out.push_str(&format!(
        "{PROFILE_BEGIN}\ncase \":$PATH:\" in *\":$HOME/.local/bin:\"*) ;; *) export \
         PATH=\"$HOME/.local/bin:$PATH\" ;; esac\n{PROFILE_END}\n"
    ));
    Some(out)
}

#[cfg(not(windows))]
fn ensure_shell_profile(dry_run: bool) -> miette::Result<()> {
    let home = dirs::home_dir().ok_or_else(|| miette::miette!("HOME is not set"))?;
    for name in [".profile", ".bashrc", ".zshenv"] {
        let path = home.join(name);
        // .profile always; the others only when the user already has them.
        if name != ".profile" && !path.exists() {
            continue;
        }
        let current = fs::read_to_string(&path).unwrap_or_default();
        let Some(next) = profile_with_path(&current) else {
            continue;
        };
        if dry_run {
            println!(
                "[dry-run] would add ~/.local/bin to PATH in {}",
                path.display()
            );
        } else {
            fs::write(&path, next).into_diagnostic()?;
            println!("PATH block written to {}", path.display());
        }
    }
    Ok(())
}
#[cfg(windows)]
fn ensure_shell_profile(_dry_run: bool) -> miette::Result<()> {
    Ok(())
}

/// Former installation directories: the versioned script layout and the alias backups.
fn legacy_dirs(root: &Path) -> Vec<PathBuf> {
    let mut out = vec![root.join("lib/aphrody/replaced")];
    if let Some(home) = dirs::home_dir() {
        out.push(home.join(".local/lib/aphrody"));
    }
    out
}

fn clean_legacy(root: &Path, running: &Path, dry_run: bool) {
    for dir in legacy_dirs(root) {
        if !dir.exists() || running.starts_with(&dir) || root.starts_with(&dir) {
            continue;
        }
        if dry_run {
            println!(
                "[dry-run] would remove former installation {}",
                dir.display()
            );
        } else if fs::remove_dir_all(&dir).is_ok() {
            println!("removed former installation {}", dir.display());
        } else {
            println!("could not remove {} (in use?)", dir.display());
        }
    }
}

fn boot_available(bin: &Path) -> bool {
    Command::new(bin)
        .args(["infra", "boot", "--help"])
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .is_ok_and(|s| s.success())
}

impl InstallCommand {
    fn root(&self) -> miette::Result<PathBuf> {
        match &self.root {
            Some(r) => Ok(r.clone()),
            None => canonical_root(),
        }
    }

    fn install_native(&self) -> miette::Result<()> {
        let src = match &self.bin {
            Some(b) => b.clone(),
            None => std::env::current_exe().into_diagnostic()?,
        };
        let src = fs::canonicalize(&src).unwrap_or(src);
        if !src.is_file() {
            return Err(miette::miette!("binary not found: {}", src.display()));
        }
        let root = self.root()?;
        let bin_dir = root.join("bin");
        let dest = bin_dir.join(exe_name());
        let src_dir = src.parent().map(Path::to_path_buf).unwrap_or_default();
        println!("aphrody self install -> {}", root.display());

        if self.dry_run {
            println!(
                "[dry-run] would copy {} and sibling binaries to {}",
                src.display(),
                bin_dir.display()
            );
        } else {
            if !same_path(&src_dir, &bin_dir) {
                for file in collect_sources(&src_dir) {
                    copy_atomic(&file, &bin_dir.join(file.file_name().unwrap_or_default()))?;
                }
                // The main binary keeps its canonical name even when `--bin` renames it.
                if !dest.exists() {
                    copy_atomic(&src, &dest)?;
                }
                for sub in ["lib", "share"] {
                    let from = src_dir.join(sub);
                    if from.is_dir() && !same_path(&from, &root.join(sub)) {
                        copy_tree(&from, &root.join(sub))?;
                    }
                }
                let release = src_dir.join("release.json");
                if release.is_file() {
                    copy_atomic(&release, &bin_dir.join("release.json"))?;
                }
            }
            let out = Command::new(&dest)
                .arg("--version")
                .output()
                .into_diagnostic()?;
            if !out.status.success() {
                return Err(miette::miette!("installed {} does not run", dest.display()));
            }
        }

        crate::self_cmd::InstallPathCommand {
            bin: Some(dest.clone()),
            build_if_missing: false,
            dry_run: self.dry_run,
        }
        .run()?;
        ensure_shell_profile(self.dry_run)?;

        if !self.keep_legacy {
            clean_legacy(&root, &src, self.dry_run);
        }

        if !self.dry_run {
            let commit = fs::read_to_string(bin_dir.join("release.json"))
                .ok()
                .and_then(|s| serde_json::from_str::<serde_json::Value>(&s).ok())
                .and_then(|v| v["commit"].as_str().map(str::to_string));
            let path = write_manifest(&root, &build_manifest(&root, commit)?)?;
            println!("manifest {}", path.display());
        }

        if self.no_boot {
            println!("boot: skipped (--no-boot)");
        } else if self.dry_run {
            println!("[dry-run] would run: aphrody infra boot apply --host local (when available)");
        } else if boot_available(&dest) {
            let status = Command::new(&dest)
                .args(["infra", "boot", "apply", "--host", "local"])
                .status()
                .into_diagnostic()?;
            if !status.success() {
                return Err(miette::miette!("infra boot apply failed ({status})"));
            }
        } else {
            println!("boot: `aphrody infra boot` not available in this build, skipped");
        }
        if which::which("bun").is_err() {
            println!("bun: not found; Bun fork release and setup: https://aphrody.com/bun/setup");
        }
        Ok(())
    }

    fn base(&self) -> String {
        self.url
            .clone()
            .or_else(|| std::env::var("APHRODY_DOWNLOAD_URL").ok())
            .unwrap_or_else(|| DEFAULT_BASE.to_string())
            .trim_end_matches('/')
            .to_string()
    }

    async fn install_wasm(&self) -> miette::Result<()> {
        let root = self.root()?;
        let dest = root.join("share/wasm");
        let base = self.base();
        println!("aphrody self install --target wasm -> {}", dest.display());
        if self.dry_run {
            println!(
                "[dry-run] would fetch {base}/latest.json, download the wasm artifact, verify \
                 SHA-256, extract"
            );
            return Ok(());
        }
        let client = reqwest::Client::new();
        let latest: serde_json::Value = client
            .get(format!("{base}/latest.json"))
            .send()
            .await
            .into_diagnostic()?
            .error_for_status()
            .into_diagnostic()?
            .json()
            .await
            .into_diagnostic()?;
        let art = latest["artifacts"]
            .as_array()
            .and_then(|a| a.iter().find(|x| x["kind"] == "wasm"))
            .ok_or_else(|| miette::miette!("no wasm artifact in {base}/latest.json"))?;
        let url = art["url"]
            .as_str()
            .ok_or_else(|| miette::miette!("wasm artifact has no url"))?;
        let want = art["sha256"].as_str().unwrap_or_default().to_lowercase();
        let bytes = client
            .get(url)
            .send()
            .await
            .into_diagnostic()?
            .error_for_status()
            .into_diagnostic()?
            .bytes()
            .await
            .into_diagnostic()?;
        let got = hex_lower(&Sha256::digest(&bytes));
        if got != want {
            return Err(miette::miette!(
                "checksum mismatch for {url} (expected {want}, got {got})"
            ));
        }
        let staging = root.join("share/wasm.new");
        let _ = fs::remove_dir_all(&staging);
        fs::create_dir_all(&staging).into_diagnostic()?;
        let archive = staging.join("artifact.tar.gz");
        fs::write(&archive, &bytes).into_diagnostic()?;
        let status = Command::new("tar")
            .arg("-xzf")
            .arg(&archive)
            .arg("-C")
            .arg(&staging)
            .status()
            .into_diagnostic()?;
        if !status.success() {
            return Err(miette::miette!("tar extraction failed"));
        }
        fs::remove_file(&archive).into_diagnostic()?;
        let _ = fs::remove_dir_all(&dest);
        fs::rename(&staging, &dest).into_diagnostic()?;
        println!(
            "wasm artifact installed in {} (package: @aphrody/cli-wasm)",
            dest.display()
        );
        if root.join("bin").join(exe_name()).exists() {
            let path = write_manifest(&root, &build_manifest(&root, None)?)?;
            println!("manifest {}", path.display());
        }
        Ok(())
    }

    /// Remote host: the one-line installer, run through `aphrody infra ssh exec`.
    fn install_remote(&self, host: InstallHost) -> miette::Result<()> {
        let name = if host == InstallHost::Vps {
            "vps"
        } else {
            "dbfr"
        };
        let cmd = format!("curl -fsSL {}/install.sh | sh", self.base());
        if self.dry_run {
            println!("[dry-run] would run on {name}: {cmd}");
            return Ok(());
        }
        let exe = std::env::current_exe().into_diagnostic()?;
        let status = Command::new(exe)
            .args(["infra", "ssh", "exec", "--host", name, "--cmd", &cmd])
            .env("APHRODY_SSH_COMMAND_TIMEOUT_SECS", "900")
            .status()
            .into_diagnostic()?;
        if !status.success() {
            return Err(miette::miette!(
                "remote install on {name} failed ({status})"
            ));
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn profile_block_is_idempotent() {
        let first = profile_with_path("export A=1").unwrap();
        assert!(first.contains(".local/bin"));
        assert!(profile_with_path(&first).is_none());
    }

    #[test]
    fn manifest_lists_files_with_checksums() {
        let dir = tempfile::tempdir().unwrap();
        fs::create_dir_all(dir.path().join("bin")).unwrap();
        fs::write(dir.path().join("bin/aphrody"), b"abc").unwrap();
        fs::write(dir.path().join("bin/aphrody.new"), b"skip").unwrap();
        let m = build_manifest(dir.path(), Some("c0ffee".into())).unwrap();
        assert_eq!(m.files.len(), 1);
        assert_eq!(m.files[0].path, "bin/aphrody");
        assert_eq!(
            m.files[0].sha256,
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
        let path = write_manifest(dir.path(), &m).unwrap();
        let back: InstallManifest =
            serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
        assert_eq!(back, m);
    }

    #[test]
    fn canonical_root_ends_with_aphrody() {
        assert!(canonical_root().unwrap().ends_with("aphrody"));
    }

    #[test]
    fn dry_run_touches_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("root");
        let cmd = InstallCommand {
            bin: Some(std::env::current_exe().unwrap()),
            root: Some(root.clone()),
            target: InstallTarget::Native,
            host: InstallHost::Local,
            url: None,
            no_boot: true,
            keep_legacy: true,
            dry_run: true,
        };
        cmd.install_native().unwrap();
        assert!(!root.exists());
    }
}
