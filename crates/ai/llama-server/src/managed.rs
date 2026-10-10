// SPDX-License-Identifier: Apache-2.0
//! High-level preparation and launch of managed encoder endpoints.
//!
//! The lower-level supervisor intentionally accepts an already-built [`Plan`].
//! This module owns the reusable end-to-end path needed by RAG consumers:
//! resolve a category-appropriate GGUF model, make its artefacts present in the
//! model store, inspect the installed `llama-server`, plan for current hardware,
//! and attach to or start the corresponding role endpoint.

use std::path::{Path, PathBuf};

use aphrody_models::{
    Backend, Catalog, Downloader, LocalRole, ModelStore, ModelTask, PullOptions, Resolved,
};

use crate::{
    Budget, DaemonCommand, Endpoint, EnsureOptions, ModelFacts, Plan, PlanRequest, Role,
    ServerCapabilities, StateDirs, Supervisor,
};

/// Default llama.cpp embedding model from the built-in model catalog.
/// Single source of truth: [`LocalRole::Embed`].
pub const DEFAULT_EMBED_MODEL: &str = LocalRole::Embed.default_model();
/// Default llama.cpp reranking model from the built-in model catalog.
/// Single source of truth: [`LocalRole::Rerank`].
pub const DEFAULT_RERANK_MODEL: &str = LocalRole::Rerank.default_model();

/// Encoder service to prepare and run.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ManagedCategory {
    /// Dense text embeddings through `/v1/embeddings`.
    Embedding,
    /// Cross-encoder relevance scores through `/v1/rerank`.
    Reranking,
}

impl ManagedCategory {
    /// Supervisor role used by this category.
    #[must_use]
    pub const fn role(self) -> Role {
        match self {
            Self::Embedding => Role::Embed,
            Self::Reranking => Role::Rerank,
        }
    }

    /// Catalog task required for an explicitly named catalog model.
    #[must_use]
    pub const fn task(self) -> ModelTask {
        match self {
            Self::Embedding => ModelTask::TextEmbedding,
            Self::Reranking => ModelTask::TextRerank,
        }
    }

    /// Curated model used when the caller supplies no model id.
    #[must_use]
    pub const fn default_model(self) -> &'static str {
        match self {
            Self::Embedding => DEFAULT_EMBED_MODEL,
            Self::Reranking => DEFAULT_RERANK_MODEL,
        }
    }
}

/// Launch controls for a prepared encoder model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedLaunchOptions {
    /// Context size. `None` uses the encoder default capped by the GGUF facts.
    pub ctx: Option<u32>,
    /// Embedding pooling override (`mean`, `cls`, `last`, ...).
    pub pooling: Option<String>,
    /// Device memory to leave free for the rest of the system, in MiB.
    pub margin_mib: u32,
    /// Concurrent llama-server request slots.
    pub parallel: u8,
    /// Escape hatch appended after generated arguments.
    pub extra_args: Vec<String>,
    /// Supervisor timeouts and idle policy. `keep_alive: None` keeps the server running.
    pub ensure: EnsureOptions,
}

impl Default for ManagedLaunchOptions {
    fn default() -> Self {
        Self {
            ctx: None,
            pooling: None,
            margin_mib: crate::DEFAULT_MARGIN_MIB,
            parallel: 1,
            extra_args: Vec::new(),
            ensure: EnsureOptions::default(),
        }
    }
}

/// End-to-end request for a managed embedding or reranking endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ManagedRequest {
    /// Endpoint category, which determines the catalog task and supervisor role.
    pub category: ManagedCategory,
    /// Catalog id or direct model reference. `None` selects the category default.
    pub model: Option<String>,
    /// Optional model-store root. `None` uses the standard Aphrody store.
    pub store_root: Option<PathBuf>,
    /// Redownload model artefacts even when they are already present.
    pub force_pull: bool,
    /// Launch controls.
    pub launch: ManagedLaunchOptions,
}

