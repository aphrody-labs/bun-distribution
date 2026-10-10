// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use crate::{
  VersionMetadata,
  helpers::{
    framework::{Framework, infer_from_package_json as infer_framework},
    npm::PackageManager,
    prompts, resolve_tauri_path, template,
  },
};
use std::{
  collections::BTreeMap,
  env::current_dir,
  fs::{read_to_string, remove_dir_all},
  io::IsTerminal,
  path::{Path, PathBuf},
};

use crate::{
  Result,
  error::{Context, ErrorExt},
};
use clap::Parser;
use handlebars::{Handlebars, to_json};
use include_dir::{Dir, include_dir};

const TEMPLATE_DIR: Dir<'_> = include_dir!("$CARGO_MANIFEST_DIR/templates/app");
const TAURI_CONF_TEMPLATE: &str = include_str!("../templates/tauri.conf.json");

#[derive(Debug, Parser)]
#[clap(about = "Initialize a Tauri project in an existing directory")]
pub struct Options {
  /// Skip prompting for values
  #[clap(long, env = "CI")]
  ci: bool,
  /// Force init to overwrite the src-tauri folder
  #[clap(short, long)]
  force: bool,
  /// Enables logging
  #[clap(short, long)]
  log: bool,
  /// Set target directory for init
  #[clap(short, long)]
  #[clap(default_value_t = current_dir().expect("failed to read cwd").display().to_string())]
  directory: String,
  /// Path of the Tauri project to use (relative to the cwd)
  #[clap(short, long)]
  tauri_path: Option<PathBuf>,
  /// Name of your Tauri application
  #[clap(short = 'A', long)]
  app_name: Option<String>,
  /// Window title of your Tauri application
  #[clap(short = 'W', long)]
  window_title: Option<String>,
  /// Web assets location, relative to <project-dir>/src-tauri
  #[clap(short = 'D', long)]
  frontend_dist: Option<String>,
  /// Url of your dev server
  #[clap(short = 'P', long)]
  dev_url: Option<String>,
  /// A shell command to run before `tauri dev` kicks in.
  #[clap(long)]
  before_dev_command: Option<String>,
  /// A shell command to run before `tauri build` kicks in.
  #[clap(long)]
  before_build_command: Option<String>,
}

#[derive(Default)]
struct InitDefaults {
  app_name: Option<String>,
  framework: Option<Framework>,
}

impl Options {
  fn load(mut self) -> Result<Self> {
    if !std::io::stdin().is_terminal() {
      self.ci = true;
    }
    let package_json_path = PathBuf::from(&self.directory).join("package.json");

    let init_defaults = if package_json_path.exists() {
      let package_json_text =
        read_to_string(&package_json_path).fs_context("failed to read", &package_json_path)?;
      let package_json: crate::PackageJson =
        serde_json::from_str(&package_json_text).context("failed to parse JSON")?;
      let (framework, _) = infer_framework(&package_json_text);
      InitDefaults {
        app_name: package_json.product_name.or(package_json.name),
        framework,
      }
    } else {
      Default::default()
    };

    self.app_name = self.app_name.map(|s| Ok(Some(s))).unwrap_or_else(|| {
      prompts::input(
        "What is your app name?",
        Some(
          init_defaults
            .app_name
            .clone()
            .unwrap_or_else(|| "Tauri App".to_string()),
        ),
        self.ci,
        true,
      )
    })?;

    self.window_title = self.window_title.map(|s| Ok(Some(s))).unwrap_or_else(|| {
      prompts::input(
        "What should the window title be?",
        Some(
          init_defaults
            .app_name
            .clone()
            .unwrap_or_else(|| "Tauri".to_string()),
        ),
        self.ci,
        true,
      )
    })?;

    self.frontend_dist = self.frontend_dist.map(|s| Ok(Some(s))).unwrap_or_else(|| prompts::input(
      r#"Where are your web assets (HTML/CSS/JS) located, relative to the "<current dir>/src-tauri/tauri.conf.json" file that will be created?"#,
      init_defaults.framework.as_ref().map(|f| f.frontend_dist()),
      self.ci,
      false,
    ))?;

    self.dev_url = self.dev_url.map(|s| Ok(Some(s))).unwrap_or_else(|| {
      prompts::input(
        "What is the url of your dev server?",
        init_defaults.framework.map(|f| f.dev_url()),
        self.ci,
        true,
      )
    })?;

    let detected_package_manager = PackageManager::from_project(&self.directory);

    self.before_dev_command = self
      .before_dev_command
      .map(|s| Ok(Some(s)))
      .unwrap_or_else(|| {
        prompts::input(
          "What command should Tauri run before `tauri dev` to start your frontend? (leave empty if not needed)",
          Some(default_dev_command(detected_package_manager).into()),
          self.ci,
          true,
        )
      })?;

    self.before_build_command = self
      .before_build_command
      .map(|s| Ok(Some(s)))
      .unwrap_or_else(|| {
        prompts::input(
          "What command should Tauri run before `tauri build` to build your frontend? (leave empty if not needed)",
          Some(default_build_command(detected_package_manager).into()),
          self.ci,
          true,
        )
      })?;

    Ok(self)
  }
}

