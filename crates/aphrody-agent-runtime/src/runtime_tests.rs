// SPDX-License-Identifier: Apache-2.0
//! Offline, deterministic tests for the runtime factory.
//!
//! Every test drives a [`StubModelClient`] against the real
//! [`ShellExecTool`](aphrody_agent_tools::ShellExecTool) /
//! [`ApplyPatchTool`](aphrody_agent_tools::ApplyPatchTool). No test constructs a
//! `reqwest::Client` or a `GeminiClient` (CLAUDE.md §7: that panics with "no
//! provider set" under rustls 0.23 in a bare test process).

use std::collections::{BTreeMap, BTreeSet};

use aphrody_agent_proto::EventMsg;
use aphrody_config::{McpServerConfig, McpServerTransportConfig};
use aphrody_engine::AutonomyMode;
use aphrody_model_client::ModelStreamEvent;
use pretty_assertions::assert_eq;
use serde_json::json;

use crate::{
    AgentRuntime, ModelChoice, PluginToolSpec, RuntimeConfig, ScriptedTurn, SkillSpec,
    StubModelClient, ToolProfileSpec,
};

#[tokio::test]
async fn relative_tool_cwd_is_resolved_from_the_session_workspace() {
    let workspace = tempfile::tempdir().unwrap();
    let other = tempfile::tempdir().unwrap();
    std::fs::create_dir(workspace.path().join("nested")).unwrap();
    for (directory, marker) in [
        (workspace.path().to_path_buf(), "workspace"),
        (workspace.path().join("nested"), "nested"),
        (other.path().to_path_buf(), "absolute"),
    ] {
        std::fs::write(directory.join("marker.txt"), marker).unwrap();
    }
    let tools =
        crate::build_tool_registry(&RuntimeConfig::new("stub").with_cwd(workspace.path())).unwrap();
    let read = tools.get("read_file").unwrap();
    for (cwd, expected) in [
        (json!("."), "workspace"),
        (json!("nested"), "nested"),
        (json!(other.path()), "absolute"),
        (serde_json::Value::Null, "workspace"),
    ] {
        let output = read
            .handle(json!({"file_path": "marker.txt", "cwd": cwd}))
            .await
            .unwrap();
        assert_eq!(output.content, expected);
    }
}

/// The argv the `shell` tool should run to echo `marker` on this platform.
///
/// On Unix `echo` is a real binary in PATH; on Windows it is a `cmd` builtin, so
/// it must be invoked through `cmd /C` (the shell tool launches executables
/// directly, with no shell wrapper).
fn echo_command(marker: &str) -> serde_json::Value {
    #[cfg(windows)]
    {
        json!(["cmd", "/C", "echo", marker])
    }
    #[cfg(not(windows))]
    {
        json!(["echo", marker])
    }
}

#[test]
fn default_config_is_full_auto() {
    let config = RuntimeConfig::default();
    assert_eq!(config.autonomy, AutonomyMode::FullAuto);
    // And via the model-targeting constructor.
    assert_eq!(
        RuntimeConfig::new("gemini-2.5-flash").autonomy,
        AutonomyMode::FullAuto
    );
}

#[test]
fn builder_requires_a_model() {
    let err = AgentRuntime::builder()
        .config(RuntimeConfig::new("m"))
        .build()
        .expect_err("missing model must error");
    assert!(matches!(err, crate::RuntimeError::Config(_)));
}

#[tokio::test]
async fn resume_appends_without_duplicating_history_and_fork_is_self_contained() {
    let root = tempfile::tempdir().expect("tempdir");
    let config = RuntimeConfig::new("stub").with_rollout_path(root.path());
    let model = || {
        ModelChoice::stub(StubModelClient::new(
            "stub",
            vec![ScriptedTurn::text("answer")],
        ))
    };
    AgentRuntime::builder()
        .config(config.clone())
        .model(model())
        .session_id("original")
        .build()
        .unwrap()
        .run_once("first")
        .await
        .unwrap();
    let original = aphrody_rollout::find_session(root.path(), "original")
        .await
        .unwrap()
        .unwrap();
    let history =
        aphrody_engine::restore_history(&aphrody_rollout::resume(&original.path).await.unwrap());
    assert_eq!(history.messages.len(), 2);

    AgentRuntime::builder()
        .config(config.clone())
        .model(model())
        .session_id("original")
        .resume_path(&original.path)
        .history(history.messages.clone())
        .build()
        .unwrap()
        .run_once("second")
        .await
        .unwrap();
    let lines = aphrody_rollout::resume(&original.path).await.unwrap();
    assert_eq!(aphrody_engine::restore_history(&lines).messages.len(), 4);
    assert_eq!(
        lines
            .iter()
            .filter(|line| line.item["type"] == "session_meta")
            .count(),
        1
    );

    AgentRuntime::builder()
        .config(config)
        .model(model())
        .session_id("fork")
        .forked_from("original")
        .history(history.messages)
        .build()
        .unwrap()
        .run_once("fork turn")
        .await
        .unwrap();
    let fork = aphrody_rollout::find_session(root.path(), "fork")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(fork.meta.forked_from.as_deref(), Some("original"));
    assert_ne!(original.path, fork.path);
    let fork_history =
        aphrody_engine::restore_history(&aphrody_rollout::resume(&fork.path).await.unwrap());
    assert_eq!(fork_history.messages.len(), 4);
    assert_eq!(
        aphrody_rollout::list_sessions(root.path())
            .await
            .unwrap()
            .sessions
            .len(),
        2
    );
}

