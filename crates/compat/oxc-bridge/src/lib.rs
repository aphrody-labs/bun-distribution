//! Aphrody's in-process Oxc bridge for the Bun fork.
//! The C ABI owns every returned string; callers release it with `aphrody_oxc_free`.
//! Parsing, analysis and minification run in-process on the crates.io Oxc crates. Formatting and linting
//! delegate to the `oxfmt` and `oxlint` binaries (overridable through `APHRODY_OXFMT` / `APHRODY_OXLINT`),
//! because Oxc does not publish its formatter and linter crates.

use std::{
  ffi::{CStr, CString, c_char},
  io::Write,
  path::Path,
  process::{Command, Stdio},
  sync::atomic::{AtomicU64, Ordering},
};

use oxc_allocator::Allocator;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_minifier::{Minifier, MinifierOptions};
use oxc_parser::Parser;
use oxc_span::SourceType;

mod analysis;

#[unsafe(no_mangle)]
pub extern "C" fn aphrody_oxc_abi_version() -> u32 {
  1
}

/// Oxc tool binary: the `env` override, else `name` resolved on PATH.
fn tool(env: &str, name: &str) -> String {
  std::env::var(env).unwrap_or_else(|_| name.to_owned())
}

/// Bare file name of `filename`, after checking its extension selects JS/TS syntax.
fn file_name(filename: &str) -> Result<&str, String> {
  let path = Path::new(filename);
  SourceType::from_path(path).map_err(|error| error.to_string())?;
  path
    .file_name()
    .and_then(|name| name.to_str())
    .ok_or_else(|| format!("{filename} has no file name"))
}

fn failure(program: &str, output: &std::process::Output) -> String {
  let stderr = String::from_utf8_lossy(&output.stderr);
  let text = if stderr.trim().is_empty() { String::from_utf8_lossy(&output.stdout) } else { stderr };
  let text = text.trim();
  if text.is_empty() { format!("{program} exited with {}", output.status) } else { text.to_owned() }
}

/// Formats with Oxc's default options: oxfmt runs from the temporary directory, away from project configs.
fn format_source(source: &str, filename: &str) -> Result<String, String> {
  let name = file_name(filename)?;
  let program = tool("APHRODY_OXFMT", "oxfmt");
  let mut child = Command::new(&program)
    .arg(format!("--stdin-filepath={name}"))
    .current_dir(std::env::temp_dir())
    .stdin(Stdio::piped())
    .stdout(Stdio::piped())
    .stderr(Stdio::piped())
    .spawn()
    .map_err(|error| format!("{program}: {error}"))?;
  let mut stdin = child.stdin.take().ok_or("oxfmt stdin is unavailable")?;
  let output = std::thread::scope(|scope| {
    let writer = scope.spawn(move || stdin.write_all(source.as_bytes()));
    let output = child.wait_with_output();
    writer.join().map_err(|_| "oxfmt stdin writer panicked".to_owned())?.map_err(|error| error.to_string())?;
    output.map_err(|error| error.to_string())
  })?;
  if !output.status.success() {
    return Err(failure(&program, &output));
  }
  String::from_utf8(output.stdout).map_err(|error| error.to_string())
}

fn operation(source: &str, filename: &str, minify: bool) -> Result<String, String> {
  if !minify {
    return format_source(source, filename);
  }
  let kind = SourceType::from_path(Path::new(filename)).map_err(|error| error.to_string())?;
  let allocator = Allocator::default();
  let parsed = Parser::new(&allocator, source, kind).parse();
  if let Some(error) = parsed.diagnostics.first() {
    return Err(error.to_string());
  }
  let mut program = parsed.program;
  let result = Minifier::new(MinifierOptions::default()).minify(&allocator, &mut program);
  Ok(
    Codegen::new()
      .with_options(CodegenOptions::minify())
      .with_scoping(result.scoping)
      .build(&program)
      .code,
  )
}

static SCRATCH: AtomicU64 = AtomicU64::new(0);

