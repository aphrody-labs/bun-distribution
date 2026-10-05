// Copyright 2026 aphrody-code
// SPDX-License-Identifier: Apache-2.0

use aphrody_n2b_core::{
    report,
    run::{default_jobs, run_map_with_jobs, run_with_jobs},
    types::{Mode, Report, RunOptions},
};
use std::path::Path;

fn options(root: &Path) -> RunOptions {
    RunOptions {
        root: root.into(),
        mode: Mode::Check,
        report: Report::Json,
        quiet: true,
        ignore: vec![],
        agent: false,
        dry_run: true,
    }
}

#[test]
fn bounded_walk_drains_more_results_than_queue_capacity_in_sorted_order() {
    let dir = tempfile::tempdir().unwrap();
    for index in 0..40 {
        std::fs::write(dir.path().join(format!("{index:02}.js")), "#!/usr/bin/env node\n").unwrap();
    }
    let fixes = run_with_jobs(&options(dir.path()), 1).unwrap();
    assert_eq!(fixes.len(), 40);
    assert_eq!(fixes.first().unwrap().file, "00.js");
    assert_eq!(fixes.last().unwrap().file, "39.js");
    let parallel = run_with_jobs(&options(dir.path()), 6).unwrap();
    assert_eq!(
        fixes.iter().map(|f| &f.file).collect::<Vec<_>>(),
        parallel.iter().map(|f| &f.file).collect::<Vec<_>>()
    );
}

#[test]
fn ignored_directories_are_pruned_including_custom_patterns() {
    let dir = tempfile::tempdir().unwrap();
    for folder in ["node_modules", "nested/target", "private/generated"] {
        let nested = dir.path().join(folder);
        std::fs::create_dir_all(&nested).unwrap();
        // Invalid UTF-8 must cause a read error if the excluded path is visited.
        std::fs::write(nested.join("bad.js"), [0xff]).unwrap();
    }
    std::fs::write(dir.path().join("ok.js"), "#!/usr/bin/env node\n").unwrap();
    let mut opts = options(dir.path());
    opts.ignore.push("private/**".into());
    let fixes = run_with_jobs(&opts, 2).unwrap();
    assert_eq!(fixes.len(), 1);
    assert_eq!(fixes[0].file, "ok.js");
}

#[test]
fn invalid_jobs_and_missing_root_are_errors() {
    let dir = tempfile::tempdir().unwrap();
    for jobs in [0, 7, usize::MAX] {
        assert!(
            run_with_jobs(&options(dir.path()), jobs).unwrap_err().to_string().contains("jobs")
        );
    }
    assert!((1..=6).contains(&default_jobs()));
    assert!(run_with_jobs(&options(&dir.path().join("missing")), 1).is_err());
}

#[test]
fn invalid_source_is_reported_instead_of_successful_empty_report() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("bad.js"), [0xff]).unwrap();
    let error = run_with_jobs(&options(dir.path()), 2).unwrap_err();
    assert!(format!("{error:#}").contains("bad.js"));
    assert!(format!("{error:#}").contains("UTF-8"));
}

#[test]
fn disabled_rule_prevents_all_edits_in_mixed_file_before_writing() {
    for override_value in [r#""off""#, r#"{"autofix":false}"#] {
        let dir = tempfile::tempdir().unwrap();
        let source = "#!/usr/bin/env node\nimport fs from 'fs';\n";
        let path = dir.path().join("index.js");
        std::fs::write(&path, source).unwrap();
        std::fs::write(
            dir.path().join("n2b.json"),
            format!(r#"{{"rules":{{"shebang/node":{override_value}}}}}"#),
        )
        .unwrap();
        let mut opts = options(dir.path());
        opts.mode = Mode::Fix;
        opts.dry_run = false;
        let fixes = run_with_jobs(&opts, 2).unwrap();
        assert_eq!(std::fs::read_to_string(path).unwrap(), source);
        let fix = fixes.iter().find(|fix| fix.file == "index.js").unwrap();
        assert_eq!(fix.before, fix.after);
        assert!(fix.findings.iter().any(|f| f.rule_id.starts_with("imports/")));
    }
}

#[test]
fn ordinary_fix_and_dry_run_keep_their_existing_behavior() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("index.js");
    let original = "#!/usr/bin/env node\n";
    std::fs::write(&path, original).unwrap();
    let mut opts = options(dir.path());
    opts.mode = Mode::Fix;
    let preview = run_with_jobs(&opts, 1).unwrap();
    assert_ne!(preview[0].before, preview[0].after);
    assert_eq!(std::fs::read_to_string(&path).unwrap(), original);
    opts.dry_run = false;
    run_with_jobs(&opts, 1).unwrap();
    assert_eq!(std::fs::read_to_string(path).unwrap(), "#!/usr/bin/env bun\n");
}

