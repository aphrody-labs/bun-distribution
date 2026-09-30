// SPDX-License-Identifier: Apache-2.0

use std::fs;
use tempfile::tempdir;

use aphrody_git::ingest::{
    DEFAULT_IGNORE_PATTERNS, IngestOptions, estimate_tokens, format_token_count, ingest_path,
};

#[test]
fn test_token_estimation_and_formatting() {
    assert_eq!(estimate_tokens(""), 0);
    let sample = "hello world this is a test string";
    let tokens = estimate_tokens(sample);
    assert!(tokens > 0);

    assert_eq!(format_token_count(500), "500");
    assert_eq!(format_token_count(1500), "1.5k");
    assert_eq!(format_token_count(2_400_000), "2.4M");
}

#[test]
fn test_default_ignore_patterns_coverage() {
    assert!(DEFAULT_IGNORE_PATTERNS.contains(&".git"));
    assert!(DEFAULT_IGNORE_PATTERNS.contains(&"node_modules"));
    assert!(DEFAULT_IGNORE_PATTERNS.contains(&"target"));
    assert!(DEFAULT_IGNORE_PATTERNS.contains(&"*.pyc"));
    assert!(DEFAULT_IGNORE_PATTERNS.contains(&"Cargo.lock"));
}

#[test]
fn test_ingest_local_path() {
    let dir = tempdir().expect("create tempdir");
    let root = dir.path();

    // Create test files
    fs::write(root.join("README.md"), "# Project Test\nDescription here\n").expect("write readme");
    fs::create_dir_all(root.join("src")).expect("create src");
    fs::write(root.join("src/main.rs"), "fn main() {\n    println!(\"hello\");\n}\n")
        .expect("write main.rs");
    fs::write(root.join("src/lib.rs"), "pub fn add(a: i32, b: i32) -> i32 { a + b }\n")
        .expect("write lib.rs");

    // Ignored files
    fs::create_dir_all(root.join("target")).expect("create target");
    fs::write(root.join("target/dummy.o"), [0u8, 1, 2, 3]).expect("write target dummy");
    fs::write(root.join("test.png"), [0u8, 1, 2, 3]).expect("write binary");

    let options = IngestOptions::default();
    let result = ingest_path(root, &options).expect("ingest local path");

    assert_eq!(result.file_count, 3);
    assert!(result.summary.contains("Files analyzed: 3"));
    assert!(result.tree.contains("README.md"));
    assert!(result.tree.contains("src/"));
    assert!(result.tree.contains("main.rs"));
    assert!(result.tree.contains("lib.rs"));

    // Check delimiters and file content
    assert!(result.content.contains("FILE: README.md"));
    assert!(result.content.contains("FILE: src/main.rs"));
    assert!(result.content.contains("FILE: src/lib.rs"));
    assert!(result.content.contains("println!(\"hello\");"));

    // Excluded patterns should not be present
    assert!(!result.content.contains("dummy.o"));
    assert!(!result.content.contains("test.png"));

    // Full context
    let full = result.full_context();
    assert!(full.contains(&result.summary));
    assert!(full.contains(&result.tree));
    assert!(full.contains(&result.content));
}

#[test]
fn test_ingest_with_include_and_exclude_filters() {
    let dir = tempdir().expect("create tempdir");
    let root = dir.path();

    fs::write(root.join("README.md"), "# Title\n").unwrap();
    fs::write(root.join("script.py"), "print('py')\n").unwrap();
    fs::write(root.join("main.rs"), "fn main() {}\n").unwrap();

    let options =
        IngestOptions { include_patterns: vec!["*.rs".to_string()], ..IngestOptions::default() };

    let result = ingest_path(root, &options).expect("ingest filter");
    assert_eq!(result.file_count, 1);
    assert!(result.content.contains("FILE: main.rs"));
    assert!(!result.content.contains("script.py"));
}
