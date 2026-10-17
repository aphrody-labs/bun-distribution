// SPDX-License-Identifier: Apache-2.0
//! Upstream LLM access for the Shenron gateway: one pooled HTTP client, backend selection
//! (configured endpoint, else the managed llama.cpp daemon), bounded retry and fallback policy.
//!
//! The decision functions are pure so they are unit-tested without a network.

use std::{sync::LazyLock, time::Duration};

use axum::http::StatusCode;
use serde_json::Value;

/// Delay before the single retry.
const RETRY_BACKOFF: Duration = Duration::from_millis(250);
/// Connect timeout of the shared client.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);

static CLIENT: LazyLock<reqwest::Client> = LazyLock::new(|| {
    reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .pool_idle_timeout(Duration::from_secs(60))
        .build()
        .unwrap_or_else(|_| reqwest::Client::new())
});

/// The process-wide pooled client for upstream LLM calls.
pub(crate) fn client() -> &'static reqwest::Client {
    &CLIENT
}

/// Build a chat-upstream request. Gateway/provider credentials are never used
/// here: the configured chat backend has its own protected bearer credential.
pub(crate) fn chat_request(method: reqwest::Method, url: reqwest::Url) -> reqwest::RequestBuilder {
    request_with_token(
        method,
        url,
        aphrody_config::ai_env::CHAT_API_KEY.resolve().as_deref(),
    )
}

pub(crate) fn request_with_token(
    method: reqwest::Method,
    url: reqwest::Url,
    token: Option<&str>,
) -> reqwest::RequestBuilder {
    let request = client().request(method, url);
    match token {
        Some(token) => request.bearer_auth(token),
        None => request,
    }
}

/// How an upstream call failed.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Failure {
    /// The connection could not be established.
    Connect,
    /// The request timed out.
    Timeout,
    /// The upstream answered with a non-success status.
    Status(u16),
    /// The body was not JSON.
    InvalidJson,
    /// Any other transport error.
    Other,
}

impl Failure {
    pub(crate) fn from_error(error: &reqwest::Error) -> Self {
        if error.is_timeout() {
            Self::Timeout
        } else if error.is_connect() {
            Self::Connect
        } else {
            Self::Other
        }
    }

    /// Whether one retry is worthwhile: connect errors and 502/503/504.
    pub(crate) const fn is_retryable(self) -> bool {
        matches!(self, Self::Connect | Self::Status(502..=504))
    }

    /// Gateway status and message for this failure; `label` is e.g. `"LLM"` or `"Vision"`.
    pub(crate) fn describe(self, label: &str) -> (StatusCode, String) {
        match self {
            Self::Timeout => (
                StatusCode::GATEWAY_TIMEOUT,
                format!("{label} backend timed out"),
            ),
            Self::Status(_) => (
                StatusCode::BAD_GATEWAY,
                format!("{label} backend rejected request"),
            ),
            Self::InvalidJson => (
                StatusCode::BAD_GATEWAY,
                format!("{label} backend returned invalid JSON"),
            ),
            Self::Connect | Self::Other => (
                StatusCode::BAD_GATEWAY,
                format!("{label} backend unavailable"),
            ),
        }
    }
}

/// POST `body` as JSON, retrying once after a short backoff on a retryable failure.
pub(crate) async fn post_json_with_retry(
    url: &reqwest::Url,
    body: &Value,
    timeout: Duration,
) -> Result<Value, Failure> {
    post_json_with_retry_token(url, body, timeout, None).await
}

/// Authenticated chat requests share retry policy without sending the chat
/// credential to an independently configured vision or embedding endpoint.
pub(crate) async fn post_chat_json_with_retry(
    url: &reqwest::Url,
    body: &Value,
    timeout: Duration,
) -> Result<Value, Failure> {
    let token = aphrody_config::ai_env::CHAT_API_KEY.resolve();
    post_json_with_retry_token(url, body, timeout, token.as_deref()).await
}

