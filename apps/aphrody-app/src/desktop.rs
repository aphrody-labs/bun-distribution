// SPDX-License-Identifier: Apache-2.0
//! Typed desktop host facades over the local Aphrody kernel.

use std::{path::PathBuf, time::Duration};

use aphrody_subsystem::SystemSubsystem;
use serde_json::{Value, json};

const KERNEL_TIMEOUT: Duration = Duration::from_secs(30);

async fn tool(name: &str, arguments: Value) -> Result<Value, String> {
    let endpoint = aphrody_kernel::transport::default_endpoint();
    let client = aphrody_kernel::client::Client::connect(&endpoint)
        .await
        .map_err(|error| format!("kernel connection: {error}"))?;
    client
        .initialize("aphrody-app")
        .await
        .map_err(|error| format!("kernel initialization: {error}"))?;
    client
        .request("tools/call", json!({ "name": name, "arguments": arguments }), KERNEL_TIMEOUT)
        .await
        .map_err(|error| format!("{name}: {error}"))
}

/// List desktop windows through the canonical window subsystem.
pub async fn windows_list() -> Result<Value, String> {
    tool("window_list", json!({})).await
}

/// Capture the desktop through the WinClean kernel subsystem.
pub async fn capture_primary() -> Result<Value, String> {
    tool("computer_capture_screen", json!({})).await
}

/// Observe the foreground window through the WinClean kernel subsystem.
pub async fn computer_observe() -> Result<Value, String> {
    tool("computer_observe", json!({ "windowHandle": 0 })).await
}

/// Windows host inventory over the persistent Hyper-V tunnel.
pub async fn windows_host_status() -> Result<Value, String> {
    tool("windows_get_system_profile", json!({})).await
}

/// Interactive Windows windows, through the user-session companion.
pub async fn windows_host_windows() -> Result<Value, String> {
    tool("desktop_list_windows", json!({})).await
}

/// Windows foreground window observation, independent of the WSLg desktop.
pub async fn windows_host_observe() -> Result<Value, String> {
    tool("desktop_computer_observe", json!({"windowHandle":0})).await
}

/// List all systemd units and services through the kernel supervisor.
pub async fn systemd_list_units() -> Result<Value, String> {
    tool("systemd_list_units", json!({})).await
}

/// Get detailed status for a single systemd unit.
pub async fn systemd_unit_status(name: String) -> Result<Value, String> {
    tool("systemd_unit_status", json!({ "name": name })).await
}

/// Start a systemd unit.
pub async fn systemd_start_unit(name: String) -> Result<Value, String> {
    tool("systemd_start_unit", json!({ "name": name })).await
}

/// Stop a systemd unit.
pub async fn systemd_stop_unit(name: String) -> Result<Value, String> {
    tool("systemd_stop_unit", json!({ "name": name })).await
}

/// Restart a systemd unit.
pub async fn systemd_restart_unit(name: String) -> Result<Value, String> {
    tool("systemd_restart_unit", json!({ "name": name })).await
}

/// Query systemd journald logs.
pub async fn systemd_journal_query(
    unit: Option<String>,
    limit: Option<u64>,
) -> Result<Value, String> {
    tool(
        "systemd_journal_query",
        json!({
            "unit": unit,
            "limit": limit.unwrap_or(50)
        }),
    )
    .await
}

/// Query status of Proton, Wine, .NET, and PowerShell Core runtimes.
pub async fn compat_runtimes_status() -> Result<Value, String> {
    tool("compat_runtimes_status", json!({})).await
}

/// Execute a command on an Aphrody infrastructure host via the kernel's `infra` subsystem.
pub async fn vps_exec(host: String, command: String) -> Result<Value, String> {
    let infra = aphrody_kernel::InfraSubsystem::new();
    infra
        .call("infra_exec", json!({ "host": host, "command": command }))
        .await
        .map_err(|e| format!("kernel infra_exec error: {e}"))
}

/// List files and directories on an Aphrody VPS filesystem via the kernel's native SFTP
/// (`infra_sftp_list`).
#[tauri::command]
pub async fn vps_fs_list(host: String, remote_path: String) -> Result<Value, String> {
    let infra = aphrody_kernel::InfraSubsystem::new();
    infra
        .call("infra_sftp_list", json!({ "host": host, "path": remote_path }))
        .await
        .map_err(|e| format!("kernel infra_sftp_list error: {e}"))
}

/// Trigger an rclone / rsync workspace synchronization via the kernel's `infra_sync`.
#[tauri::command]
pub async fn vps_sync(
    host: String,
    source: String,
    destination: String,
    apply: bool,
) -> Result<Value, String> {
    let infra = aphrody_kernel::InfraSubsystem::new();
    infra
        .call(
            "infra_sync",
            json!({
                "host": host,
                "source": source,
                "destination": destination,
                "apply": apply
            }),
        )
        .await
        .map_err(|e| format!("kernel infra_sync error: {e}"))
}

