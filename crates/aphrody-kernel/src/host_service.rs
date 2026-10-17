// SPDX-License-Identifier: Apache-2.0
//! Boot service and persistent bidirectional WSL/Windows kernel bridge.

#[cfg(windows)]
use crate::Kernel;
#[cfg(target_os = "linux")]
use crate::client::Client;
use crate::transport;
use serde::Deserialize;
#[cfg(target_os = "linux")]
use serde_json::{Value, json};
use std::time::Duration;
use std::{path::PathBuf, sync::Arc};

#[cfg(windows)]
#[path = "host_service_windows.rs"]
mod windows;

#[derive(Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Config {
    port: u32,
    #[cfg(windows)]
    #[serde(default)]
    auth_file: Option<PathBuf>,
    #[cfg(target_os = "linux")]
    #[serde(default)]
    token: Option<String>,
    #[serde(default)]
    local_endpoint: Option<String>,
    #[cfg(target_os = "linux")]
    #[serde(default)]
    remote_endpoint: Option<String>,
    #[serde(default = "default_peer")]
    peer: String,
    #[serde(default)]
    log_file: Option<PathBuf>,
}

fn default_peer() -> String {
    "windows".into()
}

fn log(config: &Config, message: &str) {
    use std::io::Write;
    if let Some(path) = &config.log_file {
        if let Ok(mut file) = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
        {
            let _ = writeln!(file, "{:?} {message}", std::time::SystemTime::now());
        }
    } else {
        eprintln!("{message}");
    }
}

fn read_config(
    args: Vec<std::ffi::OsString>,
) -> Result<(Config, bool), Box<dyn std::error::Error>> {
    let mut args = args
        .into_iter()
        .skip(1)
        .map(|arg| arg.to_string_lossy().into_owned());
    if args.next().as_deref() != Some("--config") {
        return Err("usage: aphrody host-service --config <absolute-json-path> [--console]".into());
    }
    let path = PathBuf::from(args.next().ok_or("missing config path")?);
    if !path.is_absolute() {
        return Err("config path must be absolute".into());
    }
    let config: Config = serde_json::from_slice(&std::fs::read(path)?)?;
    if config.port == 0 || !matches!(config.peer.as_str(), "windows" | "desktop" | "privileged") {
        return Err("port must be positive; peer must be windows, desktop or privileged".into());
    }
    let console = match args.next().as_deref() {
        None => false,
        Some("--console") => true,
        _ => return Err("unknown option".into()),
    };
    if args.next().is_some() {
        return Err("unexpected argument".into());
    }
    Ok((config, console))
}

/// Keep a protected bridge alive on the caller's runtime, without a second service
/// or process. The canonical MCP daemon owns the returned future and its shutdown.
///
/// # Errors
/// An invalid configuration or an unsupported host platform.
#[cfg(target_os = "linux")]
pub async fn run_bridge(path: PathBuf) -> Result<(), String> {
    let (config, _) = read_config(vec![
        "aphrody-host-bridge".into(),
        "--config".into(),
        path.into_os_string(),
    ])
    .map_err(|error| error.to_string())?;
    run(config).await.map_err(|error| error.to_string())
}

/// Entry point of the former `aphrody-host-service` binary, now reached through the `aphrody`
/// multi-call binary. `args[0]` is the program name (argv convention). Returns the process exit code.
pub fn host_service_main(args: Vec<std::ffi::OsString>) -> i32 {
    match host_service(args) {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("Error: {error}");
            1
        }
    }
}

fn host_service(args: Vec<std::ffi::OsString>) -> Result<(), Box<dyn std::error::Error>> {
    let (config, console) = read_config(args)?;
    #[cfg(windows)]
    if !console {
        return windows::dispatch(config).map_err(Into::into);
    }
    let _ = console;
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    runtime.block_on(run(config))
}