/// Lints with Oxc's default rule set: oxlint has no stdin mode, so the source goes through a private
/// scratch directory that holds no project configuration.
fn lint(source: &str, filename: &str) -> Result<Vec<String>, String> {
  let name = file_name(filename)?;
  let program = tool("APHRODY_OXLINT", "oxlint");
  let dir = std::env::temp_dir().join(format!(
    "aphrody-oxlint-{}-{}",
    std::process::id(),
    SCRATCH.fetch_add(1, Ordering::Relaxed)
  ));
  std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
  let outcome = (|| {
    std::fs::write(dir.join(name), source).map_err(|error| error.to_string())?;
    let output = Command::new(&program)
      .args(["--format=json", name])
      .current_dir(&dir)
      .stdin(Stdio::null())
      .output()
      .map_err(|error| format!("{program}: {error}"))?;
    // oxlint exits 1 when it reports errors; the JSON report is the result either way.
    let report: serde_json::Value =
      serde_json::from_slice(&output.stdout).map_err(|_| failure(&program, &output))?;
    let diagnostics = report["diagnostics"]
      .as_array()
      .ok_or_else(|| format!("{program}: report has no diagnostics array"))?;
    Ok(
      diagnostics
        .iter()
        .map(|diagnostic| diagnostic["message"].as_str().unwrap_or_default().to_owned())
        .collect(),
    )
  })();
  let _ = std::fs::remove_dir_all(&dir);
  outcome
}

fn run(source: *const c_char, filename: *const c_char, minify: bool) -> *mut c_char {
  let outcome = std::panic::catch_unwind(|| {
    if source.is_null() || filename.is_null() {
      return Err("source and filename must be non-null".to_owned());
    }
    // SAFETY: Public entry points require valid NUL-terminated UTF-8 strings.
    let source = unsafe { CStr::from_ptr(source) }
      .to_str()
      .map_err(|error| error.to_string())?;
    // SAFETY: Same contract as source, checked for null above.
    let filename = unsafe { CStr::from_ptr(filename) }
      .to_str()
      .map_err(|error| error.to_string())?;
    operation(source, filename, minify)
  });
  let response = match outcome {
    Ok(Ok(code)) => serde_json::json!({"ok": true, "code": code}),
    Ok(Err(error)) => serde_json::json!({"ok": false, "error": error}),
    Err(_) => serde_json::json!({"ok": false, "error": "Oxc operation panicked"}),
  };
  CString::new(response.to_string()).map_or(std::ptr::null_mut(), CString::into_raw)
}

/// Format JavaScript or TypeScript, using the filename extension to choose syntax.
/// # Safety
/// Both pointers must reference NUL-terminated UTF-8 strings.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_oxc_format(
  source: *const c_char,
  filename: *const c_char,
) -> *mut c_char {
  run(source, filename, false)
}

/// Minify JavaScript or TypeScript, using the filename extension to choose syntax.
/// # Safety
/// Both pointers must reference NUL-terminated UTF-8 strings.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_oxc_minify(
  source: *const c_char,
  filename: *const c_char,
) -> *mut c_char {
  run(source, filename, true)
}

/// Lint JS/TS source with Oxc's default rule set and return JSON diagnostics.
/// # Safety
/// Both pointers must reference NUL-terminated UTF-8 strings.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_oxc_lint(
  source: *const c_char,
  filename: *const c_char,
) -> *mut c_char {
  let outcome = std::panic::catch_unwind(|| {
    if source.is_null() || filename.is_null() {
      return Err("source and filename must be non-null".to_owned());
    }
    // SAFETY: Public entry point requires a valid NUL-terminated string.
    let source = unsafe { CStr::from_ptr(source) }
      .to_str()
      .map_err(|error| error.to_string())?;
    // SAFETY: Same contract as source, checked for null above.
    let filename = unsafe { CStr::from_ptr(filename) }
      .to_str()
      .map_err(|error| error.to_string())?;
    lint(source, filename)
  });
  let response = match outcome {
    Ok(Ok(diagnostics)) => serde_json::json!({"ok": true, "diagnostics": diagnostics}),
    Ok(Err(error)) => serde_json::json!({"ok": false, "error": error}),
    Err(_) => serde_json::json!({"ok": false, "error": "Oxc lint panicked"}),
  };
  CString::new(response.to_string()).map_or(std::ptr::null_mut(), CString::into_raw)
}