fn default_dev_command(pm: PackageManager) -> &'static str {
  match pm {
    PackageManager::Yarn => "yarn dev",
    PackageManager::YarnBerry => "yarn dev",
    PackageManager::Npm => "npm run dev",
    PackageManager::Pnpm => "pnpm dev",
    PackageManager::Bun => "bun dev",
    PackageManager::Deno => "deno task dev",
  }
}

fn default_build_command(pm: PackageManager) -> &'static str {
  match pm {
    PackageManager::Yarn => "yarn build",
    PackageManager::YarnBerry => "yarn build",
    PackageManager::Npm => "npm run build",
    PackageManager::Pnpm => "pnpm build",
    PackageManager::Bun => "bun build",
    PackageManager::Deno => "deno task build",
  }
}

pub fn command(mut options: Options) -> Result<()> {
  options = options.load()?;

  let template_target_path = PathBuf::from(&options.directory).join("src-tauri");
  let metadata = serde_json::from_str::<VersionMetadata>(include_str!("../metadata-v2.json"))
    .context("failed to parse version metadata")?;

  if template_target_path.exists() && !options.force {
    log::warn!(
      "Tauri dir ({:?}) not empty. Run `init --force` to overwrite.",
      template_target_path
    );
  } else {
    let _ = remove_dir_all(&template_target_path);
    let mut handlebars = Handlebars::new();
    handlebars.register_escape_fn(handlebars::no_escape);

    let mut data = tauri_dependencies_data(options.tauri_path.as_deref(), &metadata);
    data.insert(
      "frontend_dist",
      to_json(options.frontend_dist.as_deref().unwrap_or("../dist")),
    );
    data.insert("dev_url", to_json(options.dev_url));
    data.insert(
      "app_name",
      to_json(options.app_name.as_deref().unwrap_or("Tauri App")),
    );
    data.insert(
      "window_title",
      to_json(options.window_title.as_deref().unwrap_or("Tauri")),
    );
    data.insert("before_dev_command", to_json(options.before_dev_command));
    data.insert(
      "before_build_command",
      to_json(options.before_build_command),
    );

    let mut config = render_tauri_config(&data)?;
    if option_env!("TARGET") == Some("node") {
      let mut dir = current_dir().expect("failed to read cwd");
      let mut count = 0;
      let mut cli_node_module_path = None;
      let cli_path = "node_modules/@aphrody/cli";

      // only go up three folders max
      while count <= 2 {
        let test_path = dir.join(cli_path);
        if test_path.exists() {
          let mut node_module_path = PathBuf::from("..");
          for _ in 0..count {
            node_module_path.push("..");
          }
          node_module_path.push(cli_path);
          node_module_path.push("config.schema.json");
          cli_node_module_path.replace(node_module_path);
          break;
        }
        count += 1;
        match dir.parent() {
          Some(parent) => {
            dir = parent.to_path_buf();
          }
          None => break,
        }
      }

      if let Some(cli_node_module_path) = cli_node_module_path {
        let mut map = serde_json::Map::default();
        map.insert(
          "$schema".into(),
          serde_json::Value::String(
            cli_node_module_path
              .display()
              .to_string()
              .replace('\\', "/"),
          ),
        );
        let merge_config = serde_json::Value::Object(map);
        json_patch::merge(&mut config, &merge_config);
      }
    }

    data.insert(
      "tauri_config",
      to_json(serde_json::to_string_pretty(&config).unwrap()),
    );

    template::render(&handlebars, &data, &TEMPLATE_DIR, &options.directory)
      .with_context(|| "failed to render Tauri template")?;
  }

  Ok(())
}

