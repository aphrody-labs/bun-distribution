// SPDX-License-Identifier: Apache-2.0
//! Headless agent CLI using the exec contract from openai/codex (Apache-2.0).
//! Reference: var/codex/codex-rs/exec/src/{cli,exec_events}.rs.

use std::{
    collections::BTreeMap,
    io::Write as _,
    path::{Path, PathBuf},
};

#[cfg(not(test))]
use std::io::{IsTerminal as _, Read as _};

use aphrody_agent_proto::{EventMsg, InputItem, Op, ReviewDecision};
use aphrody_agent_runtime::{
    AgentRuntime, ModelChoice, ModelFactory, RuntimeConfig, ScriptedTurn, StubModelClient,
};
use aphrody_config::{CliOverrides, Config};
#[cfg(test)]
use aphrody_config::{ConfigLayer, LayerSource};
use aphrody_exec_events::*;
use clap::{Args, Subcommand};
use miette::IntoDiagnostic as _;

use crate::session_cmd::SessionArgs;
pub(crate) use aphrody_diagnostics::config::{
    apply_environment_profile, load_config, profile_workspace,
};

#[derive(Debug, Clone, Default, Args)]
pub(crate) struct ExecArgs {
    #[command(flatten)]
    pub options: crate::AgentOptions,
    #[command(subcommand)]
    pub command: Option<ExecCommand>,
    /// Initial instructions; omit or use `-` to read stdin.
    #[arg(value_name = "PROMPT")]
    pub prompt: Option<String>,
    /// Stream Codex-compatible JSONL events on stdout.
    #[arg(long, alias = "experimental-json", global = true)]
    pub json: bool,
    /// Deterministic offline backend for smoke tests.
    #[arg(long, global = true)]
    pub stub: bool,
    /// Do not persist this session.
    #[arg(long, global = true)]
    pub ephemeral: bool,
    /// Write the final agent message to this file.
    #[arg(long = "output-last-message", short = 'o', global = true)]
    pub output_last_message: Option<PathBuf>,
    /// Constrain and validate the final response against a local JSON Schema file.
    #[arg(long = "output-schema", value_name = "PATH", global = true)]
    pub output_schema: Option<PathBuf>,
    /// Permit execution outside a Git checkout.
    #[arg(long, global = true)]
    pub skip_git_repo_check: bool,
    /// Attach an image to the initial user message; repeat for multiple images.
    #[arg(long, value_name = "PATH", global = true)]
    pub image: Vec<PathBuf>,
    /// Maximum model/tool iterations; zero runs until completion or interruption.
    #[arg(long, default_value_t = 0, global = true)]
    pub max_tool_iterations: usize,
}

#[derive(Debug, Clone, Subcommand)]
pub(crate) enum ExecCommand {
    /// Continue a recorded session in place.
    Resume(SessionArgs),
    /// Start a new session with the recorded conversation as its history.
    Fork(SessionArgs),
}

pub(crate) fn profile_state_root(config: &Config) -> miette::Result<PathBuf> {
    let base =
        aphrody_models::paths::state_dir().map_err(|error| miette::miette!("exec: {error}"))?;
    let workspace = profile_workspace(config)?;
    Ok(profile_state_root_at(&base, &workspace, config.active_profile.as_deref()))
}

fn profile_state_root_at(base: &Path, workspace: &Path, active_profile: Option<&str>) -> PathBuf {
    if let Some(profile) = active_profile {
        let profile = aphrody_agent_home::paths::sanitize_profile(profile);
        if profile == "dbfr" && workspace == base.join("workspaces").join("dbfr") {
            return base.join("profiles").join(profile);
        }
        return workspace.to_path_buf();
    }
    base.to_path_buf()
}

pub(crate) fn profile_sessions_dir(config: &Config) -> miette::Result<PathBuf> {
    Ok(profile_state_root(config)?.join("sessions"))
}

