// SPDX-License-Identifier: Apache-2.0
//! The Aphrody OS kernel hosted in this server: its subsystems (systemd, compat, coreutils,
//! Nushell, Bun docs, infra, cloud, runtimes), the browser plugin and the Bun tool hosts
//! (`yolo tool`, M3) are served through this one MCP endpoint.

use std::{
    collections::HashSet,
    sync::{Arc, RwLock},
    time::Duration,
};

use aphrody_kernel::{
    Kernel, SystemSubsystem,
    client::{Client, ClientError},
    transport::default_endpoint,
};
use rmcp::model::{CallToolRequestParams, CallToolResult, ContentBlock, Tool};
use serde_json::{Value, json};
use tokio::sync::OnceCell;

static KERNEL: OnceCell<Option<Arc<Kernel>>> = OnceCell::const_new();
/// The kernel catalogue as of the last `list`, for the synchronous `get_tool`.
static CATALOG: RwLock<Vec<Tool>> = RwLock::new(Vec::new());

#[cfg(target_os = "linux")]
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NativeDaemon {
    socket: String,
    owner_uid: u32,
    owner_gid: u32,
    #[serde(default)]
    bridges: Vec<std::path::PathBuf>,
}

#[cfg(target_os = "linux")]
impl NativeDaemon {
    fn read(path: &std::path::Path) -> anyhow::Result<Self> {
        use std::os::unix::fs::PermissionsExt;
        anyhow::ensure!(path.is_absolute(), "native daemon config must be absolute");
        anyhow::ensure!(
            std::fs::metadata(path)?.permissions().mode() & 0o077 == 0,
            "native daemon config must be private"
        );
        let config: Self = serde_json::from_slice(&std::fs::read(path)?)?;
        anyhow::ensure!(
            std::path::Path::new(&config.socket).is_absolute(),
            "native daemon socket must be absolute"
        );
        anyhow::ensure!(
            config.bridges.iter().all(|path| path.is_absolute()),
            "native bridge configs must be absolute"
        );
        Ok(config)
    }
}

#[cfg(target_os = "linux")]
async fn daemon_tasks(
    config: NativeDaemon,
    hosted: Kernel,
) -> anyhow::Result<tokio::task::JoinSet<Result<(), String>>> {
    use std::os::unix::fs::MetadataExt;
    anyhow::ensure!(
        Client::connect(&config.socket).await.is_err(),
        "another native daemon owns the socket"
    );
    let mut tasks = tokio::task::JoinSet::new();
    let endpoint = config.socket.clone();
    tasks.spawn(async move {
        aphrody_kernel::transport::serve_endpoint(hosted, endpoint)
            .await
            .map_err(|error| error.to_string())
    });
    let mut ready = false;
    for _ in 0..200 {
        if Client::connect(&config.socket).await.is_ok() {
            ready = true;
            break;
        }
        if let Some(result) = tasks.try_join_next() {
            anyhow::bail!("native OS listener failed: {result:?}");
        }
        tokio::time::sleep(Duration::from_millis(25)).await;
    }
    anyhow::ensure!(ready, "native OS listener did not become ready");
    // The declared owner receives the private control socket even when the
    // single service runs as root. No other user gets filesystem access.
    let metadata = std::fs::metadata(&config.socket)?;
    if metadata.uid() != config.owner_uid || metadata.gid() != config.owner_gid {
        std::os::unix::fs::chown(&config.socket, Some(config.owner_uid), Some(config.owner_gid))?;
    }
    for path in config.bridges {
        tasks.spawn(aphrody_kernel::host_service::run_bridge(path));
    }
    Ok(tasks)
}

/// Host the OS endpoint and persistent bridge futures in this MCP process. The
/// explicit protected config is opt-in: ordinary stdio clients never claim the
/// existing daemon's socket. Dropping the task set cancels every owned listener.
pub(crate) async fn native_daemon() -> anyhow::Result<tokio::task::JoinSet<Result<(), String>>> {
    let Some(path) = std::env::var_os("APHRODY_MCP_NATIVE_DAEMON") else {
        return Ok(tokio::task::JoinSet::new());
    };
    #[cfg(target_os = "linux")]
    {
        let config = NativeDaemon::read(std::path::Path::new(&path))?;
        let hosted =
            kernel().await.ok_or_else(|| anyhow::anyhow!("native OS kernel unavailable"))?;
        daemon_tasks(config, (*hosted).clone()).await
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = path;
        anyhow::bail!("native daemon configuration currently requires Linux");
    }
}

fn imported_native_tool(name: &str) -> bool {
    ["desktop_", "windows_", "privileged_"].iter().any(|prefix| name.starts_with(prefix))
}