/// Renders the `tauri.conf.json` template.
///
/// Every value in the template is interpolated inside a JSON string literal,
/// so values are JSON-escaped to keep quotes and backslashes in user input
/// (e.g. `vite --host "0.0.0.0"` or `..\dist`) from breaking the document.
fn render_tauri_config(
  data: &BTreeMap<&'static str, serde_json::Value>,
) -> Result<serde_json::Value> {
  let mut handlebars = Handlebars::new();
  handlebars.register_escape_fn(|value| {
    let quoted = serde_json::Value::String(value.into()).to_string();
    quoted[1..quoted.len() - 1].to_string()
  });
  let config = handlebars
    .render_template(TAURI_CONF_TEMPLATE, data)
    .context("failed to render tauri.conf.json template")?;
  serde_json::from_str(&config).context("failed to parse rendered tauri.conf.json template")
}

/// Builds the template variables for the Tauri crate dependencies of the generated `Cargo.toml`.
///
/// `tauri_dep`, `tauri_build_dep`, `tauri_plugin_log_dep` and `tauri_runtime_cef_dep` are always set. The crates are the
/// Aphrody packages (`aphrody-tauri`, …) while the dependency keys keep the upstream names, so
/// `use tauri::…` and `tauri/custom-protocol` keep working.
///
/// When `tauri_path` is provided the dependencies point to the crates inside that directory
/// (`<tauri_path>/crates/tauri/aphrody-*`, the monorepo layout).
/// Version of `aphrody-tauri-plugin-log` the app template depends on when no `--tauri-path` is given.
const TAURI_PLUGIN_LOG_VERSION: &str = "3.0.0-alpha.2";