fn auto_compact_token_limit(configured: Option<i64>) -> miette::Result<Option<u64>> {
    configured
        .map(|limit| {
            u64::try_from(limit).map_err(|_| {
                miette::miette!("exec: model_auto_compact_token_limit cannot be negative")
            })
        })
        .transpose()
}

/// Only the selected profile's filtered projection enters a local model prompt.
fn profile_conversations(workspace: &Path) -> Option<String> {
    let root = workspace.canonicalize().ok()?;
    let path = workspace.join(".coord/shared/TRANSCRIPTS.md").canonicalize().ok()?;
    if !path.starts_with(&root) || std::fs::metadata(&path).ok()?.len() > 2 * 1024 * 1024 {
        return None;
    }
    let text = std::fs::read_to_string(path).ok()?;
    Some(text.chars().take(16_384).collect())
}

pub(crate) fn runtime_config(config: &Config, cwd: &Path) -> miette::Result<RuntimeConfig> {
    // The unified doctrine leads every session: Aphrody home agent identity,
    // the BXC web/scrape/browser engine, and the no-human-in-the-loop YOLO
    // execution contract. Profile-, operator- and project-level instructions
    // are layered on top of it, so they can refine it but never lose it.
    let workspace = profile_workspace(config)?;
    let mut instructions = vec![aphrody_prompts::APHRODY_UNIFIED_SYSTEM_PROMPT.to_owned()];
    instructions.extend(config.instructions.iter().cloned());
    instructions.extend(config.developer_instructions.iter().cloned());
    let docs = aphrody_project_doc::discover(
        cwd,
        &aphrody_project_doc::ProjectDocOptions {
            max_bytes: config.project_doc_max_bytes,
            fallback_filenames: config.project_doc_fallback_filenames.clone(),
            global_dir: Some(workspace.clone()),
        },
    )
    .map_err(|error| miette::miette!("exec: {error}"))?;
    instructions.push(docs.render());
    if let Some(conversations) = profile_conversations(&workspace) {
        instructions.push(format!(
            "Shared conversations of the selected Agent Home domain:\n{conversations}"
        ));
    }
    let mut runtime = RuntimeConfig::new(
        config
            .model
            .clone()
            .unwrap_or_else(|| aphrody_models::LocalRole::Chat.default_model().into()),
    )
    .with_model_provider(config.provider.id.clone())
    .with_cwd(cwd)
    .with_computer_use(config.computer_use.clone())
    .with_system_prompt(instructions.join("\n\n"))
    .with_live_agent_home_workspace(workspace.clone())
    .with_max_tool_iterations(0)
    .with_autonomy(if config.approval_policy == aphrody_config::AskForApproval::Never {
        aphrody_agent_runtime::AutonomyMode::FullAuto
    } else {
        aphrody_agent_runtime::AutonomyMode::Gated
    });
    if let Some(limit) = auto_compact_token_limit(config.model_auto_compact_token_limit)? {
        runtime = runtime.with_auto_compact_token_limit(limit);
    }
    if config.rag.enabled == Some(true) {
        let state_root = profile_state_root(config)?;
        let path = match config.rag.db_path.as_deref() {
            Some(path) => {
                if let Some(suffix) = path.strip_prefix("~/").or_else(|| path.strip_prefix("~\\")) {
                    let home = std::env::var_os(if cfg!(windows) { "USERPROFILE" } else { "HOME" })
                        .ok_or_else(|| {
                            miette::miette!("exec: cannot expand RAG database home path")
                        })?;
                    PathBuf::from(home).join(suffix)
                } else if Path::new(path).is_absolute() {
                    PathBuf::from(path)
                } else {
                    state_root.join(path)
                }
            },
            None => state_root.join("rag/index.db"),
        };
        runtime = runtime.with_rag_db(path);
    }
    if let Some(profile) = aphrody_agent_runtime::resolve_tool_profile(config, &workspace, cwd)
        .map_err(|error| miette::miette!("exec: {error}"))?
    {
        runtime = runtime.with_tool_profile(profile);
    }
    Ok(runtime)
}

