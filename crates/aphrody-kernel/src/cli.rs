// SPDX-License-Identifier: Apache-2.0
//! `aphrody kernel` (former `aphrody-kernel` binary): serve the Aphrody OS privileged control
//! plane, or talk to it.

use std::{collections::HashSet, sync::Arc, time::Duration};

use crate::{
    Kernel, SystemSubsystem,
    client::Client,
    transport::{default_endpoint, serve_endpoint},
};
use clap::{Parser, Subcommand};
use serde_json::{Value, json};

#[derive(Parser)]
#[command(
    name = "aphrody-kernel",
    version,
    about = "The Aphrody OS privileged control plane: administration, subsystems, tools, skills \
             and events over MCP."
)]
struct Cli {
    /// Local endpoint (Unix socket path or Windows pipe name); defaults to the per-user one.
    #[arg(long, global = true, env = "APHRODY_OS_SOCKET")]
    socket: Option<String>,
    /// Absolute JSON policy path that requires authenticated, scoped client sessions.
    #[arg(long, global = true, env = "APHRODY_KERNEL_AUTH_FILE")]
    auth_file: Option<std::path::PathBuf>,
    /// Absolute .codexpolicy path evaluating tool names before dispatch.
    /// Tool-specific process implementations still require argv/filesystem sandbox enforcement.
    #[arg(long, global = true, env = "APHRODY_KERNEL_EXEC_POLICY")]
    exec_policy: Option<std::path::PathBuf>,
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Serve the kernel with the built-in subsystems on the local endpoint.
    Serve {
        /// Skip the Nushell subsystem.
        #[arg(long)]
        no_shell: bool,
        /// Skip the Obscura browser subsystem.
        #[arg(long)]
        no_browser: bool,
        /// Override the automatically discovered Aphrody Web MCP provider.
        #[arg(long, env = "APHRODY_WEB_MCP_BIN")]
        web_mcp: Option<String>,
        /// Absolute NDJSON path for durable local kernel bus audit events.
        #[arg(long, env = "APHRODY_KERNEL_AUDIT_LOG")]
        audit_log: Option<std::path::PathBuf>,
    },
    /// List tools as JSON.
    Tools,
    /// List skills as JSON.
    Skills,
    /// Call one tool.
    Call {
        tool: String,
        /// Arguments object as JSON.
        #[arg(default_value = "{}")]
        arguments: String,
    },
    /// Run one skill.
    RunSkill {
        name: String,
        /// Parameters object as JSON.
        #[arg(default_value = "{}")]
        params: String,
    },
    /// Send an A2A envelope through the same kernel tool dispatcher.
    A2a {
        /// Destination agent label for the emitted bus event.
        target: String,
        /// Kernel tool to invoke.
        tool: String,
        /// Arguments object as JSON.
        #[arg(default_value = "{}")]
        arguments: String,
    },
    /// Run a program with administrator rights and no new console window: inline Sudo for
    /// Windows, the UAC prompt (hidden program window) when sudo is not inline, sudo-rs or sudo on
    /// Unix, directly when already elevated. Exits with the program's exit code.
    Elevate {
        /// Print the detected elevation path as JSON instead of running a program.
        #[arg(long)]
        probe: bool,
        /// Working directory of the elevated program (default: the current directory).
        #[arg(long)]
        cwd: Option<std::path::PathBuf>,
        /// Program followed by its arguments (put `--` before arguments that start with `-`).
        #[arg(
            trailing_var_arg = true,
            allow_hyphen_values = true,
            value_name = "PROGRAM"
        )]
        command: Vec<std::ffi::OsString>,
    },
}

/// The kernel hosted inside the single MCP server (`aphrody-mcp`): every built-in subsystem, the
/// browser plugin and the Bun tool hosts.
///
/// # Errors
/// A subsystem that fails to register, or an explicit plugin command that fails.
pub async fn embedded_kernel() -> anyhow::Result<Kernel> {
    builtin_kernel(true, true, None, None, None).await
}

