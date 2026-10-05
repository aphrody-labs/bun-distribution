// Copyright 2026 aphrody-code
// SPDX-License-Identifier: Apache-2.0
use aphrody_n2b_core::{
    scanners::source::scan_source,
    types::{Mode, Report, RunOptions},
};

fn options() -> RunOptions {
    RunOptions {
        root: ".".into(),
        mode: Mode::Aggressive,
        report: Report::Json,
        quiet: true,
        ignore: vec![],
        agent: false,
        dry_run: true,
    }
}

#[test]
fn comments_strings_templates_and_regexp_are_not_migrated() {
    let source = r#"
// Buffer.from(value, 'base64'); child_process.spawn('tool');
/* const bytes = fs.readFileSync('input'); */
const note = "Buffer.from(value, 'base64')";
const template = `Buffer.from(value, 'base64')`;
const pattern = /Buffer.from(value, 'base64')/;
Bun.spawn(['tool']);
"#;
    let (findings, after) = scan_source("example.ts", source, &options());
    assert!(findings.iter().all(|f| !f.rule_id.starts_with("api/")), "{findings:?}");
    assert_eq!(source, after);
}

#[test]
fn native_bun_and_local_or_shadowed_spawn_are_not_node_calls() {
    for source in [
        "import {spawn} from 'node:child_process'; Bun.spawn(['tool']);",
        "const spawn = () => {}; spawn();",
        "import {spawn} from 'node:child_process'; function f(spawn) { spawn(); }",
        "import * as cp from 'node:child_process'; function f(cp) { cp.spawn(); }",
    ] {
        let (findings, _) = scan_source("example.ts", source, &options());
        assert!(
            findings.iter().all(|f| f.rule_id != "api/child-process-spawn"),
            "{source}: {findings:?}"
        );
    }
}

#[test]
fn node_spawn_named_alias_namespace_and_commonjs_calls_are_detected() {
    for source in [
        "import {spawn} from 'node:child_process'; spawn('tool');",
        "import {spawn as launch} from 'node:child_process'; launch('tool');",
        "import * as cp from 'node:child_process'; cp.spawn('tool');",
        "const cp = require('node:child_process'); cp.spawn('tool');",
        "const {spawn} = require('node:child_process'); spawn('tool');",
    ] {
        let (findings, _) = scan_source("example.ts", source, &options());
        assert_eq!(
            findings.iter().filter(|f| f.rule_id == "api/child-process-spawn").count(),
            1,
            "{source}: {findings:?}"
        );
    }
}

#[test]
fn template_interpolation_is_executable_but_template_text_is_not() {
    let source = "import {spawn as launch} from 'node:child_process'; const s = `spawn('text') ${launch('tool')}`;";
    let (findings, _) = scan_source("example.ts", source, &options());
    let spawn =
        findings.iter().filter(|f| f.rule_id == "api/child-process-spawn").collect::<Vec<_>>();
    assert_eq!(spawn.len(), 1);
    assert_eq!(spawn[0].original, "launch(");
}

#[test]
fn real_api_with_string_arguments_is_still_detected() {
    let source = "const decoded = Buffer.from(value, 'base64');";
    let (findings, _) = scan_source("example.ts", source, &options());
    assert!(findings.iter().any(|f| f.rule_id == "api/buffer-from-base64"));
}