fn tauri_dependencies_data(
  tauri_path: Option<&Path>,
  metadata: &VersionMetadata,
) -> BTreeMap<&'static str, serde_json::Value> {
  let mut data = BTreeMap::new();
  if let Some(tauri_path) = tauri_path {
    let path_dep = |package: &str| {
      to_json(format!(
        "{{  package = {package:?}, path = {:?} }}",
        resolve_tauri_path(tauri_path, &format!("crates/tauri/{package}"))
      ))
    };
    data.insert("tauri_dep", path_dep("aphrody-tauri"));
    data.insert("tauri_build_dep", path_dep("aphrody-tauri-build"));
    data.insert("tauri_plugin_log_dep", path_dep("aphrody-tauri-plugin-log"));
    data.insert(
      "tauri_runtime_cef_dep",
      path_dep("aphrody-tauri-runtime-cef"),
    );
  } else {
    let version_dep = |package: &str, version: &str| {
      to_json(format!(
        r#"{{ package = "{package}", version = "{version}" }}"#
      ))
    };
    data.insert("tauri_dep", version_dep("aphrody-tauri", &metadata.tauri));
    data.insert(
      "tauri_plugin_log_dep",
      version_dep("aphrody-tauri-plugin-log", TAURI_PLUGIN_LOG_VERSION),
    );
    data.insert(
      "tauri_build_dep",
      version_dep("aphrody-tauri-build", &metadata.tauri_build),
    );
    data.insert(
      "tauri_runtime_cef_dep",
      version_dep("aphrody-tauri-runtime-cef", &metadata.tauri_runtime_cef),
    );
  }
  data
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn tauri_config_escapes_values() {
    let mut data = BTreeMap::new();
    data.insert("app_name", to_json(r#"My "quoted" App"#));
    data.insert("window_title", to_json("Tauri\tApp"));
    data.insert("frontend_dist", to_json(r"..\dist"));
    data.insert("dev_url", to_json("http://localhost:1420"));
    data.insert("before_dev_command", to_json(r#"vite --host "0.0.0.0""#));
    data.insert(
      "before_build_command",
      to_json(r"npm run build -- -D ..\dist"),
    );

    let config = render_tauri_config(&data).unwrap();
    assert_eq!(config["productName"], r#"My "quoted" App"#);
    assert_eq!(config["app"]["windows"][0]["title"], "Tauri\tApp");
    assert_eq!(config["build"]["frontendDist"], r"..\dist");
    assert_eq!(config["build"]["devUrl"], "http://localhost:1420");
    assert_eq!(
      config["build"]["beforeDevCommand"],
      r#"vite --host "0.0.0.0""#
    );
    assert_eq!(
      config["build"]["beforeBuildCommand"],
      r"npm run build -- -D ..\dist"
    );
  }

  /// The version metadata shipped with the CLI, the same source `command` uses.
  fn metadata() -> VersionMetadata {
    serde_json::from_str(include_str!("../metadata-v2.json"))
      .expect("failed to parse version metadata")
  }

  /// Renders the app `Cargo.toml` template with the same handlebars setup used by `command`.
  fn render_manifest(data: &BTreeMap<&'static str, serde_json::Value>) -> toml::Table {
    let template = TEMPLATE_DIR
      .get_file("src-tauri/Cargo.crate-manifest")
      .expect("app template is missing src-tauri/Cargo.crate-manifest")
      .contents_utf8()
      .expect("Cargo manifest template is not UTF-8");

    let mut handlebars = Handlebars::new();
    handlebars.register_escape_fn(handlebars::no_escape);
    let rendered = handlebars
      .render_template(template, data)
      .expect("failed to render Cargo manifest template");

    assert!(
      !rendered.contains("{{") && !rendered.contains("}}"),
      "rendered manifest contains handlebars braces:\n{rendered}"
    );

    toml::from_str(&rendered)
      .unwrap_or_else(|e| panic!("rendered manifest is not valid TOML: {e}\n{rendered}"))
  }

  fn dependency<'a>(manifest: &'a toml::Table, section: &str, name: &str) -> &'a toml::Table {
    manifest
      .get(section)
      .and_then(|s| s.get(name))
      .and_then(|d| d.as_table())
      .unwrap_or_else(|| panic!("[{section}] is missing the `{name}` table"))
  }

  fn assert_path_dependency(dep: &toml::Table, tauri_path: &Path, crate_dir: &str) {
    assert!(
      !dep.contains_key("version"),
      "path dependency must not carry a version: {dep:?}"
    );
    assert_eq!(
      dep.get("package").and_then(|p| p.as_str()),
      crate_dir.strip_prefix("crates/tauri/"),
      "dependency must use the Aphrody package: {dep:?}"
    );
    let path = dep
      .get("path")
      .and_then(|p| p.as_str())
      .unwrap_or_else(|| panic!("dependency is missing a string `path`: {dep:?}"));
    assert_eq!(Path::new(path), resolve_tauri_path(tauri_path, crate_dir));
  }

  fn assert_manifest_uses_path(manifest: &toml::Table, tauri_path: &Path) {
    assert_path_dependency(
      dependency(manifest, "dependencies", "tauri"),
      tauri_path,
      "crates/tauri/aphrody-tauri",
    );
    assert_path_dependency(
      dependency(manifest, "build-dependencies", "tauri-build"),
      tauri_path,
      "crates/tauri/aphrody-tauri-build",
    );
    assert_path_dependency(
      dependency(manifest, "dependencies", "tauri-plugin-log"),
      tauri_path,
      "crates/tauri/aphrody-tauri-plugin-log",
    );
    assert_path_dependency(
      dependency(manifest, "dependencies", "tauri-runtime-cef"),
      tauri_path,
      "crates/tauri/aphrody-tauri-runtime-cef",
    );
    assert!(
      !manifest.contains_key("patch"),
      "no [patch.crates-io] is needed: all Tauri crates are Aphrody packages"
    );
  }

  #[test]
  fn version_dependencies() {
    let metadata = metadata();
    let data = tauri_dependencies_data(None, &metadata);

    let manifest = render_manifest(&data);

    let tauri = dependency(&manifest, "dependencies", "tauri");
    assert_eq!(
      tauri.get("package").and_then(|v| v.as_str()),
      Some("aphrody-tauri")
    );
    assert_eq!(
      tauri.get("version").and_then(|v| v.as_str()),
      Some(metadata.tauri.as_str())
    );
    assert!(!tauri.contains_key("path"));

    let tauri_build = dependency(&manifest, "build-dependencies", "tauri-build");
    assert_eq!(
      tauri_build.get("version").and_then(|v| v.as_str()),
      Some(metadata.tauri_build.as_str())
    );
    assert!(!tauri_build.contains_key("path"));

    let tauri_runtime_cef = dependency(&manifest, "dependencies", "tauri-runtime-cef");
    assert_eq!(
      tauri_runtime_cef.get("version").and_then(|v| v.as_str()),
      Some(metadata.tauri_runtime_cef.as_str())
    );
    assert!(!tauri_runtime_cef.contains_key("path"));

    assert!(!manifest.contains_key("patch"));
  }

  #[test]
  fn relative_path_dependencies() {
    let tauri_path = Path::new("tauri-src");
    let manifest = render_manifest(&tauri_dependencies_data(Some(tauri_path), &metadata()));
    assert_manifest_uses_path(&manifest, tauri_path);
  }

  #[test]
  fn absolute_path_dependencies() {
    // absolute paths are written as-is; on Windows this covers backslash escaping
    let tauri_path = std::env::current_dir().unwrap().join("tauri-src");
    assert!(tauri_path.is_absolute());
    let manifest = render_manifest(&tauri_dependencies_data(Some(&tauri_path), &metadata()));
    assert_manifest_uses_path(&manifest, &tauri_path);
  }
}
