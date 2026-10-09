// SPDX-License-Identifier: Apache-2.0
//! Nushell as an external process: the shell subsystem of Aphrody OS.
//!
//! [`NuShell`] runs the `nu` binary found on `PATH` (a maintained Rust CLI) instead of embedding its
//! engine, so no `nu-*` crate is built here. Each call is a fresh process: variables and
//! definitions never leak between calls, output is returned as structured JSON (`to json`), and the
//! timeout kills the process.

use aphrody_proc::NoWindow as _;
use std::{
    env,
    path::{Path, PathBuf},
    process::Stdio,
    time::Duration,
};

use aphrody_subsystem::{
    SkillManifest, SkillStep, SubsystemError, SystemSubsystem, ToolDefinition,
};
use async_trait::async_trait;
use serde_json::{Map, Value as Json, json};
use tokio::{io::AsyncReadExt, process::Command};

/// Default upper bound for one evaluation.
pub const DEFAULT_TIMEOUT: Duration = Duration::from_secs(120);

/// A handle on the `nu` executable and the default working directory.
#[derive(Clone, Debug)]
pub struct NuShell {
    binary: Option<PathBuf>,
    cwd: PathBuf,
}

/// The result of one evaluation.
#[derive(Debug, Clone, PartialEq)]
pub struct NuOutput {
    /// The pipeline's value as JSON (raw text when it is not JSON).
    pub value: Json,
    /// The working directory of the evaluation.
    pub cwd: String,
}

fn find_nu() -> Option<PathBuf> {
    let name = if cfg!(windows) { "nu.exe" } else { "nu" };
    env::split_paths(&env::var_os("PATH")?).map(|dir| dir.join(name)).find(|path| path.is_file())
}

impl NuShell {
    /// Locate `nu` and fix `cwd` as the default directory. A missing binary is reported by the
    /// calls, not here, so the kernel still starts without it.
    ///
    /// # Errors
    /// Never fails today; the signature is kept for callers.
    pub fn new(cwd: &Path) -> Result<Self, String> {
        Ok(Self { binary: find_nu(), cwd: cwd.to_path_buf() })
    }

    /// Build the handle in the process's current directory.
    ///
    /// # Errors
    /// See [`NuShell::new`].
    pub fn from_current_dir() -> Result<Self, String> {
        Self::new(&env::current_dir().unwrap_or_else(|_| PathBuf::from(".")))
    }