fn prompt_from_input(prompt: Option<&str>, input: &str) -> miette::Result<String> {
    let prompt = match prompt {
        None | Some("-") => input.trim().to_owned(),
        Some(prompt) if input.trim().is_empty() => prompt.to_owned(),
        Some(prompt) => format!("{prompt}\n\n<stdin>\n{input}\n</stdin>"),
    };
    if prompt.trim().is_empty() {
        return Err(miette::miette!(
            "exec: no prompt supplied; pass PROMPT or pipe instructions on stdin"
        ));
    }
    Ok(prompt)
}

fn read_prompt(prompt: Option<&str>) -> miette::Result<String> {
    #[allow(unused_mut)]
    let mut input = String::new();
    #[cfg(not(test))]
    if !std::io::stdin().is_terminal() {
        std::io::stdin().read_to_string(&mut input).into_diagnostic()?;
    }
    prompt_from_input(prompt, &input)
}

fn input_items(prompt: String, images: &[PathBuf]) -> miette::Result<Vec<InputItem>> {
    let mut items = Vec::with_capacity(images.len() + 1);
    items.push(InputItem::Text { text: prompt });
    for image in images {
        let path = image
            .canonicalize()
            .map_err(|error| miette::miette!("exec: image {}: {error}", image.display()))?;
        if !path.is_file() {
            return Err(miette::miette!("exec: image {} is not a file", image.display()));
        }
        items.push(InputItem::Image { path: Some(path), url: None });
    }
    Ok(items)
}

fn emit(event: &ThreadEvent, json: bool) -> miette::Result<()> {
    if json {
        let mut output = std::io::stdout().lock();
        serde_json::to_writer(&mut output, event).into_diagnostic()?;
        writeln!(output).into_diagnostic()?;
        output.flush().into_diagnostic()?;
    }
    Ok(())
}

fn has_config_override(overrides: &CliOverrides, key: &str) -> bool {
    overrides.config_overrides.iter().any(|raw| {
        aphrody_config::parse_override(raw).is_ok_and(|(path, _)| path.len() == 1 && path[0] == key)
    })
}

fn reject_external_schema_refs(value: &serde_json::Value) -> miette::Result<()> {
    match value {
        serde_json::Value::Object(fields) => {
            for (name, child) in fields {
                if matches!(name.as_str(), "$ref" | "$dynamicRef" | "$recursiveRef")
                    && child.as_str().is_some_and(|reference| !reference.starts_with('#'))
                {
                    return Err(miette::miette!(
                        "exec: --output-schema permits only local fragment references"
                    ));
                }
                reject_external_schema_refs(child)?;
            }
        },
        serde_json::Value::Array(items) => {
            for item in items {
                reject_external_schema_refs(item)?;
            }
        },
        _ => {},
    }
    Ok(())
}

fn load_output_schema(path: &Path) -> miette::Result<(serde_json::Value, jsonschema::Validator)> {
    let bytes = std::fs::read(path)
        .map_err(|error| miette::miette!("exec: output schema {}: {error}", path.display()))?;
    let schema: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| miette::miette!("exec: invalid JSON output schema: {error}"))?;
    reject_external_schema_refs(&schema)?;
    let validator = jsonschema::validator_for(&schema)
        .map_err(|error| miette::miette!("exec: invalid output schema: {error}"))?;
    Ok((schema, validator))
}

fn validate_output_message(
    validator: &jsonschema::Validator,
    message: Option<&str>,
) -> miette::Result<()> {
    let message =
        message.ok_or_else(|| miette::miette!("exec: model returned no final JSON message"))?;
    let value: serde_json::Value = serde_json::from_str(message)
        .map_err(|error| miette::miette!("exec: final response is not JSON: {error}"))?;
    validator
        .validate(&value)
        .map_err(|error| miette::miette!("exec: final response violates output schema: {error}"))
}

