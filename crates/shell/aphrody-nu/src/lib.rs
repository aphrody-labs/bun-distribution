// SPDX-License-Identifier: Apache-2.0
//! Nushell, embedded: the shell subsystem of Aphrody OS.
//!
//! [`NuShell`] prepares one engine from Nushell's language, shell and extra command sets,
//! `$env.config`, the parent environment and standard library, then evaluates
//! agent code on a private clone of it, so calls never leak variables or definitions into
//! each other. Output is captured (stdout and stderr of external commands included) and
//! returned as structured JSON: tables become arrays of records, not text to re-parse.
//! Evaluation is interruptible through Nushell's own signals, which the timeout uses.

use std::{
    path::{Path, PathBuf},
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use aphrody_subsystem::{
    SkillManifest, SkillStep, SubsystemError, SystemSubsystem, ToolDefinition,
};
use async_trait::async_trait;
use nu_engine::eval_block;
use nu_protocol::{
    Config, IntoValue, PipelineData, Record, ShellError, Signals, Span, Value,
    debugger::WithoutDebug,
    engine::{EngineState, Stack, StateWorkingSet},
    format_cli_error, record,
};
use serde_json::{Map, Value as Json, json};

mod utils;

/// Default upper bound for one evaluation.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);

/// A prepared Nushell engine.
#[derive(Clone)]
pub struct NuShell {
    base: Arc<EngineState>,
}

/// The result of one evaluation.
#[derive(Debug, Clone, PartialEq)]
pub struct NuOutput {
    /// The pipeline's value as JSON.
    pub value: Json,
    /// The working directory after evaluation (a `cd` in the code is honoured).
    pub cwd: String,
}

impl NuShell {
    /// Build the engine with `cwd` as the initial directory.
    ///
    /// # Errors
    /// Returns the message of a standard-library load failure.
    pub fn new(cwd: &Path) -> Result<Self, String> {
        let mut engine = nu_cmd_lang::create_default_context();
        engine = nu_command::add_shell_command_context(engine);
        engine = nu_cmd_extra::add_extra_command_context(engine);
        let mut working_set = StateWorkingSet::new(&engine);
        working_set.add_decl(Box::new(utils::AphrodyUtils));
        engine
            .merge_delta(working_set.render())
            .map_err(|error| format!("register Aphrody utility commands: {error}"))?;
        engine.add_env_var("config".into(), Config::default().into_value(Span::unknown()));
        engine.add_env_var("ENV_CONVERSIONS".into(), Value::record(record! {}, Span::unknown()));
        for (name, value) in std::env::vars() {
            engine.add_env_var(name, Value::string(value, Span::unknown()));
        }
        engine.add_env_var("PWD".into(), Value::string(cwd.to_string_lossy(), Span::unknown()));
        nu_std::load_standard_library(&mut engine).map_err(|error| format!("{error:?}"))?;
        Ok(Self { base: Arc::new(engine) })
    }

    /// Build the engine in the process's current directory.
    ///
    /// # Errors
    /// See [`NuShell::new`].
    pub fn from_current_dir() -> Result<Self, String> {
        let cwd = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        Self::new(&cwd)
    }

    /// Evaluate `code`. `vars` become `$env` entries of this evaluation only, which is how
    /// callers pass data without splicing it into code. Blocking: run it off async threads.
    ///
    /// # Errors
    /// A parse, compile or runtime error, rendered as Nushell reports it.
    pub fn eval(
        &self,
        code: &str,
        cwd: Option<&Path>,
        vars: &Map<String, Json>,
        interrupt: Arc<AtomicBool>,
    ) -> Result<NuOutput, String> {
        let mut engine = (*self.base).clone();
        engine.set_signals(Signals::new(interrupt));
        let mut stack = Stack::new().capture_all();
        if let Some(cwd) = cwd {
            let cwd =
                cwd.canonicalize().map_err(|error| format!("cwd {}: {error}", cwd.display()))?;
            stack.add_env_var("PWD".into(), Value::string(plain_path(&cwd), Span::unknown()));
        }
        for (name, value) in vars {
            stack.add_env_var(name.clone(), json_to_nu(value));
        }

        let (block, delta) = {
            let mut working_set = StateWorkingSet::new(&engine);
            let block = nu_parser::parse(&mut working_set, Some("agent"), code.as_bytes(), false);
            if let Some(error) = working_set.parse_errors.first() {
                return Err(format_cli_error(None, &working_set, error, None));
            }
            if let Some(error) = working_set.compile_errors.first() {
                return Err(format_cli_error(None, &working_set, error, None));
            }
            (block, working_set.render())
        };
        engine.merge_delta(delta).map_err(|error| render(&engine, &error))?;
        let output = eval_block::<WithoutDebug>(&engine, &mut stack, &block, PipelineData::empty())
            .map_err(|error| render(&engine, &error))?;
        let value = collect(output.body, &engine)?;
        let cwd = engine
            .cwd(Some(&stack))
            .map(|path| path.to_string_lossy().into_owned())
            .unwrap_or_default();
        Ok(NuOutput { value: nu_to_json(&value, engine.get_config()), cwd })
    }

    /// Every command the engine knows, with its one-line description, optionally filtered by
    /// a case-insensitive substring of the name or description.
    #[must_use]
    pub fn commands(&self, filter: Option<&str>) -> Vec<Json> {
        let needle = filter.map(str::to_lowercase);
        self.base
            .get_decls_sorted(false)
            .into_iter()
            .filter_map(|(name, id)| {
                let name = String::from_utf8_lossy(&name).into_owned();
                let decl = self.base.get_decl(id);
                let description = decl.description().to_owned();
                let keep = needle.as_ref().is_none_or(|needle| {
                    name.to_lowercase().contains(needle) || description.to_lowercase().contains(needle)
                });
                keep.then(|| json!({"name": name, "description": description, "category": format!("{:?}", decl.signature().category)}))
            })
            .collect()
    }

    /// The full help of one command (signature, flags, examples), as Nushell prints it.
    ///
    /// # Errors
    /// When the command is unknown or `help` fails.
    pub fn help(&self, command: &str) -> Result<String, String> {
        if self.base.find_decl(command.as_bytes(), &[]).is_none() {
            return Err(format!("unknown command: {command}"));
        }
        let mut vars = Map::new();
        vars.insert("APHRODY_NU_HELP".into(), Json::String(command.to_owned()));
        let output =
            self.eval("help $env.APHRODY_NU_HELP | ansi strip", None, &vars, Arc::default())?;
        Ok(output.value.as_str().map_or_else(|| output.value.to_string(), str::to_owned))
    }
}

/// A path without the Windows verbatim prefix `canonicalize` adds (`\\?\C:\x` becomes `C:\x`);
/// verbatim UNC paths keep their prefix, which their meaning depends on.
fn plain_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(rest) if !rest.starts_with(r"UNC\") => rest.to_owned(),
        _ => text.into_owned(),
    }
}