async fn builtin_kernel(
    shell: bool,
    browser: bool,
    web_mcp: Option<String>,
    auth_file: Option<&std::path::Path>,
    exec_policy: Option<&std::path::Path>,
) -> anyhow::Result<Kernel> {
    let kernel = match auth_file {
        Some(path) => Kernel::with_authentication_file(path)?,
        None => Kernel::new(),
    };
    let kernel = match exec_policy {
        Some(path) => kernel.with_execution_policy_file(path)?,
        None => kernel,
    };
    kernel.register(Arc::new(crate::AdminSubsystem)).await?;
    kernel
        .register(Arc::new(aphrody_bun_docs::BunDocsSubsystem::new()) as Arc<dyn SystemSubsystem>)
        .await?;
    kernel
        .register(Arc::new(crate::systemd::SystemdSubsystem::new()) as Arc<dyn SystemSubsystem>)
        .await?;
    kernel
        .register(Arc::new(crate::coreutils::CoreutilsSubsystem::new()) as Arc<dyn SystemSubsystem>)
        .await?;
    kernel
        .register(Arc::new(crate::compat::CompatSubsystem::new()) as Arc<dyn SystemSubsystem>)
        .await?;
    kernel
        .register(Arc::new(crate::InfraSubsystem::new()) as Arc<dyn SystemSubsystem>)
        .await?;
    kernel
        .register(Arc::new(crate::CloudSubsystem::new()) as Arc<dyn SystemSubsystem>)
        .await?;
    kernel
        .register(Arc::new(crate::RuntimeSubsystem::new()) as Arc<dyn SystemSubsystem>)
        .await?;
    if shell {
        let nu = aphrody_nu::NuShell::from_current_dir().map_err(anyhow::Error::msg)?;
        kernel
            .register(Arc::new(aphrody_nu::ShellSubsystem::new(nu)) as Arc<dyn SystemSubsystem>)
            .await?;
    }
    // Subsystems of higher layers (aphrody-ui, aphrody-web) run as MCP plugin processes: this
    // repository never links them (docs/REPO-LAYERING.md).
    let mut occupied: HashSet<String> = kernel
        .tools()
        .await
        .into_iter()
        .map(|(_, tool)| tool.name)
        .collect();
    let mut plugins: Vec<PluginEntry> = Vec::new();
    if browser {
        // The plugin resolves the Aphrody Web provider itself; an explicit one is handed down.
        let child_env: Vec<(String, String)> = web_mcp
            .map(|command| ("APHRODY_WEB_MCP_BIN".to_owned(), command))
            .into_iter()
            .collect();
        plugins.push(PluginEntry {
            name: "browser",
            description: "Obscura headless browser (aphrody-web plugin process).",
            env: "APHRODY_BROWSER_MCP_BIN",
            binary: "aphrody-browser-mcp",
            args: Vec::new(),
            child_env,
        });
    }
    for entry in plugins {
        if let Some(plugin) = crate::mcp_proxy::McpProxySubsystem::configured_plugin(
            crate::mcp_proxy::PluginSpec {
                name: entry.name,
                description: entry.description,
                env: entry.env,
                binary: entry.binary,
                args: &entry.args,
                child_env: &entry.child_env,
            },
            &occupied,
        )
        .await
        .map_err(anyhow::Error::msg)?
        {
            occupied.extend(plugin.tools().into_iter().map(|tool| tool.name));
            kernel.register(plugin).await?;
        }
    }
    // Bun tool tables served through this one endpoint: no second MCP server (`m3 tool-host`).
    let m3_args = m3_tool_host().map(|script| vec![script.to_string_lossy().into_owned()]);
    let hosts = [(
        "m3",
        "Material 3 tokens, themes, symbols and docs (aphrody-m3 tool host).",
        "APHRODY_M3_TOOL_HOST",
        "bun",
        m3_args,
    )];
    for (name, description, env, binary, args) in hosts {
        let Some(args) = args else { continue };
        if let Some(host) = crate::tool_host::ToolHostSubsystem::configured(
            crate::tool_host::ToolHostSpec {
                name,
                description,
                env,
                binary,
                args: &args,
            },
            &occupied,
        )
        .await
        .map_err(anyhow::Error::msg)?
        {
            occupied.extend(host.tools().into_iter().map(|tool| tool.name));
            kernel.register(host).await?;
        }
    }
    Ok(kernel)
}

/// A plugin subsystem to attach when its binary resolves: the fields of
/// [`crate::mcp_proxy::PluginSpec`], with the child environment owned here.
struct PluginEntry {
    name: &'static str,
    description: &'static str,
    env: &'static str,
    binary: &'static str,
    args: Vec<String>,
    child_env: Vec<(String, String)>,
}

/// The M3 tool host script: `$APHRODY_M3_ROOT`, then `./m3`, then `~/aphrody/m3`.
fn m3_tool_host() -> Option<std::path::PathBuf> {
    let roots = [
        std::env::var_os("APHRODY_M3_ROOT").map(std::path::PathBuf::from),
        std::env::current_dir().ok().map(|dir| dir.join("m3")),
        crate::paths::home_dir().map(|home| home.join("aphrody/m3")),
    ];
    roots
        .into_iter()
        .flatten()
        .map(|root| root.join("packages/m3-mcp/src/tool-host.ts"))
        .find(|server| server.is_file())
}

