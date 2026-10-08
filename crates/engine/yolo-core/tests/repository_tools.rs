// SPDX-License-Identifier: Apache-2.0
#![cfg(feature = "repository-tools")]

use std::{path::Path, time::Duration};
use yolo_core::{mapper, polyglot};

#[test]
fn javascript_uses_ast_for_multiline_imports_and_declarations() {
  let source = r#"
/* import fake from 'comment'; class Fake {} */
import {
  value,
} from 'package';
export { something } from 'reexport';
const text = "function Fake() {}";
export async function
  realFunction() { return import('./dynamic.js'); }
export class RealClass {}
interface RealInterface {}
const { left, right: renamed } = value;
"#;
  let parsed = polyglot::parse(Path::new("example.ts"), source);
  assert!(parsed.diagnostics.is_empty(), "{:?}", parsed.diagnostics);
  assert_eq!(parsed.imports, ["package", "reexport", "./dynamic.js"]);
  assert_eq!(parsed.declarations.functions, ["realFunction"]);
  assert_eq!(parsed.declarations.classes, ["RealClass"]);
  assert_eq!(parsed.declarations.interfaces, ["RealInterface"]);
  assert_eq!(parsed.declarations.constants, ["text", "left", "renamed"]);
}

#[test]
fn require_calls_are_imports_and_locals_are_not_constants() {
  let source = r#"
const { join } = require("node:path");
const fs = require('fs');
const dynamic = require(name);
export const enum Mode { Read, Write = 2, "dash-name" }
enum Plain { A }
const TOP = 1;
function run() {
  const local = require("./local");
  for (const item of []) {}
  if (TOP) { const inner = 2; }
  return local;
}
class Box { static { const hidden = 3; } }
"#;
  let parsed = polyglot::parse(Path::new("module.ts"), source);
  assert!(parsed.diagnostics.is_empty(), "{:?}", parsed.diagnostics);
  assert_eq!(parsed.imports, ["node:path", "fs", "./local"]);
  assert_eq!(parsed.declarations.constants, ["join", "fs", "dynamic", "TOP"]);
  assert_eq!(parsed.declarations.enums, ["Mode", "Plain"]);
  assert_eq!(
    parsed.declarations.enum_variants,
    ["Mode.Read", "Mode.Write", "Mode.dash-name", "Plain.A"]
  );
}

#[test]
fn invalid_javascript_reports_parser_diagnostics_and_no_invented_symbols() {
  let parsed = polyglot::parse(Path::new("bad.js"), "import { broken from ;");
  assert!(!parsed.diagnostics.is_empty());
  assert!(parsed.imports.is_empty());
  assert!(parsed.declarations.functions.is_empty());
  assert_eq!(parsed.validation_gate.as_deref(), Some("bun test"));
}

#[test]
fn javascript_comment_counts_follow_oxc_spans_including_crlf() {
  let source = "// comment\r\n\r\nconst value = '// code';\r\n/* comment */\r\n";
  let parsed = polyglot::parse(Path::new("test.js"), source);
  assert_eq!(
    (
      parsed.total_lines,
      parsed.code_lines,
      parsed.comment_lines,
      parsed.blank_lines
    ),
    (4, 1, 2, 1)
  );
}

fn repository() -> tempfile::TempDir {
  let root = tempfile::tempdir().unwrap();
  let app = root.path().join("apps/demo");
  std::fs::create_dir_all(&app).unwrap();
  std::fs::write(
    app.join("package.json"),
    r#"{"name":"fixture","version":"1.0.0"}"#,
  )
  .unwrap();
  std::fs::write(app.join("index.ts"), "const ok = true;\n").unwrap();
  root
}

#[test]
fn audit_keeps_topology_contract_and_prunes_ignored_directories() {
  let root = repository();
  let ignored = root.path().join("apps/demo/node_modules/ignored");
  std::fs::create_dir_all(&ignored).unwrap();
  std::fs::write(
    ignored.join("index.ts"),
    "const path = '/home/ubuntu/fixture';",
  )
  .unwrap();
  let audit = root.path().join("reports/audit.json");
  let map = root.path().join("reports/map.json");
  let result = mapper::audit::run(root.path(), &audit, &map).unwrap();
  assert_eq!(result.status, mapper::core::Status::ProductionReady);
  let report: serde_json::Value = serde_json::from_slice(&std::fs::read(&map).unwrap()).unwrap();
  assert_eq!(report["stats"]["total_files"], 2);
  assert_eq!(report["workspaces"][0]["path"], "apps/demo");
  assert_eq!(report["workspaces"][0]["name"], "fixture");
  assert!(mapper::audit::run(&root.path().join("missing"), &audit, &map).is_err());
}