// A Windows SSH process runs outside the interactive desktop. An explicit protected
// desktop pipe delegates desktop_* calls to the signed-in user's existing bridge,
// preserving its authentication instead of trying to capture the SSH session.
fn native_bridge() -> (String, bool) {
    std::env::var("APHRODY_MCP_DESKTOP_SOCKET")
        .ok()
        .filter(|endpoint| !endpoint.trim().is_empty())
        .map_or_else(|| (default_endpoint(), false), |endpoint| (endpoint, true))
}

fn desktop_tool(name: &str) -> bool {
    aphrody_kernel::AdminSubsystem.tools().iter().any(|tool| tool.name == name)
}

// The owner-only native endpoint imports authenticated Windows/desktop/root bridges.
// Connect per operation so restarts recover without replaying a call of unknown outcome.
async fn bridge_request(
    endpoint: &str,
    method: &str,
    params: Value,
    timeout: Duration,
) -> Result<Value, ClientError> {
    tokio::time::timeout(timeout, async {
        let client = Client::connect(endpoint).await?;
        client.initialize("aphrody-mcp-native-bridge").await?;
        client.request(method, params, timeout).await
    })
    .await
    .map_err(|_| ClientError::Timeout { method: method.to_owned() })?
}

async fn bridge_tools(endpoint: &str, desktop: bool) -> Result<Vec<Tool>, ClientError> {
    let result = bridge_request(endpoint, "tools/list", json!({}), Duration::from_secs(2)).await?;
    let tools = result.get("tools").and_then(Value::as_array).ok_or_else(|| ClientError::Rpc {
        code: -32603,
        message: "native bridge returned an invalid tool catalog".to_owned(),
    })?;
    Ok(tools
        .iter()
        .filter_map(|tool| {
            let name = tool.get("name")?.as_str()?;
            if if desktop { !desktop_tool(name) } else { !imported_native_tool(name) } {
                return None;
            }
            let mut tool: Tool = serde_json::from_value(tool.clone()).ok()?;
            if desktop {
                tool.name = format!("desktop_{name}").into();
            }
            Some(tool)
        })
        .collect())
}

async fn bridge_call(
    endpoint: &str,
    request: &CallToolRequestParams,
    desktop: bool,
) -> CallToolResult {
    let name = if desktop {
        let Some(name) = request.name.strip_prefix("desktop_").filter(|name| desktop_tool(name))
        else {
            return CallToolResult::error(vec![ContentBlock::text("unknown native desktop tool")]);
        };
        name
    } else {
        request.name.as_ref()
    };
    let arguments =
        request.arguments.as_ref().map_or_else(|| json!({}), |map| Value::Object(map.clone()));
    match bridge_request(
        endpoint,
        "tools/call",
        json!({"name":name, "arguments":arguments}),
        Duration::from_secs(30),
    )
    .await
    {
        Ok(result) => serde_json::from_value(result)
            .map(|result| native_capture(request.name.as_ref(), result))
            .unwrap_or_else(|reason| {
                CallToolResult::error(vec![ContentBlock::text(format!(
                    "invalid native bridge result: {reason}"
                ))])
            }),
        Err(reason) => CallToolResult::error(vec![ContentBlock::text(format!(
            "native bridge unavailable: {reason}"
        ))]),
    }
}

// The native OS RPC carries captured PNG bytes inside structured JSON. Present
// them as MCP image content, without also expanding the base64 into model text.
fn native_capture(name: &str, mut result: CallToolResult) -> CallToolResult {
    let raw = ["desktop_", "windows_", "privileged_"]
        .iter()
        .find_map(|prefix| name.strip_prefix(prefix))
        .unwrap_or(name);
    if !matches!(raw, "computer_observe" | "computer_capture_screen")
        || result.is_error == Some(true)
    {
        return result;
    }
    let Some(structured) = result.structured_content.as_mut() else { return result };
    let image = if raw == "computer_observe" {
        structured.get_mut("image")
    } else {
        Some(&mut *structured)
    };
    let Some(image) = image.and_then(Value::as_object_mut) else { return result };
    if image.get("mimeType").and_then(Value::as_str) != Some("image/png") {
        return result;
    }
    let Some(Value::String(data)) = image.remove("dataBase64") else { return result };
    let metadata = serde_json::to_string_pretty(structured).unwrap_or_default();
    result.content = vec![ContentBlock::text(metadata), ContentBlock::image(data, "image/png")];
    result
}

async fn kernel() -> Option<Arc<Kernel>> {
    KERNEL
        .get_or_init(|| async {
            match aphrody_kernel::cli::embedded_kernel().await {
                Ok(kernel) => Some(Arc::new(kernel)),
                Err(error) => {
                    tracing::warn!(%error, "embedded Aphrody kernel unavailable");
                    None
                },
            }
        })
        .await
        .clone()
}

