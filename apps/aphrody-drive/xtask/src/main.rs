//! Build automation tasks for Spacedrive
//!
//! This crate provides build tasks using the xtask pattern - a Rust-native
//! approach to build automation. No bash scripts, no JavaScript, no external tools.
//!
//! ## Usage
//!
//! ```bash
//! cargo xtask setup        # Setup dev environment (replaces pnpm prep)
//! cargo xtask test-core    # Run core integration checks
//! ```
//!
//! ## About xtask
//!
//! The xtask pattern is the idiomatic Rust way to handle build automation.
//! It's just a regular Rust binary in your workspace that you invoke via
//! `cargo xtask <command>`. This approach is used by major projects like
//! rust-analyzer, tokio, and many others.
//!
//! Benefits:
//! - Pure Rust - no shell scripts or JavaScript to maintain
//! - Type-safe and easy to debug
//! - Cross-platform by default
//! - No external tools required (except cargo/rustup)

mod bump;
mod config;
mod contributors;
mod native_deps;
mod system;
mod test_core;

use anyhow::{Context, Result};
use std::fs;
use std::process::Command;

/// Find the workspace root by walking up the directory tree
fn find_workspace_root() -> Result<std::path::PathBuf> {
	let mut current = std::env::current_dir()?;

	loop {
		let cargo_toml = current.join("Cargo.toml");
		if cargo_toml.exists() {
			let contents = std::fs::read_to_string(&cargo_toml)?;
			if contents.contains("[workspace]") {
				return Ok(current);
			}
		}

		if !current.pop() {
			anyhow::bail!(
				"Could not find workspace root. Please run from within the Spacedrive workspace."
			);
		}
	}
}

fn main() -> Result<()> {
	let args: Vec<String> = std::env::args().collect();

	if args.len() < 2 {
		eprintln!("Usage: cargo xtask <command>");
		eprintln!();
		eprintln!("Commands:");
		eprintln!(
			"  setup        Setup development environment (downloads deps, generates config)"
		);
		eprintln!("  test-core    Run all core integration tests with progress tracking");
		eprintln!("  bump <ver>   Bump version across all packages (e.g. bump 2.0.0-alpha.2)");
		eprintln!(
			"  update-contributors  Fetch contributors from GitHub and update contributors.json"
		);
		eprintln!();
		eprintln!("Examples:");
		eprintln!("  cargo xtask setup          # First time setup");
		eprintln!("  cargo xtask test-core      # Run all core tests");
		std::process::exit(1);
	}

	match args[1].as_str() {
		"setup" => setup()?,
		"test-core" => {
			let verbose = args
				.get(2)
				.map(|s| s == "--verbose" || s == "-v")
				.unwrap_or(false);
			test_core_command(verbose)?;
		}
		"bump" => {
			let version = args.get(2).cloned().unwrap_or_else(|| {
				eprintln!("Usage: cargo xtask bump <version>");
				eprintln!("Example: cargo xtask bump 2.0.0-alpha.2");
				std::process::exit(1);
			});
			let root = find_workspace_root()?;
			bump::bump(&root, &version)?;
		}
		"update-contributors" => {
			let project_root = find_workspace_root()?;
			contributors::update(&project_root)?;
		}
		_ => {
			eprintln!("Unknown command: {}", args[1]);
			eprintln!("Run 'cargo xtask' for usage information.");
			std::process::exit(1);
		}
	}

	Ok(())
}

