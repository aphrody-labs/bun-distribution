// SPDX-License-Identifier: Apache-2.0
//! Integration test over the `tests/fixtures/malformed_calls/` corpus: at
//! least 40 realistic malformed tool-call outputs, each recovered through
//! [`extract_any`] and checked against a sibling `.expected.json`.

use std::{fs, path::PathBuf};

use serde::Deserialize;
use serde_json::Value;

use super::*;

#[derive(Debug, Deserialize)]
struct ExpectedCall {
    name: String,
    arguments: Value,
}

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/malformed_calls")
}

#[test]
fn malformed_call_fixtures_recover_at_least_90_percent() {
    let dir = fixtures_dir();
    let mut txt_files: Vec<PathBuf> = fs::read_dir(&dir)
        .unwrap_or_else(|err| panic!("reading fixtures dir {}: {err}", dir.display()))
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().and_then(|e| e.to_str()) == Some("txt"))
        .collect();
    txt_files.sort();

    assert!(
        txt_files.len() >= 40,
        "expected at least 40 malformed-call fixtures, found {}",
        txt_files.len()
    );

    let mut failures = Vec::new();
    for txt_path in &txt_files {
        let expected_path = txt_path.with_extension("expected.json");
        let input = fs::read_to_string(txt_path)
            .unwrap_or_else(|err| panic!("reading {}: {err}", txt_path.display()));
        let expected_text = fs::read_to_string(&expected_path)
            .unwrap_or_else(|err| panic!("reading {}: {err}", expected_path.display()));
        let expected: Vec<ExpectedCall> = serde_json::from_str(&expected_text)
            .unwrap_or_else(|err| panic!("parsing {}: {err}", expected_path.display()));

        let recovered = extract_any(&input);
        let matches = recovered.len() == expected.len()
            && recovered
                .iter()
                .zip(expected.iter())
                .all(|(got, want)| got.name == want.name && got.arguments == want.arguments);

        if !matches {
            let want_debug: Vec<(&str, String)> = expected
                .iter()
                .map(|c| (c.name.as_str(), c.arguments.to_string()))
                .collect();
            let got_debug: Vec<(&str, String)> = recovered
                .iter()
                .map(|c| (c.name.as_str(), c.arguments.to_string()))
                .collect();
            failures.push(format!(
                "{}: expected {want_debug:?}, got {got_debug:?}",
                txt_path.file_name().unwrap().to_string_lossy(),
            ));
        }
    }

    let total = txt_files.len();
    let recovered_count = total - failures.len();
    #[allow(clippy::cast_precision_loss)]
    let rate = recovered_count as f64 / total as f64;
    eprintln!(
        "malformed_calls recovery: {recovered_count}/{total} ({:.1}%)",
        rate * 100.0
    );

    if !failures.is_empty() {
        eprintln!(
            "--- malformed_calls recovery failures ({}/{total}) ---",
            failures.len()
        );
        for failure in &failures {
            eprintln!("{failure}");
        }
    }

    assert!(
        rate >= 0.90,
        "recovered {recovered_count}/{total} ({:.1}%), need >= 90%",
        rate * 100.0
    );
}