fn run_analysis(source: *const c_char, filename: *const c_char, program: bool) -> *mut c_char {
  let outcome = std::panic::catch_unwind(|| {
    if source.is_null() || filename.is_null() {
      return Err(analysis::AnalysisError::input(
        "source and filename must be non-null".to_owned(),
      ));
    }
    // SAFETY: Public entry points require valid NUL-terminated UTF-8 strings.
    let source = unsafe { CStr::from_ptr(source) }
      .to_str()
      .map_err(|error| analysis::AnalysisError::input(error.to_string()))?;
    // SAFETY: Same pointer contract and null guard as source.
    let filename = unsafe { CStr::from_ptr(filename) }
      .to_str()
      .map_err(|error| analysis::AnalysisError::input(error.to_string()))?;
    analysis::analyze(source, filename, program)
  });
  let response = match outcome {
    Ok(Ok(value)) => serde_json::json!({"ok": true, "result": value}),
    Ok(Err(error)) => {
      serde_json::json!({"ok": false, "kind": error.kind, "error": error.message})
    }
    Err(_) => serde_json::json!({"ok": false, "kind": "panic", "error": "Oxc analysis panicked"}),
  };
  CString::new(response.to_string()).map_or(std::ptr::null_mut(), CString::into_raw)
}

/// Analyze static ESM imports and exports, preserving TypeScript declarations and source order.
/// # Safety
/// Both pointers must reference valid NUL-terminated UTF-8 strings.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_oxc_analyze(
  source: *const c_char,
  filename: *const c_char,
) -> *mut c_char {
  run_analysis(source, filename, false)
}

/// Serialize the official Oxc ESTree program. Span positions use UTF-16 code units.
/// # Safety
/// Both pointers must reference valid NUL-terminated UTF-8 strings.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_oxc_parse(
  source: *const c_char,
  filename: *const c_char,
) -> *mut c_char {
  run_analysis(source, filename, true)
}