/// Setup development environment
///
/// This replaces the old `pnpm prep` workflow with a pure Rust implementation.
/// It downloads native dependencies and generates the cargo config.
fn setup() -> Result<()> {
	println!("Setting up Spacedrive development environment...");
	println!();

	let project_root = find_workspace_root()?;

	// Detect system - use TARGET_TRIPLE env var if set for cross-compilation
	let system = match std::env::var("TARGET_TRIPLE") {
		Ok(target_triple) if !target_triple.is_empty() => {
			println!("Using TARGET_TRIPLE from environment: {}", target_triple);
			system::SystemInfo::from_target_triple(&target_triple)?
		}
		_ => system::SystemInfo::detect()?,
	};
	println!("Detected platform: {:?} {:?}", system.os, system.arch);

	// Check for required tools
	println!("Checking for required tools...");
	if !system::has_linker("cargo") {
		anyhow::bail!("cargo not found. Please install Rust from https://rustup.rs");
	}
	if !system::has_linker("rustc") {
		anyhow::bail!("rustc not found. Please install Rust from https://rustup.rs");
	}
	println!("   ✓ Rust toolchain found");

	// Setup native dependencies directory
	let native_deps_dir = project_root.join("apps").join(".deps");
	println!();
	println!("Setting up native dependencies...");

	// Clean and create deps directory
	if native_deps_dir.exists() {
		fs::remove_dir_all(&native_deps_dir).context("Failed to clean native deps directory")?;
	}
	fs::create_dir_all(&native_deps_dir).context("Failed to create native deps directory")?;

	// Download desktop native dependencies
	let filename = system.native_deps_filename();
	native_deps::download_native_deps(&filename, &native_deps_dir)?;

	// Create symlinks for shared libraries
	#[cfg(target_os = "macos")]
	{
		println!();
		println!("Creating symlinks for shared libraries...");
		native_deps::symlink_libs_macos(&project_root, &native_deps_dir)?;
	}

	#[cfg(target_os = "linux")]
	{
		println!();
		println!("Creating symlinks for shared libraries...");
		native_deps::symlink_libs_linux(&project_root, &native_deps_dir)?;
		println!("   ✓ Symlinks created");
	}

	// Generate cargo config before building daemon so FFMPEG_DIR and other env vars are set
	println!();
	config::generate_cargo_config(&project_root, Some(&native_deps_dir))?;

	// Build release daemon for Tauri bundler validation
	// The Tauri config references the release daemon in externalBin, so we need to build it
	// once even for dev mode to satisfy Tauri's path validation
	println!();
	println!("Building release daemon for Tauri (with ffmpeg,heif features)...");

	let target_triple = system.target_triple();
	let args = vec![
		"build",
		"--release",
		"--features",
		"sd-core/ffmpeg,sd-core/heif",
		"--bin",
		"sd-daemon",
		"--target",
		&target_triple,
	];

	let status = Command::new("cargo")
		.args(&args)
		.current_dir(&project_root)
		.status()
		.context("Failed to build release daemon")?;

	if !status.success() {
		anyhow::bail!("Failed to build release daemon");
	}
	println!("   ✓ Release daemon built");

	// Create target-suffixed daemon binary for Tauri bundler
	// Tauri's externalBin appends the target triple to binary names
	let exe_ext = if cfg!(windows) { ".exe" } else { "" };
	let daemon_source = project_root.join(format!(
		"target/{}/release/sd-daemon{}",
		target_triple, exe_ext
	));
	let daemon_target = project_root.join(format!(
		"target/release/sd-daemon-{}{}",
		target_triple, exe_ext
	));

	if daemon_source.exists() {
		fs::copy(&daemon_source, &daemon_target)
			.context("Failed to create target-suffixed daemon binary")?;
		println!("   ✓ Created sd-daemon-{}{}", target_triple, exe_ext);
	}

	// On Windows, copy DLLs to target directories so executables can find them at runtime
	#[cfg(windows)]
	{
		println!();
		println!("Copying DLLs to target directories...");
		let dll_source_dir = native_deps_dir.join("bin");
		if dll_source_dir.exists() {
			let mut target_dirs = vec![
				("debug".to_string(), project_root.join("target/debug")),
				("release".to_string(), project_root.join("target/release")),
			];

			// Also copy to target-triple directories used by CI cross-compilation
			for triple in ["x86_64-pc-windows-msvc", "aarch64-pc-windows-msvc"] {
				for profile in ["debug", "release"] {
					let dir = project_root.join("target").join(triple).join(profile);
					target_dirs.push((format!("{}/{}", triple, profile), dir));
				}
			}

			for (label, target_dir) in &target_dirs {
				fs::create_dir_all(target_dir).ok();

				if let Ok(entries) = fs::read_dir(&dll_source_dir) {
					for entry in entries.flatten() {
						let path = entry.path();
						if path.extension().map_or(false, |ext| ext == "dll") {
							let dest = target_dir.join(path.file_name().unwrap());
							if let Err(e) = fs::copy(&path, &dest) {
								eprintln!(
									"   Warning: Failed to copy {}: {}",
									path.file_name().unwrap().to_string_lossy(),
									e
								);
							}
						}
					}
				}
				println!("   ✓ DLLs copied to target/{}/", label);
			}
		}
	}

	println!();
	println!("Setup complete!");
	println!();
	println!("Next steps:");
	println!("   • cargo build              			- Build the CLI with daemon");
	println!();
	println!("Then launch an app:");
	println!("   • bun run tauri dev (repository root)   - Launch aphrody-app with the Drive pane");
	println!();

	Ok(())
}

/// Run all core integration tests with progress tracking
///
/// This command runs all sd-core integration tests defined in test_core.rs.
/// Tests are run sequentially with --test-threads=1 to avoid conflicts.
/// Use --verbose to see full test output.
fn test_core_command(verbose: bool) -> Result<()> {
	let results = test_core::run_tests(verbose)?;

	let failed_count = results.iter().filter(|r| !r.passed).count();

	if failed_count > 0 {
		std::process::exit(1);
	} else {
		if verbose {
			println!("All tests passed!");
		}
	}

	Ok(())
}