#[test]
fn audit_maps_declared_cargo_and_package_json_workspaces() {
  let root = tempfile::tempdir().unwrap();
  let r = root.path();
  let write = |path: &str, text: &str| {
    let path = r.join(path);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, text).unwrap();
  };
  write("Cargo.toml", "[workspace]\nmembers = [\"src/sys\", \"src/core\"]\n");
  write("package.json", r#"{"name":"root","workspaces":["./packages/types"]}"#);
  write("src/sys/Cargo.toml", "[package]\nname = \"bun_sys\"\nversion = \"0.1.0\"\n");
  write("src/sys/lib.rs", "pub fn open() {}\n");
  write("src/core/Cargo.toml", "[package]\nname = \"bun_core\"\n");
  write("src/core/lib.rs", "\n");
  write("packages/types/package.json", r#"{"name":"types"}"#);
  write("packages/types/index.d.ts", "export {};\n");
  write("packages/types/fixture/package.json", r#"{"name":"fixture"}"#);
  let audit = r.join("out/audit.json");
  let map = r.join("out/map.json");
  let result = mapper::audit::run(r, &audit, &map).unwrap();
  assert_eq!(result.workspaces, 3);
  let report: serde_json::Value = serde_json::from_slice(&std::fs::read(&map).unwrap()).unwrap();
  let names: Vec<(&str, &str, u64)> = report["workspaces"]
    .as_array()
    .unwrap()
    .iter()
    .map(|w| {
      (
        w["path"].as_str().unwrap(),
        w["name"].as_str().unwrap(),
        w["file_count"].as_u64().unwrap(),
      )
    })
    .collect();
  assert_eq!(
    names,
    [("packages/types", "types", 3), ("src/core", "bun_core", 2), ("src/sys", "bun_sys", 2)]
  );
}

#[tokio::test(flavor = "current_thread")]
async fn watcher_reuses_current_runtime_rescans_and_joins_on_shutdown() {
  let root = repository();
  let audit = root.path().join("reports/audit.json");
  let map = root.path().join("reports/map.json");
  let (stop, stopped) = tokio::sync::oneshot::channel();
  let watch = mapper::watch::run_async_with_shutdown(root.path(), &audit, &map, 20, async {
    let _ = stopped.await;
  });
  let edits = async {
    loop {
      if map.exists() {
        break;
      }
      tokio::time::sleep(Duration::from_millis(10)).await;
    }
    std::fs::write(
      root.path().join("apps/demo/added.ts"),
      "export const added = true;\n",
    )
    .unwrap();
    loop {
      let current = std::fs::read(&map)
        .ok()
        .and_then(|bytes| serde_json::from_slice::<serde_json::Value>(&bytes).ok());
      if current.is_some_and(|value| value["stats"]["total_files"] == 3) {
        break;
      }
      tokio::time::sleep(Duration::from_millis(10)).await;
    }
    stop.send(()).unwrap();
  };
  tokio::time::timeout(Duration::from_secs(5), async {
    let (result, ()) = tokio::join!(watch, edits);
    result.unwrap();
  })
  .await
  .expect("watcher must observe native filesystem events and shut down");
  // No audit task is left mutating the artifact after graceful shutdown.
  let final_report = std::fs::read(&map).unwrap();
  std::fs::write(root.path().join("apps/demo/after-stop.ts"), "export {};").unwrap();
  tokio::time::sleep(Duration::from_millis(60)).await;
  assert_eq!(std::fs::read(map).unwrap(), final_report);
}

#[tokio::test(flavor = "current_thread")]
async fn sync_watcher_refuses_nested_runtime_instead_of_starting_another_pool() {
  let root = repository();
  let error = mapper::watch::run(
    root.path(),
    Path::new("audit.json"),
    Path::new("map.json"),
    20,
  )
  .unwrap_err();
  assert!(error.to_string().contains("run_async"));
}