#[cfg(windows)]
async fn run(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    let auth = config
        .auth_file
        .as_ref()
        .ok_or("Windows host requires authFile")?;
    let kernel = Kernel::with_authentication_file(auth)?;
    kernel.register(Arc::new(crate::AdminSubsystem)).await?;
    if let Some(endpoint) = config.local_endpoint.clone() {
        let local_kernel = kernel.clone();
        tokio::spawn(async move {
            if let Err(error) = transport::serve_endpoint(local_kernel, endpoint).await {
                eprintln!("host named pipe failed: {error}");
            }
        });
    }
    windows::ready();
    let limit = Arc::new(tokio::sync::Semaphore::new(16));
    let mut connections = tokio::task::JoinSet::new();
    let mut listener: Option<(String, crate::hvsock::HostListener)> = None;
    loop {
        let discovered = tokio::task::spawn_blocking(crate::hvsock::wsl_vm_id).await??;
        if let Some((id, vm)) = discovered {
            if listener.as_ref().is_none_or(|(current, _)| current != &id) {
                drop(listener.take());
                let bound = crate::hvsock::HostListener::bind(config.port, vm)?;
                log(
                    &config,
                    &format!("Hyper-V listener ready: VM {id}, port {}", config.port),
                );
                listener = Some((id, bound));
            }
        } else {
            listener = None;
        }
        let Some((_, active)) = &listener else {
            tokio::time::sleep(Duration::from_secs(2)).await;
            continue;
        };
        let permit = Arc::clone(&limit).acquire_owned().await?;
        let stream = match tokio::time::timeout(Duration::from_secs(2), active.accept()).await {
            Ok(stream) => stream?,
            Err(_) => continue,
        };
        let kernel = kernel.clone();
        connections.spawn(async move {
            let _permit = permit;
            let (reader, writer) = tokio::io::split(stream);
            transport::serve_connection(kernel, reader, writer).await;
        });
        while connections.try_join_next().is_some() {}
    }
}

#[cfg(target_os = "linux")]
async fn run(config: Config) -> Result<(), Box<dyn std::error::Error>> {
    let mut delay = Duration::from_millis(100);
    loop {
        match bridge(&config).await {
            Ok(()) => log(&config, "bridge disconnected; reconnecting"),
            Err(error) => log(&config, &format!("bridge unavailable: {error}")),
        }
        tokio::time::sleep(delay).await;
        delay = (delay * 2).min(Duration::from_secs(5));
    }
}

#[cfg(not(any(windows, target_os = "linux")))]
async fn run(_config: Config) -> Result<(), Box<dyn std::error::Error>> {
    Err("host bridge supports Windows and Linux".into())
}