impl ManagedRequest {
    /// Request a managed endpoint with the curated model for `category`.
    #[must_use]
    pub fn new(category: ManagedCategory) -> Self {
        Self {
            category,
            model: None,
            store_root: None,
            force_pull: false,
            launch: ManagedLaunchOptions::default(),
        }
    }
}

/// Model artefacts made ready for a managed endpoint.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PreparedManagedModel {
    /// Endpoint category this model was prepared for.
    pub category: ManagedCategory,
    /// Catalog id or direct reference used as the API alias.
    pub model_id: String,
    /// Primary GGUF weights passed to llama-server.
    pub primary_path: PathBuf,
    /// Every artefact installed for the model.
    pub all_paths: Vec<PathBuf>,
    /// Whether every artefact was already present before preparation.
    pub already_present: bool,
}

/// Result of preparing, planning, and starting a managed endpoint.
#[derive(Debug, Clone, PartialEq)]
pub struct ManagedEndpoint {
    /// Model used by the endpoint.
    pub model: PreparedManagedModel,
    /// Concrete launch plan selected for this machine and server build.
    pub plan: Plan,
    /// Ready supervised endpoint.
    pub endpoint: Endpoint,
}

impl ManagedEndpoint {
    /// OpenAI-compatible API root (`http://127.0.0.1:PORT/v1`).
    #[must_use]
    pub fn base_url(&self) -> String {
        self.endpoint.base_url()
    }
}