/// Inspect remote Git project status and commit tree via the kernel's `infra_git_status`.
#[tauri::command]
pub async fn vps_git_status(host: String, repo_path: String) -> Result<Value, String> {
    let infra = aphrody_kernel::InfraSubsystem::new();
    infra
        .call("infra_git_status", json!({ "host": host, "repo_path": repo_path }))
        .await
        .map_err(|e| format!("kernel infra_git_status error: {e}"))
}

/// Query current working directory of the process dynamically.
#[tauri::command]
pub fn system_cwd() -> Result<Value, String> {
    let cwd = std::env::current_dir().map_err(|e| format!("current_dir: {e}"))?;
    Ok(json!({ "cwd": cwd.to_string_lossy() }))
}

/// List entries in a local workspace directory.
#[tauri::command]
pub fn fs_read_dir(path: Option<String>) -> Result<Value, String> {
    let dir = match path {
        Some(p) if !p.trim().is_empty() => std::path::PathBuf::from(p),
        _ => std::env::current_dir().map_err(|e| format!("cannot get cwd: {e}"))?,
    };
    if !dir.is_dir() {
        return Err(format!("not a directory: {}", dir.display()));
    }
    let mut entries = Vec::new();
    let read =
        std::fs::read_dir(&dir).map_err(|e| format!("cannot read dir {}: {e}", dir.display()))?;
    for item in read.flatten() {
        let file_type = item.file_type().ok();
        let is_dir = file_type.as_ref().map(|t| t.is_dir()).unwrap_or(false);
        let name = item.file_name().to_string_lossy().to_string();
        let size = item.metadata().ok().map(|m| m.len()).unwrap_or(0);
        let path_str = item.path().to_string_lossy().to_string();
        entries.push(json!({
            "name": name,
            "path": path_str,
            "is_dir": is_dir,
            "size": size,
        }));
    }
    entries.sort_by(|a, b| {
        let a_dir = a.get("is_dir").and_then(Value::as_bool).unwrap_or(false);
        let b_dir = b.get("is_dir").and_then(Value::as_bool).unwrap_or(false);
        if a_dir != b_dir {
            return b_dir.cmp(&a_dir);
        }
        let a_name = a.get("name").and_then(Value::as_str).unwrap_or("");
        let b_name = b.get("name").and_then(Value::as_str).unwrap_or("");
        a_name.to_lowercase().cmp(&b_name.to_lowercase())
    });
    Ok(json!({ "path": dir.to_string_lossy(), "entries": entries }))
}

/// Read text file content safely with length cap (up to 2MB).
#[tauri::command]
pub fn fs_read_text(path: String) -> Result<Value, String> {
    let path_buf = std::path::PathBuf::from(&path);
    if !path_buf.is_file() {
        return Err(format!("not a file: {path}"));
    }
    let metadata = std::fs::metadata(&path_buf).map_err(|e| format!("metadata error: {e}"))?;
    if metadata.len() > 2 * 1024 * 1024 {
        return Err("file exceeds 2MB preview limit".into());
    }
    let content =
        std::fs::read_to_string(&path_buf).map_err(|e| format!("cannot read text: {e}"))?;
    Ok(json!({
        "path": path,
        "size": metadata.len(),
        "content": content
    }))
}

/// Inspect GitHub repository status via the kernel's `cloud` subsystem.
#[tauri::command]
pub async fn github_status(repo_path: Option<String>) -> Result<Value, String> {
    let cloud = aphrody_kernel::CloudSubsystem::new();
    cloud
        .call("github_status", json!({ "repo_path": repo_path }))
        .await
        .map_err(|e| format!("kernel github_status error: {e}"))
}

/// Inspect GitHub branches via the kernel's `cloud` subsystem.
#[tauri::command]
pub async fn github_branches(repo_path: Option<String>) -> Result<Value, String> {
    let cloud = aphrody_kernel::CloudSubsystem::new();
    cloud
        .call("github_branches", json!({ "repo_path": repo_path }))
        .await
        .map_err(|e| format!("kernel github_branches error: {e}"))
}

/// Inspect Google Cloud credentials, active project and Gemini availability via the kernel's
/// `cloud` subsystem.
#[tauri::command]
pub async fn gcp_status() -> Result<Value, String> {
    let cloud = aphrody_kernel::CloudSubsystem::new();
    cloud.call("gcp_status", json!({})).await.map_err(|e| format!("kernel gcp_status error: {e}"))
}

/// Inspect Google Cloud Storage bucket objects via the kernel's `cloud` subsystem.
#[tauri::command]
pub async fn gcp_storage_list(bucket: String, prefix: Option<String>) -> Result<Value, String> {
    let cloud = aphrody_kernel::CloudSubsystem::new();
    cloud
        .call("gcp_storage_list", json!({ "bucket": bucket, "prefix": prefix }))
        .await
        .map_err(|e| format!("kernel gcp_storage_list error: {e}"))
}

/// Query comprehensive system health and supply-chain diagnostics.
pub async fn doctor() -> Result<Value, String> {
    Ok(aphrody_diagnostics::diagnostics(format!("{} (desktop)", env!("CARGO_PKG_VERSION"))).await)
}