fn parse_object(text: &str) -> anyhow::Result<Value> {
    // Valid JSON may contain escaped quotes inside code or paths. Only
    // normalize the legacy shell-escaped form after normal parsing fails.
    let value: Value = serde_json::from_str(text).or_else(|original| {
        if text.contains(r#"\""#) {
            serde_json::from_str(&text.replace(r#"\""#, "\""))
        } else {
            Err(original)
        }
    })?;
    anyhow::ensure!(value.is_object(), "expected a JSON object, got {text}");
    Ok(value)
}

/// Run one request against the running kernel, or against an in-process one.
async fn request(
    endpoint: &str,
    method: &str,
    params: Value,
    auth_file: Option<&std::path::Path>,
    exec_policy: Option<&std::path::Path>,
) -> anyhow::Result<Value> {
    if let Ok(client) = Client::connect(endpoint).await {
        client.initialize("aphrody-kernel-cli").await?;
        return Ok(client
            .request(method, params, Duration::from_secs(600))
            .await?);
    }
    let kernel = builtin_kernel(true, true, None, auth_file, exec_policy).await?;
    let (client_side, server_side) = tokio::io::duplex(1 << 20);
    let (reader, writer) = tokio::io::split(server_side);
    tokio::spawn(crate::transport::serve_connection(kernel, reader, writer));
    let client = Client::from_stream(Box::new(client_side));
    client.initialize("aphrody-kernel-cli").await?;
    Ok(client
        .request(method, params, Duration::from_secs(600))
        .await?)
}

/// `elevate`: the detected path as JSON with `--probe`, otherwise the program's exit code.
fn elevate(
    probe: bool,
    cwd: Option<&std::path::Path>,
    command: &[std::ffi::OsString],
) -> anyhow::Result<i32> {
    if probe {
        let path = aphrody_proc::Elevation::detect()?;
        print(&json!({ "elevated": aphrody_proc::is_elevated(), "path": path.label() }))?;
        return Ok(0);
    }
    let (program, args) = command
        .split_first()
        .ok_or_else(|| anyhow::anyhow!("elevate: missing PROGRAM"))?;
    Ok(aphrody_proc::run_elevated(program, args, cwd)?)
}

fn print(value: &Value) -> anyhow::Result<()> {
    println!("{}", serde_json::to_string_pretty(value)?);
    Ok(())
}

/// Entry point of the former `aphrody-kernel` binary, now reached through the `aphrody` multi-call binary.
/// `args[0]` is the program name (argv convention). Returns the process exit code.
pub fn cli_main(args: Vec<std::ffi::OsString>) -> i32 {
    let cli = match Cli::try_parse_from(args) {
        Ok(cli) => cli,
        Err(error) => {
            let _ = error.print();
            return error.exit_code();
        }
    };
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("Error: {error}");
            return 1;
        }
    };
    match runtime.block_on(run(cli)) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("Error: {error:?}");
            1
        }
    }
}