#[cfg(target_os = "linux")]
async fn bridge(config: &Config) -> Result<(), Box<dyn std::error::Error>> {
    let token = config
        .token
        .as_ref()
        .filter(|token| !token.is_empty())
        .ok_or("Linux bridge requires a token")?;
    let endpoint = config
        .local_endpoint
        .clone()
        .unwrap_or_else(transport::default_endpoint);
    let mut local = Client::connect(&endpoint).await?;
    local.initialize("aphrody-host-bridge").await?;
    let remote_endpoint = config
        .remote_endpoint
        .clone()
        .unwrap_or_else(|| format!("vsock://{}", config.port));
    let mut remote = Client::connect(&remote_endpoint).await?;
    remote.request("initialize", json!({"protocolVersion":"2025-03-26", "capabilities":{}, "clientInfo":{"name":"aphrody-host-bridge", "version":env!("CARGO_PKG_VERSION")}, "authToken":token}), Duration::from_secs(5)).await?;
    remote.notify("notifications/initialized", json!({}))?;
    let local_tools = local
        .request("tools/list", json!({}), Duration::from_secs(5))
        .await?;
    let remote_tools = remote
        .request("tools/list", json!({}), Duration::from_secs(5))
        .await?;
    let namespaced = |catalog: &Value, prefix: &str| -> Vec<Value> {
        catalog["tools"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|tool| {
                let name = tool["name"].as_str()?;
                // Never export imported peer tools or generated skills back to their
                // source; this prevents recursive bridge dispatch and stale schemas.
                if name.starts_with("windows_")
                    || name.starts_with("desktop_")
                    || name.starts_with("linux_")
                    || name.starts_with("privileged_")
                    || name.starts_with("skill_")
                {
                    return None;
                }
                let mut tool = tool.clone();
                tool["name"] = json!(format!("{prefix}_{name}"));
                Some(tool)
            })
            .collect()
    };
    let remote_exports = namespaced(&remote_tools, &config.peer);
    let local_exports = namespaced(&local_tools, "linux");
    local.request("system/register_subsystem", json!({"name":config.peer, "description":"Native Windows Hyper-V host bridge", "runtime":"rust", "tools": remote_exports, "skills":[]}), Duration::from_secs(5)).await?;
    remote.request("system/register_subsystem", json!({"name":"linux", "description":"Native Linux guest kernel bridge", "runtime":"rust", "tools":local_exports, "skills":[]}), Duration::from_secs(5)).await?;
    log(
        config,
        &format!(
            "bridge connected: {} peer tools, {} Linux tools",
            remote_exports.len(),
            local_exports.len()
        ),
    );
    for client in [&local, &remote] {
        client
            .request("system/subscribe", json!({}), Duration::from_secs(5))
            .await?;
    }
    let mut local_incoming = std::mem::replace(
        &mut local.incoming,
        tokio::sync::mpsc::unbounded_channel().1,
    );
    let mut remote_incoming = std::mem::replace(
        &mut remote.incoming,
        tokio::sync::mpsc::unbounded_channel().1,
    );
    let local = Arc::new(local);
    let remote = Arc::new(remote);
    let mut calls = tokio::task::JoinSet::new();
    let limit = Arc::new(tokio::sync::Semaphore::new(16));
    let mut heartbeat = tokio::time::interval(Duration::from_secs(5));
    loop {
        tokio::select! {
            message = local_incoming.recv() => {
                let Some(message) = message else { break; };
                forward(message, &config.peer, "linux", Arc::clone(&local), Arc::clone(&remote), Arc::clone(&limit), &mut calls).await;
            },
            message = remote_incoming.recv() => {
                let Some(message) = message else { break; };
                forward(message, "linux", &config.peer, Arc::clone(&remote), Arc::clone(&local), Arc::clone(&limit), &mut calls).await;
            },
            _ = heartbeat.tick() => {
                // Windows automation can keep the peer busy longer than the
                // idle ping deadline. In-flight calls already have bounded
                // deadlines; EOF still ends the bridge immediately. Do not
                // cancel a valid operation by probing it on that same stream.
                if !calls.is_empty() {
                    continue;
                }
                remote.request("ping", json!({}), Duration::from_secs(3)).await?;
                local.request("ping", json!({}), Duration::from_secs(3)).await?;
            },
            _ = calls.join_next(), if !calls.is_empty() => {},
        }
    }
    Ok(())
}

#[cfg(target_os = "linux")]
async fn forward(
    message: Value,
    prefix: &str,
    event_origin: &str,
    source: Arc<Client>,
    target: Arc<Client>,
    limit: Arc<tokio::sync::Semaphore>,
    calls: &mut tokio::task::JoinSet<()>,
) {
    if message["method"] == "system/event" {
        let event = &message["params"];
        let Some(kind) = event["kind"].as_str() else {
            return;
        };
        if !kind.starts_with("bridge.") && !kind.starts_with("tools/") {
            let _ = target
                .request(
                    "system/publish",
                    json!({"kind":format!("bridge.{event_origin}.{kind}"), "payload":event}),
                    Duration::from_secs(3),
                )
                .await;
        }
        return;
    }
    let Some(id) = message.get("id").cloned() else {
        return;
    };
    if message["method"] != "tools/call" {
        let _ = source.respond(id, json!({}));
        return;
    }
    let Some(name) = message["params"]["name"]
        .as_str()
        .and_then(|name| name.strip_prefix(&format!("{prefix}_")))
    else {
        let _ = source.respond(id, json!({"isError":true, "content":[{"type":"text","text":"invalid bridge tool prefix"}]}));
        return;
    };
    let args = message["params"]["arguments"].clone();
    let name = name.to_owned();
    let Ok(permit) = limit.try_acquire_owned() else {
        let _ = source.respond(id, json!({"isError":true, "content":[{"type":"text","text":"bridge concurrency limit reached"}]}));
        return;
    };
    calls.spawn(async move {
        let _permit = permit;
        let response = target.request("tools/call", json!({"name":name,"arguments":args}), Duration::from_secs(300)).await
            .unwrap_or_else(|error| json!({"isError":true, "content":[{"type":"text","text":error.to_string()}]}));
        let _ = source.respond(id, response);
    });
}