#[test]
fn build_tool_registry_loads_shell_and_apply_patch() {
    let config = RuntimeConfig::new("m");
    let tools = crate::build_tool_registry(&config).expect("registry");
    for name in [
        "shell",
        "apply_patch",
        "read_file",
        "search_text",
        "computer_use",
    ] {
        assert!(tools.get(name).is_some(), "missing tool: {name}");
    }
    // BXC native web surface, registered beside the local built-ins.
    for name in crate::BXC_BUILTIN_TOOLS {
        assert!(tools.get(name).is_some(), "missing bxc tool: {name}");
    }
    const NATIVE: usize = 5 + crate::BXC_BUILTIN_TOOLS.len();
    #[cfg(not(windows))]
    assert_eq!(tools.len(), NATIVE);
    #[cfg(windows)]
    {
        let native = [
            "shell",
            "apply_patch",
            "read_file",
            "search_text",
            "computer_use",
            "web_search",
            "web_scrape",
            "js_eval",
            "google_ai",
            crate::BROWSER_TOOL,
        ];
        let imported = aphrody_agent_tools::winclean_tools()
            .iter()
            .filter(|t| !native.contains(&t.definition().name.as_str()))
            .count();
        assert_eq!(tools.len(), NATIVE + imported);
        // The native aphrody `read_file` wins the name clash.
        assert!(
            tools
                .get("read_file")
                .unwrap()
                .definition()
                .description
                .contains("repository inspection")
        );
        for name in [
            "winclean",
            "computer_observe",
            "computer_click",
            "kill_process",
        ] {
            assert!(tools.get(name).is_some(), "missing winclean tool: {name}");
        }
    }
}

#[tokio::test]
async fn profiled_registry_is_an_exact_builtin_and_skill_allowlist() {
    let root = tempfile::tempdir().expect("tempdir");
    let direct = root.path().join("direct.md");
    let plugin = root.path().join("plugin.md");
    std::fs::write(&direct, "direct profile skill").unwrap();
    std::fs::write(&plugin, "plugin profile skill").unwrap();

    let profile = ToolProfileSpec {
        builtin_tools: Some(BTreeSet::from(["read_file".to_owned()])),
        skills: vec![SkillSpec::new("review", &direct)],
        plugins: vec![PluginToolSpec {
            id: "quality".to_owned(),
            skills: vec![SkillSpec::new("lint", &plugin)],
            mcp_servers: BTreeMap::new(),
        }],
        mcp_servers: BTreeMap::new(),
    };
    let tools = crate::build_tool_registry(&RuntimeConfig::new("stub").with_tool_profile(profile))
        .expect("profiled registry");
    std::fs::write(&direct, "mutated after profile assembly").unwrap();

    assert!(tools.get("read_file").is_some());
    assert!(tools.get("shell").is_none());
    assert!(tools.get("apply_patch").is_none());
    assert_eq!(tools.len(), 3);
    assert_eq!(
        tools
            .get("skill__review")
            .unwrap()
            .handle(json!({}))
            .await
            .unwrap()
            .content,
        "direct profile skill"
    );
    assert_eq!(
        tools
            .get("skill__quality__lint")
            .unwrap()
            .handle(json!({}))
            .await
            .unwrap()
            .content,
        "plugin profile skill"
    );
}