async fn post_json_with_retry_token(
    url: &reqwest::Url,
    body: &Value,
    timeout: Duration,
    token: Option<&str>,
) -> Result<Value, Failure> {
    let mut attempt = 0_u8;
    loop {
        let failure = match request_with_token(reqwest::Method::POST, url.clone(), token)
            .timeout(timeout)
            .json(body)
            .send()
            .await
        {
            Ok(upstream) if upstream.status().is_success() => {
                return upstream.json::<Value>().await.map_err(|error| {
                    if error.is_timeout() {
                        Failure::Timeout
                    } else {
                        Failure::InvalidJson
                    }
                });
            }
            Ok(upstream) => Failure::Status(upstream.status().as_u16()),
            Err(error) => Failure::from_error(&error),
        };
        if attempt == 0 && failure.is_retryable() {
            attempt += 1;
            tokio::time::sleep(RETRY_BACKOFF).await;
            continue;
        }
        return Err(failure);
    }
}

/// Which backend serves a chat request.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum BackendChoice {
    /// `APHRODY_AI_CHAT_BASE_URL` (or an alias) is set.
    Configured,
    /// The managed llama.cpp daemon.
    Managed,
    /// Nothing is configured and the managed backend is not compiled in.
    Unavailable,
}

/// Pure backend selection: an explicit base URL always wins.
pub(crate) const fn select_backend(configured: bool, managed_compiled: bool) -> BackendChoice {
    if configured {
        BackendChoice::Configured
    } else if managed_compiled {
        BackendChoice::Managed
    } else {
        BackendChoice::Unavailable
    }
}

/// Whether the managed backend is compiled in.
pub(crate) const MANAGED_COMPILED: bool = cfg!(feature = "managed-llama");

/// The ready chat daemon's endpoint, without starting a model or renewing its lease.
/// Explicit endpoint configuration is handled by the caller before this fallback.
pub(crate) fn running_managed_url() -> Option<reqwest::Url> {
    #[cfg(feature = "managed-llama")]
    {
        let state = aphrody_llama_server::discover_running(aphrody_llama_server::Role::Chat)?;
        if !state.ready
            || aphrody_config::ai_env::CHAT_MODEL
                .resolve()
                .is_some_and(|model| model != state.alias)
        {
            return None;
        }
        reqwest::Url::parse(&state.base_url()).ok()
    }
    #[cfg(not(feature = "managed-llama"))]
    {
        None
    }
}

/// Pure fallback decision from `APHRODY_SHENRON_LLM_FALLBACK`.
pub(crate) fn fallback_wanted(value: Option<&str>) -> bool {
    value.is_some_and(|value| value.trim() == "gemini-web")
}

#[cfg(feature = "managed-llama")]
pub(crate) use managed::resolve as resolve_managed;

/// Fallback when the managed backend is not compiled in.
#[cfg(not(feature = "managed-llama"))]
pub(crate) async fn resolve_managed() -> Result<(reqwest::Url, String), String> {
    Err("managed llama backend is not compiled in".to_owned())
}

#[cfg(feature = "managed-llama")]
mod managed {
    use std::{
        path::{Path, PathBuf},
        sync::Arc,
    };

    use aphrody_llama_server::{
        Budget, DaemonCommand, EnsureOptions, ModelFacts, OssReadyOptions, OssReadyOutcome, Plan,
        PlanRequest, Role, ServerCapabilities, StateDirs, Supervisor,
    };
    use tokio::sync::OnceCell;

    /// Everything needed to (re)attach to the chat daemon, computed once.
    struct Prepared {
        supervisor: Supervisor,
        binary: PathBuf,
        plan: Plan,
        model_id: String,
    }

    static PREPARED: OnceCell<Arc<Prepared>> = OnceCell::const_new();

    fn in_directory(directory: &Path) -> Option<PathBuf> {
        let name = format!("llama-server{}", std::env::consts::EXE_SUFFIX);
        [directory.join(&name), directory.join("bin").join(name)]
            .into_iter()
            .find(|path| path.is_file())
    }