/// Query OS subsystem status and WinClean tool coverage.
pub async fn os_status() -> Result<Value, String> {
    Ok(aphrody_diagnostics::os_status().await)
}

/// Query infrastructure targets and service matrix.
pub async fn infra_status() -> Result<Value, String> {
    Ok(aphrody_diagnostics::infra_status())
}

fn aphrody_home_dir() -> PathBuf {
    std::env::var_os("USERPROFILE")
        .or_else(|| std::env::var_os("HOME"))
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
        .join(".aphrody")
}

/// Check connectivity to all configured infrastructure targets.
pub async fn infra_check() -> Result<Value, String> {
    Ok(aphrody_diagnostics::infra_check())
}

/// Query active CLI/agent configuration and raw config.toml.
pub async fn config_get() -> Result<Value, String> {
    let resolved = tokio::task::spawn_blocking(|| {
        aphrody_diagnostics::config_resolved(None, false, None, &[]).unwrap_or_else(|_| json!({}))
    })
    .await
    .unwrap_or_else(|_| json!({}));

    let config_path = aphrody_home_dir().join("config.toml");
    let raw = tokio::fs::read_to_string(&config_path).await.unwrap_or_default();

    Ok(json!({
        "resolved": resolved,
        "path": config_path.to_string_lossy(),
        "raw": raw
    }))
}

/// Save updated config.toml content.
pub async fn config_save(content: String) -> Result<Value, String> {
    let config_path = aphrody_home_dir().join("config.toml");
    if let Some(parent) = config_path.parent() {
        tokio::fs::create_dir_all(parent).await.map_err(|e| e.to_string())?;
    }
    tokio::fs::write(&config_path, content.as_bytes()).await.map_err(|e| e.to_string())?;
    Ok(json!({ "saved": true, "path": config_path.to_string_lossy() }))
}

/// Inspect active environment variables and local AI parameters.
pub async fn env_get() -> Result<Value, String> {
    let _ = tokio::task::spawn_blocking(aphrody_diagnostics::ai_env).await;

    let local_ai_path = aphrody_home_dir().join("ai").join("local-ai.json");
    let local_ai: Value = if let Ok(data) = tokio::fs::read_to_string(&local_ai_path).await {
        serde_json::from_str(&data).unwrap_or_else(|_| json!({}))
    } else {
        json!({})
    };

    let tracked = [
        ("APHRODY_BIN", "Chemin vers l'exécutable binaire aphrody", "Système"),
        ("APHRODY_MODELS_DIR", "Répertoire de stockage des modèles IA", "Modèles"),
        ("APHRODY_AI_CHAT_MODEL", "Modèle local par défaut pour le chat", "IA & Rôles"),
        ("APHRODY_AI_CODE_MODEL", "Modèle local spécialisé dans le code", "IA & Rôles"),
        ("APHRODY_AI_REASONING_MODEL", "Modèle de raisonnement avancé", "IA & Rôles"),
        ("APHRODY_AI_EMBED_MODEL", "Modèle d'embedding vectoriel (RAG)", "IA & Rôles"),
        ("APHRODY_AI_OCR_MODEL", "Modèle de reconnaissance optique (OCR)", "IA & Rôles"),
        ("APHRODY_AI_STT_MODEL", "Modèle de transcription audio (Whisper)", "IA & Rôles"),
        ("APHRODY_AI_VISION_MODEL", "Modèle multimodal pour la vision", "IA & Rôles"),
        ("RUST_LOG", "Niveau de journalisation de l'application", "Débogage"),
        ("RUST_BACKTRACE", "Capture des traces de pile en cas d'erreur", "Débogage"),
        ("APHRODY_YOLO", "Mode d'exécution autonome sans confirmation", "Exécution"),
        ("APHRODY_NHITL", "Mode non-human-in-the-loop (sans approbation)", "Exécution"),
        ("NO_PROXY", "Hôtes exemptés de proxy réseau", "Réseau"),
    ];

    let ai_env = local_ai.get("env").and_then(Value::as_object);
    let mut variables = Vec::new();

    for (name, description, category) in tracked {
        let live_val = std::env::var(name).ok();
        let file_val = ai_env.and_then(|e| e.get(name)).and_then(Value::as_str).map(String::from);
        let effective = live_val.or(file_val);
        variables.push(json!({
            "name": name,
            "value": effective,
            "is_set": effective.is_some(),
            "description": description,
            "category": category
        }));
    }

    Ok(json!({
        "variables": variables,
        "local_ai": local_ai
    }))
}

/// Set or unset a process environment variable.
pub fn env_set(name: String, value: Option<String>) -> Result<Value, String> {
    if let Some(v) = &value {
        // SAFETY: env manipulation is performed explicitly upon user settings request.
        unsafe {
            std::env::set_var(&name, v);
        }
    } else {
        // SAFETY: env manipulation is performed explicitly upon user settings request.
        unsafe {
            std::env::remove_var(&name);
        }
    }
    Ok(json!({ "name": name, "value": value }))
}