async fn run(cli: Cli) -> anyhow::Result<i32> {
    let mut exit_code = 0;
    let endpoint = cli.socket.unwrap_or_else(default_endpoint);
    let auth_file = cli.auth_file.as_deref();
    let exec_policy = cli.exec_policy.as_deref();
    match cli.command {
        Command::Serve {
            no_shell,
            no_browser,
            web_mcp,
            audit_log,
        } => {
            let kernel =
                builtin_kernel(!no_shell, !no_browser, web_mcp, auth_file, exec_policy).await?;
            if let Some(path) = audit_log {
                kernel.start_audit(path)?;
            }
            eprintln!("aphrody-kernel: serving {endpoint}");
            serve_endpoint(kernel, endpoint).await?;
        }
        Command::Tools => {
            print(&request(&endpoint, "tools/list", json!({}), auth_file, exec_policy).await?)?
        }
        Command::Skills => {
            print(&request(&endpoint, "skills/list", json!({}), auth_file, exec_policy).await?)?
        }
        Command::Call { tool, arguments } => {
            let result = request(
                &endpoint,
                "tools/call",
                json!({ "name": tool, "arguments": parse_object(&arguments)? }),
                auth_file,
                exec_policy,
            )
            .await?;
            print(&result)?;
            if result
                .get("isError")
                .and_then(Value::as_bool)
                .unwrap_or(false)
            {
                exit_code = 1;
            }
        }
        Command::RunSkill { name, params } => {
            print(
                &request(
                    &endpoint,
                    "skills/run",
                    json!({ "name": name, "params": parse_object(&params)? }),
                    auth_file,
                    exec_policy,
                )
                .await?,
            )?;
        }
        Command::A2a {
            target,
            tool,
            arguments,
        } => print(
            &request(
                &endpoint,
                "a2a/message/send",
                json!({
                    "target": target,
                    "sourceAgent": "aphrody-kernel-cli",
                    "tool": tool,
                    "arguments": parse_object(&arguments)?,
                }),
                auth_file,
                exec_policy,
            )
            .await?,
        )?,
        Command::Elevate {
            probe,
            cwd,
            command,
        } => {
            exit_code =
                tokio::task::spawn_blocking(move || elevate(probe, cwd.as_deref(), &command))
                    .await??;
        }
    }
    Ok(exit_code)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::assert_matches;

    #[test]
    fn parse_object_valid_and_invalid() {
        assert_eq!(parse_object("{}").unwrap(), json!({}));
        assert_eq!(
            parse_object(r#"{"name": "aphrody", "value": 42}"#).unwrap(),
            json!({"name": "aphrody", "value": 42})
        );
        assert_eq!(
            parse_object(r#"{\"escaped\": true}"#).unwrap(),
            json!({"escaped": true})
        );
        let arguments =
            json!({"code": "ps | where name =~ \"claude|codex\"", "path": "C:\\agents\\run"});
        assert_eq!(parse_object(&arguments.to_string()).unwrap(), arguments);
        assert!(parse_object("[1, 2, 3]").is_err());
        assert!(parse_object("\"string\"").is_err());
        assert!(parse_object("42").is_err());
        assert!(parse_object("not a json").is_err());
    }

    #[test]
    fn cli_parse_subcommands() {
        let tools_cli = Cli::try_parse_from(["aphrody-kernel", "tools"]).unwrap();
        assert_matches!(tools_cli.command, Command::Tools);

        let skills_cli = Cli::try_parse_from(["aphrody-kernel", "skills"]).unwrap();
        assert_matches!(skills_cli.command, Command::Skills);

        let call_cli =
            Cli::try_parse_from(["aphrody-kernel", "call", "ping", r#"{"test": 1}"#]).unwrap();
        if let Command::Call { tool, arguments } = call_cli.command {
            assert_eq!(tool, "ping");
            assert_eq!(arguments, r#"{"test": 1}"#);
        } else {
            panic!("expected Command::Call");
        }

        let a2a_cli =
            Cli::try_parse_from(["aphrody-kernel", "a2a", "target-agent", "remote_tool", "{}"])
                .unwrap();
        if let Command::A2a { target, tool, .. } = a2a_cli.command {
            assert_eq!(target, "target-agent");
            assert_eq!(tool, "remote_tool");
        } else {
            panic!("expected Command::A2a");
        }

        let serve_cli = Cli::try_parse_from([
            "aphrody-kernel",
            "--socket",
            "/tmp/custom.sock",
            "serve",
            "--no-shell",
            "--no-browser",
        ])
        .unwrap();
        assert_eq!(serve_cli.socket.as_deref(), Some("/tmp/custom.sock"));
        if let Command::Serve {
            no_shell,
            no_browser,
            web_mcp,
            audit_log,
        } = serve_cli.command
        {
            assert!(no_shell);
            assert!(no_browser);
            assert!(web_mcp.is_none());
            assert!(audit_log.is_none());
        } else {
            panic!("expected Command::Serve");
        }

        let audit_cli = Cli::try_parse_from([
            "aphrody-kernel",
            "serve",
            "--audit-log",
            r"C:\audit\kernel.ndjson",
        ])
        .unwrap();
        if let Command::Serve { audit_log, .. } = audit_cli.command {
            assert_eq!(
                audit_log.as_deref(),
                Some(std::path::Path::new(r"C:\audit\kernel.ndjson"))
            );
        } else {
            panic!("expected Command::Serve");
        }

        let elevate_cli = Cli::try_parse_from([
            "aphrody-kernel",
            "elevate",
            "--cwd",
            r"C:\work",
            "sc.exe",
            "query",
            "-x",
        ])
        .unwrap();
        if let Command::Elevate {
            probe,
            cwd,
            command,
        } = elevate_cli.command
        {
            assert!(!probe);
            assert_eq!(cwd.as_deref(), Some(std::path::Path::new(r"C:\work")));
            assert_eq!(
                command,
                ["sc.exe", "query", "-x"].map(std::ffi::OsString::from)
            );
        } else {
            panic!("expected Command::Elevate");
        }
        assert!(elevate(false, None, &[]).is_err());

        let exec_policy_cli = Cli::try_parse_from([
            "aphrody-kernel",
            "--exec-policy",
            r"C:\policy\.codexpolicy",
            "tools",
        ])
        .unwrap();
        assert_eq!(
            exec_policy_cli.exec_policy.as_deref(),
            Some(std::path::Path::new(r"C:\policy\.codexpolicy"))
        );
    }
}