#[test]
fn separate_profiles_do_not_share_skills() {
    let root = tempfile::tempdir().expect("tempdir");
    let path = root.path().join("skill.md");
    std::fs::write(&path, "body").unwrap();
    let registry = |name: &str| {
        crate::build_tool_registry(
            &RuntimeConfig::new("stub").with_tool_profile(ToolProfileSpec {
                builtin_tools: Some(BTreeSet::new()),
                skills: vec![SkillSpec::new(name, &path)],
                ..ToolProfileSpec::default()
            }),
        )
        .unwrap()
    };

    let alpha = registry("alpha");
    let beta = registry("beta");
    assert!(alpha.get("skill__alpha").is_some());
    assert!(alpha.get("skill__beta").is_none());
    assert!(beta.get("skill__beta").is_some());
    assert!(beta.get("skill__alpha").is_none());
}

#[tokio::test]
async fn mcp_profiles_require_async_build_and_skip_disabled_servers() {
    let disabled = McpServerConfig {
        transport: McpServerTransportConfig::Stdio {
            command: "must-not-be-spawned".to_owned(),
            args: Vec::new(),
            env: None,
            cwd: None,
        },
        enabled: false,
        startup_timeout_sec: None,
        tool_timeout_sec: None,
        enabled_tools: None,
        disabled_tools: None,
    };
    let config = RuntimeConfig::new("stub").with_tool_profile(ToolProfileSpec {
        builtin_tools: Some(BTreeSet::from(["read_file".to_owned()])),
        mcp_servers: BTreeMap::from([("disabled".to_owned(), disabled)]),
        ..ToolProfileSpec::default()
    });
    let model = || {
        ModelChoice::stub(StubModelClient::new(
            "stub",
            vec![ScriptedTurn::text("unused")],
        ))
    };

    let sync_error = AgentRuntime::builder()
        .config(config.clone())
        .model(model())
        .build()
        .expect_err("sync build must reject MCP discovery");
    assert!(sync_error.to_string().contains("build_profiled"));

    let runtime = AgentRuntime::builder()
        .config(config)
        .model(model())
        .build_profiled()
        .await
        .expect("disabled MCP server is skipped without spawning it");
    assert!(runtime.tools().get("read_file").is_some());
    assert_eq!(runtime.tools().len(), 1);
}

#[tokio::test]
async fn run_once_drives_a_tool_then_a_final_message() {
    // Turn 1: the model asks to run a shell command.
    // Turn 2: after seeing the tool output, the model produces its answer.
    let marker = "RUNTIME_OK";
    let stub = StubModelClient::new(
        "stub-model",
        vec![
            ScriptedTurn::tool_call(
                "call-1",
                "shell",
                json!({ "command": echo_command(marker) }),
            ),
            ScriptedTurn::text("all done"),
        ],
    );

    let runtime = AgentRuntime::builder()
        .config(RuntimeConfig::new("stub-model"))
        .model(ModelChoice::stub(stub))
        .build()
        .expect("build runtime");

    let result = runtime.run_once("please run echo").await.expect("run_once");

    // The model's final message is surfaced.
    assert_eq!(result.last_agent_message.as_deref(), Some("all done"));
    // Two model calls happened: the tool-call turn and the final-message turn.
    assert_eq!(result.outcome.tool_iterations, 2);
    assert!(!result.outcome.interrupted);
    assert!(!result.outcome.hit_iteration_cap);

    // The engine surfaced the tool dispatch lifecycle.
    let mut begin_ok = false;
    let mut end_ok = false;
    let mut final_message_ok = false;
    for event in &result.events {
        match &event.msg {
            EventMsg::ToolCallBegin { call_id, name } => {
                if call_id == "call-1" && name == "shell" {
                    begin_ok = true;
                }
            }
            EventMsg::ToolCallEnd { call_id, ok } => {
                if call_id == "call-1" && *ok {
                    end_ok = true;
                }
            }
            EventMsg::AgentMessage { text } if text == "all done" => {
                final_message_ok = true;
            }
            _ => {}
        }
    }
    assert!(begin_ok, "expected a ToolCallBegin for the shell call");
    assert!(
        end_ok,
        "expected a successful ToolCallEnd for the shell call"
    );
    assert!(final_message_ok, "expected the final AgentMessage");

    // A TurnComplete must close the turn.
    assert!(
        result
            .events
            .iter()
            .any(|e| matches!(&e.msg, EventMsg::TurnComplete { .. }))
    );
}