/// Drive one turn, streaming events and preserving the session identity.
pub(crate) async fn run(args: ExecArgs, mut overrides: CliOverrides) -> miette::Result<()> {
    let output_schema = args.output_schema.as_deref().map(load_output_schema).transpose()?;
    overrides = args.options.apply_to(overrides);
    let session_args = match &args.command {
        Some(ExecCommand::Resume(session) | ExecCommand::Fork(session)) => Some(session),
        None => None,
    };
    if let Some(session_args) = session_args {
        overrides = session_args.options.apply_to(overrides);
    }
    overrides = apply_environment_profile(overrides);
    let mut config = load_config(&overrides)?;
    let mut selected = None;
    let mut history = Vec::new();
    if let Some(session_args) = session_args {
        let root = profile_sessions_dir(&config)?;
        let (session, restored) = crate::session_cmd::load(&root, session_args).await?;
        if overrides.cwd.is_none() {
            overrides.cwd.clone_from(&session.meta.cwd);
        }
        if overrides.model.is_none()
            && config.active_profile.is_none()
            && !has_config_override(&overrides, "model")
        {
            overrides.model.clone_from(&session.meta.model);
        }
        if overrides.model_provider.is_none()
            && !overrides.oss
            && overrides.local_provider.is_none()
            && config.active_profile.is_none()
            && !has_config_override(&overrides, "model_provider")
        {
            overrides.model_provider.clone_from(&session.meta.model_provider);
        }
        history = restored;
        selected = Some(session);
        config = load_config(&overrides)?;
    }
    let cwd = overrides.cwd.clone().unwrap_or(std::env::current_dir().into_diagnostic()?);
    let cwd = cwd.canonicalize().into_diagnostic()?;
    if !cwd.is_dir() {
        return Err(miette::miette!("exec: working directory is not a directory"));
    }
    if !args.skip_git_repo_check && !cwd.ancestors().any(|path| path.join(".git").exists()) {
        return Err(miette::miette!("exec: outside a Git checkout; use --skip-git-repo-check"));
    }
    let prompt = read_prompt(
        session_args.and_then(SessionArgs::effective_prompt).or(args.prompt.as_deref()),
    )?;
    let items = input_items(prompt.clone(), &args.image)?;
    let _provider =
        if args.stub { None } else { Some(crate::oss_cmd::prepare(&mut config, &cwd).await?) };
    let yolo = args.options.yolo || session_args.is_some_and(|session| session.options.yolo);
    let mut runtime_config = runtime_config(&config, &cwd)?.with_max_tool_iterations(if yolo {
        0
    } else {
        args.max_tool_iterations
    });
    if let Some((schema, _)) = &output_schema {
        runtime_config = runtime_config.with_response_schema(schema.clone());
    }
    if !args.ephemeral && std::env::var_os("APHRODY_NO_ROLLOUT").is_none() {
        runtime_config = runtime_config.with_rollout_path(profile_sessions_dir(&config)?);
    }
    let model = if args.stub {
        ModelChoice::stub(StubModelClient::new(
            &runtime_config.model,
            vec![ScriptedTurn::text(format!("stub agent: received prompt -> {prompt}"))],
        ))
    } else {
        let client =
            ModelFactory::build(&config).map_err(|error| miette::miette!("exec: {error}"))?;
        if output_schema.is_some() && !client.capabilities().json_schema {
            return Err(miette::miette!(
                "exec: selected model does not support JSON Schema output"
            ));
        }
        ModelChoice::from_client(client)
    };
    let mut thread_id = aphrody_agent_proto::Event::new(EventMsg::TurnStarted).id;
    let profiled_tools = runtime_config.tool_profile.is_some();
    let mut builder = AgentRuntime::builder().config(runtime_config).model(model).history(history);
    if let Some(session) = selected {
        if matches!(args.command, Some(ExecCommand::Fork(_))) {
            builder = builder.forked_from(session.meta.id);
        } else {
            thread_id = session.meta.id;
            if !args.ephemeral && std::env::var_os("APHRODY_NO_ROLLOUT").is_none() {
                builder = builder.resume_path(session.path);
            }
        }
    }
    let builder = builder.session_id(thread_id.clone());
    let runtime = if profiled_tools { builder.build_profiled().await } else { builder.build() }
        .map_err(|error| miette::miette!("exec: {error}"))?;
    emit(&ThreadEvent::ThreadStarted(ThreadStartedEvent { thread_id }), args.json)?;
    let mut handle = runtime.spawn().await.map_err(|error| miette::miette!("exec: {error}"))?;
    let mut events =
        handle.events().ok_or_else(|| miette::miette!("exec: event stream unavailable"))?;
    handle
        .submit(Op::UserInput { items })
        .map_err(|_| miette::miette!("exec: session stopped before accepting input"))?;
    let mut translator = EngineEvents::default();
    let mut final_message = None;
    let mut failure = None;
    let mut completed = false;
    let signal = tokio::signal::ctrl_c();
    tokio::pin!(signal);
    loop {
        tokio::select! {
            event = events.recv() => {
                let Some(event) = event else { break };
                let auto_approve = yolo
                    || std::env::var_os("APHRODY_AUTO_APPROVE").is_some()
                    || std::env::var_os("APHRODY_NHITL").is_some()
                    || std::env::var_os("APHRODY_YOLO").is_some();
                let approval_decision = if auto_approve {
                    ReviewDecision::Approved
                } else {
                    ReviewDecision::Denied
                };
                if let EventMsg::ExecApprovalRequest { id, .. } = &event.msg {
                    let _ = handle.submit(Op::ExecApproval { id: id.clone(), decision: approval_decision.clone() });
                }
                if let EventMsg::ApplyPatchApprovalRequest { id, .. } = &event.msg {
                    let _ = handle.submit(Op::PatchApproval { id: id.clone(), decision: approval_decision });
                }
                if let EventMsg::Error { message } = &event.msg {
                    failure = Some(message.clone());
                }
                if let EventMsg::TurnComplete { last_agent_message } = &event.msg {
                    final_message.clone_from(last_agent_message);
                    completed = true;
                    if let Some((_, validator)) = &output_schema
                        && let Err(error) = validate_output_message(validator, final_message.as_deref())
                    {
                        failure = Some(error.to_string());
                    }
                }
                for translated in translator.translate(&event.msg) {
                    if (!matches!(translated, ThreadEvent::TurnCompleted(_)) || failure.is_none())
                        && let Err(error) = emit(&translated, args.json)
                    {
                        failure = Some(error.to_string());
                        break;
                    }
                }
                if failure.is_some() || completed { break; }
            }
            signal_result = &mut signal => {
                failure = Some(match signal_result {
                    Ok(()) => "turn interrupted".to_owned(),
                    Err(error) => format!("failed to receive interrupt: {error}"),
                });
                let _ = handle.submit(Op::Interrupt);
                break;
            }
        }
    }
    let _ = handle.submit(Op::Shutdown);
    handle.join().await.into_diagnostic()?;
    if !completed && failure.is_none() {
        failure = Some("session closed before completing its turn".to_owned());
    }
    if let Some(message) = failure {
        emit(
            &ThreadEvent::TurnFailed(TurnFailedEvent {
                error: ThreadErrorEvent { message: message.clone() },
            }),
            args.json,
        )?;
        return Err(miette::miette!("exec: {message}"));
    }
    if let Some(path) = args.output_last_message {
        std::fs::write(path, final_message.as_deref().unwrap_or("")).into_diagnostic()?;
    }
    if !args.json
        && let Some(message) = final_message
    {
        println!("{message}");
    }
    Ok(())
}