/// Kernel tools not already served by a built-in route.
pub(crate) async fn list(taken: impl Fn(&str) -> bool) -> Vec<Tool> {
    let mut tools: Vec<Tool> = if let Some(kernel) = kernel().await {
        kernel
            .tools()
            .await
            .into_iter()
            .filter(|(_, definition)| !taken(&definition.name))
            .filter_map(|(_, definition)| serde_json::from_value::<Tool>(definition.to_mcp()).ok())
            .collect()
    } else {
        Vec::new()
    };
    let occupied: HashSet<String> = tools.iter().map(|tool| tool.name.to_string()).collect();
    let (endpoint, desktop) = native_bridge();
    if let Ok(imported) = bridge_tools(&endpoint, desktop).await {
        tools.extend(
            imported
                .into_iter()
                .filter(|tool| !taken(&tool.name) && !occupied.contains(tool.name.as_ref())),
        );
    }
    if let Ok(mut catalog) = CATALOG.write() {
        catalog.clone_from(&tools);
    }
    tools
}

pub(crate) fn get(name: &str) -> Option<Tool> {
    CATALOG.read().ok()?.iter().find(|tool| tool.name == name).cloned()
}

pub(crate) async fn owns(name: &str) -> bool {
    if let Some(kernel) = kernel().await
        && kernel.tools().await.iter().any(|(_, tool)| tool.name == name)
    {
        return true;
    }
    if imported_native_tool(name) {
        let (endpoint, desktop) = native_bridge();
        return bridge_tools(&endpoint, desktop)
            .await
            .is_ok_and(|tools| tools.iter().any(|tool| tool.name == name));
    }
    false
}