fn render(engine: &EngineState, error: &ShellError) -> String {
    format_cli_error(None, &StateWorkingSet::new(engine), error, None)
}

/// Drain a pipeline into one value. Byte streams (external commands) become their text,
/// stdout then stderr; a non-zero exit is reported but does not discard the output.
fn collect(body: PipelineData, engine: &EngineState) -> Result<Value, String> {
    if let PipelineData::ByteStream(stream, ..) = body {
        let span = stream.span();
        return match stream.into_child() {
            Ok(mut child) => {
                child.ignore_error(true);
                let output = child.wait_with_output().map_err(|error| render(engine, &error))?;
                let mut text =
                    String::from_utf8_lossy(&output.stdout.unwrap_or_default()).into_owned();
                let stderr =
                    String::from_utf8_lossy(&output.stderr.unwrap_or_default()).into_owned();
                if !stderr.is_empty() {
                    if !text.is_empty() && !text.ends_with('\n') {
                        text.push('\n');
                    }
                    text.push_str(&stderr);
                }
                Ok(Value::string(text, span))
            },
            Err(stream) => {
                let mut buffer = Vec::new();
                stream.write_to(&mut buffer).map_err(|error| render(engine, &error))?;
                Ok(Value::string(String::from_utf8_lossy(&buffer), span))
            },
        };
    }
    let value = body.into_value(Span::unknown()).map_err(|error| render(engine, &error))?;
    if let Value::Error { error, .. } = &value {
        return Err(render(engine, error));
    }
    Ok(value)
}

/// JSON for a Nushell value. Sizes are bytes, durations nanoseconds, dates RFC 3339; closures,
/// ranges and cell paths use their display form.
#[must_use]
pub fn nu_to_json(value: &Value, config: &Config) -> Json {
    match value {
        Value::Nothing { .. } => Json::Null,
        Value::Bool { val, .. } => json!(val),
        Value::Int { val, .. } | Value::Duration { val, .. } => json!(val),
        Value::Float { val, .. } => {
            serde_json::Number::from_f64(*val).map_or(Json::Null, Json::Number)
        },
        Value::String { val, .. } | Value::Glob { val, .. } => json!(val),
        Value::Filesize { val, .. } => json!(val.get()),
        Value::Date { val, .. } => json!(val.to_rfc3339()),
        Value::Record { val, .. } => Json::Object(
            val.iter().map(|(key, value)| (key.clone(), nu_to_json(value, config))).collect(),
        ),
        Value::List { vals, .. } => {
            Json::Array(vals.iter().map(|value| nu_to_json(value, config)).collect())
        },
        Value::Binary { val, .. } => Json::Array(val.iter().map(|byte| json!(byte)).collect()),
        Value::Error { error, .. } => json!({ "error": error.to_string() }),
        other => json!(other.to_expanded_string(", ", config)),
    }
}

