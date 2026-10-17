// SPDX-License-Identifier: Apache-2.0
//! Shared preparation of managed and externally hosted open-weight providers.

use std::{
    path::{Path, PathBuf},
    time::Duration,
};

use aphrody_config::{Config, ManagedRuntime};
use aphrody_llama_server::{
    Budget, DaemonCommand, EnsureOptions, InferenceBackend, LoraAdapter, ModelFacts,
    OssReadyOptions, OssReadyOutcome, PlanRequest, Role, ServerCapabilities, StateDirs, Supervisor,
};

/// Failure while resolving weights, probing a runtime, or starting its server.
#[derive(Debug, thiserror::Error)]
#[error("oss: {0}")]
pub struct ManagedProviderError(String);

impl ManagedProviderError {
    fn message(value: impl std::fmt::Display) -> Self {
        Self(value.to_string())
    }
}

/// Keeps an attached managed server alive for the lifetime of a client session.
#[derive(Debug, Default)]
pub struct ProviderLease {
    heartbeat: Option<tokio::task::JoinHandle<()>>,
    /// The in-process engine endpoint, when the model runs in this process. Held only to
    /// keep the shared engine alive for the lease's lifetime.
    #[cfg(feature = "in-process")]
    #[allow(dead_code, reason = "keep-alive handle, never read")]
    server: Option<std::sync::Arc<aphrody_llama_server::InProcessServer>>,
}

impl ProviderLease {
    fn with_heartbeat(heartbeat: Option<tokio::task::JoinHandle<()>>) -> Self {
        Self {
            heartbeat,
            #[cfg(feature = "in-process")]
            server: None,
        }
    }
}

impl Drop for ProviderLease {
    fn drop(&mut self) {
        if let Some(task) = &self.heartbeat {
            task.abort();
        }
    }
}

fn expand_path(raw: &str, cwd: &Path) -> Result<PathBuf, ManagedProviderError> {
    if let Some(suffix) = raw.strip_prefix("~/").or_else(|| raw.strip_prefix("~\\")) {
        return Ok(aphrody_models::paths::home_dir()
            .map_err(ManagedProviderError::message)?
            .join(suffix));
    }
    Ok(cwd.join(raw))
}

fn in_directory(directory: &Path) -> Option<PathBuf> {
    let name = format!("llama-server{}", std::env::consts::EXE_SUFFIX);
    [directory.join(&name), directory.join("bin").join(name)]
        .into_iter()
        .find(|path| path.is_file())
}

fn managed_binary(root: &Path) -> Option<PathBuf> {
    let mut directories: Vec<_> = std::fs::read_dir(root)
        .ok()?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| {
            path.is_dir()
                && path
                    .file_name()
                    .is_some_and(|name| name.to_string_lossy().starts_with("llama-"))
        })
        .collect();
    directories.sort_by(|left, right| right.file_name().cmp(&left.file_name()));
    directories.into_iter().find_map(|path| in_directory(&path))
}

fn resolve_binary(config: &Config, cwd: &Path) -> Result<PathBuf, ManagedProviderError> {
    if let Some(directory) = &config.llama.runtime_dir {
        let directory = expand_path(directory, cwd)?;
        return in_directory(&directory).ok_or_else(|| {
            ManagedProviderError::message(format_args!(
                "llama-server absent from configured runtime_dir {}",
                directory.display()
            ))
        });
    }
    if let Some(binary) = std::env::var_os("APHRODY_LLAMA_BIN").filter(|value| !value.is_empty()) {
        let binary = cwd.join(binary);
        if binary
            .file_stem()
            .is_some_and(|name| name == "llama-server")
            && binary.is_file()
        {
            return Ok(binary);
        }
        if let Some(found) = binary.parent().and_then(in_directory) {
            return Ok(found);
        }
        return Err(ManagedProviderError::message(
            "APHRODY_LLAMA_BIN does not locate llama-server",
        ));
    }
    if let Some(directory) = std::env::var_os("APHRODY_LLAMA_DIR").filter(|value| !value.is_empty())
        && let Some(binary) = in_directory(&cwd.join(directory))
    {
        return Ok(binary);
    }
    if let Ok(root) = aphrody_models::paths::runtimes_dir()
        && let Some(binary) = managed_binary(&root)
    {
        return Ok(binary);
    }
    which::which("llama-server").map_err(|_| {
        ManagedProviderError::message(
            "llama-server is not installed; set [llama].runtime_dir or APHRODY_LLAMA_BIN",
        )
    })
}

