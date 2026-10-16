// SPDX-License-Identifier: Apache-2.0
//! `aphrody mcp …` subcommands — list configured MCP servers / call tools.
//!
//! Backed by `gemini-runtime`'s [`aphrody_gemini_runtime::McpClient`] and
//! [`aphrody_gemini_runtime::mcp_config`]. Output is NDJSON on stdout so the command
//! can be piped into `jq` or other downstream tools.

use std::{
    collections::HashMap,
    io::Write as _,
    path::{Path, PathBuf},
};

use aphrody_gemini_runtime::{
    McpClient, McpConfig, McpServerConfig, McpTransportConfig, load_default_mcp_config,
    load_mcp_config, mcp_default_config_path,
};
use async_trait::async_trait;
use serde_json::json;
use toml_edit::{Array, DocumentMut, Item, Table, value};

use crate::context::{GoogleContext, TerminalCommand};

fn agent_config_path() -> miette::Result<PathBuf> {
    Ok(aphrody_models::paths::state_dir()
        .map_err(|error| miette::miette!("resolve Aphrody state directory: {error}"))?
        .join("config.toml"))
}

fn read_agent_config(path: &Path) -> miette::Result<DocumentMut> {
    match std::fs::read_to_string(path) {
        Ok(source) => source
            .parse::<DocumentMut>()
            .map_err(|_| miette::miette!("parse {}: invalid TOML configuration", path.display())),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(DocumentMut::new()),
        Err(error) => Err(miette::miette!("read {}: {error}", path.display())),
    }
}

fn server_table_mut(document: &mut DocumentMut) -> miette::Result<&mut Table> {
    if !document.as_table().contains_key("mcp_servers") {
        document["mcp_servers"] = Item::Table(Table::new());
    }
    document["mcp_servers"]
        .as_table_mut()
        .ok_or_else(|| miette::miette!("[mcp_servers] must be a TOML table"))
}

fn edit_add(
    document: &mut DocumentMut,
    name: &str,
    url: Option<&str>,
    command: &[String],
) -> miette::Result<()> {
    if name.trim().is_empty() {
        return Err(miette::miette!("MCP server name cannot be empty"));
    }
    if url.is_some() == !command.is_empty() {
        return Err(miette::miette!("provide exactly one of --url or a command after --"));
    }
    if let Some(url) = url
        && !(url.starts_with("https://") || url.starts_with("http://"))
    {
        return Err(miette::miette!("MCP server URL must use http:// or https://"));
    }
    let servers = server_table_mut(document)?;
    if servers.contains_key(name) {
        return Err(miette::miette!("MCP server `{name}` already exists"));
    }
    let mut entry = Table::new();
    if let Some(url) = url {
        entry["url"] = value(url);
    } else {
        entry["command"] = value(command[0].as_str());
        if command.len() > 1 {
            let mut args = Array::new();
            for arg in &command[1..] {
                args.push(arg.as_str());
            }
            entry["args"] = value(args);
        }
    }
    servers.insert(name, Item::Table(entry));
    Ok(())
}

fn edit_remove(document: &mut DocumentMut, name: &str) -> miette::Result<()> {
    let servers = server_table_mut(document)?;
    if servers.remove(name).is_none() {
        return Err(miette::miette!("MCP server `{name}` is not configured"));
    }
    Ok(())
}

fn write_agent_config(path: &Path, document: &DocumentMut) -> miette::Result<()> {
    let parent = path.parent().ok_or_else(|| miette::miette!("invalid config path"))?;
    std::fs::create_dir_all(parent)
        .map_err(|error| miette::miette!("create {}: {error}", parent.display()))?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)
        .map_err(|error| miette::miette!("create temporary config: {error}"))?;
    temporary
        .write_all(document.to_string().as_bytes())
        .map_err(|error| miette::miette!("write temporary config: {error}"))?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| miette::miette!("sync temporary config: {error}"))?;
    temporary
        .persist(path)
        .map_err(|error| miette::miette!("replace {}: {}", path.display(), error.error))?;
    Ok(())
}

