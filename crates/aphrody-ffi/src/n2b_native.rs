// SPDX-License-Identifier: Apache-2.0
// Copyright 2026 aphrody-code
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// node2bun-native — hot-path helpers exposés à Bun via bun:ffi.
//
// Les fichiers source sont passés encodés en UTF-16LE (même représentation
// interne que les JS strings en général). Les offsets retournés sont en
// UTF-16 code units, ce qui correspond à `String.prototype.charCodeAt` et
// `indexOf` côté JS — donc compatibles avec l'index passé par makeFinding.

use std::{
    ffi::{CStr, CString, c_char},
    path::PathBuf,
};

use aphrody_n2b_core::{
    report, run,
    types::{Mode, Report, RunOptions},
};
use memchr::memchr_iter;

/// Écrit dans `out_ptr` les offsets (en u16 units) de chaque '\n' trouvé
/// dans le buffer UTF-16LE pointé par `buf` (`byte_len` octets, donc
/// `byte_len/2` u16s).
///
/// Retourne le nombre total de newlines. Si ce nombre excède `out_cap`,
/// `out` n'est que partiellement rempli et l'appelant doit rappeler avec
/// un buffer plus grand.
///
/// # Safety
/// - `buf` doit pointer sur `byte_len` octets valides et alignés sur 2.
/// - `out_ptr` doit pointer sur `out_cap` `u32` valides et alignés.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn find_newlines_u16(
    buf: *const u8,
    byte_len: usize,
    out_ptr: *mut u32,
    out_cap: usize,
) -> usize {
    if buf.is_null() || byte_len < 2 {
        return 0;
    }
    let bytes = unsafe { std::slice::from_raw_parts(buf, byte_len & !1) };
    let out = if out_ptr.is_null() || out_cap == 0 {
        &mut [][..]
    } else {
        unsafe { std::slice::from_raw_parts_mut(out_ptr, out_cap) }
    };

    // UTF-16LE : le code unit 0x000A (\n) est représenté par les octets
    // 0x0A 0x00. On cherche 0x0A et on filtre : position paire + octet
    // haut à zéro. Ça exclut le cas où 0x0A apparaît comme octet haut
    // d'un autre caractère (U+0Axx).
    let mut count: usize = 0;
    for byte_pos in memchr_iter(0x0A, bytes) {
        if byte_pos & 1 != 0 {
            continue;
        }
        // SAFETY: byte_pos < bytes.len() et bytes.len() pair.
        let hi = unsafe { *bytes.get_unchecked(byte_pos + 1) };
        if hi != 0 {
            continue;
        }
        let u16_index = (byte_pos >> 1) as u32;
        if count < out.len() {
            out[count] = u16_index;
        }
        count += 1;
    }
    count
}

/// Sanity-check appelé par le wrapper TS au load pour vérifier que la
/// lib est chargeable et que l'ABI est la bonne.
#[unsafe(no_mangle)]
pub extern "C" fn node2bun_abi_version() -> u32 {
    2
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct ScanOptions {
    #[serde(default = "run::default_jobs")]
    jobs: usize,
    #[serde(default)]
    ignore: Vec<String>,
    #[serde(default)]
    mode: ScanMode,
    #[serde(default)]
    dry_run: bool,
}

#[derive(Default, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
enum ScanMode {
    #[default]
    Check,
    Fix,
    Aggressive,
}

impl From<ScanMode> for Mode {
    fn from(mode: ScanMode) -> Self {
        match mode {
            ScanMode::Check => Self::Check,
            ScanMode::Fix => Self::Fix,
            ScanMode::Aggressive => Self::Aggressive,
        }
    }
}

#[derive(serde::Serialize)]
#[serde(untagged)]
enum ScanResult {
    Success { ok: bool, report: serde_json::Value },
    Error { ok: bool, error: String },
}

/// Scan a project in check mode and return an owned JSON result.
///
/// Success has `{"ok":true,"report":<N2B JSON report>}`; failure has
/// `{"ok":false,"error":"..."}`. The caller releases the returned pointer
/// exactly once with [`node2bun_string_free`]. This function never edits the
/// project and never starts the `n2b` executable.
///
/// # Safety
/// `root_ptr` must be a null pointer or a valid NUL-terminated UTF-8 string.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn node2bun_scan_json(root_ptr: *const c_char) -> *mut c_char {
    unsafe { node2bun_scan_with_options_json(root_ptr, std::ptr::null()) }
}