fn keep_alive(value: Option<&str>) -> Result<Option<Duration>, ManagedProviderError> {
    let Some(value) = value else {
        return Ok(Some(aphrody_llama_server::DEFAULT_KEEP_ALIVE));
    };
    if value == "0" || value == "forever" {
        return Ok(None);
    }
    let (number, multiplier) = match value.chars().last() {
        Some('s') => (&value[..value.len() - 1], 1_u64),
        Some('m') => (&value[..value.len() - 1], 60),
        Some('h') => (&value[..value.len() - 1], 3_600),
        _ => (value, 1),
    };
    let seconds = number
        .parse::<u64>()
        .ok()
        .and_then(|number| number.checked_mul(multiplier))
        .filter(|seconds| *seconds > 0)
        .ok_or_else(|| {
            ManagedProviderError::message(format_args!(
                "invalid llama.keep_alive duration `{value}`"
            ))
        })?;
    Ok(Some(Duration::from_secs(seconds)))
}

fn validate_extra_args(arguments: &[String]) -> Result<(), ManagedProviderError> {
    const OWNED: &[&str] = &[
        "--model",
        "-m",
        "--alias",
        "--host",
        "--port",
        "--ctx-size",
        "-c",
        "--parallel",
        "-np",
        "--n-gpu-layers",
        "--gpu-layers",
        "-ngl",
        "--fit",
        "--fit-target",
        "--n-cpu-moe",
        "--cpu-moe",
        "--mmproj",
        "--lora",
        "--lora-scaled",
        "--lora-init-without-apply",
        "--cache-type-k",
        "--cache-type-v",
        "-ctk",
        "-ctv",
    ];
    for argument in arguments {
        let flag = argument
            .split_once('=')
            .map_or(argument.as_str(), |(flag, _)| flag);
        if OWNED.contains(&flag) {
            return Err(ManagedProviderError::message(format_args!(
                "llama.extra_args cannot override supervisor-managed option `{flag}`; use the \
                 corresponding llama configuration field"
            )));
        }
    }
    Ok(())
}

/// Resolve weights and attach to or start the configured local provider.
///
/// The returned lease must live as long as the session using the endpoint.
/// Providers with an explicit remote endpoint need no process and return an
/// empty lease.
///
/// # Errors
///
/// Returns an error when configuration is invalid, required weights or the
/// runtime binary cannot be resolved, or the provider does not become ready.
pub async fn prepare_managed_provider(
    config: &mut Config,
    cwd: &Path,
) -> Result<ProviderLease, ManagedProviderError> {
    prepare_managed_provider_in(config, cwd, None).await
}