    /// Same lookup order as `aphrody-agent-runtime`'s managed provider, minus the config file
    /// `[llama].runtime_dir` (the gateway has no loaded `Config`).
    fn resolve_binary() -> Result<PathBuf, String> {
        if let Some(binary) = std::env::var_os("APHRODY_LLAMA_BIN").filter(|v| !v.is_empty()) {
            let binary = PathBuf::from(binary);
            if binary
                .file_stem()
                .is_some_and(|name| name == "llama-server")
                && binary.is_file()
            {
                return Ok(binary);
            }
            return binary
                .parent()
                .and_then(in_directory)
                .ok_or_else(|| "APHRODY_LLAMA_BIN does not locate llama-server".to_owned());
        }
        if let Some(directory) = std::env::var_os("APHRODY_LLAMA_DIR").filter(|v| !v.is_empty())
            && let Some(binary) = in_directory(Path::new(&directory))
        {
            return Ok(binary);
        }
        if let Ok(root) = aphrody_models::paths::runtimes_dir()
            && let Ok(entries) = std::fs::read_dir(&root)
        {
            let mut directories: Vec<_> = entries
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
            if let Some(binary) = directories.iter().find_map(|path| in_directory(path)) {
                return Ok(binary);
            }
        }
        which::which("llama-server")
            .map_err(|_| "llama-server is not installed; set APHRODY_LLAMA_BIN".to_owned())
    }

    /// The daemon launcher: the sibling `aphrody-llama-daemon`, else the sibling `aphrody` CLI
    /// re-invoked with its hidden `__llama-daemon` subcommand.
    fn daemon_command() -> Result<DaemonCommand, String> {
        if let Ok(command) = DaemonCommand::sibling_binary() {
            return Ok(command);
        }
        let current = std::env::current_exe().map_err(|error| error.to_string())?;
        let cli = current.with_file_name(format!("aphrody{}", std::env::consts::EXE_SUFFIX));
        if cli.is_file() {
            return Ok(DaemonCommand {
                program: cli,
                args: vec!["__llama-daemon".to_owned()],
            });
        }
        Err("no llama daemon launcher found next to the gateway executable".to_owned())
    }

    async fn prepare() -> Result<Arc<Prepared>, String> {
        let binary = resolve_binary()?;
        let model = aphrody_config::ai_env::CHAT_MODEL.resolve();
        let ready = aphrody_llama_server::ensure_oss_ready(OssReadyOptions {
            provider: "llama",
            model: model.as_deref(),
            ..OssReadyOptions::default()
        })
        .await
        .map_err(|error| error.to_string())?;
        let OssReadyOutcome::LlamaReady {
            model_id,
            primary_path,
            all_paths,
            ..
        } = ready
        else {
            return Err("managed llama provider returned an unexpected outcome".to_owned());
        };
        let probe_binary = binary.clone();
        let (facts, caps, budget) = tokio::task::spawn_blocking(move || {
            let facts = ModelFacts::read(&primary_path).map_err(|error| error.to_string())?;
            let caps =
                ServerCapabilities::probe(&probe_binary).map_err(|error| error.to_string())?;
            let budget = Budget::from_profile(&aphrody_models::accel::probe());
            Ok::<_, String>((facts, caps, budget))
        })
        .await
        .map_err(|error| error.to_string())??;
        let mut request = PlanRequest::new(Role::Chat, &model_id);
        request.mmproj = all_paths.into_iter().skip(1).find(|path| {
            path.file_name()
                .is_some_and(|name| name.to_string_lossy().contains("mmproj"))
        });
        // Shenron fine-tuned adapter (`aphrody train run --kind lora` output).
        if let Some(path) = std::env::var_os("APHRODY_SHENRON_CHAT_LORA")
            .map(std::path::PathBuf::from)
            .filter(|path| path.is_file())
        {
            request
                .lora
                .push(aphrody_llama_server::LoraAdapter { path, scale: 1.0 });
        }
        let plan = aphrody_llama_server::plan(&facts, &caps, budget, &request);
        let state = aphrody_models::paths::state_dir().map_err(|error| error.to_string())?;
        let supervisor = Supervisor::new(StateDirs::new(state), daemon_command()?);
        Ok(Arc::new(Prepared {
            supervisor,
            binary,
            plan,
            model_id,
        }))
    }

