// SPDX-License-Identifier: Apache-2.0
use std::collections::HashMap;

use aphrody_patch::{Hunk, parse_patch};
use pretty_assertions::assert_eq;

use super::*;

fn no_files(_path: &str) -> Option<String> {
    None
}

fn reader<'a>(map: &'a HashMap<&str, &str>) -> impl Fn(&str) -> Option<String> + 'a {
    move |path: &str| map.get(path).map(|s| (*s).to_string())
}

// ---------------------------------------------------------------------------
// detect_patch_format
// ---------------------------------------------------------------------------

#[test]
fn detects_codex_patch() {
    let text = "*** Begin Patch\n*** Add File: a.txt\n+hi\n*** End Patch";
    assert_eq!(detect_patch_format(text), Some(PatchFormat::CodexPatch));
}

#[test]
fn detects_unified_diff() {
    let text = "--- a/foo.rs\n+++ b/foo.rs\n@@ -1,1 +1,1 @@\n-old\n+new\n";
    assert_eq!(detect_patch_format(text), Some(PatchFormat::UnifiedDiff));
}

#[test]
fn detects_search_replace() {
    let text = "foo.py\n<<<<<<< SEARCH\nold\n=======\nnew\n>>>>>>> REPLACE\n";
    assert_eq!(detect_patch_format(text), Some(PatchFormat::SearchReplace));
}

#[test]
fn detects_whole_file() {
    let text = "src/lib.rs\n```rust\nfn main() {}\n```\n";
    assert_eq!(detect_patch_format(text), Some(PatchFormat::WholeFile));
}

#[test]
fn detects_none_for_plain_prose() {
    assert_eq!(
        detect_patch_format("I made the change you asked for."),
        None
    );
}

// ---------------------------------------------------------------------------
// Unified diff -> Codex patch
// ---------------------------------------------------------------------------

#[test]
fn unified_diff_update_round_trips() {
    let diff = concat!(
        "diff --git a/src/lib.rs b/src/lib.rs\n",
        "index 123..456 100644\n",
        "--- a/src/lib.rs\n",
        "+++ b/src/lib.rs\n",
        "@@ -1,3 +1,3 @@\n",
        " fn main() {\n",
        "-    old();\n",
        "+    new();\n",
        " }\n",
    );
    let codex = normalize_to_codex_patch(diff, &no_files).unwrap();
    let parsed = parse_patch(&codex).unwrap();
    assert_eq!(parsed.hunks.len(), 1);
    match &parsed.hunks[0] {
        Hunk::UpdateFile { path, chunks, .. } => {
            assert_eq!(path.to_str().unwrap(), "src/lib.rs");
            assert_eq!(chunks[0].old_lines, vec!["fn main() {", "    old();", "}"]);
            assert_eq!(chunks[0].new_lines, vec!["fn main() {", "    new();", "}"]);
        }
        other => panic!("expected UpdateFile, got {other:?}"),
    }
}

#[test]
fn unified_diff_new_file() {
    let diff = "--- /dev/null\n+++ b/new.txt\n@@ -0,0 +1,2 @@\n+line one\n+line two\n";
    let codex = normalize_to_codex_patch(diff, &no_files).unwrap();
    let parsed = parse_patch(&codex).unwrap();
    assert_eq!(
        parsed.hunks,
        vec![Hunk::AddFile {
            path: "new.txt".into(),
            contents: "line one\nline two\n".to_string(),
        }]
    );
}

#[test]
fn unified_diff_delete_file() {
    let diff = "--- a/gone.txt\n+++ /dev/null\n@@ -1,1 +0,0 @@\n-bye\n";
    let codex = normalize_to_codex_patch(diff, &no_files).unwrap();
    let parsed = parse_patch(&codex).unwrap();
    assert_eq!(
        parsed.hunks,
        vec![Hunk::DeleteFile {
            path: "gone.txt".into()
        }]
    );
}

#[test]
fn unified_diff_multi_file() {
    let diff = "--- a/one.txt\n+++ b/one.txt\n@@ -1,1 +1,1 @@\n-a\n+A\n--- a/two.txt\n+++ \
                b/two.txt\n@@ -1,1 +1,1 @@\n-b\n+B\n";
    let codex = normalize_to_codex_patch(diff, &no_files).unwrap();
    let parsed = parse_patch(&codex).unwrap();
    assert_eq!(parsed.hunks.len(), 2);
}

