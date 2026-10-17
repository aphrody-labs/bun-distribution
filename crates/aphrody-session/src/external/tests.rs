// SPDX-License-Identifier: Apache-2.0
//! Fixture-driven tests: one temporary home holding an Antigravity CLI, a
//! Codex and a Claude Code tree in their real layouts, synced into a
//! temporary output directory.

use std::{
    ffi::OsString,
    fs::{self, OpenOptions},
    io::Write,
    path::{Path, PathBuf},
};

use serde_json::json;

use super::{
    AgentKind, AgentRoots, ExternalRecord, Role, STATE_FILE_NAME, SyncOptions, SyncState,
    classify_process,
    common::{file_uri_to_path, normalize_workspace, truncate_text},
    sync,
    sync::{mirror_abs, mirror_rel, source_key},
    sync_with,
};

const AGY_ID: &str = "f1a94f76-83ad-4a8f-939b-fa33ac87c6fc";
const CODEX_ID: &str = "01a0d73e-4519-7791-a2aa-0c655564e426";
const CLAUDE_ID: &str = "ed8309d2-204b-4875-8ed2-db456db2c1a2";

struct Fixture {
    _dir: tempfile::TempDir,
    home: PathBuf,
    out: PathBuf,
    workspace: String,
}

impl Fixture {
    fn new() -> Self {
        let dir = tempfile::tempdir().expect("tempdir");
        let home = dir.path().join("home");
        let out = dir.path().join("aphrody").join("sessions");
        let workspace = dir.path().join("work").join("repo").display().to_string();
        let fixture = Self {
            _dir: dir,
            home,
            out,
            workspace,
        };
        fixture.write_agy();
        fixture.write_codex();
        fixture.write_claude();
        fixture
    }

    fn roots(&self) -> AgentRoots {
        AgentRoots::from_home(&self.home)
    }

    fn options(&self) -> SyncOptions {
        SyncOptions::new(self.roots(), &self.out)
    }

    fn agy_transcript(&self) -> PathBuf {
        super::agy::transcript_path(&self.roots().agy, AGY_ID)
    }

    fn codex_rollout(&self) -> PathBuf {
        self.roots()
            .codex
            .join("sessions")
            .join("2026")
            .join("09")
            .join("25")
            .join(format!("rollout-2026-09-25T08-26-17-{CODEX_ID}.jsonl"))
    }

    fn claude_transcript(&self) -> PathBuf {
        self.roots()
            .claude
            .join("projects")
            .join("C--work-repo")
            .join(format!("{CLAUDE_ID}.jsonl"))
    }

    fn mirror(&self, agent: AgentKind, id: &str) -> PathBuf {
        mirror_abs(&self.out, &mirror_rel(agent, id))
    }

    fn write_agy(&self) {
        let root = self.roots().agy;
        write(
            &root.join("cache").join("last_conversations.json"),
            &json!({ self.workspace.clone(): AGY_ID }).to_string(),
        );
        write(
            &root.join("cache").join("conversation_metadata.json"),
            &json!({ "conversations": { AGY_ID: { "summary": {
                "ID": AGY_ID, "Title": "Explore the docs",
                "WorkspaceURIs": ["file:///c%3A/elsewhere"] } } } })
            .to_string(),
        );
        write_lines(
            &self.agy_transcript(),
            &[
                json!({"step_index": 0, "source": "USER_EXPLICIT", "type": "USER_INPUT",
                   "status": "DONE", "created_at": "2026-09-25T03:37:29Z",
                   "content": "explore the docs"}),
                json!({"step_index": 1, "source": "MODEL", "type": "PLANNER_RESPONSE",
                   "status": "DONE", "created_at": "2026-09-25T03:37:30Z",
                   "thinking": "Listing the repositories first.",
                   "tool_calls": [{"name": "run_command",
                                   "args": {"CommandLine": "\"ls\"", "Cwd": "\"C:\\\\src\""}}]}),
                json!({"step_index": 2, "source": "MODEL", "type": "GENERIC", "status": "DONE",
                   "created_at": "2026-09-25T03:37:33Z",
                   "content": "The command exited with code 0.\nOutput: aphrody"}),
                json!({"step_index": 3, "source": "SYSTEM", "type": "CHECKPOINT", "status": "DONE",
                   "created_at": "2026-09-25T03:40:00Z", "content": "# Resuming from a compaction"}),
            ],
        );
    }