#[derive(Default)]
struct EngineEvents {
    next_id: usize,
    usage: Usage,
    tools: BTreeMap<String, ThreadItem>,
}

impl EngineEvents {
    fn item(&mut self, details: ThreadItemDetails) -> ThreadItem {
        let id = format!("item_{}", self.next_id);
        self.next_id += 1;
        ThreadItem { id, details }
    }

    fn translate(&mut self, event: &EventMsg) -> Vec<ThreadEvent> {
        match event {
            EventMsg::TurnStarted => vec![ThreadEvent::TurnStarted(TurnStartedEvent {})],
            EventMsg::AgentMessage { text } => {
                let item = self
                    .item(ThreadItemDetails::AgentMessage(AgentMessageItem { text: text.clone() }));
                vec![ThreadEvent::ItemCompleted(ItemCompletedEvent { item })]
            },
            EventMsg::ToolCallBegin { call_id, name } => {
                let item = self.item(ThreadItemDetails::McpToolCall(McpToolCallItem {
                    server: "aphrody".into(),
                    tool: name.clone(),
                    arguments: serde_json::Value::Null,
                    result: None,
                    error: None,
                    status: McpToolCallStatus::InProgress,
                }));
                self.tools.insert(call_id.clone(), item.clone());
                vec![ThreadEvent::ItemStarted(ItemStartedEvent { item })]
            },
            EventMsg::ToolCallEnd { call_id, ok } => {
                let Some(mut item) = self.tools.remove(call_id) else { return Vec::new() };
                if let ThreadItemDetails::McpToolCall(tool) = &mut item.details {
                    tool.status =
                        if *ok { McpToolCallStatus::Completed } else { McpToolCallStatus::Failed };
                }
                vec![ThreadEvent::ItemCompleted(ItemCompletedEvent { item })]
            },
            EventMsg::TokenCount { input, output, .. } => {
                self.usage.input_tokens = self
                    .usage
                    .input_tokens
                    .saturating_add(i64::try_from(*input).unwrap_or(i64::MAX));
                self.usage.output_tokens = self
                    .usage
                    .output_tokens
                    .saturating_add(i64::try_from(*output).unwrap_or(i64::MAX));
                Vec::new()
            },
            EventMsg::TurnComplete { .. } => {
                vec![ThreadEvent::TurnCompleted(TurnCompletedEvent { usage: self.usage.clone() })]
            },
            EventMsg::Error { message } => {
                vec![ThreadEvent::Error(ThreadErrorEvent { message: message.clone() })]
            },
            _ => Vec::new(),
        }
    }
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    use super::*;

