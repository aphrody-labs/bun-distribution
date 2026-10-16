//! Cargo config generation from template

use anyhow::{Context, Result};
use serde::Serialize;
use std::fs;
use std::path::Path;

use crate::system::{get_best_linker, Os, SystemInfo};

#[derive(Serialize)]
struct ConfigContext {
	#[serde(rename = "nativeDeps")]
	native_deps: Option<String>,
	protoc: Option<String>,
	#[serde(rename = "isWin")]
	is_win: bool,
	#[serde(rename = "isMacOS")]
	is_macos: bool,
	#[serde(rename = "isLinux")]
	is_linux: bool,
	#[serde(rename = "hasLLD")]
	has_lld: Option<LinkerInfo>,
	#[serde(rename = "sdkPath")]
	sdk_path: String,
}

#[derive(Serialize)]
struct LinkerInfo {
	linker: String,
}

/// Generate .cargo/config.toml from the mustache template
pub fn generate_cargo_config(
	root: &Path,
	native_deps_dir: Option<&Path>,
) -> Result<()> {
	println!("️  Generating .cargo/config.toml...");

	let system = SystemInfo::detect()?;

	// Get linker info
	let has_lld = get_best_linker().map(|linker| LinkerInfo { linker });

	// Convert paths to strings and handle Windows backslashes
	let native_deps =
		native_deps_dir.map(|p| p.to_string_lossy().replace('\\', "\\\\").to_string());

	let protoc = native_deps_dir.map(|p| {
		let protoc_name = if cfg!(target_os = "windows") {
			"protoc.exe"
		} else {
			"protoc"
		};
		p.join("bin")
			.join(protoc_name)
			.to_string_lossy()
			.replace('\\', "\\\\")
			.to_string()
	});


	// Get macOS SDK path so bindgen can find system headers (errno.h, etc.)
	let sdk_path = if matches!(system.os, Os::MacOS) {
		std::process::Command::new("xcrun")
			.args(["--show-sdk-path"])
			.output()
			.ok()
			.filter(|o| o.status.success())
			.and_then(|o| String::from_utf8(o.stdout).ok())
			.map(|p| p.trim().to_string())
			.unwrap_or_default()
	} else {
		String::new()
	};

	// Build context for mustache
	let context = ConfigContext {
		native_deps,
		protoc,
		is_win: matches!(system.os, Os::Windows),
		is_macos: matches!(system.os, Os::MacOS),
		is_linux: matches!(system.os, Os::Linux),
		has_lld,
		sdk_path,
	};

	// Read template
	let template_path = root.join(".cargo").join("config.toml.mustache");
	let template =
		fs::read_to_string(&template_path).context("Failed to read config.toml.mustache")?;

	// Render template
	let rendered = mustache::compile_str(&template)
		.context("Failed to compile mustache template")?
		.render_to_string(&context)
		.context("Failed to render template")?;

	// Clean up extra newlines
	let rendered = rendered
		.lines()
		.filter(|line| !line.trim().is_empty() || line.is_empty())
		.collect::<Vec<_>>()
		.join("\n");

	// Validate TOML before writing
	toml::from_str::<toml::Value>(&rendered).context("Generated config is not valid TOML")?;

	// Write output
	let output_path = root.join(".cargo").join("config.toml");
	fs::write(&output_path, rendered).context("Failed to write config.toml")?;

	println!("   ✓ Generated {}", output_path.display());

	Ok(())
}