/// Release exactly one string returned by this bridge. Null is accepted.
/// # Safety
/// `pointer` must be null or a live pointer returned by this bridge, released once.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn aphrody_oxc_free(pointer: *mut c_char) {
  if !pointer.is_null() {
    // SAFETY: The caller guarantees ownership and a single release.
    drop(unsafe { CString::from_raw(pointer) });
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  fn response(pointer: *mut c_char) -> serde_json::Value {
    assert!(!pointer.is_null());
    // SAFETY: Each test passes a live bridge-owned result, then frees it once.
    let value = serde_json::from_str(unsafe { CStr::from_ptr(pointer) }.to_str().unwrap()).unwrap();
    unsafe { aphrody_oxc_free(pointer) };
    value
  }

  #[test]
  fn formatting_minification_and_lint_preserve_response_shapes() {
    let source = CString::new("const greeting='hello'; console.log(greeting)").unwrap();
    let filename = CString::new("fixture.js").unwrap();
    let formatted = response(unsafe { aphrody_oxc_format(source.as_ptr(), filename.as_ptr()) });
    let minified = response(unsafe { aphrody_oxc_minify(source.as_ptr(), filename.as_ptr()) });
    let linted = response(unsafe { aphrody_oxc_lint(source.as_ptr(), filename.as_ptr()) });
    assert_eq!(aphrody_oxc_abi_version(), 1);
    assert_eq!(formatted["ok"], true);
    assert!(
      formatted["code"]
        .as_str()
        .unwrap()
        .contains("const greeting")
    );
    assert_eq!(minified["ok"], true);
    assert!(minified["code"].as_str().unwrap().contains("console.log"));
    assert_eq!(linted["ok"], true);
    assert!(linted["diagnostics"].is_array());
  }

  fn installed(env: &str, name: &str) -> bool {
    Command::new(tool(env, name))
      .arg("--version")
      .output()
      .is_ok_and(|output| output.status.success())
  }

  #[test]
  fn formatting_and_lint_delegate_to_oxfmt_and_oxlint() {
    let filename = CString::new("fixture.js").unwrap();
    let source = CString::new("const x=1").unwrap();
    let formatted = response(unsafe { aphrody_oxc_format(source.as_ptr(), filename.as_ptr()) });
    if installed("APHRODY_OXFMT", "oxfmt") {
      assert_eq!(formatted["code"], "const x = 1;\n");
    } else {
      assert!(formatted["error"].as_str().unwrap().contains("oxfmt"));
    }
    let bad = CString::new("const = ;").unwrap();
    let linted = response(unsafe { aphrody_oxc_lint(bad.as_ptr(), filename.as_ptr()) });
    if installed("APHRODY_OXLINT", "oxlint") {
      assert!(!linted["diagnostics"].as_array().unwrap().is_empty());
      let clean = response(unsafe { aphrody_oxc_lint(source.as_ptr(), filename.as_ptr()) });
      assert_eq!(clean["diagnostics"], serde_json::json!([]));
    } else {
      assert!(linted["error"].as_str().unwrap().contains("oxlint"));
    }
  }

  #[test]
  fn null_invalid_utf8_and_invalid_syntax_return_owned_errors() {
    let filename = CString::new("fixture.js").unwrap();
    let null = response(unsafe { aphrody_oxc_format(std::ptr::null(), filename.as_ptr()) });
    assert_eq!(null["ok"], false);
    let invalid_utf8 = [0xff_u8, 0];
    let invalid =
      response(unsafe { aphrody_oxc_minify(invalid_utf8.as_ptr().cast(), filename.as_ptr()) });
    assert_eq!(invalid["ok"], false);
    let source = CString::new("const = ;").unwrap();
    let syntax = response(unsafe { aphrody_oxc_minify(source.as_ptr(), filename.as_ptr()) });
    assert_eq!(syntax["ok"], false);
    let linted = response(unsafe { aphrody_oxc_lint(source.as_ptr(), filename.as_ptr()) });
    assert_eq!(linted["ok"], true);
    assert!(!linted["diagnostics"].as_array().unwrap().is_empty());
    // SAFETY: Null is an explicitly accepted no-op.
    unsafe { aphrody_oxc_free(std::ptr::null_mut()) };
  }

  #[test]
  fn module_metadata_preserves_physical_requests_types_and_utf16_spans() {
    let text = "// 🐈\nimport './dep'; export { value } from './other'; import './dep'; export * from './all'; export interface Shape {} export default 1;";
    let source = CString::new(text).unwrap();
    let filename = CString::new("fixture.ts").unwrap();
    let value = response(unsafe { aphrody_oxc_analyze(source.as_ptr(), filename.as_ptr()) });
    assert_eq!(value["ok"], true);
    let result = &value["result"];
    assert_eq!(
      result["imports"],
      serde_json::json!(["./dep", "./other", "./dep", "./all"])
    );
    assert_eq!(
      result["exports"],
      serde_json::json!(["value", "*", "Shape", "default"])
    );
    assert_eq!(result["spanEncoding"], "utf16");
    let utf16 = text.encode_utf16().collect::<Vec<_>>();
    for request in result["requests"].as_array().unwrap() {
      let start = request["start"].as_u64().unwrap() as usize;
      let end = request["end"].as_u64().unwrap() as usize;
      let literal = String::from_utf16(&utf16[start..end]).unwrap();
      assert_eq!(
        literal,
        format!("'{}'", request["specifier"].as_str().unwrap())
      );
    }
  }

  #[test]
  fn official_estree_serialization_retains_typed_declarations() {
    let source = CString::new("export interface Shape { value: number }").unwrap();
    let filename = CString::new("fixture.ts").unwrap();
    let value = response(unsafe { aphrody_oxc_parse(source.as_ptr(), filename.as_ptr()) });
    assert_eq!(value["ok"], true);
    assert_eq!(value["result"]["type"], "Program");
    assert_eq!(
      value["result"]["body"][0]["declaration"]["type"],
      "TSInterfaceDeclaration"
    );
  }

  #[test]
  fn analysis_rejects_invalid_inputs_syntax_and_semantics() {
    let filename = CString::new("fixture.ts").unwrap();
    let null = response(unsafe { aphrody_oxc_analyze(std::ptr::null(), filename.as_ptr()) });
    assert_eq!(null["kind"], "input");
    for text in ["export const = ;", "let duplicate; let duplicate;"] {
      let source = CString::new(text).unwrap();
      let value = response(unsafe { aphrody_oxc_parse(source.as_ptr(), filename.as_ptr()) });
      assert_eq!(value["ok"], false);
      assert_eq!(value["kind"], "syntax");
    }
  }
}
