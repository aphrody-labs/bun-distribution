// Copyright 2019-2024 Tauri Programme within The Commons Conservancy
// SPDX-License-Identifier: Apache-2.0
// SPDX-License-Identifier: MIT

use crate::{Result, error::ErrorExt, helpers::app_paths::walk_builder};

use regex::{Captures, Regex};

use std::{fs, path::Path, sync::LazyLock};

const SELECT_RUNTIME: &str = ".runtime(tauri_runtime_cef::Cef::default())";

static BUILDER_DEFAULT: LazyLock<Regex> =
  LazyLock::new(|| Regex::new(r"tauri::Builder::default\(\)").unwrap());
static CHAINED_CALL: LazyLock<Regex> =
  LazyLock::new(|| Regex::new(r"^[ \t]*\r?\n([ \t]*)\.").unwrap());
static WRY_TYPE: LazyLock<Regex> =
  LazyLock::new(|| Regex::new(r"(\b[A-Za-z_][A-Za-z0-9_]*::)?\bWry\b").unwrap());
static TAURI_USE_GROUP: LazyLock<Regex> =
  LazyLock::new(|| Regex::new(r"use\s+tauri::\{[^;]*\bWry\b[^;]*\};").unwrap());
static WEBVIEW_VERSION: LazyLock<Regex> =
  LazyLock::new(|| Regex::new(r"\btauri::webview_version\s*\(").unwrap());

/// Plain renames, applied regardless of the runtime.
const RENAMES: &[(&str, &str)] = &[
  (".with_inner_tray_icon(", ".with_inner_blocking("),
  (
    ".js_init_script_on_all_frames(",
    ".initialization_script_on_all_frames(",
  ),
  (".js_init_script(", ".initialization_script("),
  ("fn extend_api(", "fn run_invoke_handler("),
];

/// Items of the wry runtime that have no CEF equivalent: reported, not renamed.
const WRY_ONLY_ITEMS: &[&str] = &["tauri::tao::", "tauri::wry::", "tauri::android_binding!"];

/// The CEF entry point, which hands Chromium's helper processes the executable before the app starts.
const CEF_ENTRY_POINT: &str = "#[tauri_runtime_cef::cef_entry_point]";

static MAIN_FN: LazyLock<Regex> = LazyLock::new(|| Regex::new(r"(?m)^fn main\(\)").unwrap());

/// The result of the Rust source migration.
#[derive(Debug, Default)]
pub struct MigratedSource {
  /// Whether a `tauri::Builder` now selects the wry runtime.
  pub runtime_selected: bool,
}

/// Migrates the Rust files of the given directory.
pub fn migrate(tauri_dir: &Path, uses_runtime: bool) -> Result<MigratedSource> {
  let mut migrated = MigratedSource::default();

  for entry in walk_builder(tauri_dir).build().flatten() {
    let path = entry.path();
    if path.extension().is_none_or(|ext| ext != "rs") {
      continue;
    }

    let contents = fs::read_to_string(path).fs_context("failed to read Rust file", path)?;
    let (new_contents, runtime_selected) = migrate_source(&contents, uses_runtime);
    migrated.runtime_selected |= runtime_selected;

    if uses_runtime {
      for item in WRY_ONLY_ITEMS {
        if new_contents.contains(item) {
          log::warn!(
            "{} uses `{item}`, which has no CEF equivalent: port it to the CEF runtime",
            path.display()
          );
        }
      }
    }

    if WEBVIEW_VERSION.is_match(&new_contents) {
      log::warn!(
        "`tauri::webview_version` was removed from {}, use `App::webview_version` or `AppHandle::webview_version` instead",
        path.display()
      );
    }

    if new_contents != contents {
      fs::write(path, new_contents).fs_context("failed to write Rust file", path)?;
    }
  }

  Ok(migrated)
}