pub(crate) fn add_server(name: &str, url: Option<&str>, command: &[String]) -> miette::Result<()> {
    let path = agent_config_path()?;
    let mut document = read_agent_config(&path)?;
    edit_add(&mut document, name, url, command)?;
    write_agent_config(&path, &document)?;
    println!("{}", json!({"name": name, "status": "added"}));
    Ok(())
}

pub(crate) fn remove_server(name: &str) -> miette::Result<()> {
    let path = agent_config_path()?;
    let mut document = read_agent_config(&path)?;
    edit_remove(&mut document, name)?;
    write_agent_config(&path, &document)?;
    println!("{}", json!({"name": name, "status": "removed"}));
    Ok(())
}

pub(crate) fn get_server(name: &str) -> miette::Result<()> {
    let config = resolve_config(None)?;
    let server = config
        .servers
        .iter()
        .find(|server| server.name == name)
        .ok_or_else(|| miette::miette!("MCP server `{name}` is not configured"))?;
    let (transport, argument_count) = match &server.transport {
        McpTransportConfig::Stdio { args, .. } => ("stdio", args.len()),
        McpTransportConfig::Http { .. } => ("http", 0),
        McpTransportConfig::StreamableHttp { .. } => ("streamable-http", 0),
    };
    println!("{}", json!({"name": name, "transport": transport, "argument_count": argument_count}));
    Ok(())
}

#[cfg(test)]
mod config_edit_tests {
    use super::*;

    #[test]
    fn add_and_remove_preserve_unrelated_comments() {
        let original = "# keep root comment\nmodel = 'local' # keep model \
                        comment\n\n[mcp_servers.other]\ncommand = 'other' # keep other comment\n";
        let mut document: DocumentMut = original.parse().expect("fixture parses");
        edit_add(&mut document, "new-server", None, &["server".into(), "--stdio".into()])
            .expect("add server");
        let updated = document.to_string();
        assert!(updated.contains("# keep root comment"));
        assert!(updated.contains("# keep model comment"));
        assert!(updated.contains("# keep other comment"));
        assert!(updated.contains("[mcp_servers.new-server]"));
        assert!(updated.contains("args = [\"--stdio\"]"));
        edit_remove(&mut document, "new-server").expect("remove server");
        assert_eq!(document.to_string(), original);
    }

    #[test]
    fn duplicate_and_invalid_transport_leave_document_unchanged() {
        let original = "[mcp_servers.existing]\nurl = 'https://example.test/mcp'\n";
        let mut document: DocumentMut = original.parse().expect("fixture parses");
        assert!(
            edit_add(&mut document, "existing", Some("https://example.test/mcp"), &[]).is_err()
        );
        assert!(edit_add(&mut document, "another", Some("file:///mcp"), &[]).is_err());
        assert!(edit_add(&mut document, "another", None, &[]).is_err());
        assert_eq!(document.to_string(), original);
    }