/// [`prepare_managed_provider`] with an explicit model store root.
///
/// `store_root` names the folder weights are resolved and downloaded into; `None` keeps the
/// default (`$APHRODY_MODELS_DIR`, else `<state dir>/models`). A host that embeds the agent in
/// its own process (the desktop app-server broker) passes the folder the user picked here
/// instead of mutating the process environment.
///
/// # Errors
///
/// See [`prepare_managed_provider`].
pub async fn prepare_managed_provider_in(
    config: &mut Config,
    cwd: &Path,
    store_root: Option<&Path>,
) -> Result<ProviderLease, ManagedProviderError> {
    let managed = config.provider.info.managed == Some(ManagedRuntime::LlamaServer)
        && config.provider.info.base_url.is_none();
    let local = matches!(config.provider.id.as_str(), "ollama" | "lmstudio" | "vllm");
    if !managed && !local {
        return Ok(ProviderLease::default());
    }
    let mut options = EnsureOptions::default();
    let mut adapter = None;
    if managed {
        options.keep_alive = keep_alive(config.llama.keep_alive.as_deref())?;
        validate_extra_args(config.llama.extra_args.as_deref().unwrap_or_default())?;
        if let Some(path) = &config.llama.lora {
            let path = expand_path(path, cwd)?;
            if !path.is_file() {
                return Err(ManagedProviderError::message(format_args!(
                    "LoRA adapter does not exist: {}",
                    path.display()
                )));
            }
            adapter = Some(path);
        }
    }

    // The engine of a managed model: in this process when the build has it (the desktop app),
    // else the detached `llama-server` daemon. `APHRODY_LLAMA_BACKEND` overrides.
    let backend = if managed {
        InferenceBackend::from_env().map_err(ManagedProviderError::message)?
    } else {
        InferenceBackend::Spawn
    };
    let spawned = managed && backend == InferenceBackend::Spawn;
    if managed
        && backend == InferenceBackend::InProcess
        && config
            .llama
            .extra_args
            .as_ref()
            .is_some_and(|args| !args.is_empty())
    {
        tracing::warn!(
            "`llama.extra_args` apply to llama-server only; the in-process engine ignores them"
        );
    }

    let binary = if spawned {
        Some(resolve_binary(config, cwd)?)
    } else {
        None
    };
    let caps = if let Some(binary) = binary.clone() {
        Some(
            tokio::task::spawn_blocking(move || ServerCapabilities::probe(&binary))
                .await
                .map_err(ManagedProviderError::message)?
                .map_err(ManagedProviderError::message)?,
        )
    } else {
        None
    };
    if let Some(model) = config
        .model
        .as_deref()
        .and_then(|model| model.strip_prefix("file:"))
    {
        config.model = Some(format!("file:{}", expand_path(model, cwd)?.display()));
    }
    let endpoint = config.provider.info.base_url.as_deref().map(|endpoint| {
        if config.provider.id == "ollama" {
            endpoint
                .trim_end_matches('/')
                .strip_suffix("/v1")
                .unwrap_or(endpoint)
                .to_owned()
        } else {
            endpoint.to_owned()
        }
    });
    let ready = aphrody_llama_server::ensure_oss_ready(OssReadyOptions {
        provider: if managed {
            "llama"
        } else {
            &config.provider.id
        },
        model: config.model.as_deref(),
        endpoint: endpoint.as_deref(),
        store_root,
        ..OssReadyOptions::default()
    })
    .await
    .map_err(ManagedProviderError::message)?;
    match ready {
        OssReadyOutcome::LlamaReady {
            model_id,
            primary_path,
            all_paths,
            ..
        } => {
            if backend == InferenceBackend::InProcess {
                let mmproj = all_paths.iter().skip(1).find(|path| {
                    path.file_name()
                        .is_some_and(|name| name.to_string_lossy().contains("mmproj"))
                });
                return start_in_process(
                    config,
                    model_id,
                    primary_path,
                    mmproj.cloned(),
                    adapter.map(|path| (path, 1.0)),
                )
                .await;
            }
            let caps =
                caps.ok_or_else(|| ManagedProviderError::message("missing runtime capabilities"))?;
            let binary =
                binary.ok_or_else(|| ManagedProviderError::message("missing runtime binary"))?;
            let (facts, budget) = tokio::task::spawn_blocking(move || {
                let facts = ModelFacts::read(&primary_path)?;
                Ok::<_, aphrody_llama_server::FactsError>((
                    facts,
                    Budget::from_profile(&aphrody_models::accel::probe()),
                ))
            })
            .await
            .map_err(ManagedProviderError::message)?
            .map_err(ManagedProviderError::message)?;
            let mut request = PlanRequest::new(Role::Chat, &model_id);
            request.ctx = config.llama.ctx;
            request.mmproj = all_paths.into_iter().skip(1).find(|path| {
                path.file_name()
                    .is_some_and(|name| name.to_string_lossy().contains("mmproj"))
            });
            request.extra_args = config.llama.extra_args.clone().unwrap_or_default();
            if let Some(path) = adapter {
                request.lora.push(LoraAdapter { path, scale: 1.0 });
            }
            let plan = aphrody_llama_server::plan(&facts, &caps, budget, &request);
            let state =
                aphrody_models::paths::state_dir().map_err(ManagedProviderError::message)?;
            let supervisor = Supervisor::new(
                StateDirs::new(state),
                DaemonCommand {
                    program: std::env::current_exe().map_err(ManagedProviderError::message)?,
                    args: vec!["__llama-daemon".into()],
                },
            );
            let endpoint = supervisor
                .ensure(&binary, &plan, options)
                .await
                .map_err(ManagedProviderError::message)?;
            supervisor
                .touch(Role::Chat)
                .map_err(ManagedProviderError::message)?;
            config.model = Some(model_id);
            config.provider.info.base_url = Some(endpoint.base_url());
            let request: aphrody_llama_server::daemon::DaemonRequest = serde_json::from_slice(
                &tokio::fs::read(supervisor.dirs().spec_file(Role::Chat))
                    .await
                    .map_err(ManagedProviderError::message)?,
            )
            .map_err(ManagedProviderError::message)?;
            let heartbeat = request
                .keep_alive_secs
                .map(Duration::from_secs)
                .map(|duration| {
                    tokio::spawn(async move {
                        let interval = (duration / 3).max(Duration::from_millis(100));
                        loop {
                            tokio::time::sleep(interval).await;
                            if let Err(error) = supervisor.touch(Role::Chat) {
                                eprintln!(
                                    "warning: failed to refresh managed inference lease: {error}"
                                );
                            }
                        }
                    })
                });
            Ok(ProviderLease::with_heartbeat(heartbeat))
        }
        OssReadyOutcome::OllamaReady { model, endpoint } => {
            config.model = Some(model);
            let endpoint = endpoint.trim_end_matches('/');
            config.provider.info.base_url = Some(if endpoint.ends_with("/v1") {
                endpoint.to_owned()
            } else {
                format!("{endpoint}/v1")
            });
            Ok(ProviderLease::default())
        }
        OssReadyOutcome::LmStudioReady { model, endpoint }
        | OssReadyOutcome::VllmReady { model, endpoint } => {
            config.model = Some(model);
            config.provider.info.base_url = Some(endpoint);
            Ok(ProviderLease::default())
        }
    }
}