/// Returns the migrated source and whether it selects the wry runtime.
pub fn migrate_source(source: &str, uses_runtime: bool) -> (String, bool) {
  let mut source = migrate_wry_type(source);

  for (from, to) in RENAMES {
    source = source.replace(from, to);
  }

  if !uses_runtime {
    return (source, false);
  }

  if MAIN_FN.is_match(&source) && !source.contains("cef_entry_point") {
    source = MAIN_FN
      .replace(&source, format!("{CEF_ENTRY_POINT}\nfn main()"))
      .into_owned();
  }

  let mut runtime_selected = source.contains(SELECT_RUNTIME);
  let mut migrated = String::with_capacity(source.len());
  let mut last_end = 0;
  for builder in BUILDER_DEFAULT.find_iter(&source) {
    migrated.push_str(&source[last_end..builder.end()]);
    last_end = builder.end();

    let rest = &source[builder.end()..];
    if rest.trim_start().starts_with(".runtime(") {
      continue;
    }

    if let Some(chained) = CHAINED_CALL.captures(rest) {
      // the builder calls are chained on the following lines, add the runtime selection as a new line
      migrated.push('\n');
      migrated.push_str(&chained[1]);
    }
    migrated.push_str(SELECT_RUNTIME);
    runtime_selected = true;
  }
  migrated.push_str(&source[last_end..]);

  (migrated, runtime_selected)
}

/// The `tauri::Wry` runtime type was removed, the generic types now default to `tauri::DynRuntime`.
fn migrate_wry_type(source: &str) -> String {
  // `Wry` is only in scope when imported from `tauri`
  let imports_wry = source.contains("use tauri::Wry;") || TAURI_USE_GROUP.is_match(source);

  WRY_TYPE
    .replace_all(source, |captures: &Captures<'_>| {
      match captures.get(1).map(|prefix| prefix.as_str()) {
        Some("tauri::") => "tauri::DynRuntime".to_string(),
        None if imports_wry => "DynRuntime".to_string(),
        _ => captures[0].to_string(),
      }
    })
    .into_owned()
}

#[cfg(test)]
mod tests {
  use super::migrate_source;

  #[test]
  fn selects_runtime_on_chained_builder() {
    let source = r#"pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
"#;
    let (migrated, selected) = migrate_source(source, true);
    assert!(selected);
    assert_eq!(
      migrated,
      r#"pub fn run() {
  tauri::Builder::default()
    .runtime(tauri_runtime_cef::Cef::default())
    .plugin(tauri_plugin_opener::init())
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
"#
    );
  }

  #[test]
  fn selects_runtime_on_inline_builder() {
    let (migrated, selected) = migrate_source("let builder = tauri::Builder::default();", true);
    assert!(selected);
    assert_eq!(
      migrated,
      "let builder = tauri::Builder::default().runtime(tauri_runtime_cef::Cef::default());"
    );
  }

  #[test]
  fn is_idempotent() {
    let source = r#"tauri::Builder::default()
    .runtime(tauri_runtime_cef::Cef::default())
    .run(tauri::generate_context!())"#;
    let (migrated, selected) = migrate_source(source, true);
    assert!(selected);
    assert_eq!(migrated, source);
  }

  #[test]
  fn adds_cef_entry_point_once() {
    let source = "fn main() {
  app_lib::run()
}
";
    let (migrated, _) = migrate_source(source, true);
    assert_eq!(
      migrated,
      "#[tauri_runtime_cef::cef_entry_point]
fn main() {
  app_lib::run()
}
"
    );
    assert_eq!(migrate_source(&migrated, true).0, migrated);
  }

  #[test]
  fn does_not_select_runtime_without_wry() {
    let source = "let builder = tauri::Builder::default();";
    let (migrated, selected) = migrate_source(source, false);
    assert!(!selected);
    assert_eq!(migrated, source);
  }

  #[test]
  fn replaces_wry_type() {
    let (migrated, _) = migrate_source(
      "fn a(app: tauri::AppHandle<tauri::Wry>, handle: tauri::WryHandle) {}",
      true,
    );
    assert_eq!(
      migrated,
      "fn a(app: tauri::AppHandle<tauri::DynRuntime>, handle: tauri::WryHandle) {}"
    );

    let (migrated, _) = migrate_source(
      "use tauri::{AppHandle, Wry};\nfn a(app: AppHandle<Wry>, b: other::Wry) {}",
      true,
    );
    assert_eq!(
      migrated,
      "use tauri::{AppHandle, DynRuntime};\nfn a(app: AppHandle<DynRuntime>, b: other::Wry) {}"
    );

    // not imported from tauri, left alone
    let source = "use my_runtime::Wry;\nfn a(app: tauri::AppHandle<Wry>) {}";
    assert_eq!(migrate_source(source, true).0, source);
  }
}