    #[test]
    fn toml_servers_are_visible_to_list_and_call_resolution() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("config.toml");
        std::fs::write(&path, "[mcp_servers.alpha]\ncommand = 'server'\nargs = ['--stdio']\n\n[mcp_servers.beta]\nurl = 'https://example.test/mcp'\n\n[mcp_servers.off]\ncommand = 'ignored'\nenabled = false\n")
            .expect("write fixture");
        let config = resolve_config(Some(&path)).expect("load TOML servers");
        assert_eq!(config.servers.len(), 2);
        assert!(
            matches!(&config.servers[0].transport, McpTransportConfig::Stdio { command, args, .. }
            if command == "server" && args == &["--stdio"])
        );
        assert!(
            matches!(&config.servers[1].transport, McpTransportConfig::StreamableHttp { url, .. }
            if url == "https://example.test/mcp")
        );
    }

    #[test]
    fn config_write_is_replaceable_and_parseable() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("config.toml");
        std::fs::write(&path, "# existing\nmodel = 'local'\n").expect("fixture");
        let mut document = read_agent_config(&path).expect("read config");
        edit_add(&mut document, "new", Some("https://example.test/mcp"), &[]).expect("add server");
        write_agent_config(&path, &document).expect("atomic replace");
        let saved = std::fs::read_to_string(&path).expect("read saved config");
        assert!(saved.contains("# existing"));
        assert_eq!(load_toml_servers(&path).expect("load saved config").servers.len(), 1);
    }

    #[test]
    fn fresh_user_without_legacy_json_can_list_new_toml_server() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("config.toml");
        let mut document = DocumentMut::new();
        edit_add(&mut document, "fresh", None, &["server".into()]).expect("add server");
        write_agent_config(&path, &document).expect("persist server");
        let merged = merge_toml_servers(McpConfig::default(), &path)
            .expect("TOML server visible with no legacy JSON");
        assert_eq!(merged.servers.len(), 1);
        assert_eq!(merged.servers[0].name, "fresh");
    }

    #[test]
    fn bearer_env_config_remains_unresolved_until_connection() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("config.toml");
        std::fs::write(
            &path,
            "[mcp_servers.remote]\nurl = 'https://example.test/mcp'\nbearer_token_env_var = \
             'APHRODY_TEST_MCP_MISSING_ENV'\n[mcp_servers.remote.http_headers]\nX-Project = \
             'workspace-1'\n",
        )
        .expect("write config");
        let config = load_toml_servers(&path).expect("load config without secret");
        let McpTransportConfig::StreamableHttp { headers, .. } = &config.servers[0].transport
        else {
            panic!("expected HTTP server");
        };
        assert_eq!(headers.get("X-Project").map(String::as_str), Some("workspace-1"));
        assert_eq!(
            headers.get("Authorization").map(String::as_str),
            Some("Bearer ${APHRODY_TEST_MCP_MISSING_ENV}")
        );
        assert!(matches!(
            resolve_http_headers(headers),
            Err(aphrody_gemini_runtime::McpError::MissingHeaderEnvironment { .. })
        ));
    }

    #[test]
    fn inline_and_section_tables_preserve_http_auth_and_stdio_environment() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("config.toml");
        for source in [
            "[mcp_servers.remote]\nurl='https://example.test/mcp'\nhttp_headers={authorization='Bearer fixture-only', X-Project='scope'}\n[mcp_servers.local]\ncommand='aphrody-mcp'\nenv={APHRODY_MCP_ENV_FILE='/fixture/profile.json', PATH='/fixture/bin'}\n",
            "[mcp_servers.remote]\nurl='https://example.test/mcp'\n[mcp_servers.remote.http_headers]\nauthorization='Bearer fixture-only'\nX-Project='scope'\n[mcp_servers.local]\ncommand='aphrody-mcp'\n[mcp_servers.local.env]\nAPHRODY_MCP_ENV_FILE='/fixture/profile.json'\nPATH='/fixture/bin'\n",
            "mcp_servers={remote={url='https://example.test/mcp',http_headers={authorization='Bearer fixture-only',X-Project='scope'}},local={command='aphrody-mcp',env={APHRODY_MCP_ENV_FILE='/fixture/profile.json',PATH='/fixture/bin'}}}\n",
        ] {
            std::fs::write(&path, source).expect("write config");
            let config = load_toml_servers(&path).expect("load table-like config");
            assert_eq!(config.servers.len(), 2);
            let remote = config.servers.iter().find(|server| server.name == "remote").unwrap();
            let McpTransportConfig::StreamableHttp { headers, .. } = &remote.transport else {
                panic!("expected HTTP transport");
            };
            assert_eq!(
                headers.get("authorization").map(String::as_str),
                Some("Bearer fixture-only")
            );
            assert_eq!(headers.get("X-Project").map(String::as_str), Some("scope"));
            let local = config.servers.iter().find(|server| server.name == "local").unwrap();
            let McpTransportConfig::Stdio { env, .. } = &local.transport else {
                panic!("expected stdio transport");
            };
            assert_eq!(
                env.get("APHRODY_MCP_ENV_FILE").map(String::as_str),
                Some("/fixture/profile.json")
            );
            assert_eq!(env.get("PATH").map(String::as_str), Some("/fixture/bin"));
        }
    }

    #[test]
    fn invalid_auth_and_environment_tables_fail_without_disclosing_source_values() {
        let directory = tempfile::tempdir().expect("temporary directory");
        let path = directory.path().join("config.toml");
        for source in [
            "[mcp_servers.remote]\nurl='https://example.test/mcp'\nhttp_headers='fixture-private-value'\n",
            "[mcp_servers.remote]\nurl='https://example.test/mcp'\nhttp_headers={Authorization=['fixture-private-value']}\n",
            "[mcp_servers.local]\ncommand='aphrody-mcp'\nenv='fixture-private-value'\n",
            "[mcp_servers.local]\ncommand='aphrody-mcp'\nenv={AUTH=['fixture-private-value']}\n",
            "[mcp_servers.remote]\nurl='https://example.test/mcp'\nhttp_headers={Authorization='fixture-private-value'\n",
        ] {
            std::fs::write(&path, source).expect("write invalid config");
            let error = load_toml_servers(&path).expect_err("malformed authentication must fail");
            assert!(!error.to_string().contains("fixture-private-value"));
            assert!(!format!("{error:?}").contains("fixture-private-value"));
        }
    }
}