    #[derive(Parser)]
    struct TestCli {
        #[command(flatten)]
        exec: ExecArgs,
    }

    #[test]
    fn codex_exec_resume_and_fork_arguments_parse() {
        let cli = TestCli::try_parse_from(["exec", "--json", "resume", "--last", "continue"])
            .expect("resume --last accepts a prompt");
        let Some(ExecCommand::Resume(args)) = cli.exec.command else { panic!("resume") };
        assert!(cli.exec.json);
        assert_eq!(args.effective_prompt(), Some("continue"));
        let cli =
            TestCli::try_parse_from(["exec", "fork", "session-id", "new direction", "--stub"])
                .expect("global exec flags work after subcommands");
        let Some(ExecCommand::Fork(args)) = cli.exec.command else { panic!("fork") };
        assert!(cli.exec.stub);
        assert_eq!(args.session_id.as_deref(), Some("session-id"));
        assert_eq!(args.effective_prompt(), Some("new direction"));
    }

    #[test]
    fn output_schema_is_loaded_and_final_response_is_validated() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("answer.schema.json");
        std::fs::write(&path, br##"{"type":"object","properties":{"answer":{"type":"integer"}},"required":["answer"],"additionalProperties":false}"##).unwrap();
        let parsed =
            TestCli::try_parse_from(["exec", "--output-schema", path.to_str().unwrap(), "answer"])
                .expect("parse schema option");
        assert_eq!(parsed.exec.output_schema.as_deref(), Some(path.as_path()));
        let (schema, validator) = load_output_schema(&path).unwrap();
        assert_eq!(schema["type"], "object");
        assert!(validate_output_message(&validator, Some(r#"{"answer":42}"#)).is_ok());
        assert!(validate_output_message(&validator, Some(r#"{"answer":"wrong"}"#)).is_err());
        assert!(validate_output_message(&validator, Some("not JSON")).is_err());
        assert!(validate_output_message(&validator, None).is_err());

        std::fs::write(&path, br##"{"$ref":"https://example.invalid/schema"}"##).unwrap();
        assert!(load_output_schema(&path).is_err());
        std::fs::write(&path, br##"{"type":"not-a-json-type"}"##).unwrap();
        assert!(load_output_schema(&path).is_err());
    }

    #[tokio::test]
    async fn invalid_stub_response_does_not_write_last_message() {
        let directory = tempfile::tempdir().unwrap();
        let schema = directory.path().join("response.schema.json");
        let last_message = directory.path().join("last-message.json");
        std::fs::write(&schema, br#"{"type":"object","required":["answer"]}"#).unwrap();
        let args = ExecArgs {
            prompt: Some("answer".into()),
            stub: true,
            ephemeral: true,
            skip_git_repo_check: true,
            output_schema: Some(schema),
            output_last_message: Some(last_message.clone()),
            ..ExecArgs::default()
        };
        let error = run(args, CliOverrides::default()).await.unwrap_err().to_string();
        assert!(error.contains("final response is not JSON"), "{error}");
        assert!(!last_message.exists());
    }

    #[test]
    fn image_arguments_attach_existing_files() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let image = directory.path().join("frame.png");
        std::fs::write(&image, b"image bytes").expect("fixture");
        let cli = TestCli::try_parse_from([
            "exec",
            "--image",
            image.to_str().expect("UTF-8 path"),
            "describe",
        ])
        .expect("parse --image");
        let items = input_items("describe".into(), &cli.exec.image).expect("build input items");
        assert!(matches!(&items[0], InputItem::Text { text } if text == "describe"));
        assert!(matches!(&items[1], InputItem::Image { path: Some(path), url: None }
            if path == &image.canonicalize().expect("canonical image")));
        assert!(input_items("describe".into(), &[directory.path().join("missing.png")]).is_err());
    }

    #[test]
    fn piped_input_preserves_explicit_prompt() {
        assert_eq!(
            prompt_from_input(Some("review"), "patch").unwrap(),
            "review\n\n<stdin>\npatch\n</stdin>"
        );
        assert_eq!(prompt_from_input(Some("-"), "  task\n").unwrap(), "task");
        assert!(prompt_from_input(None, "  ").is_err());
    }

    #[test]
    fn events_keep_tool_ids_and_accumulate_usage() {
        let mut events = EngineEvents::default();
        let started = events
            .translate(&EventMsg::ToolCallBegin { call_id: "call-a".into(), name: "shell".into() });
        let finished =
            events.translate(&EventMsg::ToolCallEnd { call_id: "call-a".into(), ok: false });
        let ThreadEvent::ItemStarted(started) = &started[0] else { panic!("started") };
        let ThreadEvent::ItemCompleted(finished) = &finished[0] else { panic!("completed") };
        assert_eq!(started.item.id, finished.item.id);
        let ThreadItemDetails::McpToolCall(tool) = &finished.item.details else { panic!("tool") };
        assert_eq!(tool.status, McpToolCallStatus::Failed);
        events.translate(&EventMsg::TokenCount { input: 4, output: 3, total: 7 });
        events.translate(&EventMsg::TokenCount { input: 8, output: 2, total: 10 });
        let completed = events.translate(&EventMsg::TurnComplete { last_agent_message: None });
        let ThreadEvent::TurnCompleted(completed) = &completed[0] else { panic!("turn") };
        assert_eq!(completed.usage.input_tokens, 12);
        assert_eq!(completed.usage.output_tokens, 5);
    }

    #[test]
    fn profile_state_keeps_sessions_and_rag_outside_the_agent_home() {
        let state = Path::new("state");
        let dbfr = state.join("workspaces/dbfr");
        let root = profile_state_root_at(state, &dbfr, Some("dbfr"));
        assert_eq!(root, state.join("profiles/dbfr"));
        assert_eq!(root.join("sessions"), state.join("profiles/dbfr/sessions"));
        assert_eq!(root.join("rag/index.db"), state.join("profiles/dbfr/rag/index.db"));
        let legacy = state.join("workspace-shenron");
        assert_eq!(profile_state_root_at(state, &legacy, Some("shenron")), legacy);
        assert_eq!(profile_state_root_at(state, &legacy, None), state);
    }

    #[test]
    fn auto_compact_limit_is_checked_before_runtime_propagation() {
        assert_eq!(auto_compact_token_limit(None).unwrap(), None);
        assert_eq!(auto_compact_token_limit(Some(96_000)).unwrap(), Some(96_000));
        assert!(auto_compact_token_limit(Some(-1)).is_err());
    }

    #[test]
    fn runtime_config_leads_with_the_unified_doctrine() {
        let cwd = std::env::current_dir().expect("cwd");
        let env = |_: &str| None;
        let layers = vec![ConfigLayer::new(
            LayerSource::Builtin,
            aphrody_config::builtin_providers_layer_value(&env),
        )];
        let (config, _) =
            aphrody_config::resolve(layers, &CliOverrides::default(), "llama", &BTreeMap::new())
                .expect("resolve builtin config");
        let runtime = runtime_config(&config, &cwd).expect("runtime config");
        let prompt = runtime.system_prompt.as_deref().expect("system prompt");
        assert!(
            prompt.starts_with(aphrody_prompts::APHRODY_UNIFIED_SYSTEM_PROMPT),
            "the unified doctrine must lead the assembled system prompt"
        );
        // YOLO contract: the turn loop is never capped mid-objective.
        assert_eq!(runtime.max_tool_iterations, 0);
    }
    #[test]
    fn default_and_explicit_domain_profiles_reach_the_local_runtime_home() {
        let cwd = tempfile::tempdir().unwrap();
        for (explicit, expected) in [(None, "aphrody"), (Some("dbfr"), "dbfr"), (Some("ie"), "ie")]
        {
            let layers = vec![
                ConfigLayer::new(
                    LayerSource::Builtin,
                    aphrody_config::builtin_providers_layer_value(&|_| None),
                ),
                ConfigLayer::new(
                    LayerSource::User,
                    toml::from_str(
                        "profile = 'aphrody'\n[profiles.aphrody]\n[profiles.dbfr]\n[profiles.ie]\n",
                    )
                    .unwrap(),
                ),
            ];
            let overrides =
                CliOverrides { profile: explicit.map(str::to_owned), ..Default::default() };
            let (config, _) =
                aphrody_config::resolve(layers, &overrides, "llama", &BTreeMap::new()).unwrap();
            assert_eq!(config.active_profile.as_deref(), Some(expected));
            let runtime = runtime_config(&config, cwd.path()).unwrap();
            assert_eq!(
                runtime.live_agent_home_workspace,
                Some(profile_workspace(&config).unwrap())
            );
        }
    }
    #[test]
    fn local_model_conversations_stay_inside_the_selected_profile() {
        let root = tempfile::tempdir().unwrap();
        let aphrody = root.path().join("aphrody");
        let dbfr = root.path().join("dbfr");
        for (profile, text) in [(&aphrody, "aphrody conversation"), (&dbfr, "dbfr conversation")] {
            std::fs::create_dir_all(profile.join(".coord/shared")).unwrap();
            std::fs::write(profile.join(".coord/shared/TRANSCRIPTS.md"), text).unwrap();
        }
        assert_eq!(profile_conversations(&aphrody).as_deref(), Some("aphrody conversation"));
        assert_eq!(profile_conversations(&dbfr).as_deref(), Some("dbfr conversation"));
        #[cfg(unix)]
        {
            std::fs::remove_file(dbfr.join(".coord/shared/TRANSCRIPTS.md")).unwrap();
            std::os::unix::fs::symlink(
                aphrody.join(".coord/shared/TRANSCRIPTS.md"),
                dbfr.join(".coord/shared/TRANSCRIPTS.md"),
            )
            .unwrap();
            assert!(
                profile_conversations(&dbfr).is_none(),
                "a cross-domain symlink must not enter the model prompt"
            );
        }
    }
}
