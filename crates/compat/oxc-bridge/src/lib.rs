//! Aphrody's in-process Oxc bridge for the Bun fork.
//! The C ABI owns every returned string; callers release it with `aphrody_oxc_free`.

use std::{
  ffi::{CStr, CString, c_char},
  path::Path,
  sync::Arc,
};

use oxc_allocator::Allocator;
use oxc_codegen::{Codegen, CodegenOptions};
use oxc_formatter::{JsFormatOptions, format};
use oxc_linter::{
  ConfigStore, ConfigStoreBuilder, ContextSubHost, ContextSubHostOptions, ExternalPluginStore,
  LintOptions, Linter, ModuleRecord,
};
use oxc_minifier::{Minifier, MinifierOptions};
use oxc_parser::Parser;
use oxc_semantic::SemanticBuilder;
use oxc_span::SourceType;
use rustc_hash::FxHashMap;

mod analysis;

#[unsafe(no_mangle)]
pub extern "C" fn aphrody_oxc_abi_version() -> u32 {
  1
}

fn operation(source: &str, filename: &str, minify: bool) -> Result<String, String> {
  let kind = SourceType::from_path(Path::new(filename)).map_err(|error| error.to_string())?;
  let allocator = Allocator::default();
  if !minify {
    let formatted = format(&allocator, source, kind, JsFormatOptions::default())
      .map_err(|error| error.to_string())?
      .print()
      .map_err(|error| error.to_string())?;
    return Ok(formatted.into_code());
  }
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

fn lint(source: &str, filename: &str) -> Result<Vec<String>, String> {
  let path = Path::new(filename);
  let kind = SourceType::from_path(path).map_err(|error| error.to_string())?;
  let allocator = Allocator::default();
  let parsed = Parser::new(&allocator, source, kind).parse();
  if !parsed.diagnostics.is_empty() {
    return Ok(
      parsed
        .diagnostics
        .into_iter()
        .map(|error| error.to_string())
        .collect(),
    );
  }
  let semantic = SemanticBuilder::new_linter()
    .build(&parsed.program)
    .semantic;
  let module_record = Arc::new(ModuleRecord::new(path, &parsed.module_record, &semantic));
  let mut external_plugins = ExternalPluginStore::default();
  let config = ConfigStoreBuilder::default()
    .build(&mut external_plugins)
    .map_err(|error| error.to_string())?;
  let linter = Linter::new(
    LintOptions::default(),
    ConfigStore::new(config, FxHashMap::default(), external_plugins),
    None,
  );
  Ok(
    linter
      .run(
        path,
        vec![ContextSubHost::new(
          semantic,
          module_record,
          0,
          ContextSubHostOptions::default(),
        )],
        &allocator,
      )
      .into_iter()
      .map(|message| message.error.to_string())
      .collect(),
  )
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