// ---------------------------------------------------------------------------
// `aphrody mcp list`
// ---------------------------------------------------------------------------

/// List every MCP server declared in the config and emit one NDJSON line per
/// server (with its tool inventory).
///
/// Behaviour:
///
/// - Reads `--config <PATH>` if supplied, otherwise calls [`mcp_default_config_path`] (env / XDG /
///   `%APPDATA%` / `.mcp.json`).
/// - For each entry: spawns / connects, runs `initialize` + `tools/list`, then emits one NDJSON
///   line of shape `{ "server": "<name>", "transport": "stdio|http|streamable-http", "tools": [...]
///   }`.
/// - Servers that fail to start are still emitted with `{ "error": "..." }` so the caller can
///   detect partial outages.
pub(crate) struct McpListCommand {
    /// Optional path override for the config file.
    pub config: Option<PathBuf>,
    /// When true, skip the live `initialize` + `tools/list` round-trip and
    /// just dump the static config. Useful when offline or for diagnostics.
    pub no_probe: bool,
}

#[async_trait]
impl TerminalCommand for McpListCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        let cfg = resolve_config(self.config.as_deref())?;
        if cfg.servers.is_empty() {
            // Emit a single diagnostic NDJSON line so downstream tools can
            // tell "no servers" apart from "command crashed".
            let line = json!({
                "warning": "no MCP servers configured",
                "hint": "create ~/.config/aphrody/mcp.json or set APHRODY_MCP_CONFIG"
            });
            println!("{line}");
            return Ok(());
        }
        for spec in &cfg.servers {
            let line =
                if self.no_probe { describe_static(spec) } else { describe_live(spec).await };
            println!("{line}");
        }
        Ok(())
    }
}

fn describe_static(spec: &McpServerConfig) -> serde_json::Value {
    json!({
        "server": spec.name,
        "transport": transport_tag(&spec.transport),
        "probe": false,
    })
}

async fn describe_live(spec: &McpServerConfig) -> serde_json::Value {
    let transport_tag = transport_tag(&spec.transport).to_owned();
    match connect_client(&spec.transport).await {
        Err(e) => json!({
            "server": spec.name,
            "transport": transport_tag,
            "error": format!("connect failed: {e}"),
        }),
        Ok(mut client) => match client.initialize().await {
            Err(e) => json!({
                "server": spec.name,
                "transport": transport_tag,
                "error": format!("initialize failed: {e}"),
            }),
            Ok(info) => match client.list_tools().await {
                Err(e) => json!({
                    "server": spec.name,
                    "transport": transport_tag,
                    "server_info": info,
                    "error": format!("tools/list failed: {e}"),
                }),
                Ok(tools) => {
                    let tool_descriptors: Vec<serde_json::Value> = tools
                        .into_iter()
                        .map(|t| {
                            json!({
                                "name": t.name,
                                "description": t.description,
                                "input_schema": t.input_schema,
                            })
                        })
                        .collect();
                    json!({
                        "server": spec.name,
                        "transport": transport_tag,
                        "server_info": info,
                        "tools": tool_descriptors,
                    })
                },
            },
        },
    }
}