#[test]
fn unified_diff_crlf_source_is_normalised() {
    let diff = "--- a/win.txt\r\n+++ b/win.txt\r\n@@ -1,1 +1,1 @@\r\n-old line\r\n+new line\r\n";
    let codex = normalize_to_codex_patch(diff, &no_files).unwrap();
    assert!(!codex.contains('\r'));
    let parsed = parse_patch(&codex).unwrap();
    match &parsed.hunks[0] {
        Hunk::UpdateFile { chunks, .. } => {
            assert_eq!(chunks[0].old_lines, vec!["old line"]);
            assert_eq!(chunks[0].new_lines, vec!["new line"]);
        }
        other => panic!("expected UpdateFile, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// SEARCH/REPLACE -> Codex patch
// ---------------------------------------------------------------------------

#[test]
fn search_replace_new_file() {
    let text =
        "```\nnotes/todo.md\n<<<<<<< SEARCH\n=======\n- [ ] write tests\n>>>>>>> REPLACE\n```";
    let codex = normalize_to_codex_patch(text, &no_files).unwrap();
    let parsed = parse_patch(&codex).unwrap();
    assert_eq!(
        parsed.hunks,
        vec![Hunk::AddFile {
            path: "notes/todo.md".into(),
            contents: "- [ ] write tests\n".to_string(),
        }]
    );
}

#[test]
fn search_replace_update_existing_file() {
    let files = HashMap::from([("src/lib.rs", "fn main() {\n    old();\n}\n")]);
    let text = "src/lib.rs\n<<<<<<< SEARCH\n    old();\n=======\n    new();\n>>>>>>> REPLACE\n";
    let codex = normalize_to_codex_patch(text, &reader(&files)).unwrap();
    let parsed = parse_patch(&codex).unwrap();
    match &parsed.hunks[0] {
        Hunk::UpdateFile { chunks, .. } => {
            assert_eq!(chunks[0].old_lines, vec!["    old();"]);
            assert_eq!(chunks[0].new_lines, vec!["    new();"]);
        }
        other => panic!("expected UpdateFile, got {other:?}"),
    }
}

#[test]
fn search_replace_multiple_blocks_same_file() {
    let files = HashMap::from([("m.txt", "1\n2\n3\n")]);
    let text = "m.txt\n<<<<<<< SEARCH\n1\n=======\nONE\n>>>>>>> REPLACE\nm.txt\n<<<<<<< \
                SEARCH\n3\n=======\nTHREE\n>>>>>>> REPLACE\n";
    let codex = normalize_to_codex_patch(text, &reader(&files)).unwrap();
    let parsed = parse_patch(&codex).unwrap();
    match &parsed.hunks[0] {
        Hunk::UpdateFile { chunks, .. } => assert_eq!(chunks.len(), 2),
        other => panic!("expected UpdateFile, got {other:?}"),
    }
}

// ---------------------------------------------------------------------------
// Whole-file -> Codex patch
// ---------------------------------------------------------------------------

#[test]
fn whole_file_new_file() {
    let text = "src/main.rs\n```rust\nfn main() {\n    println!(\"hi\");\n}\n```\n";
    let codex = normalize_to_codex_patch(text, &no_files).unwrap();
    let parsed = parse_patch(&codex).unwrap();
    assert_eq!(
        parsed.hunks,
        vec![Hunk::AddFile {
            path: "src/main.rs".into(),
            contents: "fn main() {\n    println!(\"hi\");\n}\n".to_string(),
        }]
    );
}

#[test]
fn whole_file_update_existing_file() {
    let files = HashMap::from([("src/main.rs", "fn main() {}\n")]);
    let text = "src/main.rs\n```rust\nfn main() {\n    println!(\"hi\");\n}\n```\n";
    let codex = normalize_to_codex_patch(text, &reader(&files)).unwrap();
    let parsed = parse_patch(&codex).unwrap();
    match &parsed.hunks[0] {
        Hunk::UpdateFile { chunks, .. } => {
            assert_eq!(chunks[0].old_lines, vec!["fn main() {}"]);
            assert_eq!(
                chunks[0].new_lines,
                vec!["fn main() {", "    println!(\"hi\");", "}"]
            );
        }
        other => panic!("expected UpdateFile, got {other:?}"),
    }
}

#[test]
fn codex_patch_passes_through_unchanged() {
    let text = "*** Begin Patch\n*** Add File: a.txt\n+hi\n*** End Patch";
    let codex = normalize_to_codex_patch(text, &no_files).unwrap();
    assert_eq!(codex, text);
    parse_patch(&codex).unwrap();
}

#[test]
fn unknown_format_errors() {
    let err = normalize_to_codex_patch("just some prose", &no_files).unwrap_err();
    assert!(matches!(err, PatchNormalizeError::UnknownFormat));
}