    fn write_codex(&self) {
        let root = self.roots().codex;
        write(
            &root.join("session_index.jsonl"),
            &format!(
                "{}\n{}\n",
                json!({"id": CODEX_ID, "thread_name": "old name", "updated_at": "2026-09-25T06:00:00Z"}),
                json!({"id": CODEX_ID, "thread_name": "Redesign plan", "updated_at": "2026-09-25T06:30:00Z"}),
            ),
        );
        // An archived rollout must never be read (it would duplicate lines).
        write(
            &root
                .join("archived_sessions")
                .join(format!("rollout-x-{CODEX_ID}.jsonl")),
            "{}\n",
        );
        write_lines(
            &self.codex_rollout(),
            &[
                json!({"timestamp": "2026-09-25T06:26:17.680Z", "type": "session_meta",
                   "payload": {"id": CODEX_ID, "cwd": self.workspace, "originator": "codex-tui"}}),
                json!({"timestamp": "2026-09-25T06:26:18.000Z", "type": "response_item",
                   "payload": {"type": "message", "role": "developer",
                               "content": [{"type": "input_text", "text": "<permissions>"}]}}),
                json!({"timestamp": "2026-09-25T06:26:19.000Z", "type": "response_item",
                   "payload": {"type": "message", "role": "user",
                               "content": [{"type": "input_text", "text": "write the plan"}]}}),
                json!({"timestamp": "2026-09-25T06:26:19.500Z", "type": "event_msg",
                   "payload": {"type": "user_message", "message": "write the plan"}}),
                json!({"timestamp": "2026-09-25T06:26:20.000Z", "type": "response_item",
                   "payload": {"type": "reasoning", "summary": [], "encrypted_content": "gAAAA"}}),
                json!({"timestamp": "2026-09-25T06:26:21.000Z", "type": "response_item",
                   "payload": {"type": "function_call", "name": "exec_command",
                               "arguments": "{\"cmd\":\"ls\"}", "call_id": "call_1"}}),
                json!({"timestamp": "2026-09-25T06:26:22.000Z", "type": "response_item",
                   "payload": {"type": "function_call_output", "call_id": "call_1",
                               "output": "Cargo.toml\nsrc"}}),
                json!({"timestamp": "2026-09-25T06:26:23.000Z", "type": "response_item",
                   "payload": {"type": "message", "role": "assistant",
                               "content": [{"type": "output_text", "text": "Plan written."}]}}),
            ],
        );
    }

    fn write_claude(&self) {
        write_lines(
            &self.claude_transcript(),
            &[
                json!({"type": "permission-mode", "permissionMode": "bypass", "sessionId": CLAUDE_ID}),
                json!({"type": "user", "sessionId": CLAUDE_ID, "cwd": self.workspace,
                   "timestamp": "2026-09-25T07:00:00.000Z",
                   "message": {"role": "user", "content": "fix the build"}}),
                json!({"type": "assistant", "sessionId": CLAUDE_ID, "cwd": self.workspace,
                   "timestamp": "2026-09-25T07:00:05.000Z",
                   "message": {"role": "assistant", "content": [
                       {"type": "thinking", "thinking": "Check cargo first."},
                       {"type": "text", "text": "Running the check."},
                       {"type": "tool_use", "id": "toolu_1", "name": "Bash",
                        "input": {"command": "cargo check"}}]}}),
                json!({"type": "user", "sessionId": CLAUDE_ID, "cwd": self.workspace,
                   "timestamp": "2026-09-25T07:00:30.000Z",
                   "message": {"role": "user", "content": [
                       {"type": "tool_result", "tool_use_id": "toolu_1",
                        "content": [{"type": "text", "text": "Finished dev profile"}]}]}}),
                json!({"type": "attachment", "sessionId": CLAUDE_ID, "cwd": self.workspace,
                   "attachment": {"type": "file"}}),
            ],
        );
    }
}

