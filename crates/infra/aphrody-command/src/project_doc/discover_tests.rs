// SPDX-License-Identifier: Apache-2.0
use std::fs;

use pretty_assertions::assert_eq;

use super::*;
use crate::project_doc::{ProjectDoc, ProjectDocOptions, Scope, SkipReason};

fn write(path: &Path, content: &str) {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).expect("create parent dirs");
    }
    fs::write(path, content).expect("write fixture file");
}

fn options() -> ProjectDocOptions {
    ProjectDocOptions::default()
}

#[test]
fn root_agents_md_plus_override_precedence_in_order() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    write(&root.join(".git"), "gitdir marker");
    write(&root.join("AGENTS.md"), "root instructions");
    write(&root.join("a/AGENTS.override.md"), "a override");
    write(&root.join("a/AGENTS.md"), "a generic (must be ignored)");
    fs::create_dir_all(root.join("a/b")).expect("mkdir a/b");

    let cwd = root.join("a/b");
    let doc = discover(&cwd, &options()).expect("discover");

    assert_eq!(doc.parts.len(), 2);
    assert_eq!(doc.parts[0].content, "root instructions");
    assert_eq!(doc.parts[0].scope, Scope::Project);
    assert_eq!(doc.parts[1].content, "a override");
    assert!(!doc.truncated);
}

#[test]
fn git_marker_may_be_a_file_worktree() {
    let dir = tempfile::tempdir().expect("tempdir");
    let root = dir.path();
    // A git worktree's `.git` is a regular file containing `gitdir: ...`.
    write(&root.join(".git"), "gitdir: /somewhere/else/.git/worktrees/x\n");
    write(&root.join("AGENTS.md"), "worktree root instructions");

    let doc = discover(root, &options()).expect("discover");
    assert_eq!(doc.parts.len(), 1);
    assert_eq!(doc.parts[0].content, "worktree root instructions");
}

#[test]
fn no_git_root_considers_only_cwd() {
    let dir = tempfile::tempdir().expect("tempdir");
    // No `.git` anywhere under `dir`, so `sub2` is its own root and `sub1`'s
    // AGENTS.md (a sibling ancestor, not an ancestor-of-self, but present in
    // the tree) must not be picked up.
    write(&dir.path().join("sub1/AGENTS.md"), "must not appear");
    write(&dir.path().join("sub1/sub2/AGENTS.md"), "must appear");

    let cwd = dir.path().join("sub1/sub2");
    let doc = discover(&cwd, &options()).expect("discover");

    assert_eq!(doc.parts.len(), 1);
    assert_eq!(doc.parts[0].content, "must appear");
}

#[test]
fn fallback_filename_used_when_agents_md_absent() {
    let dir = tempfile::tempdir().expect("tempdir");
    write(&dir.path().join(".git"), "marker");
    write(&dir.path().join("CONVENTIONS.md"), "convention instructions");

    let opts = ProjectDocOptions {
        fallback_filenames: vec!["CONVENTIONS.md".to_string()],
        ..ProjectDocOptions::default()
    };
    let doc = discover(dir.path(), &opts).expect("discover");
    assert_eq!(doc.parts.len(), 1);
    assert_eq!(doc.parts[0].content, "convention instructions");
}

#[test]
fn budget_truncates_on_a_multi_byte_char_boundary() {
    let dir = tempfile::tempdir().expect("tempdir");
    write(&dir.path().join(".git"), "marker");
    // "café" = 5 bytes ('c','a','f' = 1 byte each, 'é' = 2 bytes). A budget
    // of 4 lands exactly inside the 2-byte 'é', so the boundary search must
    // back off to 3.
    write(&dir.path().join("AGENTS.md"), "café");

    let opts = ProjectDocOptions { max_bytes: 4, ..ProjectDocOptions::default() };
    let doc = discover(dir.path(), &opts).expect("discover");
    assert_eq!(doc.parts.len(), 1);
    assert_eq!(doc.parts[0].content, "caf");
    assert!(doc.parts[0].truncated);
    assert!(doc.truncated);
    // The result must always be valid UTF-8 (guaranteed by the type, but
    // assert the byte length explicitly to document the boundary choice).
    assert_eq!(doc.parts[0].content.len(), 3);
}

#[test]
fn zero_budget_disables_project_docs_entirely() {
    let dir = tempfile::tempdir().expect("tempdir");
    write(&dir.path().join(".git"), "marker");
    write(&dir.path().join("AGENTS.md"), "should never be read");

    let opts = ProjectDocOptions { max_bytes: 0, ..ProjectDocOptions::default() };
    let doc = discover(dir.path(), &opts).expect("discover");
    assert_eq!(doc, ProjectDoc::default());
}