/// Serve `primary_path` from this process and point the provider at the loopback endpoint.
#[cfg(feature = "in-process")]
async fn start_in_process(
    config: &mut Config,
    model_id: String,
    primary_path: PathBuf,
    mmproj: Option<PathBuf>,
    lora: Option<(PathBuf, f32)>,
) -> Result<ProviderLease, ManagedProviderError> {
    use std::sync::{Arc, Mutex, OnceLock, Weak};

    use aphrody_llama_server::{
        InProcessLlama, InProcessServer,
        in_process::{LoadOptions, LoraSpec},
    };

    // One loaded copy per file, projector, adapter and context size while any session still
    // holds it.
    type Key = (
        PathBuf,
        Option<u32>,
        Option<PathBuf>,
        Option<(PathBuf, u32)>,
    );
    type LoadedServers = Vec<(Key, Weak<InProcessServer>)>;
    static LOADED: OnceLock<Mutex<LoadedServers>> = OnceLock::new();
    let loaded = LOADED.get_or_init(Mutex::default);
    let ctx = config.llama.ctx;
    let key: Key = (
        primary_path.clone(),
        ctx,
        mmproj.clone(),
        lora.clone().map(|(path, scale)| (path, scale.to_bits())),
    );
    let live = loaded.lock().ok().and_then(|mut list| {
        list.retain(|(_, server)| server.strong_count() > 0);
        list.iter()
            .find(|(entry, _)| *entry == key)
            .and_then(|(_, server)| server.upgrade())
    });
    let server = if let Some(server) = live {
        server
    } else {
        let engine = InProcessLlama::load(
            &primary_path,
            model_id.clone(),
            LoadOptions {
                ctx,
                mmproj,
                lora: lora
                    .into_iter()
                    .map(|(path, scale)| LoraSpec { path, scale })
                    .collect(),
                ..LoadOptions::default()
            },
        )
        .await
        .map_err(ManagedProviderError::message)?;
        let server = Arc::new(
            InProcessServer::start(engine)
                .await
                .map_err(ManagedProviderError::message)?,
        );
        if let Ok(mut list) = loaded.lock() {
            list.push((key, Arc::downgrade(&server)));
        }
        server
    };
    config.model = Some(model_id);
    config.provider.info.base_url = Some(server.base_url());
    Ok(ProviderLease {
        heartbeat: None,
        server: Some(server),
    })
}

#[cfg(not(feature = "in-process"))]
async fn start_in_process(
    _config: &mut Config,
    _model_id: String,
    _primary_path: PathBuf,
    _mmproj: Option<PathBuf>,
    _lora: Option<(PathBuf, f32)>,
) -> Result<ProviderLease, ManagedProviderError> {
    Err(ManagedProviderError::message(
        "this build has no in-process inference engine",
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn latest_managed_install_supports_bin_subdirectory() {
        let root = tempfile::tempdir().unwrap();
        let name = format!("llama-server{}", std::env::consts::EXE_SUFFIX);
        for directory in ["llama-b10000", "llama-b20000/bin", "unrelated/bin"] {
            let directory = root.path().join(directory);
            std::fs::create_dir_all(&directory).unwrap();
            std::fs::write(directory.join(&name), b"fixture").unwrap();
        }
        assert_eq!(
            managed_binary(root.path()).unwrap(),
            root.path().join("llama-b20000/bin").join(name)
        );
    }

    #[test]
    fn duration_and_supervisor_arguments_are_validated() {
        assert_eq!(
            keep_alive(Some("5m")).unwrap(),
            Some(Duration::from_secs(300))
        );
        assert_eq!(keep_alive(Some("forever")).unwrap(), None);
        assert!(keep_alive(Some("1week")).is_err());
        assert!(validate_extra_args(&["--host=0.0.0.0".into()]).is_err());
        assert!(validate_extra_args(&["--threads".into(), "8".into()]).is_ok());
    }
}