#[test]
fn mapped_json_has_exact_parity_for_check_fix_and_dry_run() {
    let dir = tempfile::tempdir().unwrap();
    let sources = [("a.js", "#!/usr/bin/env node\n"), ("b.ts", "import fs from 'fs';\n")];
    std::fs::write(dir.path().join("clean.ts"), "const ok = true;\n").unwrap();
    for (mode, dry_run) in [(Mode::Check, true), (Mode::Fix, false), (Mode::Aggressive, true)] {
        let mut opts = options(dir.path());
        opts.mode = mode;
        opts.dry_run = dry_run;
        for (path, source) in sources {
            std::fs::write(dir.path().join(path), source).unwrap();
        }
        let fixes = run_with_jobs(&opts, 1).unwrap();
        let expected: serde_json::Value =
            serde_json::from_str(&report::render_json(&fixes, &opts)).unwrap();
        for (path, source) in sources {
            std::fs::write(dir.path().join(path), source).unwrap();
        }
        let files = run_map_with_jobs(&opts, 3, |fix| Ok(report::json_file(&fix)?)).unwrap();
        let actual = report::json_report(files, &opts);
        assert_eq!(actual, expected);
        assert_eq!(actual["files_scanned"], 2);
        assert_eq!(actual["files"][0]["path"], "a.js");
    }
}

#[test]
fn projection_keeps_only_selected_results_and_propagates_callback_errors() {
    let dir = tempfile::tempdir().unwrap();
    let original = format!("#!/usr/bin/env node\n{}", "// source context\n".repeat(8192));
    for index in 0..20 {
        std::fs::write(dir.path().join(format!("{index:02}.js")), &original).unwrap();
    }
    let lengths = run_map_with_jobs(&options(dir.path()), 2, |fix| Ok(fix.before.len())).unwrap();
    assert_eq!(lengths, vec![original.len(); 20]);
    let error =
        run_map_with_jobs::<(), _>(&options(dir.path()), 1, |_| anyhow::bail!("projection failed"))
            .unwrap_err();
    assert!(format!("{error:#}").contains("projection failed"));
    // An ordinary error leaves the lease reusable (only panics poison it).
    assert_eq!(run_map_with_jobs(&options(dir.path()), 1, |_| Ok(())).unwrap().len(), 20);
}

#[test]
fn n2b_waits_for_the_shared_yolo_scan_owner() {
    use std::sync::mpsc;
    use std::time::Duration;

    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join("index.js"), "#!/usr/bin/env node\n").unwrap();
    let opts = options(dir.path());
    let lease = aphrody_n2b_core::util::resources::acquire_scan_lease(1).unwrap();
    let (ready_tx, ready_rx) = mpsc::channel();
    let (done_tx, done_rx) = mpsc::channel();
    let scan = std::thread::spawn(move || {
        ready_tx.send(()).unwrap();
        let result = run_with_jobs(&opts, 2);
        done_tx.send(result).unwrap();
    });
    ready_rx.recv_timeout(Duration::from_secs(5)).unwrap();
    let blocked = done_rx.recv_timeout(Duration::from_millis(100));
    // Release before asserting, so a failing test cannot leave a blocked worker.
    drop(lease);
    assert!(matches!(blocked, Err(mpsc::RecvTimeoutError::Timeout)));
    let fixes = done_rx.recv_timeout(Duration::from_secs(5)).unwrap().unwrap();
    assert_eq!(fixes.len(), 1);
    assert_eq!(fixes[0].file, "index.js");
    scan.join().unwrap();
}