/// Run the N2B core with JSON options: `ignore`, `mode`, `dry_run` and `jobs` (1–6).
/// `mode=fix` and `mode=aggressive` can write project files unless `dry_run=true`.
/// Both arguments must be null or valid NUL-terminated UTF-8 strings.
/// The result is owned by the caller and freed with `node2bun_string_free`.
///
/// # Safety
/// Both arguments must be null or valid NUL-terminated UTF-8 strings.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn node2bun_scan_with_options_json(
    root_ptr: *const c_char,
    options_ptr: *const c_char,
) -> *mut c_char {
    let outcome = std::panic::catch_unwind(|| {
        if root_ptr.is_null() {
            return Err("project root is null".to_string());
        }
        let root = unsafe { CStr::from_ptr(root_ptr) }
            .to_str()
            .map_err(|_| "project root is not UTF-8".to_string())?;
        let root = PathBuf::from(root);
        if !root.is_dir() {
            return Err(format!(
                "project root is not a directory: {}",
                root.display()
            ));
        }
        let options = if options_ptr.is_null() {
            ScanOptions {
                jobs: run::default_jobs(),
                ignore: Vec::new(),
                mode: ScanMode::Check,
                dry_run: true,
            }
        } else {
            let json = unsafe { CStr::from_ptr(options_ptr) }
                .to_str()
                .map_err(|_| "scan options are not UTF-8".to_string())?;
            serde_json::from_str::<ScanOptions>(json)
                .map_err(|error| format!("invalid scan options: {error}"))?
        };
        let opts = RunOptions {
            root,
            mode: options.mode.into(),
            report: Report::Json,
            quiet: true,
            ignore: options.ignore,
            agent: false,
            dry_run: options.dry_run,
        };
        let files = run::run_map_with_jobs(&opts, options.jobs, |fix| Ok(report::json_file(&fix)?))
            .map_err(|error| format!("{error:#}"))?;
        Ok(report::json_report(files, &opts))
    });

    let result = match outcome {
        Ok(Ok(report)) => ScanResult::Success { ok: true, report },
        Ok(Err(error)) => ScanResult::Error { ok: false, error },
        Err(_) => ScanResult::Error {
            ok: false,
            error: "N2B scan panicked".into(),
        },
    };
    serde_json::to_string(&result)
        .ok()
        .and_then(|json| CString::new(json).ok())
        .map(CString::into_raw)
        .unwrap_or(std::ptr::null_mut())
}

/// Release a string returned by [`node2bun_scan_json`].
///
/// # Safety
/// `ptr` must be null or the exact live pointer returned by
/// [`node2bun_scan_json`]. It must not be released twice.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn node2bun_string_free(ptr: *mut c_char) {
    if !ptr.is_null() {
        drop(unsafe { CString::from_raw(ptr) });
    }
}

#[cfg(test)]
mod scan_tests {
    use super::*;