pub(crate) async fn call(request: &CallToolRequestParams) -> CallToolResult {
    let kernel = kernel().await;
    let embedded_owns = if let Some(kernel) = &kernel {
        kernel.tools().await.iter().any(|(_, tool)| tool.name == request.name)
    } else {
        false
    };
    if imported_native_tool(request.name.as_ref()) && !embedded_owns {
        let (endpoint, desktop) = native_bridge();
        return bridge_call(&endpoint, request, desktop).await;
    }
    let Some(kernel) = kernel else {
        return CallToolResult::error(vec![ContentBlock::text("Aphrody kernel unavailable")]);
    };
    let arguments =
        request.arguments.as_ref().map_or_else(|| json!({}), |map| Value::Object(map.clone()));
    let result = kernel.call_tool_result(request.name.as_ref(), arguments).await;
    serde_json::from_value(result)
        .map(|result| native_capture(request.name.as_ref(), result))
        .unwrap_or_else(|reason| {
            CallToolResult::error(vec![ContentBlock::text(format!(
                "invalid kernel result: {reason}"
            ))])
        })
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

    #[test]
    fn native_capture_is_visual_content_without_duplicate_base64_text() {
        let metadata =
            json!({"window":{"Handle":42},"image":{"mimeType":"image/png","dataBase64":"AQ=="}});
        let result = || {
            serde_json::from_value::<CallToolResult>(json!({
                "content":[{"type":"text","text":metadata.to_string()}],
                "structuredContent":metadata,"isError":false
            }))
            .unwrap()
        };
        let image =
            serde_json::to_value(native_capture("desktop_computer_observe", result())).unwrap();
        assert_eq!(image["content"][1]["type"], "image");
        assert_eq!(image["content"][1]["data"], "AQ==");
        assert_eq!(image["structuredContent"]["window"]["Handle"], 42);
        assert!(image["structuredContent"]["image"].get("dataBase64").is_none());
        assert!(!image["content"][0]["text"].as_str().unwrap().contains("AQ=="));
        let unchanged = serde_json::to_value(native_capture("nu_eval", result())).unwrap();
        assert_eq!(unchanged["content"].as_array().unwrap().len(), 1);
        assert_eq!(unchanged["structuredContent"], metadata);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn native_daemon_requires_private_absolute_configuration() {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("daemon.json");
        let value = json!({"socket":directory.path().join("os.sock"),"ownerUid":0,"ownerGid":0});
        std::fs::write(&path, value.to_string()).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o644)).unwrap();
        assert!(NativeDaemon::read(&path).err().unwrap().to_string().contains("private"));
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        assert!(NativeDaemon::read(&path).is_ok());
        let mut relative_bridge = value;
        relative_bridge["bridges"] = json!(["desktop.json"]);
        std::fs::write(&path, relative_bridge.to_string()).unwrap();
        assert!(NativeDaemon::read(&path).err().unwrap().to_string().contains("absolute"));
    }

    #[cfg(target_os = "linux")]
    #[tokio::test]
    async fn native_daemon_keeps_one_kernel_owner_and_stops_its_listener() {
        use std::os::unix::fs::MetadataExt;
        let directory = tempfile::tempdir().unwrap();
        let owner = std::fs::metadata(directory.path()).unwrap();
        let endpoint = directory.path().join("os.sock").to_string_lossy().into_owned();
        let config = || NativeDaemon {
            socket: endpoint.clone(),
            owner_uid: owner.uid(),
            owner_gid: owner.gid(),
            bridges: Vec::new(),
        };
        let mut tasks = daemon_tasks(config(), Kernel::new()).await.unwrap();
        let client = Client::connect(&endpoint).await.unwrap();
        client.initialize("one-native-process-test").await.unwrap();
        assert!(daemon_tasks(config(), Kernel::new()).await.is_err());
        assert!(client.request("ping", json!({}), Duration::from_secs(2)).await.is_ok());
        drop(client);
        tasks.shutdown().await;
        assert!(Client::connect(&endpoint).await.is_err());
    }

    fn peer(
        result: Value,
        expected_tool: Option<&str>,
    ) -> (tempfile::TempDir, String, tokio::task::JoinHandle<()>) {
        let expected_tool = expected_tool.map(str::to_owned);
        let directory = tempfile::tempdir().unwrap();
        let endpoint = directory.path().join("native.sock");
        let listener = tokio::net::UnixListener::bind(&endpoint).unwrap();
        let task = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let (read, mut write) = stream.into_split();
            let mut read = BufReader::new(read);
            let mut line = String::new();
            while read.read_line(&mut line).await.unwrap() > 0 {
                let message: Value = serde_json::from_str(&line).unwrap();
                line.clear();
                let Some(id) = message.get("id") else { continue };
                let initializing = message["method"] == "initialize";
                let payload = if initializing {
                    json!({"protocolVersion":"2025-03-26", "capabilities":{}})
                } else {
                    if let Some(expected) = &expected_tool {
                        assert_eq!(message["params"]["name"], *expected);
                    }
                    result.clone()
                };
                write
                    .write_all(
                        format!("{}\n", json!({"jsonrpc":"2.0", "id":id, "result":payload}))
                            .as_bytes(),
                    )
                    .await
                    .unwrap();
                if !initializing {
                    break;
                }
            }
        });
        (directory, endpoint.to_string_lossy().into_owned(), task)
    }

    #[tokio::test]
    async fn native_catalog_import_cannot_replace_builtin_owners() {
        let definition =
            |name| json!({"name":name, "description":"native", "inputSchema":{"type":"object"}});
        let (_directory, endpoint, task) = peer(
            json!({"tools":[definition("desktop_computer_observe"), definition("aphrody_search"), definition("nu_eval")]}),
            None,
        );
        let tools = bridge_tools(&endpoint, false).await.unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "desktop_computer_observe");
        task.await.unwrap();
    }

    #[tokio::test]
    async fn native_call_preserves_images_and_error_results() {
        for result in [
            json!({"content":[{"type":"image", "data":"AQ==", "mimeType":"image/png"}], "structuredContent":{"window":{"Handle":42}}, "isError":false}),
            json!({"content":[{"type":"text", "text":"foreground denied"}], "isError":true}),
        ] {
            let (_directory, endpoint, task) =
                peer(result.clone(), Some("desktop_computer_observe"));
            let request =
                serde_json::from_value(json!({"name":"desktop_computer_observe", "arguments":{}}))
                    .unwrap();
            let returned =
                serde_json::to_value(bridge_call(&endpoint, &request, false).await).unwrap();
            assert_eq!(returned["content"], result["content"]);
            assert_eq!(returned["isError"], result["isError"]);
            assert_eq!(returned.get("structuredContent"), result.get("structuredContent"));
            task.await.unwrap();
        }
    }

    #[tokio::test]
    async fn desktop_pipe_projects_only_native_catalog_and_routes_original_name() {
        let definition =
            |name| json!({"name":name, "description":"native", "inputSchema":{"type":"object"}});
        let (_directory, endpoint, task) = peer(
            json!({"tools":[definition("computer_observe"), definition("nu_eval"), definition("linux_nu_eval")]}),
            None,
        );
        let tools = bridge_tools(&endpoint, true).await.unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0].name, "desktop_computer_observe");
        task.await.unwrap();

        let result =
            json!({"content":[{"type":"text", "text":"interactive session"}], "isError":false});
        let (_directory, endpoint, task) = peer(result.clone(), Some("computer_observe"));
        let request = serde_json::from_value(json!({"name":"desktop_computer_observe"})).unwrap();
        let returned = serde_json::to_value(bridge_call(&endpoint, &request, true).await).unwrap();
        assert_eq!(returned["content"], result["content"]);
        task.await.unwrap();
        let rejected = serde_json::from_value(json!({"name":"desktop_nu_eval"})).unwrap();
        assert_eq!(bridge_call(&endpoint, &rejected, true).await.is_error, Some(true));
    }
}