    async fn run(
        &self,
        code: &str,
        cwd: Option<&Path>,
        vars: &Map<String, Json>,
        timeout: Duration,
    ) -> Result<(String, String), String> {
        let binary = self
            .binary
            .as_ref()
            .ok_or_else(|| "`nu` is not installed (cargo install nu --locked)".to_owned())?;
        let dir = cwd.map_or_else(|| self.cwd.clone(), Path::to_path_buf);
        let mut command = Command::new(binary).no_window();
        command
            .args(["--no-config-file", "--commands", code])
            .current_dir(&dir)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);
        for (name, value) in vars {
            let text = value.as_str().map_or_else(|| value.to_string(), str::to_owned);
            command.env(name, text);
        }
        let mut child = command.spawn().map_err(|error| format!("spawn nu: {error}"))?;
        let mut stdout = child.stdout.take().ok_or("nu stdout")?;
        let mut stderr = child.stderr.take().ok_or("nu stderr")?;
        let work = async {
            let (mut out, mut err) = (String::new(), String::new());
            let (a, b) = tokio::join!(stdout.read_to_string(&mut out), stderr.read_to_string(&mut err));
            a.map_err(|error| error.to_string())?;
            b.map_err(|error| error.to_string())?;
            let status = child.wait().await.map_err(|error| error.to_string())?;
            if status.success() { Ok((out, err)) } else { Err(err.trim().to_owned()) }
        };
        tokio::time::timeout(timeout, work)
            .await
            .map_err(|_| format!("nu timed out after {}s", timeout.as_secs()))?
    }

    /// Evaluate `code`; its value is serialised with `to json`. `vars` are exposed as `$env.<name>`
    /// of this call only (non-string values arrive as JSON text: use `from json`).
    ///
    /// # Errors
    /// A parse or runtime error as `nu` prints it, a spawn failure or the timeout.
    pub async fn eval(
        &self,
        code: &str,
        cwd: Option<&Path>,
        vars: &Map<String, Json>,
        timeout: Duration,
    ) -> Result<NuOutput, String> {
        let wrapped = format!("do {{\n{code}\n}} | to json --raw");
        let (out, _) = self.run(&wrapped, cwd, vars, timeout).await?;
        let value = serde_json::from_str(out.trim()).unwrap_or(Json::String(out.clone()));
        let cwd = cwd.map_or_else(|| self.cwd.clone(), Path::to_path_buf);
        Ok(NuOutput { value, cwd: cwd.to_string_lossy().into_owned() })
    }

    /// Every command `nu` knows, with its description and category, optionally filtered by a
    /// case-insensitive substring of the name or description.
    ///
    /// # Errors
    /// When `nu` cannot be run.
    pub async fn commands(&self, filter: Option<&str>) -> Result<Vec<Json>, String> {
        let code = "help commands | select name description category | to json --raw";
        let (out, _) = self.run(code, None, &Map::new(), Duration::from_secs(30)).await?;
        let all: Vec<Json> = serde_json::from_str(out.trim()).map_err(|error| error.to_string())?;
        let needle = filter.map(str::to_lowercase);
        Ok(all
            .into_iter()
            .filter(|entry| {
                needle.as_ref().is_none_or(|needle| {
                    ["name", "description"].iter().any(|key| {
                        entry.get(key).and_then(Json::as_str).is_some_and(|text| {
                            text.to_lowercase().contains(needle)
                        })
                    })
                })
            })
            .collect())
    }

    /// The full help of one command (signature, flags, examples), as `nu` prints it.
    ///
    /// # Errors
    /// When the command name is invalid or unknown.
    pub async fn help(&self, command: &str) -> Result<String, String> {
        if command.is_empty()
            || !command.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, ' ' | '-' | '_'))
        {
            return Err(format!("unknown command: {command}"));
        }
        let mut vars = Map::new();
        vars.insert("APHRODY_NU_HELP".into(), Json::String(command.to_owned()));
        let (out, _) = self
            .run("help $env.APHRODY_NU_HELP | ansi strip", None, &vars, Duration::from_secs(30))
            .await?;
        Ok(out)
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
        "Nushell (external `nu` process): structured pipelines over files, processes, network and data."
    }

    fn tools(&self) -> Vec<ToolDefinition> {
        vec![
            ToolDefinition::new(
                "nu_eval",
                "Evaluate Nushell code and return its value as JSON (tables are arrays of records). \
                 Pass data through `vars` (read as $env.<name>; non-strings arrive as JSON text) \
                 instead of splicing it into code.",
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
                let output = self
                    .shell
                    .eval(&code, cwd.as_deref(), &vars, timeout)
                    .await
                    .map_err(SubsystemError::Failed)?;
                Ok(json!({ "value": output.value, "cwd": output.cwd }))
            },
            "nu_commands" => {
                let list = self
                    .shell
                    .commands(text("filter").as_deref())
                    .await
                    .map_err(SubsystemError::Failed)?;
                Ok(json!(list))
            },
            "nu_help" => {
                let command = text("command").ok_or_else(|| {
                    SubsystemError::InvalidArguments("`command` is required".into())
                })?;
                Ok(json!(self.shell.help(&command).await.map_err(SubsystemError::Failed)?))
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

    fn shell() -> Option<NuShell> {
        let shell = NuShell::from_current_dir().ok()?;
        shell.binary.is_some().then_some(shell)
    }

    #[tokio::test]
    async fn tables_come_back_as_records() {
        let Some(shell) = shell() else { return };
        let out = shell
            .eval("[[a b]; [1 2]]", None, &Map::new(), Duration::from_secs(30))
            .await
            .unwrap();
        assert_eq!(out.value, json!([{"a": 1, "b": 2}]));
    }

    #[tokio::test]
    async fn vars_are_env_and_not_code() {
        let Some(shell) = shell() else { return };
        let mut vars = Map::new();
        vars.insert("X".into(), json!("1; rm -rf /"));
        let out = shell.eval("$env.X", None, &vars, Duration::from_secs(30)).await.unwrap();
        assert_eq!(out.value, json!("1; rm -rf /"));
    }

    #[tokio::test]
    async fn parse_errors_are_reported() {
        let Some(shell) = shell() else { return };
        let error =
            shell.eval("let = =", None, &Map::new(), Duration::from_secs(30)).await.unwrap_err();
        assert!(!error.is_empty());
    }

    #[tokio::test]
    async fn timeout_kills_the_process() {
        let Some(shell) = shell() else { return };
        let error =
            shell.eval("sleep 30sec", None, &Map::new(), Duration::from_secs(1)).await.unwrap_err();
        assert!(error.contains("timed out"), "{error}");
    }

    #[tokio::test]
    async fn invalid_help_names_are_rejected_before_spawn() {
        let shell = NuShell { binary: None, cwd: PathBuf::from(".") };
        assert!(shell.help("ls; rm").await.unwrap_err().contains("unknown command"));
    }
}