#[test]
fn global_override_beats_global_default() {
    let global_dir = tempfile::tempdir().expect("tempdir");
    write(&global_dir.path().join("AGENTS.md"), "global default");
    write(&global_dir.path().join("AGENTS.override.md"), "global override");

    let project_dir = tempfile::tempdir().expect("tempdir");
    write(&project_dir.path().join(".git"), "marker");

    let opts = ProjectDocOptions {
        global_dir: Some(global_dir.path().to_path_buf()),
        ..ProjectDocOptions::default()
    };
    let doc = discover(project_dir.path(), &opts).expect("discover");
    assert_eq!(doc.parts.len(), 1);
    assert_eq!(doc.parts[0].scope, Scope::Global);
    assert_eq!(doc.parts[0].content, "global override");
}

#[test]
fn crlf_content_is_preserved_verbatim() {
    let dir = tempfile::tempdir().expect("tempdir");
    write(&dir.path().join(".git"), "marker");
    write(&dir.path().join("AGENTS.md"), "line one\r\nline two\r\n");

    let doc = discover(dir.path(), &options()).expect("discover");
    assert_eq!(doc.parts.len(), 1);
    assert_eq!(doc.parts[0].content, "line one\r\nline two");
}

#[test]
fn directory_named_agents_md_is_ignored_not_fatal() {
    let dir = tempfile::tempdir().expect("tempdir");
    write(&dir.path().join(".git"), "marker");
    fs::create_dir_all(dir.path().join("AGENTS.md")).expect("mkdir AGENTS.md");
    write(&dir.path().join("NOTES.md"), "fallback notes");

    let opts = ProjectDocOptions {
        fallback_filenames: vec!["NOTES.md".to_string()],
        ..ProjectDocOptions::default()
    };
    let doc = discover(dir.path(), &opts).expect("discover");

    assert_eq!(doc.parts.len(), 1);
    assert_eq!(doc.parts[0].content, "fallback notes");
    assert!(
        doc.skipped
            .iter()
            .any(|(path, reason)| path.ends_with("AGENTS.md") && *reason == SkipReason::NotAFile)
    );
}

#[test]
fn empty_file_is_skipped_with_reason() {
    let dir = tempfile::tempdir().expect("tempdir");
    write(&dir.path().join(".git"), "marker");
    write(&dir.path().join("AGENTS.md"), "   \n\t  ");

    let doc = discover(dir.path(), &options()).expect("discover");
    assert!(doc.parts.is_empty());
    assert!(
        doc.skipped
            .iter()
            .any(|(path, reason)| path.ends_with("AGENTS.md") && *reason == SkipReason::Empty)
    );
}

#[test]
fn non_utf8_file_is_skipped_with_reason_not_lossy_decoded() {
    let dir = tempfile::tempdir().expect("tempdir");
    write(&dir.path().join(".git"), "marker");
    fs::write(dir.path().join("AGENTS.md"), [0xFF, 0xFE, 0x00, 0x00]).expect("write invalid utf8");

    let doc = discover(dir.path(), &options()).expect("discover");
    assert!(doc.parts.is_empty());
    assert!(
        doc.skipped
            .iter()
            .any(|(path, reason)| path.ends_with("AGENTS.md") && *reason == SkipReason::NotUtf8)
    );
}

#[test]
fn budget_exhausted_drops_a_later_part_entirely_and_is_reported() {
    let dir = tempfile::tempdir().expect("tempdir");
    write(&dir.path().join(".git"), "marker");
    write(&dir.path().join("AGENTS.md"), "0123456789");
    write(&dir.path().join("a/AGENTS.md"), "this should be dropped");
    fs::create_dir_all(dir.path().join("a")).expect("mkdir a");

    let opts = ProjectDocOptions { max_bytes: 10, ..ProjectDocOptions::default() };
    let doc = discover(&dir.path().join("a"), &opts).expect("discover");
    assert_eq!(doc.parts.len(), 1);
    assert_eq!(doc.parts[0].content, "0123456789");
    assert!(doc.truncated);
    assert!(doc.skipped.iter().any(|(path, reason)| path.ends_with("a/AGENTS.md")
        || matches!(reason, SkipReason::BudgetExhausted)));
}

#[test]
fn render_inserts_separator_only_between_global_and_first_project_part() {
    let global_dir = tempfile::tempdir().expect("tempdir");
    write(&global_dir.path().join("AGENTS.md"), "global text");

    let project_dir = tempfile::tempdir().expect("tempdir");
    write(&project_dir.path().join(".git"), "marker");
    write(&project_dir.path().join("AGENTS.md"), "root text");
    write(&project_dir.path().join("a/AGENTS.md"), "a text");

    let opts = ProjectDocOptions {
        global_dir: Some(global_dir.path().to_path_buf()),
        ..ProjectDocOptions::default()
    };
    let doc = discover(&project_dir.path().join("a"), &opts).expect("discover");
    let rendered = doc.render();
    assert_eq!(rendered, format!("global text{AGENTS_MD_SEPARATOR}root text\n\na text"));
}