// ---------------------------------------------------------------------------
// `aphrody mcp call`
// ---------------------------------------------------------------------------

/// Invoke a single tool on a configured MCP server.
///
/// Resolves `--config` → finds `<server>` entry → connects → runs
/// `initialize` + `tools/call` with `--args '<json>'` → emits the raw
/// JSON-RPC result as a single NDJSON line on stdout.
pub(crate) struct McpCallCommand {
    /// Optional path override for the config file.
    pub config: Option<PathBuf>,
    /// Server logical name (as it appears in `mcpServers` keys).
    pub server: String,
    /// Tool name to invoke.
    pub tool: String,
    /// JSON-encoded arguments object (must be a JSON object).
    pub args: String,
}

#[async_trait]
impl TerminalCommand for McpCallCommand {
    async fn execute(&self, _ctx: &GoogleContext) -> miette::Result<()> {
        let parsed_args: serde_json::Value = serde_json::from_str(&self.args)
            .map_err(|e| miette::miette!("--args must be valid JSON: {e}"))?;
        let envelope =
            call_tool(self.config.as_deref(), &self.server, &self.tool, parsed_args, false).await?;
        println!("{envelope}");
        Ok(())
    }
}

/// Call the existing native MCP client without stdio capture or a child process.
/// Configuration and authentication retain the CLI owner's resolution rules.
pub async fn run_mcp_tool_http(
    config: Option<PathBuf>,
    server: String,
    tool: String,
    arguments: serde_json::Value,
) -> miette::Result<serde_json::Value> {
    // FFI callers bypass run_async's TLS bootstrap; retain that same provider.
    let _ = rustls::crypto::ring::default_provider().install_default();
    call_tool(config.as_deref(), &server, &tool, arguments, true).await
}