    /// Base URL (`.../v1`) and served model id of the managed chat daemon.
    ///
    /// Planning is cached; each call re-attaches when the idle daemon has exited and touches the
    /// lease so it stays alive.
    pub(crate) async fn resolve() -> Result<(reqwest::Url, String), String> {
        let prepared = PREPARED.get_or_try_init(prepare).await?.clone();
        let base = if let Some(state) = prepared.supervisor.status(Role::Chat) {
            state.base_url()
        } else {
            prepared
                .supervisor
                .ensure(&prepared.binary, &prepared.plan, EnsureOptions::default())
                .await
                .map_err(|error| error.to_string())?
                .base_url()
        };
        prepared
            .supervisor
            .touch(Role::Chat)
            .map_err(|error| error.to_string())?;
        let url = reqwest::Url::parse(&base).map_err(|error| error.to_string())?;
        Ok((url, prepared.model_id.clone()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn upstream_chat_auth_is_not_shared_with_keyless_vision_requests() {
        use axum::{
            Json, Router,
            http::{HeaderMap, header},
            routing::post,
        };
        use serde_json::json;
        let _ = rustls::crypto::ring::default_provider().install_default();
        let app = Router::new().route(
            "/probe",
            post(|headers: HeaderMap| async move {
                Json(json!({"authorization": headers.get(header::AUTHORIZATION)
                .and_then(|value| value.to_str().ok())}))
            }),
        );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move { axum::serve(listener, app).await });
        let url = reqwest::Url::parse(&format!("http://{address}/probe")).unwrap();
        let chat = post_json_with_retry_token(
            &url,
            &json!({}),
            Duration::from_secs(2),
            Some("chat-only-fixture"),
        )
        .await
        .unwrap();
        assert_eq!(chat["authorization"], "Bearer chat-only-fixture");
        let vision = post_json_with_retry(&url, &json!({}), Duration::from_secs(2))
            .await
            .unwrap();
        assert!(vision["authorization"].is_null());
        server.abort();
    }

    #[test]
    fn configured_url_wins() {
        assert_eq!(select_backend(true, true), BackendChoice::Configured);
        assert_eq!(select_backend(true, false), BackendChoice::Configured);
        assert_eq!(select_backend(false, true), BackendChoice::Managed);
        assert_eq!(select_backend(false, false), BackendChoice::Unavailable);
    }

    #[test]
    fn retry_classification() {
        assert!(Failure::Connect.is_retryable());
        for status in [502, 503, 504] {
            assert!(Failure::Status(status).is_retryable());
        }
        for status in [400, 401, 404, 429, 500] {
            assert!(!Failure::Status(status).is_retryable());
        }
        assert!(!Failure::Timeout.is_retryable());
        assert!(!Failure::InvalidJson.is_retryable());
        assert!(!Failure::Other.is_retryable());
    }

    #[test]
    fn failure_statuses() {
        assert_eq!(
            Failure::Timeout.describe("LLM").0,
            StatusCode::GATEWAY_TIMEOUT
        );
        assert_eq!(Failure::Connect.describe("LLM").0, StatusCode::BAD_GATEWAY);
        assert_eq!(
            Failure::Status(503).describe("Vision").1,
            "Vision backend rejected request"
        );
    }

    #[test]
    fn fallback_decision() {
        assert!(fallback_wanted(Some("gemini-web")));
        assert!(fallback_wanted(Some(" gemini-web ")));
        assert!(!fallback_wanted(Some("")));
        assert!(!fallback_wanted(Some("other")));
        assert!(!fallback_wanted(None));
    }
}