/// Failure while selecting, preparing, planning, or launching a managed model.
#[derive(Debug, thiserror::Error)]
pub enum ManagedError {
    /// Model catalog, store, or download failure.
    #[error("managed model error: {0}")]
    Model(#[from] aphrody_models::ModelError),
    /// GGUF inspection failure.
    #[error("managed model inspection failed: {0}")]
    Facts(#[from] crate::FactsError),
    /// Installed server capability probe failure.
    #[error("managed llama-server capability probe failed: {0}")]
    Capability(#[from] crate::CapabilityError),
    /// Supervisor launch or stop failure.
    #[error("managed llama-server supervisor failed: {0}")]
    Supervisor(#[from] crate::SupervisorError),
    /// Filesystem or daemon discovery failure.
    #[error("managed llama-server i/o error: {0}")]
    Io(#[from] std::io::Error),
    /// A catalog model belongs to another task.
    #[error("model `{model}` serves `{found}`, not required task `{expected}`")]
    TaskMismatch {
        /// Requested model id.
        model: String,
        /// Task required by the endpoint category.
        expected: ModelTask,
        /// Task declared by the catalog entry.
        found: ModelTask,
    },
    /// A catalog model cannot be executed by llama.cpp.
    #[error("model `{model}` uses backend `{found}`, not required backend `llama-cpp`")]
    BackendMismatch {
        /// Requested model id.
        model: String,
        /// Backend declared by the catalog entry.
        found: Backend,
    },
    /// The resolved model has no primary artefact.
    #[error("model `{model}` resolved without a primary weights artefact")]
    MissingWeights {
        /// Requested model id or reference.
        model: String,
    },
    /// The installed llama-server lacks the endpoint switch for this role.
    #[error("installed llama-server does not advertise support for `{role}` endpoints")]
    UnsupportedRole {
        /// Role that cannot be enabled.
        role: &'static str,
    },
    /// A blocking preparation task panicked or was cancelled.
    #[error("managed llama-server task failed: {0}")]
    Task(String),
}

/// Reusable managed llama-server facade.
#[derive(Debug, Clone)]
pub struct ManagedLlamaServer {
    binary: PathBuf,
    supervisor: Supervisor,
}

impl ManagedLlamaServer {
    /// Use `binary` with an already configured supervisor.
    #[must_use]
    pub fn new(binary: impl Into<PathBuf>, supervisor: Supervisor) -> Self {
        Self { binary: binary.into(), supervisor }
    }

    /// Use the daemon installed beside the current executable and store state under `state_root`.
    ///
    /// # Errors
    ///
    /// Returns [`ManagedError::Io`] when the sibling daemon is not installed.
    pub fn with_sibling_daemon(
        binary: impl Into<PathBuf>,
        state_root: impl Into<PathBuf>,
    ) -> Result<Self, ManagedError> {
        let daemon = DaemonCommand::sibling_binary()?;
        Ok(Self::new(binary, Supervisor::new(StateDirs::new(state_root), daemon)))
    }

    /// Underlying supervisor, for status inspection and side-channel access.
    #[must_use]
    pub fn supervisor(&self) -> &Supervisor {
        &self.supervisor
    }

    /// Resolve and make the requested model artefacts present locally.
    ///
    /// Catalog ids are checked against both the requested task and the
    /// llama.cpp backend. Direct references are accepted because the category
    /// supplies their role; GGUF validation happens before launch.
    ///
    /// # Errors
    ///
    /// Returns [`ManagedError`] when selection, validation, storage, or download fails.
    pub async fn prepare(
        &self,
        request: &ManagedRequest,
    ) -> Result<PreparedManagedModel, ManagedError> {
        let model_id = request
            .model
            .as_deref()
            .filter(|model| !model.is_empty() && *model != "default")
            .unwrap_or_else(|| request.category.default_model())
            .to_string();
        let catalog = Catalog::builtin();
        let resolved = catalog.resolve(&model_id)?;
        validate_resolved(&model_id, request.category, &resolved)?;

        let store = match &request.store_root {
            Some(root) => ModelStore::with_root(root)?,
            None => ModelStore::open()?,
        };
        let downloader = Downloader::new()?;
        let primary_path = match &resolved {
            Resolved::Catalog(entry) => entry.primary().map(|file| store.path_for(&file.reference)),
            Resolved::Direct(reference) => Some(store.path_for(reference)),
        }
        .ok_or_else(|| ManagedError::MissingWeights { model: model_id.clone() })?;
        let artifacts = resolved.artifacts();
        let mut all_paths = Vec::with_capacity(artifacts.len());
        let mut already_present = true;

        for (reference, expected_sha256) in artifacts {
            let path = store.path_for(&reference);
            let outcome = downloader
                .pull(
                    &store,
                    &reference,
                    &PullOptions {
                        expected_sha256,
                        force: request.force_pull,
                        catalog_id: resolved.catalog_id().map(ToOwned::to_owned),
                    },
                    |_| {},
                )
                .await?;
            already_present &= !outcome.transferred();
            all_paths.push(path);
        }

        Ok(PreparedManagedModel {
            category: request.category,
            model_id,
            primary_path,
            all_paths,
            already_present,
        })
    }

    /// Inspect, plan, and launch an already prepared model.
    ///
    /// Blocking GGUF, binary, and hardware probes run outside the async executor.
    /// A server with the same role and fingerprint is reused by the supervisor.
    ///
    /// # Errors
    ///
    /// Returns [`ManagedError`] when inspection, capability checks, planning inputs,
    /// or supervisor launch fail.
    pub async fn launch_prepared(
        &self,
        model: PreparedManagedModel,
        options: &ManagedLaunchOptions,
    ) -> Result<ManagedEndpoint, ManagedError> {
        let binary = self.binary.clone();
        let model_path = model.primary_path.clone();
        let (facts, capabilities, budget) = tokio::task::spawn_blocking(move || {
            let facts = ModelFacts::read(&model_path)?;
            let capabilities = ServerCapabilities::probe(&binary)?;
            let budget = Budget::from_profile(&aphrody_models::accel::probe());
            Ok::<_, ManagedError>((facts, capabilities, budget))
        })
        .await
        .map_err(|error| ManagedError::Task(error.to_string()))??;

        require_role_support(model.category, &capabilities)?;
        let mut plan_request = PlanRequest::new(model.category.role(), &model.model_id);
        plan_request.ctx = options.ctx;
        plan_request.pooling = options.pooling.clone();
        plan_request.margin_mib = options.margin_mib;
        plan_request.parallel = options.parallel.max(1);
        plan_request.extra_args.clone_from(&options.extra_args);
        plan_request.mmproj = model
            .all_paths
            .iter()
            .skip(1)
            .find(|path| {
                path.file_name().is_some_and(|name| name.to_string_lossy().contains("mmproj"))
            })
            .cloned();
        let plan = crate::plan(&facts, &capabilities, budget, &plan_request);
        let endpoint = self.supervisor.ensure(&self.binary, &plan, options.ensure).await?;
        Ok(ManagedEndpoint { model, plan, endpoint })
    }

    /// Prepare and launch a managed endpoint in one call.
    ///
    /// # Errors
    ///
    /// See [`ManagedLlamaServer::prepare`] and [`ManagedLlamaServer::launch_prepared`].
    pub async fn ensure(&self, request: &ManagedRequest) -> Result<ManagedEndpoint, ManagedError> {
        let model = self.prepare(request).await?;
        self.launch_prepared(model, &request.launch).await
    }

    /// Stop one managed category cleanly.
    ///
    /// # Errors
    ///
    /// Returns [`ManagedError::Supervisor`] when shutdown fails.
    pub async fn stop(&self, category: ManagedCategory) -> Result<bool, ManagedError> {
        Ok(self.supervisor.stop(category.role()).await?)
    }

    /// Path of the llama-server binary used by this facade.
    #[must_use]
    pub fn binary(&self) -> &Path {
        &self.binary
    }
}

fn validate_resolved(
    model_id: &str,
    category: ManagedCategory,
    resolved: &Resolved<'_>,
) -> Result<(), ManagedError> {
    if let Resolved::Catalog(entry) = resolved {
        if entry.task != category.task() {
            return Err(ManagedError::TaskMismatch {
                model: model_id.to_string(),
                expected: category.task(),
                found: entry.task,
            });
        }
        if entry.backend != Backend::LlamaCpp {
            return Err(ManagedError::BackendMismatch {
                model: model_id.to_string(),
                found: entry.backend,
            });
        }
    }
    Ok(())
}

fn require_role_support(
    category: ManagedCategory,
    capabilities: &ServerCapabilities,
) -> Result<(), ManagedError> {
    let supported = match category {
        ManagedCategory::Embedding => capabilities.embedding_flag.is_some(),
        ManagedCategory::Reranking => capabilities.rerank_flag.is_some(),
    };
    if supported {
        Ok(())
    } else {
        Err(ManagedError::UnsupportedRole { role: category.role().as_str() })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn category_defaults_are_catalogued_llama_models() {
        for category in [ManagedCategory::Embedding, ManagedCategory::Reranking] {
            let entry = Catalog::builtin().get(category.default_model()).expect("default entry");
            assert_eq!(entry.task, category.task());
            assert_eq!(entry.backend, Backend::LlamaCpp);
        }
    }

    #[test]
    fn wrong_task_and_backend_are_rejected_before_download() {
        let catalog = Catalog::builtin();
        let wrong_task = catalog.resolve(DEFAULT_RERANK_MODEL).expect("resolve");
        assert!(matches!(
            validate_resolved(DEFAULT_RERANK_MODEL, ManagedCategory::Embedding, &wrong_task),
            Err(ManagedError::TaskMismatch { .. })
        ));

        let wrong_backend = catalog.resolve("bge-small-en-v1.5").expect("resolve");
        assert!(matches!(
            validate_resolved("bge-small-en-v1.5", ManagedCategory::Embedding, &wrong_backend),
            Err(ManagedError::BackendMismatch { .. })
        ));
    }

    #[test]
    fn role_capability_is_mandatory() {
        let caps = ServerCapabilities::parse("--model FILE --port PORT", None);
        assert!(matches!(
            require_role_support(ManagedCategory::Embedding, &caps),
            Err(ManagedError::UnsupportedRole { role: "embed" })
        ));
        assert!(matches!(
            require_role_support(ManagedCategory::Reranking, &caps),
            Err(ManagedError::UnsupportedRole { role: "rerank" })
        ));
    }
}
