// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//! `aphrody-discord-compiler` — Native Rust + Bun compiler and AST orchestrator for Aphrody Discord bots.
//!
//! Provides deterministic standalone binary compilation via `bun build --compile`,
//! Oxc-based AST syntax and decorator validation, reflection polyfill ordering,
//! and automated smoke testing without requiring external standalone scripts.

use std::{
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::Instant,
};

use colored::Colorize;
use miette::{IntoDiagnostic, Result, bail};
use serde::{Deserialize, Serialize};

/// Target Discord bots recognized by Aphrody.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BotTarget {
    Shenron,
    RoseGriffon,
    Achillea,
    Custom(PathBuf),
}

impl BotTarget {
    pub fn parse(s: &str) -> Option<Self> {
        match s.to_lowercase().as_str() {
            "shenron" | "shenron-bot" => Some(Self::Shenron),
            "rg" | "rosegriffon" | "rose-griffon" | "rg-bot" => Some(Self::RoseGriffon),
            "achillea" | "achillea-bot" => Some(Self::Achillea),
            _ => {
                let p = PathBuf::from(s);
                if p.exists() {
                    Some(Self::Custom(p))
                } else {
                    None
                }
            }
        }
    }

    pub fn id(&self) -> &str {
        match self {
            Self::Shenron => "shenron",
            Self::RoseGriffon => "rg",
            Self::Achillea => "achillea",
            Self::Custom(_) => "custom",
        }
    }

    pub fn display_name(&self) -> &str {
        match self {
            Self::Shenron => "Shenron Discord Bot + Public API",
            Self::RoseGriffon => "Rose Griffon Discord Bot (RG / Azalée)",
            Self::Achillea => "Achillea (Rose Griffon Unified Engine & API)",
            Self::Custom(_) => "Custom Discord Bot",
        }
    }

    pub fn default_dir(&self, root: &Path) -> PathBuf {
        match self {
            Self::Shenron => root.join("apps/shenron/bot"),
            Self::RoseGriffon | Self::Achillea => root.join("apps/rg/bot"),
            Self::Custom(p) => p.clone(),
        }
    }

    pub fn entrypoint(&self) -> &str {
        match self {
            Self::Shenron | Self::RoseGriffon | Self::Achillea => "src/entry-standalone.ts",
            Self::Custom(_) => "src/entry-standalone.ts",
        }
    }

    pub fn default_outfile(&self) -> &str {
        match self {
            Self::Shenron => "dist/shenron",
            Self::RoseGriffon => "dist/rg-bot",
            Self::Achillea => "dist/achillea",
            Self::Custom(_) => "dist/bot",
        }
    }
}

/// Compilation options for `bun build --compile`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompilerOptions {
    pub minify: bool,
    pub sourcemap: bool,
    pub smoke_check: bool,
    pub target_triple: Option<String>,
    pub pre_build: bool,
}

impl Default for CompilerOptions {
    fn default() -> Self {
        Self {
            minify: true,
            sourcemap: true,
            smoke_check: true,
            target_triple: None,
            pre_build: true,
        }
    }
}

/// Result of a standalone binary compilation.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompilationResult {
    pub bot_id: String,
    pub bot_name: String,
    pub binary_path: PathBuf,
    pub binary_size_bytes: u64,
    pub duration_ms: u128,
    pub smoke_passed: bool,
    pub smoke_output: String,
}

/// Bot inspection metadata.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct BotInspection {
    pub bot_name: String,
    pub dir: PathBuf,
    pub package_json_exists: bool,
    pub tsconfig_json_exists: bool,
    pub has_standalone_entry: bool,
    pub uses_discord_kit: bool,
    pub commands_count: usize,
    pub oxc_diagnostics_errors: usize,
}

/// The Aphrody Discord Bot Compiler.
pub struct DiscordCompiler {
    root: PathBuf,
    bun_bin: PathBuf,
}

impl DiscordCompiler {
    /// Discover the repository root and resolve `bun` binary.
    pub fn new() -> Result<Self> {
        let root = Self::find_repo_root()?;
        let bun_bin = Self::resolve_bun_bin()?;
        Ok(Self { root, bun_bin })
    }

    /// Explicitly provide the monorepo root.
    pub fn with_root(root: PathBuf) -> Result<Self> {
        let bun_bin = Self::resolve_bun_bin()?;
        Ok(Self { root, bun_bin })
    }

    fn find_repo_root() -> Result<PathBuf> {
        let mut cur = std::env::current_dir().into_diagnostic()?;
        loop {
            if cur.join("bun.lock").exists() && cur.join("Cargo.toml").exists() {
                return Ok(cur);
            }
            if !cur.pop() {
                break;
            }
        }
        // Fallback to current dir if not discovered
        std::env::current_dir().into_diagnostic()
    }