async fn call_tool(
    config: Option<&Path>,
    server: &str,
    tool: &str,
    arguments: serde_json::Value,
    http_only: bool,
) -> miette::Result<serde_json::Value> {
    if !arguments.is_object() {
        return Err(miette::miette!(
            "--args must be a JSON object (got {})",
            short_type(&arguments)
        ));
    }
    let cfg = resolve_config(config)?;
    let spec = cfg
        .servers
        .iter()
        .find(|s| s.name == server)
        .ok_or_else(|| miette::miette!("MCP server `{server}` not in config"))?;
    if http_only && matches!(spec.transport, McpTransportConfig::Stdio { .. }) {
        return Err(miette::miette!("direct MCP workflows require a configured HTTP transport"));
    }
    let mut client = connect_client(&spec.transport)
        .await
        .map_err(|e| miette::miette!("connect to `{server}` failed: {e}"))?;
    client.initialize().await.map_err(|e| miette::miette!("initialize `{server}` failed: {e}"))?;
    let result = client
        .call_tool(tool, arguments)
        .await
        .map_err(|e| miette::miette!("tools/call `{tool}` on `{server}` failed: {e}"))?;
    Ok(json!({"server": server, "tool": tool, "result": result}))
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn resolve_config(path: Option<&std::path::Path>) -> miette::Result<McpConfig> {
    if let Some(path) = path {
        if path.extension().is_some_and(|ext| ext.eq_ignore_ascii_case("toml")) {
            return load_toml_servers(path);
        }
        return load_mcp_config(path).map_err(|e| miette::miette!("load {}: {e}", path.display()));
    }
    let _legacy_path =
        mcp_default_config_path().map_err(|e| miette::miette!("resolve default: {e}"))?;
    let legacy =
        load_default_mcp_config().map_err(|e| miette::miette!("load default MCP config: {e}"))?;
    merge_toml_servers(legacy, &agent_config_path()?)
}

fn merge_toml_servers(mut merged: McpConfig, path: &Path) -> miette::Result<McpConfig> {
    for server in load_toml_servers(path)?.servers {
        if let Some(existing) = merged.servers.iter_mut().find(|entry| entry.name == server.name) {
            *existing = server;
        } else {
            merged.servers.push(server);
        }
    }
    Ok(merged)
}

fn load_toml_servers(path: &Path) -> miette::Result<McpConfig> {
    let document = read_agent_config(path)?;
    let Some(servers) = document.as_table().get("mcp_servers") else {
        return Ok(McpConfig::default());
    };
    let servers = servers
        .as_table_like()
        .ok_or_else(|| miette::miette!("[mcp_servers] must be a TOML table"))?;
    let mut config = McpConfig::default();
    for (name, item) in servers.iter() {
        let entry = item
            .as_table_like()
            .ok_or_else(|| miette::miette!("[mcp_servers.{name}] must be a TOML table"))?;
        if entry.get("enabled").and_then(Item::as_bool) == Some(false) {
            continue;
        }
        let transport = if let Some(command) = entry.get("command").and_then(Item::as_str) {
            let args = entry
                .get("args")
                .and_then(Item::as_array)
                .map(|array| {
                    array
                        .iter()
                        .map(|arg| {
                            arg.as_str().map(str::to_owned).ok_or_else(|| {
                                miette::miette!("MCP server `{name}` has a non-string argument")
                            })
                        })
                        .collect::<miette::Result<Vec<_>>>()
                })
                .transpose()?
                .unwrap_or_default();
            let env = entry
                .get("env")
                .map(|item| {
                    let table = item.as_table_like().ok_or_else(|| {
                        miette::miette!("MCP server `{name}` requires `env` to be a TOML table")
                    })?;
                    table
                        .iter()
                        .map(|(key, value)| {
                            value
                                .as_str()
                                .map(|value| (key.to_owned(), value.to_owned()))
                                .ok_or_else(|| {
                                    miette::miette!(
                                        "MCP server `{name}` has a non-string env value"
                                    )
                                })
                        })
                        .collect::<miette::Result<HashMap<_, _>>>()
                })
                .transpose()?
                .unwrap_or_default();
            McpTransportConfig::Stdio { command: command.to_owned(), args, env }
        } else if let Some(url) = entry.get("url").and_then(Item::as_str) {
            let mut headers = entry
                .get("http_headers")
                .map(|item| {
                    let table = item.as_table_like().ok_or_else(|| {
                        miette::miette!(
                            "MCP server `{name}` requires `http_headers` to be a TOML table"
                        )
                    })?;
                    table
                        .iter()
                        .map(|(key, value)| {
                            value
                                .as_str()
                                .map(|value| (key.to_owned(), value.to_owned()))
                                .ok_or_else(|| {
                                    miette::miette!("MCP server `{name}` has a non-string header")
                                })
                        })
                        .collect::<miette::Result<HashMap<_, _>>>()
                })
                .transpose()?
                .unwrap_or_default();
            if let Some(var_name) = entry.get("bearer_token_env_var").and_then(Item::as_str) {
                headers.insert("Authorization".to_owned(), format!("Bearer ${{{var_name}}}"));
            }
            McpTransportConfig::StreamableHttp { url: url.to_owned(), headers }
        } else {
            return Err(miette::miette!("MCP server `{name}` needs command or url"));
        };
        config.servers.push(McpServerConfig { name: name.to_owned(), transport });
    }
    Ok(config)
}

async fn connect_client(
    transport: &McpTransportConfig,
) -> Result<McpClient, aphrody_gemini_runtime::McpError> {
    match transport {
        McpTransportConfig::Stdio { command, args, env } => {
            let args_refs: Vec<&str> = args.iter().map(String::as_str).collect();
            McpClient::from_stdio(command, &args_refs, env).await
        },
        McpTransportConfig::Http { url, headers }
        | McpTransportConfig::StreamableHttp { url, headers } => {
            McpClient::from_http_headers(url.clone(), &resolve_http_headers(headers)?)
        },
    }
}

fn resolve_http_headers(
    headers: &HashMap<String, String>,
) -> Result<HashMap<String, String>, aphrody_gemini_runtime::McpError> {
    headers
        .iter()
        .map(|(name, value)| {
            let prefix = if value.starts_with("Bearer ") { "Bearer " } else { "" };
            let raw = value.strip_prefix(prefix).unwrap_or(value);
            let resolved =
                if let Some(variable) = raw.strip_prefix("${").and_then(|s| s.strip_suffix('}')) {
                    let secret =
                        std::env::var(variable).ok().filter(|value| !value.is_empty()).ok_or_else(
                            || aphrody_gemini_runtime::McpError::MissingHeaderEnvironment {
                                name: name.clone(),
                                variable: variable.to_owned(),
                            },
                        )?;
                    format!("{prefix}{secret}")
                } else {
                    value.clone()
                };
            Ok((name.clone(), resolved))
        })
        .collect()
}

fn transport_tag(t: &McpTransportConfig) -> &'static str {
    match t {
        McpTransportConfig::Stdio { .. } => "stdio",
        McpTransportConfig::Http { .. } => "http",
        McpTransportConfig::StreamableHttp { .. } => "streamable-http",
    }
}