/// A Nushell value for JSON input.
#[must_use]
pub fn json_to_nu(value: &Json) -> Value {
    let span = Span::unknown();
    match value {
        Json::Null => Value::nothing(span),
        Json::Bool(val) => Value::bool(*val, span),
        Json::Number(number) => number.as_i64().map_or_else(
            || Value::float(number.as_f64().unwrap_or(f64::NAN), span),
            |int| Value::int(int, span),
        ),
        Json::String(text) => Value::string(text, span),
        Json::Array(items) => Value::list(items.iter().map(json_to_nu).collect(), span),
        Json::Object(fields) => {
            let mut record = Record::new();
            for (key, value) in fields {
                record.push(key, json_to_nu(value));
            }
            Value::record(record, span)
        },
    }
}

/// The shell subsystem: `nu_eval`, `nu_commands`, `nu_help`.
pub struct ShellSubsystem {
    shell: NuShell,
}

impl ShellSubsystem {
    #[must_use]
    pub fn new(shell: NuShell) -> Self {
        Self { shell }
    }
}

#[async_trait]
impl SystemSubsystem for ShellSubsystem {
    fn name(&self) -> &'static str {
        "shell"
    }

    fn description(&self) -> &'static str {
        "Nushell, embedded: structured pipelines over files, processes, network and data."
    }

    fn tools(&self) -> Vec<ToolDefinition> {
        vec![
            ToolDefinition::new(
                "nu_eval",
                "Evaluate Nushell code and return its value as JSON (tables are arrays of records). \
                 Pass data through `vars` (read as $env.<name>) instead of splicing it into code. \
                 External command output is captured, stdout then stderr.",
                json!({
                    "type": "object",
                    "properties": {
                        "code": { "type": "string", "description": "Nushell source." },
                        "cwd": { "type": "string", "description": "Working directory (default: the kernel's)." },
                        "vars": { "type": "object", "description": "Values exposed as $env.<name> for this call." },
                        "timeout_secs": { "type": "integer", "minimum": 1, "maximum": 3600 }
                    },
                    "required": ["code"]
                }),
            ),
            ToolDefinition::new(
                "nu_commands",
                "List Nushell commands with their descriptions, optionally filtered.",
                json!({"type": "object", "properties": {"filter": {"type": "string"}}}),
            )
            .read_only(),
            ToolDefinition::new(
                "nu_help",
                "Full help of one Nushell command: signature, flags, examples.",
                json!({"type": "object", "properties": {"command": {"type": "string"}}, "required": ["command"]}),
            )
            .read_only(),
        ]
    }

    async fn call(&self, tool: &str, arguments: Json) -> Result<Json, SubsystemError> {
        let text = |key: &str| arguments.get(key).and_then(Json::as_str).map(str::to_owned);
        match tool {
            "nu_eval" => {
                let code = text("code")
                    .ok_or_else(|| SubsystemError::InvalidArguments("`code` is required".into()))?;
                let cwd = text("cwd").map(PathBuf::from);
                let vars = match arguments.get("vars") {
                    None | Some(Json::Null) => Map::new(),
                    Some(Json::Object(vars)) => vars.clone(),
                    Some(_) => {
                        return Err(SubsystemError::InvalidArguments(
                            "`vars` must be an object".into(),
                        ));
                    },
                };
                let timeout = arguments
                    .get("timeout_secs")
                    .and_then(Json::as_u64)
                    .map_or(DEFAULT_TIMEOUT, |secs| Duration::from_secs(secs.clamp(1, 3600)));
                let interrupt = Arc::new(AtomicBool::new(false));
                let shell = self.shell.clone();
                let flag = Arc::clone(&interrupt);
                let job = tokio::task::spawn_blocking(move || {
                    shell.eval(&code, cwd.as_deref(), &vars, flag)
                });
                let output = match tokio::time::timeout(timeout, job).await {
                    Ok(joined) => {
                        joined.map_err(|error| SubsystemError::Failed(error.to_string()))?
                    },
                    Err(_) => {
                        interrupt.store(true, Ordering::Relaxed);
                        return Err(SubsystemError::Failed(format!(
                            "nu_eval timed out after {}s",
                            timeout.as_secs()
                        )));
                    },
                }
                .map_err(SubsystemError::Failed)?;
                Ok(json!({ "value": output.value, "cwd": output.cwd }))
            },
            "nu_commands" => Ok(json!(self.shell.commands(text("filter").as_deref()))),
            "nu_help" => {
                let command = text("command").ok_or_else(|| {
                    SubsystemError::InvalidArguments("`command` is required".into())
                })?;
                let shell = self.shell.clone();
                let help = tokio::task::spawn_blocking(move || shell.help(&command))
                    .await
                    .map_err(|error| SubsystemError::Failed(error.to_string()))?
                    .map_err(SubsystemError::Failed)?;
                Ok(json!(help))
            },
            other => Err(SubsystemError::UnknownTool(other.to_owned())),
        }
    }

    fn skills(&self) -> Vec<SkillManifest> {
        vec![
            SkillManifest {
                name: "largest_files".into(),
                description: "The 20 largest files directly under a directory, largest first."
                    .into(),
                parameters: vec!["path".into()],
                steps: vec![SkillStep {
                    tool: "nu_eval".into(),
                    arguments: json!({
                        "code": "ls --all $env.path | where type == file | sort-by size --reverse | first 20 | select name size modified",
                        "vars": { "path": "{{path}}" }
                    }),
                }],
            },
            SkillManifest {
                name: "system_snapshot".into(),
                description: "Host, CPU, memory and disk facts, plus the 10 busiest processes."
                    .into(),
                parameters: vec![],
                steps: vec![SkillStep {
                    tool: "nu_eval".into(),
                    arguments: json!({
                        "code": "{ host: (sys host), cpu: (sys cpu | length), mem: (sys mem), disks: (sys disks), top: (ps | sort-by cpu --reverse | first 10 | select pid name cpu mem) }"
                    }),
                }],
            },
        ]
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn shell() -> NuShell {
        NuShell::from_current_dir().expect("engine")
    }

    #[test]
    fn tables_come_back_as_records() {
        let out = shell()
            .eval("[[a b]; [1 x] [2 y]] | where a > 1", None, &Map::new(), Arc::default())
            .expect("eval");
        assert_eq!(out.value, json!([{"a": 2, "b": "y"}]));
    }

    #[test]
    fn vars_are_env_and_not_code() {
        let mut vars = Map::new();
        vars.insert("text".into(), json!("; exit 1"));
        let out =
            shell().eval("$env.text | str length", None, &vars, Arc::default()).expect("eval");
        assert_eq!(out.value, json!(8));
    }

    #[test]
    fn parse_errors_are_reported_not_panicked() {
        let error =
            shell().eval("let x = ", None, &Map::new(), Arc::default()).expect_err("parse error");
        assert!(error.contains("Error"), "{error}");
    }

    #[test]
    fn evaluations_do_not_leak_into_each_other() {
        let shell = shell();
        shell.eval("def leaked [] { 1 }", None, &Map::new(), Arc::default()).expect("def");
        assert!(shell.eval("leaked", None, &Map::new(), Arc::default()).is_err());
    }

    #[test]
    fn external_command_output_is_captured() {
        let out =
            shell().eval("^cargo --version", None, &Map::new(), Arc::default()).expect("eval");
        assert!(
            out.value.as_str().is_some_and(|text| text.starts_with("cargo ")),
            "{:?}",
            out.value
        );
    }

    #[test]
    fn json_round_trip_keeps_structure() {
        let input = json!({"n": 1, "f": 1.5, "s": "x", "l": [true, null], "r": {"k": "v"}});
        assert_eq!(nu_to_json(&json_to_nu(&input), &Config::default()), input);
    }

    #[test]
    fn full_nushell_surface_is_registered() {
        let names = shell()
            .commands(None)
            .into_iter()
            .filter_map(|command| command.get("name").and_then(Json::as_str).map(str::to_owned))
            .collect::<std::collections::HashSet<_>>();
        for required in ["help", "open", "http", "random", "aphrody utils"] {
            assert!(names.contains(required), "missing Nushell command: {required}");
        }
    }

    #[test]
    fn utility_command_rejects_shell_expressions_before_ipc() {
        let error = shell()
            .eval("aphrody utils 'grep;rm'", None, &Map::new(), Arc::default())
            .expect_err("shell syntax must not reach the kernel");
        assert!(error.contains("utility names cannot be paths or shell expressions"), "{error}");
    }

    #[tokio::test]
    async fn subsystem_times_out_and_interrupts() {
        let subsystem = ShellSubsystem::new(shell());
        let error = subsystem
            .call("nu_eval", json!({"code": "loop { sleep 10ms }", "timeout_secs": 1}))
            .await
            .expect_err("timeout");
        assert!(error.to_string().contains("timed out"));
    }
}