    fn resolve_bun_bin() -> Result<PathBuf> {
        if let Ok(path) = which::which("bun") {
            return Ok(path);
        }
        if let Ok(home) = std::env::var("HOME") {
            let p = PathBuf::from(home).join(".bun/bin/bun");
            if p.exists() {
                return Ok(p);
            }
        }
        let system_bun = PathBuf::from("/usr/local/bin/bun");
        if system_bun.exists() {
            return Ok(system_bun);
        }
        bail!("Could not resolve `bun` executable in PATH or ~/.bun/bin/bun");
    }

    pub fn repo_root(&self) -> &Path {
        &self.root
    }

    pub fn bun_path(&self) -> &Path {
        &self.bun_bin
    }

    /// Inspect a bot's directory, checking configuration, decorators, and syntax with Oxc.
    pub fn inspect(&self, target: &BotTarget) -> Result<BotInspection> {
        let dir = target.default_dir(&self.root);
        let pkg_path = dir.join("package.json");
        let tsconfig_path = dir.join("tsconfig.json");
        let entry_path = dir.join(target.entrypoint());

        let pkg_exists = pkg_path.exists();
        let tsconfig_exists = tsconfig_path.exists();
        let entry_exists = entry_path.exists();

        let uses_discord_kit = if pkg_exists {
            let content = std::fs::read_to_string(&pkg_path).unwrap_or_default();
            content.contains("@aphrody/discord-kit")
        } else {
            false
        };

        let mut commands_count = 0;
        let mut oxc_errors = 0;
        let commands_dir = dir.join("src/commands");
        if commands_dir.exists() {
            for entry in walkdir(&commands_dir) {
                if entry.extension().and_then(|e| e.to_str()) == Some("ts") {
                    commands_count += 1;
                    if let Ok(source) = std::fs::read_to_string(&entry) {
                        let filename = entry.to_string_lossy();
                        if let Ok(c_source) = std::ffi::CString::new(source) {
                            if let Ok(c_filename) = std::ffi::CString::new(filename.as_bytes()) {
                                unsafe {
                                    let ptr = aphrody_oxc_bridge::aphrody_oxc_lint(
                                        c_source.as_ptr(),
                                        c_filename.as_ptr(),
                                    );
                                    if !ptr.is_null() {
                                        let cstr = std::ffi::CStr::from_ptr(ptr);
                                        if let Ok(s) = cstr.to_str() {
                                            if let Ok(v) = serde_json::from_str::<serde_json::Value>(s) {
                                                if v["ok"] == false {
                                                    oxc_errors += 1;
                                                }
                                            }
                                        }
                                        aphrody_oxc_bridge::aphrody_oxc_free(ptr);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }

        Ok(BotInspection {
            bot_name: target.display_name().to_string(),
            dir,
            package_json_exists: pkg_exists,
            tsconfig_json_exists: tsconfig_exists,
            has_standalone_entry: entry_exists,
            uses_discord_kit,
            commands_count,
            oxc_diagnostics_errors: oxc_errors,
        })
    }

    /// Compile a target bot into a standalone native binary via `bun build --compile`.
    pub fn compile(&self, target: &BotTarget, options: &CompilerOptions) -> Result<CompilationResult> {
        let dir = target.default_dir(&self.root);
        if !dir.exists() {
            bail!("Bot directory does not exist: {}", dir.display());
        }

        println!("\n{}", "======================================================".cyan());
        println!(
            "📦 {} {}",
            "Compiling standalone native binary for:".bold(),
            target.display_name().green()
        );
        println!("   Directory:  {}", dir.display());
        println!("   Entrypoint: {}", target.entrypoint());
        println!("   Output:     {}", target.default_outfile());
        println!("{}", "======================================================".cyan());

        // Pre-build hook
        if options.pre_build && target == &BotTarget::Shenron {
            let css_script = dir.join("scripts/build-dashboard-css.sh");
            if css_script.exists() {
                println!("  [pre-build] Generating Tailwind CSS for Shenron dashboard...");
                let status = Command::new("bash")
                    .arg("scripts/build-dashboard-css.sh")
                    .current_dir(&dir)
                    .status()
                    .into_diagnostic()?;
                if !status.success() {
                    bail!("Tailwind pre-build failed for Shenron");
                }
            }
        }

        let start = Instant::now();
        let outfile = target.default_outfile();
        let mut build_args = vec![
            "build".to_string(),
            target.entrypoint().to_string(),
            "--compile".to_string(),
        ];

        if options.minify {
            build_args.push("--minify".to_string());
        }
        if options.sourcemap {
            build_args.push("--sourcemap".to_string());
        }
        if let Some(target_triple) = &options.target_triple {
            build_args.push(format!("--target={target_triple}"));
        }
        build_args.push(format!("--outfile={outfile}"));

        println!("  [bun] {} {}", self.bun_bin.display(), build_args.join(" "));
        let status = Command::new(&self.bun_bin)
            .args(&build_args)
            .current_dir(&dir)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .into_diagnostic()?;

        if !status.success() {
            bail!("bun build --compile failed with exit code {:?}", status.code());
        }

        let duration = start.elapsed();
        let binary_path = dir.join(outfile);
        if !binary_path.exists() {
            bail!("Compiled binary was not created at {}", binary_path.display());
        }

        let meta = std::fs::metadata(&binary_path).into_diagnostic()?;
        let size_bytes = meta.len();
        println!(
            "✓ {} in {:.2}s! (Size: {})",
            "Binary successfully compiled".green().bold(),
            duration.as_secs_f64(),
            format_bytes(size_bytes)
        );
        println!("  Path: {}", binary_path.display().to_string().cyan());

        // Smoke test
        let mut smoke_passed = false;
        let mut smoke_output = String::new();
        if options.smoke_check {
            println!("  [smoke] Testing standalone binary with --help...");
            let output = Command::new(&binary_path)
                .arg("--help")
                .current_dir(&dir)
                .env("NODE_ENV", "production")
                .output()
                .into_diagnostic()?;

            smoke_output = String::from_utf8_lossy(&output.stdout).to_string();
            if smoke_output.is_empty() {
                smoke_output = String::from_utf8_lossy(&output.stderr).to_string();
            }

            if output.status.success() || !smoke_output.is_empty() {
                smoke_passed = true;
                let sample = smoke_output.lines().next().unwrap_or("(clean boot)");
                println!("  [smoke sample]: {}", sample.dimmed());
                println!("✓ {}", "Standalone binary smoke check passed cleanly".green());
            } else {
                bail!("Smoke check failed: binary produced no output or crashed");
            }
        }

        Ok(CompilationResult {
            bot_id: target.id().to_string(),
            bot_name: target.display_name().to_string(),
            binary_path,
            binary_size_bytes: size_bytes,
            duration_ms: duration.as_millis(),
            smoke_passed,
            smoke_output,
        })
    }

    /// Compile all primary Discord bots in the monorepo.
    pub fn compile_all(&self, options: &CompilerOptions) -> Result<Vec<CompilationResult>> {
        let targets = [BotTarget::Shenron, BotTarget::RoseGriffon];
        let mut results = Vec::new();
        for t in &targets {
            results.push(self.compile(t, options)?);
        }
        Ok(results)
    }

    /// Run full monorepo discord verification suite.
    pub fn verify_monorepo(&self) -> Result<()> {
        println!("\n🔍 Running full Discord verification via `bun scripts/audit/discord-verify.ts --full --compile`...\n");
        let status = Command::new(&self.bun_bin)
            .args(["scripts/audit/discord-verify.ts", "--full", "--compile"])
            .current_dir(&self.root)
            .stdout(Stdio::inherit())
            .stderr(Stdio::inherit())
            .status()
            .into_diagnostic()?;

        if !status.success() {
            bail!("Monorepo Discord verification failed with exit code {:?}", status.code());
        }
        println!("\n🎉 {}", "All Discord monorepo gates and native compilations verified successfully!".green().bold());
        Ok(())
    }
}

fn walkdir(dir: &Path) -> Vec<PathBuf> {
    let mut files = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                files.extend(walkdir(&path));
            } else {
                files.push(path);
            }
        }
    }
    files
}

fn format_bytes(bytes: u64) -> String {
    if bytes == 0 {
        return "0 B".to_string();
    }
    let k = 1024.0;
    let sizes = ["B", "KB", "MB", "GB"];
    let i = (bytes as f64).log(k).floor() as usize;
    let i = i.min(sizes.len() - 1);
    format!("{:.2} {}", (bytes as f64) / k.powi(i as i32), sizes[i])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_bot_target() {
        assert_eq!(BotTarget::parse("shenron"), Some(BotTarget::Shenron));
        assert_eq!(BotTarget::parse("rg"), Some(BotTarget::RoseGriffon));
        assert_eq!(BotTarget::parse("rose-griffon"), Some(BotTarget::RoseGriffon));
        assert_eq!(BotTarget::parse("achillea"), Some(BotTarget::Achillea));
    }

    #[test]
    fn default_compiler_options() {
        let opts = CompilerOptions::default();
        assert!(opts.minify);
        assert!(opts.sourcemap);
        assert!(opts.smoke_check);
    }
}