fn short_type(v: &serde_json::Value) -> &'static str {
    match v {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "bool",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn resolve_http_headers_preserves_custom_headers() {
        let mut h = HashMap::new();
        h.insert("Authorization".to_owned(), "Bearer abc123".to_owned());
        h.insert("X-Project".to_owned(), "workspace-1".to_owned());
        let resolved = resolve_http_headers(&h).expect("headers");
        assert_eq!(resolved.get("Authorization").map(String::as_str), Some("Bearer abc123"));
        assert_eq!(resolved.get("X-Project").map(String::as_str), Some("workspace-1"));
    }

    #[test]
    fn resolve_http_headers_handles_env_placeholder() {
        let var = "APHRODY_TEST_MCP_BEARER_TOKEN";
        // SAFETY: nightly Rust requires unsafe for env mutation; the test is
        // isolated by using a uniquely-named variable.
        unsafe { std::env::set_var(var, "secret-token") };
        let mut h = HashMap::new();
        h.insert("Authorization".to_owned(), format!("Bearer ${{{var}}}"));
        assert_eq!(
            resolve_http_headers(&h).expect("headers").get("Authorization").map(String::as_str),
            Some("Bearer secret-token")
        );
        unsafe { std::env::remove_var(var) };
    }

    #[test]
    fn resolve_http_headers_fails_closed_on_missing_env() {
        let mut h = HashMap::new();
        h.insert("Authorization".to_owned(), "Bearer ${APHRODY_TEST_DEFINITELY_UNSET}".to_owned());
        assert!(matches!(
            resolve_http_headers(&h),
            Err(aphrody_gemini_runtime::McpError::MissingHeaderEnvironment { .. })
        ));
    }

    #[test]
    fn resolve_http_headers_preserves_case_insensitive_header() {
        let mut h = HashMap::new();
        h.insert("authorization".to_owned(), "Bearer xyz".to_owned());
        assert_eq!(
            resolve_http_headers(&h).expect("headers").get("authorization").map(String::as_str),
            Some("Bearer xyz")
        );
    }

    #[test]
    fn transport_tag_matches_variants() {
        let s =
            McpTransportConfig::Stdio { command: "x".into(), args: vec![], env: HashMap::new() };
        assert_eq!(transport_tag(&s), "stdio");
        let h = McpTransportConfig::Http { url: "https://x".into(), headers: HashMap::new() };
        assert_eq!(transport_tag(&h), "http");
        let sh =
            McpTransportConfig::StreamableHttp { url: "https://x".into(), headers: HashMap::new() };
        assert_eq!(transport_tag(&sh), "streamable-http");
    }
}