fn write(path: &Path, body: &str) {
    fs::create_dir_all(path.parent().expect("parent")).expect("mkdir");
    fs::write(path, body).expect("write");
}

fn write_lines(path: &Path, lines: &[serde_json::Value]) {
    let body: String = lines.iter().map(|line| format!("{line}\n")).collect();
    write(path, &body);
}

fn append(path: &Path, body: &str) {
    let mut file = OpenOptions::new()
        .append(true)
        .open(path)
        .expect("open for append");
    file.write_all(body.as_bytes()).expect("append");
}

fn read_mirror(path: &Path) -> Vec<ExternalRecord> {
    fs::read_to_string(path)
        .expect("mirror exists")
        .lines()
        .map(|line| serde_json::from_str(line).expect("mirror line is a record"))
        .collect()
}

fn roles_and_texts(records: &[ExternalRecord]) -> Vec<(Role, String)> {
    records
        .iter()
        .map(|record| (record.role, record.text.clone()))
        .collect()
}

#[test]
fn syncs_all_three_formats() {
    let fixture = Fixture::new();
    let report = sync(&fixture.options()).expect("sync");

    // Antigravity CLI: user, reasoning + tool call, tool output, system note.
    let agy = read_mirror(&fixture.mirror(AgentKind::Agy, AGY_ID));
    assert_eq!(
        roles_and_texts(&agy),
        vec![
            (Role::User, "explore the docs".to_owned()),
            (
                Role::Reasoning,
                "Listing the repositories first.".to_owned()
            ),
            (
                Role::ToolCall,
                r#"run_command {"CommandLine":"\"ls\"","Cwd":"\"C:\\\\src\""}"#.to_owned()
            ),
            (
                Role::ToolResult,
                "The command exited with code 0.\nOutput: aphrody".to_owned()
            ),
            (Role::System, "# Resuming from a compaction".to_owned()),
        ]
    );
    // last_conversations.json outranks the metadata's workspace URI.
    assert!(
        agy.iter()
            .all(|record| record.workspace.as_deref() == Some(fixture.workspace.as_str()))
    );
    assert_eq!(
        agy[0].ts.map(|ts| ts.to_rfc3339()),
        Some("2026-09-25T03:37:29+00:00".to_owned())
    );
    assert_eq!(agy[1].offset, agy[2].offset, "one line, two records");
    assert_eq!((agy[1].part, agy[2].part), (0, 1));

    // Codex: session_meta and event_msg produce nothing, encrypted reasoning is dropped.
    let codex = read_mirror(&fixture.mirror(AgentKind::Codex, CODEX_ID));
    assert_eq!(
        roles_and_texts(&codex),
        vec![
            (Role::System, "<permissions>".to_owned()),
            (Role::User, "write the plan".to_owned()),
            (Role::ToolCall, r#"exec_command {"cmd":"ls"}"#.to_owned()),
            (Role::ToolResult, "Cargo.toml\nsrc".to_owned()),
            (Role::Assistant, "Plan written.".to_owned()),
        ]
    );
    assert!(
        codex
            .iter()
            .all(|record| record.workspace.as_deref() == Some(fixture.workspace.as_str()))
    );
    assert!(codex.iter().all(|record| record.session_id == CODEX_ID));

    // Claude Code: blocks become parts; bookkeeping lines are skipped.
    let claude = read_mirror(&fixture.mirror(AgentKind::Claude, CLAUDE_ID));
    assert_eq!(
        roles_and_texts(&claude),
        vec![
            (Role::User, "fix the build".to_owned()),
            (Role::Reasoning, "Check cargo first.".to_owned()),
            (Role::Assistant, "Running the check.".to_owned()),
            (
                Role::ToolCall,
                r#"Bash {"command":"cargo check"}"#.to_owned()
            ),
            (Role::ToolResult, "Finished dev profile".to_owned()),
        ]
    );
    assert_eq!(claude[3].part, 2);
    assert_eq!(
        claude[0].source_path,
        fixture.claude_transcript().display().to_string()
    );

    assert_eq!(report.records_ingested, 15);
    assert_eq!(report.sources_scanned, 3);
    assert_eq!(report.sources_updated, 3);
    assert_eq!(report.sessions.len(), 3);
    assert!(report.issues.is_empty(), "{:?}", report.issues);
    let codex_session = report
        .sessions
        .iter()
        .find(|session| session.agent == AgentKind::Codex)
        .expect("codex");
    assert_eq!(
        codex_session.title.as_deref(),
        Some("Redesign plan"),
        "latest index entry wins"
    );
    let agy_session = report
        .sessions
        .iter()
        .find(|session| session.agent == AgentKind::Agy)
        .expect("agy");
    assert_eq!(agy_session.title.as_deref(), Some("Explore the docs"));
    assert!(report.live_processes.is_none(), "probing is off by default");

    let json = serde_json::to_value(&report).expect("report serialises");
    assert_eq!(json["schema_version"], 1);
    assert_eq!(json["agents"][1]["agent"], "codex");
}

#[test]
fn rerun_without_changes_ingests_nothing() {
    let fixture = Fixture::new();
    sync(&fixture.options()).expect("first sync");
    let before = fs::read(fixture.mirror(AgentKind::Claude, CLAUDE_ID)).expect("mirror");
    let report = sync(&fixture.options()).expect("second sync");
    assert_eq!(report.records_ingested, 0);
    assert_eq!(report.sources_updated, 0);
    assert!(report.sessions.is_empty());
    assert_eq!(
        fs::read(fixture.mirror(AgentKind::Claude, CLAUDE_ID)).expect("mirror"),
        before
    );
}

#[test]
fn appended_lines_are_ingested_once_from_the_stored_offset() {
    let fixture = Fixture::new();
    sync(&fixture.options()).expect("first sync");
    let state = SyncState::load(&fixture.out.join(STATE_FILE_NAME)).expect("state");
    let key = source_key(&fixture.codex_rollout());
    let first_offset = state.sources[&key].offset;
    assert_eq!(
        first_offset,
        fs::metadata(fixture.codex_rollout()).expect("meta").len()
    );

    let line = json!({"timestamp": "2026-09-25T06:30:00.000Z", "type": "response_item",
                      "payload": {"type": "message", "role": "user",
                                  "content": [{"type": "input_text", "text": "and ship it"}]}});
    append(&fixture.codex_rollout(), &format!("{line}\n"));

    let report = sync(&fixture.options()).expect("second sync");
    assert_eq!(report.records_ingested, 1);
    assert_eq!(report.sessions.len(), 1);
    assert_eq!(report.sessions[0].new_records, 1);
    let codex = read_mirror(&fixture.mirror(AgentKind::Codex, CODEX_ID));
    assert_eq!(codex.len(), 6);
    let last = codex.last().expect("last");
    assert_eq!(
        (last.role, last.text.as_str(), last.offset),
        (Role::User, "and ship it", first_offset)
    );
    // The workspace learned from session_meta on the first run is kept.
    assert_eq!(last.workspace.as_deref(), Some(fixture.workspace.as_str()));

    let state = SyncState::load(&fixture.out.join(STATE_FILE_NAME)).expect("state");
    assert_eq!(state.sources[&key].records, 6);
}

#[test]
fn a_line_still_being_written_is_left_for_the_next_run() {
    let fixture = Fixture::new();
    sync(&fixture.options()).expect("first sync");
    let transcript = fixture.claude_transcript();
    let line = json!({"type": "user", "sessionId": CLAUDE_ID, "cwd": fixture.workspace,
                      "message": {"role": "user", "content": "one more thing"}})
    .to_string();
    let (head, tail) = line.split_at(line.len() / 2);
    append(&transcript, head);

    let report = sync(&fixture.options()).expect("partial sync");
    assert_eq!(report.records_ingested, 0, "no newline yet");

    append(&transcript, &format!("{tail}\n"));
    let report = sync(&fixture.options()).expect("completed sync");
    assert_eq!(report.records_ingested, 1);
    let claude = read_mirror(&fixture.mirror(AgentKind::Claude, CLAUDE_ID));
    assert_eq!(
        claude.last().map(|record| record.text.as_str()),
        Some("one more thing")
    );
}

#[test]
fn an_interrupted_run_leaves_no_duplicate_behind() {
    let fixture = Fixture::new();
    sync(&fixture.options()).expect("first sync");
    let mirror = fixture.mirror(AgentKind::Codex, CODEX_ID);
    // What a run killed between the mirror write and the state commit leaves.
    append(&mirror, "{\"torn\": true}\n");
    let line = json!({"timestamp": "2026-09-25T06:31:00.000Z", "type": "response_item",
                      "payload": {"type": "message", "role": "assistant",
                                  "content": [{"type": "output_text", "text": "Shipped."}]}});
    append(&fixture.codex_rollout(), &format!("{line}\n"));

    let report = sync(&fixture.options()).expect("sync after crash");
    assert_eq!(report.records_ingested, 1);
    assert!(
        report
            .issues
            .iter()
            .any(|issue| issue.message.contains("uncommitted"))
    );
    let codex = read_mirror(&mirror);
    assert_eq!(codex.len(), 6);
    assert_eq!(
        codex.last().map(|record| record.text.as_str()),
        Some("Shipped.")
    );
}

#[test]
fn a_deleted_mirror_is_rebuilt_from_its_source() {
    let fixture = Fixture::new();
    sync(&fixture.options()).expect("first sync");
    let mirror = fixture.mirror(AgentKind::Agy, AGY_ID);
    let original = fs::read(&mirror).expect("mirror");
    fs::remove_file(&mirror).expect("delete mirror");

    let report = sync(&fixture.options()).expect("rebuild");
    assert_eq!(report.records_ingested, 5);
    assert_eq!(fs::read(&mirror).expect("mirror"), original);
}

#[test]
fn a_rewritten_source_is_ingested_again_and_its_mirror_rebuilt() {
    let fixture = Fixture::new();
    sync(&fixture.options()).expect("first sync");
    write_lines(
        &fixture.claude_transcript(),
        &[
            json!({"type": "user", "sessionId": CLAUDE_ID, "cwd": fixture.workspace,
               "message": {"role": "user", "content": "a different conversation, longer than the old head"}}),
        ],
    );
    let report = sync(&fixture.options()).expect("resync");
    assert_eq!(report.records_ingested, 1);
    assert!(
        report
            .issues
            .iter()
            .any(|issue| issue.message.contains("ingesting it again"))
    );
    let claude = read_mirror(&fixture.mirror(AgentKind::Claude, CLAUDE_ID));
    assert_eq!(
        roles_and_texts(&claude),
        vec![(
            Role::User,
            "a different conversation, longer than the old head".to_owned()
        )]
    );
}

#[test]
fn a_rejected_batch_is_rolled_back_and_retried() {
    let fixture = Fixture::new();
    let options = fixture.options().with_agents(vec![AgentKind::Codex]);
    let report = sync_with(&options, |_| Err("memory store offline".to_owned())).expect("sync");
    assert_eq!(report.records_ingested, 0);
    assert!(
        report
            .issues
            .iter()
            .any(|issue| issue.message.contains("memory store offline"))
    );
    let mirror = fixture.mirror(AgentKind::Codex, CODEX_ID);
    assert_eq!(
        fs::metadata(&mirror).map(|meta| meta.len()).unwrap_or(0),
        0,
        "rolled back"
    );
    let state = SyncState::load(&fixture.out.join(STATE_FILE_NAME)).expect("state");
    assert!(state.sources.is_empty(), "offset not committed");

    let mut seen = 0;
    let report = sync_with(&options, |batch| {
        seen += batch.len();
        Ok(())
    })
    .expect("retry");
    assert_eq!((report.records_ingested, seen), (5, 5));
    assert_eq!(read_mirror(&mirror).len(), 5);
}

#[test]
fn agent_filter_limits_the_run() {
    let fixture = Fixture::new();
    let report =
        sync(&fixture.options().with_agents(vec![AgentKind::Claude])).expect("claude only");
    assert_eq!(report.agents.len(), 1);
    assert_eq!(report.records_ingested, 5);
    assert!(!fixture.mirror(AgentKind::Codex, CODEX_ID).exists());
    assert!(!fixture.mirror(AgentKind::Agy, AGY_ID).exists());
}

#[test]
fn malformed_lines_are_counted_and_skipped() {
    let fixture = Fixture::new();
    append(&fixture.claude_transcript(), "{not json\n");
    let report = sync(&fixture.options()).expect("sync");
    let claude = report
        .agents
        .iter()
        .find(|agent| agent.agent == AgentKind::Claude)
        .expect("claude");
    assert_eq!(claude.malformed_lines, 1);
    assert_eq!(claude.records, 5);
}

#[test]
fn long_text_is_cut_on_a_char_boundary_and_flagged() {
    let fixture = Fixture::new();
    sync(&fixture.options()).expect("first sync, uncapped");
    let long = "é".repeat(100);
    append(
        &fixture.claude_transcript(),
        &format!(
            "{}\n",
            json!({"type": "user", "cwd": fixture.workspace,
                   "message": {"role": "user", "content": long}})
        ),
    );
    sync(&fixture.options().with_max_text_bytes(11)).expect("sync");
    let claude = read_mirror(&fixture.mirror(AgentKind::Claude, CLAUDE_ID));
    let last = claude.last().expect("last");
    assert!(last.truncated);
    assert_eq!(
        last.text,
        "é".repeat(5),
        "11 bytes round down to 5 two-byte characters"
    );
    assert!(!claude[0].truncated);

    assert_eq!(
        truncate_text("abc".to_owned(), 0),
        ("abc".to_owned(), false),
        "0 disables the cap"
    );
}

#[test]
fn a_missing_home_is_an_empty_run() {
    let dir = tempfile::tempdir().expect("tempdir");
    let options = SyncOptions::new(
        AgentRoots::from_home(&dir.path().join("nobody")),
        dir.path().join("out"),
    );
    let report = sync(&options).expect("sync");
    assert_eq!(report.sources_scanned, 0);
    assert!(report.agents.iter().all(|agent| !agent.root_exists));
    assert!(report.issues.is_empty());
}

#[test]
fn a_corrupt_state_stops_the_run_instead_of_duplicating_the_mirror() {
    let fixture = Fixture::new();
    sync(&fixture.options()).expect("first sync");
    fs::write(fixture.out.join(STATE_FILE_NAME), "{ not a state").expect("corrupt");
    let error = sync(&fixture.options()).expect_err("corrupt state is fatal");
    assert!(error.to_string().contains("move it aside"), "{error}");
}

#[test]
fn mirror_names_are_sanitised_and_never_look_like_rollouts() {
    assert_eq!(
        mirror_rel(AgentKind::Codex, CODEX_ID),
        format!("codex/{CODEX_ID}.jsonl")
    );
    assert_eq!(
        mirror_rel(AgentKind::Claude, "../../etc/passwd"),
        "claude/_.._etc_passwd.jsonl"
    );
    assert_eq!(
        mirror_rel(AgentKind::Agy, "rollout-abc"),
        "agy/ext-rollout-abc.jsonl"
    );
    assert_eq!(mirror_rel(AgentKind::Agy, ".."), "agy/session.jsonl");
    assert_eq!(
        super::codex::session_id_from_file_name(Path::new(&format!(
            "rollout-2026-09-25T08-26-17-{CODEX_ID}.jsonl"
        ))),
        Some(CODEX_ID.to_owned())
    );
    assert_eq!(
        super::codex::session_id_from_file_name(Path::new("rollout-custom.jsonl")),
        Some("custom".to_owned())
    );
}

#[test]
fn agent_names_parse_with_aliases() {
    assert_eq!("agy".parse::<AgentKind>().ok(), Some(AgentKind::Agy));
    assert_eq!(
        "Antigravity".parse::<AgentKind>().ok(),
        Some(AgentKind::Agy)
    );
    assert_eq!(
        "claude-code".parse::<AgentKind>().ok(),
        Some(AgentKind::Claude)
    );
    assert_eq!("codex".parse::<AgentKind>().ok(), Some(AgentKind::Codex));
    assert!("cursor".parse::<AgentKind>().is_err());
}

#[test]
fn file_uris_and_workspaces_normalise() {
    let decoded = file_uri_to_path("file:///c%3A/work/aphrody").expect("path");
    if cfg!(windows) {
        assert_eq!(decoded, r"C:\work\aphrody");
    } else {
        assert_eq!(decoded, "C:/work/aphrody");
    }
    assert_eq!(
        file_uri_to_path("file:///home/me/repo").as_deref(),
        Some("/home/me/repo")
    );
    assert_eq!(file_uri_to_path("https://example.com"), None);
    assert_eq!(
        normalize_workspace("/home/me/repo/"),
        normalize_workspace("/home/me/repo")
    );
    if cfg!(windows) {
        assert_eq!(
            normalize_workspace(r"C:\Users\Me\Repo\"),
            normalize_workspace("c:/users/me/repo")
        );
        assert_eq!(
            normalize_workspace(r"\\?\C:\x"),
            normalize_workspace("C:/x")
        );
    }
}

fn args(list: &[&str]) -> Vec<OsString> {
    list.iter().map(OsString::from).collect()
}

#[test]
fn process_classification_counts_only_agents() {
    // Native executables.
    assert_eq!(
        classify_process(
            "claude.exe",
            Some(Path::new("C:/Users/me/.local/bin/claude.exe")),
            &[]
        ),
        Some((AgentKind::Claude, false))
    );
    assert_eq!(
        classify_process("codex", None, &[]),
        Some((AgentKind::Codex, false))
    );
    assert_eq!(
        classify_process("codex-x86_64-pc-windows-msvc.exe", None, &[]),
        Some((AgentKind::Codex, false))
    );
    assert_eq!(
        classify_process("agy.exe", None, &[]),
        Some((AgentKind::Agy, false))
    );
    assert_eq!(
        classify_process("Antigravity.exe", None, &[]),
        Some((AgentKind::Agy, false))
    );
    // Electron / Chromium helper processes of the desktop app are not agents.
    assert_eq!(
        classify_process(
            "Antigravity.exe",
            None,
            &args(&["Antigravity.exe", "--type=renderer"])
        ),
        None
    );
    // The Claude Desktop chat app is not Claude Code, in any of its installs.
    for desktop in [
        r"C:\Users\me\AppData\Local\AnthropicClaude\app-0.14.10\claude.exe",
        r"C:\Program Files\WindowsApps\Claude_1.0.0.0_x64__pzs8sxrjxfjjc\app\claude.exe",
        "/Applications/Claude.app/Contents/MacOS/Claude",
    ] {
        assert_eq!(
            classify_process("claude.exe", Some(Path::new(desktop)), &[]),
            None,
            "{desktop}"
        );
    }
    assert_eq!(
        classify_process(
            "claude",
            Some(Path::new("/home/me/.claude/local/claude")),
            &[]
        ),
        Some((AgentKind::Claude, false))
    );

    // node hosting an agent script.
    assert_eq!(
        classify_process(
            "node.exe",
            None,
            &args(&[
                "node",
                "--max-old-space-size=8192",
                r"C:\npm\node_modules\@anthropic-ai\claude-code\cli.js",
            ])
        ),
        Some((AgentKind::Claude, true))
    );
    assert_eq!(
        classify_process(
            "node",
            None,
            &args(&["node", "/usr/lib/node_modules/@openai/codex/bin/codex.js"])
        ),
        Some((AgentKind::Codex, true))
    );
    // node hosting anything else is never an agent, even under an agent's
    // config directory.
    assert_eq!(
        classify_process(
            "node.exe",
            None,
            &args(&["node", r"C:\Users\me\.claude\plugins\x\server.js"])
        ),
        None
    );
    assert_eq!(
        classify_process("node", None, &args(&["node", "vite.js", "--claude"])),
        None
    );
    assert_eq!(classify_process("node", None, &[]), None);
    assert_eq!(classify_process("cargo.exe", None, &[]), None);
    assert_eq!(classify_process("codex-helper", None, &[]), None);
}

#[test]
fn live_probe_runs_on_this_host() {
    // Real process table; the test binary itself is not an agent.
    let live = super::probe_live_processes();
    let me = std::process::id();
    assert!(live.iter().all(|process| process.pid != me));
    let dir = tempfile::tempdir().expect("tempdir");
    let options = SyncOptions::new(
        AgentRoots::from_home(&dir.path().join("h")),
        dir.path().join("out"),
    )
    .with_probe_processes(true);
    let report = sync(&options).expect("sync with probing");
    assert!(report.live_processes.is_some());
}

#[cfg(feature = "memory")]
#[test]
fn records_feed_the_memory_provider_idempotently() {
    use aphrody_memory::{
        provider::MemoryProvider, sqlite_local::SqliteLocalProvider, types::MemoryQuery,
    };

    use super::{memory_agent_id, sync_into_memory};

    let fixture = Fixture::new();
    let provider = SqliteLocalProvider::open_in_memory().expect("sqlite");
    let runtime = tokio::runtime::Builder::new_current_thread()
        .build()
        .expect("runtime");
    let report = sync_into_memory(&fixture.options(), &provider, runtime.handle())
        .expect("sync into memory");
    let memory = report.memory.expect("memory report");
    assert_eq!(memory.provider, "sqlite_local");
    // user + assistant only: agy 1 user; codex 1 user + 1 assistant; claude 1 user + 1 assistant.
    assert_eq!(memory.records_fed, 5);

    let codex = runtime
        .block_on(provider.search(MemoryQuery::for_agent(memory_agent_id(AgentKind::Codex))))
        .expect("search");
    let mut contents: Vec<&str> = codex.iter().map(|record| record.content.as_str()).collect();
    contents.sort_unstable();
    assert_eq!(contents, vec!["Plan written.", "write the plan"]);
    assert!(
        codex
            .iter()
            .all(|record| record.tags.contains(&"external-session".to_owned()))
    );
    assert_eq!(codex[0].metadata["session_id"], CODEX_ID);

    // Feeding the same records again replaces them (deterministic ids).
    let mirror = read_mirror(&fixture.mirror(AgentKind::Codex, CODEX_ID));
    let fed = runtime
        .block_on(super::feed_memory(&provider, &mirror))
        .expect("refeed");
    assert_eq!(fed, 2);
    let again = runtime
        .block_on(provider.search(MemoryQuery::for_agent(memory_agent_id(AgentKind::Codex))))
        .expect("search");
    assert_eq!(again.len(), 2);
}

#[test]
fn state_keys_ignore_separator_and_case_spelling() {
    let native = source_key(Path::new("/home/me/.codex/sessions/a.jsonl"));
    assert_eq!(native, "/home/me/.codex/sessions/a.jsonl");
    if cfg!(windows) {
        assert_eq!(
            source_key(Path::new(r"C:\Users\Me\.codex\sessions\a.jsonl")),
            source_key(Path::new("c:/users/me/.codex/sessions/a.jsonl"))
        );
    }
}

#[cfg(feature = "memory")]
#[tokio::test]
async fn shared_recall_filters_workspace_and_keeps_all_three_owners() {
    use aphrody_memory::{SqliteLocalProvider, provider::MemoryProvider, types::MemoryRecord};
    let provider = SqliteLocalProvider::open_in_memory().unwrap();
    let workspace = tempfile::tempdir().unwrap();
    for (index, agent) in [AgentKind::Claude, AgentKind::Codex, AgentKind::Agy]
        .into_iter()
        .enumerate()
    {
        let mut record = MemoryRecord::new(
            format!("record-{index}"),
            super::memory_agent_id(agent),
            "shared",
        );
        record.created_at_unix_ms = index as u64;
        record.metadata = serde_json::json!({"workspace": workspace.path()});
        provider.add(record).await.unwrap();
    }
    provider
        .add(MemoryRecord::new(
            "unknown",
            "external:codex",
            "no workspace",
        ))
        .await
        .unwrap();
    provider
        .add(
            MemoryRecord::new("other", "external:claude", "other repo")
                .with_metadata(serde_json::json!({"workspace": "/unrelated-repo"})),
        )
        .await
        .unwrap();
    let records = super::workspace_memory(&provider, workspace.path(), 3)
        .await
        .unwrap();
    assert_eq!(records.len(), 3);
    assert_eq!(records[0].agent_id, "external:agy");
    assert_eq!(records[1].agent_id, "external:codex");
    assert_eq!(records[2].agent_id, "external:claude");
    assert_eq!(
        super::workspace_memory(&provider, workspace.path(), 1)
            .await
            .unwrap()
            .len(),
        1
    );
}