    #[test]
    fn native_envelope_preserves_core_report_without_a_json_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("index.js"), "#!/usr/bin/env node\n").unwrap();
        let root = CString::new(dir.path().to_string_lossy().as_bytes()).unwrap();
        let opts = RunOptions {
            root: dir.path().into(),
            mode: Mode::Check,
            report: Report::Json,
            quiet: true,
            ignore: vec![],
            agent: false,
            dry_run: true,
        };
        let expected: serde_json::Value =
            serde_json::from_str(&report::render_json(&run::run(&opts).unwrap(), &opts)).unwrap();
        let pointer = unsafe { node2bun_scan_json(root.as_ptr()) };
        let actual: serde_json::Value =
            serde_json::from_str(unsafe { CStr::from_ptr(pointer) }.to_str().unwrap()).unwrap();
        unsafe { node2bun_string_free(pointer) };
        assert_eq!(
            actual,
            serde_json::json!({ "ok": true, "report": expected })
        );
    }

    #[test]
    fn jobs_option_is_bounded_and_invalid_source_is_an_error() {
        let dir = tempfile::tempdir().unwrap();
        let root = CString::new(dir.path().to_string_lossy().as_bytes()).unwrap();
        for jobs in [0, 7] {
            let options = CString::new(format!(r#"{{"jobs":{jobs}}}"#)).unwrap();
            let pointer =
                unsafe { node2bun_scan_with_options_json(root.as_ptr(), options.as_ptr()) };
            let json: serde_json::Value =
                serde_json::from_str(unsafe { CStr::from_ptr(pointer) }.to_str().unwrap()).unwrap();
            unsafe { node2bun_string_free(pointer) };
            assert_eq!(json["ok"], false);
            assert!(json["error"].as_str().unwrap().contains("jobs"));
        }
        std::fs::write(dir.path().join("bad.js"), [0xff]).unwrap();
        let options = CString::new(r#"{"jobs":1}"#).unwrap();
        let pointer = unsafe { node2bun_scan_with_options_json(root.as_ptr(), options.as_ptr()) };
        let json: serde_json::Value =
            serde_json::from_str(unsafe { CStr::from_ptr(pointer) }.to_str().unwrap()).unwrap();
        unsafe { node2bun_string_free(pointer) };
        assert_eq!(json["ok"], false);
        assert!(json["error"].as_str().unwrap().contains("bad.js"));
    }

    #[test]
    fn scan_json_reports_node_findings_without_editing_the_project() {
        let dir = tempfile::tempdir().expect("temporary project");
        let script = dir.path().join("index.js");
        let original = "#!/usr/bin/env node\nconsole.log('hello');\n";
        std::fs::write(&script, original).expect("write fixture");
        let root = CString::new(dir.path().to_string_lossy().as_bytes()).expect("root path");

        let pointer = unsafe { node2bun_scan_json(root.as_ptr()) };
        assert!(!pointer.is_null());
        let json: serde_json::Value =
            serde_json::from_str(unsafe { CStr::from_ptr(pointer) }.to_str().expect("UTF-8"))
                .expect("JSON");
        unsafe { node2bun_string_free(pointer) };

        assert_eq!(json["ok"], true);
        assert_eq!(json["report"]["schema_version"], 2);
        assert!(
            json["report"]["files"][0]["findings"]
                .as_array()
                .expect("findings array")
                .iter()
                .any(|finding| finding["rule_id"] == "shebang/node")
        );
        assert_eq!(
            std::fs::read_to_string(script).expect("read fixture"),
            original
        );
    }

    #[test]
    fn null_root_is_a_structured_error() {
        let pointer = unsafe { node2bun_scan_json(std::ptr::null()) };
        assert!(!pointer.is_null());
        let json: serde_json::Value =
            serde_json::from_str(unsafe { CStr::from_ptr(pointer) }.to_str().expect("UTF-8"))
                .expect("JSON");
        unsafe { node2bun_string_free(pointer) };
        assert_eq!(
            json,
            serde_json::json!({ "ok": false, "error": "project root is null" })
        );
    }

    #[test]
    fn options_apply_ignore_without_editing_project() {
        let dir = tempfile::tempdir().expect("temporary project");
        let script = dir.path().join("index.js");
        let original = "#!/usr/bin/env node\nconsole.log('hello');\n";
        std::fs::write(&script, original).expect("fixture");
        let root = CString::new(dir.path().to_string_lossy().as_bytes()).expect("root");
        let options = CString::new(r#"{"mode":"aggressive","ignore":["index.js"],"dry_run":true}"#)
            .expect("options");
        let pointer = unsafe { node2bun_scan_with_options_json(root.as_ptr(), options.as_ptr()) };
        let report: serde_json::Value =
            serde_json::from_str(unsafe { CStr::from_ptr(pointer) }.to_str().expect("UTF-8"))
                .expect("JSON");
        unsafe { node2bun_string_free(pointer) };
        assert_eq!(report["ok"], true);
        assert_eq!(report["report"]["findings_total"], 0);
        assert_eq!(
            std::fs::read_to_string(script).expect("read fixture"),
            original
        );
    }
}