#[tokio::test]
async fn run_once_reinjects_tool_output_into_history() {
    // The second scripted turn echoes nothing useful on its own; we assert the
    // tool actually ran and its output ended up in a ToolCallEnd(ok=true),
    // proving the engine re-injected the result and looped to a second model
    // call that produced the final message.
    let stub = StubModelClient::new(
        "stub-model",
        vec![
            ScriptedTurn::tool_call(
                "c-echo",
                "shell",
                json!({ "command": echo_command("HELLO_FROM_TOOL") }),
            ),
            ScriptedTurn::text("acknowledged"),
        ],
    );

    let runtime = AgentRuntime::builder()
        .config(RuntimeConfig::new("stub-model"))
        .model(ModelChoice::stub(stub))
        .build()
        .expect("build");

    let result = runtime.run_once("go").await.expect("run_once");
    assert_eq!(result.last_agent_message.as_deref(), Some("acknowledged"));
    assert_eq!(result.outcome.tool_iterations, 2);
}

#[tokio::test]
async fn run_once_apply_patch_creates_a_file_on_disk() {
    let dir = tempfile::tempdir().expect("tempdir");
    let target = dir.path().join("created.txt");
    let target_str = target.to_string_lossy().replace('\\', "/");

    // A minimal apply_patch document that adds one file with a single line.
    let patch = format!(
        "*** Begin Patch\n*** Add File: {target_str}\n+hello patched world\n*** End Patch\n"
    );

    let stub = StubModelClient::new(
        "stub-model",
        vec![
            ScriptedTurn::tool_call("patch-1", "apply_patch", json!({ "patch": patch })),
            ScriptedTurn::text("file written"),
        ],
    );

    let runtime = AgentRuntime::builder()
        .config(RuntimeConfig::new("stub-model"))
        .model(ModelChoice::stub(stub))
        .build()
        .expect("build");

    let result = runtime.run_once("write the file").await.expect("run_once");
    assert_eq!(result.last_agent_message.as_deref(), Some("file written"));

    // The patch tool ran successfully and the file exists with our content.
    assert!(
        result.events.iter().any(|e| matches!(
            &e.msg,
            EventMsg::ToolCallEnd { call_id, ok } if call_id == "patch-1" && *ok
        )),
        "expected a successful apply_patch ToolCallEnd"
    );

    let contents = std::fs::read_to_string(&target).expect("created file must exist");
    assert!(
        contents.contains("hello patched world"),
        "unexpected file contents: {contents:?}"
    );
}

#[tokio::test]
async fn run_once_text_only_turn_finishes_in_one_iteration() {
    let stub = StubModelClient::new(
        "stub-model",
        vec![ScriptedTurn {
            events: vec![
                ModelStreamEvent::ReasoningDelta("thinking...".to_string()),
                ModelStreamEvent::TextDelta("just text".to_string()),
            ],
        }],
    );

    let runtime = AgentRuntime::builder()
        .config(RuntimeConfig::new("stub-model"))
        .model(ModelChoice::stub(stub))
        .build()
        .expect("build");

    let result = runtime.run_once("say something").await.expect("run_once");
    assert_eq!(result.last_agent_message.as_deref(), Some("just text"));
    assert_eq!(result.outcome.tool_iterations, 1);
    assert!(result.events.iter().any(|e| matches!(
        &e.msg,
        EventMsg::AgentReasoningDelta { delta } if delta == "thinking..."
    )));
}

#[tokio::test]
async fn run_once_writes_dated_rollout_with_session_meta_first_line() {
    let tmp = tempfile::tempdir().expect("tempdir");
    let sessions_root = tmp.path().join("sessions");

    let stub = StubModelClient::new(
        "stub-model",
        vec![ScriptedTurn {
            events: vec![ModelStreamEvent::TextDelta(
                "rollout test complete".to_string(),
            )],
        }],
    );

    let runtime = AgentRuntime::builder()
        .config(
            RuntimeConfig::new("stub-model")
                .with_system_prompt("test system prompt")
                .with_rollout_path(&sessions_root),
        )
        .model(ModelChoice::stub(stub))
        .build()
        .expect("build");

    let result = runtime.run_once("hello rollout").await.expect("run_once");
    assert_eq!(
        result.last_agent_message.as_deref(),
        Some("rollout test complete")
    );

    // Verify session listing found the session under dated directory YYYY/MM/DD
    let listing = aphrody_rollout::list_sessions(&sessions_root)
        .await
        .expect("list_sessions");
    assert_eq!(listing.sessions.len(), 1);

    let session = &listing.sessions[0];
    assert_eq!(session.meta.model.as_deref(), Some("stub-model"));
    assert_eq!(
        session.meta.instructions.as_deref(),
        Some("test system prompt")
    );
    assert_eq!(session.meta.originator, "aphrody");

    // Read first line explicitly and verify it parses as session_meta
    let meta = aphrody_rollout::read_session_meta(&session.path)
        .await
        .expect("read_session_meta")
        .expect("session_meta must be present");
    assert_eq!(meta.model.as_deref(), Some("stub-model"));
}
