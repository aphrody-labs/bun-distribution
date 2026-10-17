// SPDX-License-Identifier: Apache-2.0
//! Thin, read-only integration of the workspace-pinned official `hf-hub`.
//! No credentials are persisted here; the caller selects the domain's store.
//! Downloads remain owned by [`crate::Downloader`] and [`crate::ModelStore`].

use aphrody_secrets::{SecretStore, SecretValue};
use futures_util::TryStreamExt as _;
use hf_hub::HFClient;
/// Official repository-kind selector, shared with the pinned library.
pub use hf_hub::RepoTypeAny;
use hf_hub::repository::{DatasetInfo, KernelInfo, ModelInfo, SpaceInfo};

/// Repository metadata of any kind, carrying the official per-kind info types.
/// hf-hub 1.0 exposes typed `info()` calls only, so the runtime-tagged union lives here.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub enum RepoInfo {
    /// Model metadata, boxed because [`ModelInfo`] dwarfs the other variants.
    Model(Box<ModelInfo>),
    /// Dataset metadata.
    Dataset(DatasetInfo),
    /// Space metadata.
    Space(SpaceInfo),
    /// Kernel metadata.
    Kernel(KernelInfo),
}

impl RepoInfo {
    /// Repository id, in the form `owner/name`.
    #[must_use]
    pub fn id(&self) -> &str {
        match self {
            Self::Model(info) => &info.id,
            Self::Dataset(info) => &info.id,
            Self::Space(info) => &info.id,
            Self::Kernel(info) => &info.id,
        }
    }

    /// Model metadata, when this describes a model repository.
    #[must_use]
    pub fn as_model(&self) -> Option<&ModelInfo> {
        match self {
            Self::Model(info) => Some(info),
            _ => None,
        }
    }
}

/// Errors deliberately exclude remote bodies and secret-store error strings.
#[derive(Debug, thiserror::Error)]
pub enum HubError {
    /// No usable token exists in the selected store.
    #[error("Hugging Face identity missing in selected protected store")]
    MissingIdentity,
    /// The selected store could not resolve the credential.
    #[error("Hugging Face protected-store lookup failed")]
    CredentialStore,
    /// A token is not a valid HTTP bearer value.
    #[error("invalid Hugging Face bearer credential")]
    InvalidCredential,
    /// Invalid request, rejected before network I/O.
    #[error("invalid Hub request")]
    InvalidRequest,
    /// The official client rejected or failed a request.
    #[error("Hugging Face Hub request failed")]
    Request,
}

/// Resolve exactly the caller-selected key, without creating another store.
/// Missing, blank, or binary credentials never silently become anonymous.
///
/// # Errors
/// Returns a redacted error for unavailable stores or unusable credentials.
pub async fn resolve_token(store: &dyn SecretStore, key: &str) -> Result<SecretValue, HubError> {
    let token = store
        .get(key)
        .await
        .map_err(|_| HubError::CredentialStore)?
        .ok_or(HubError::MissingIdentity)?;
    validate_token(&token)?;
    Ok(token)
}

fn validate_token(token: &SecretValue) -> Result<(), HubError> {
    let value = token.expose_secret();
    if value.trim().is_empty() {
        return Err(HubError::MissingIdentity);
    }
    if !value
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b"-._~+/=".contains(&b))
    {
        return Err(HubError::InvalidCredential);
    }
    Ok(())
}

/// Metadata-only client fixed to the official HTTPS Hub origin.
/// No raw client accessor is exposed, so callers cannot enable writes or
/// redirect the credential to a custom endpoint through this adapter.
#[derive(Clone)]
pub struct Hub {
    client: HFClient,
    authenticated: bool,
}

impl std::fmt::Debug for Hub {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Hub")
            .field("authenticated", &self.authenticated)
            .finish_non_exhaustive()
    }
}

impl Hub {
    /// Anonymous public metadata access. Does not inspect environment or files.
    ///
    /// # Errors
    /// Returns a redacted client-construction error.
    pub fn anonymous() -> Result<Self, HubError> {
        Self::build(None)
    }

    /// Reuse a credential from the caller's existing domain store.
    ///
    /// # Errors
    /// Returns redacted lookup, validation or client-construction errors.
    pub async fn from_secret_store(store: &dyn SecretStore, key: &str) -> Result<Self, HubError> {
        let token = resolve_token(store, key).await?;
        Self::build(Some(&token))
    }

    fn build(token: Option<&SecretValue>) -> Result<Self, HubError> {
        crate::fetch::ensure_crypto_provider();
        let http = reqwest::Client::builder()
            .user_agent(concat!("aphrody-models/", env!("CARGO_PKG_VERSION")))
            .timeout(std::time::Duration::from_secs(30))
            .connect_timeout(std::time::Duration::from_secs(10))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|_| HubError::Request)?;
        let mut builder = HFClient::builder()
            .client(http)
            .endpoint("https://huggingface.co")
            .cache_enabled(false)
            .retry_max_attempts(2)
            .user_agent(concat!("aphrody-models/", env!("CARGO_PKG_VERSION")));
        if let Some(token) = token {
            builder = builder.token(token.expose_secret());
        }
        Ok(Self {
            client: builder.build().map_err(|_| HubError::Request)?,
            authenticated: token.is_some(),
        })
    }

    /// Validate the configured identity remotely without returning private profile fields.
    ///
    /// # Errors
    /// Anonymous clients fail locally; rejected tokens and network errors fail remotely.
    pub async fn verify_identity(&self) -> Result<(), HubError> {
        if !self.authenticated {
            return Err(HubError::MissingIdentity);
        }
        self.client
            .whoami()
            .send()
            .await
            .map(|_| ())
            .map_err(|_| HubError::Request)
    }

    /// Read Space runtime/hardware status without mutating the Space.
    ///
    /// # Errors
    /// Invalid ids fail locally; transport and permission failures are redacted.
    pub async fn space_runtime(&self, id: &str) -> Result<hf_hub::spaces::SpaceRuntime, HubError> {
        let (owner, name) = validated_id(id)?;
        self.client
            .space(owner, name)
            .runtime()
            .send()
            .await
            .map_err(|_| HubError::Request)
    }

    /// Read model, dataset, Space or kernel metadata at an explicit revision.
    /// Mutable revisions are allowed for discovery, never implied to be pinned.
    ///
    /// # Errors
    /// Invalid ids/revisions fail locally; Hub failures are redacted.
    pub async fn info(
        &self,
        kind: RepoTypeAny,
        id: &str,
        revision: &str,
    ) -> Result<RepoInfo, HubError> {
        let (owner, name) = validated_id(id)?;
        if revision.is_empty() || revision.len() > 256 || revision.chars().any(char::is_control) {
            return Err(HubError::InvalidRequest);
        }
        let client = &self.client;
        let info = match kind {
            RepoTypeAny::Model => client
                .model(owner, name)
                .info()
                .revision(revision)
                .send()
                .await
                .map(|v| RepoInfo::Model(Box::new(v))),
            RepoTypeAny::Dataset => client
                .dataset(owner, name)
                .info()
                .revision(revision)
                .send()
                .await
                .map(RepoInfo::Dataset),
            RepoTypeAny::Space => client
                .space(owner, name)
                .info()
                .revision(revision)
                .send()
                .await
                .map(RepoInfo::Space),
            RepoTypeAny::Kernel => client
                .kernel(owner, name)
                .info()
                .revision(revision)
                .send()
                .await
                .map(RepoInfo::Kernel),
        };
        info.map_err(|_| HubError::Request)
    }

    /// Search a bounded metadata page (1–100 results); never download payloads.
    ///
    /// # Errors
    /// Rejects excessive limits, kernel search and control characters locally.
    pub async fn search(
        &self,
        kind: RepoTypeAny,
        query: &str,
        limit: usize,
    ) -> Result<Vec<RepoInfo>, HubError> {
        if !(1..=100).contains(&limit) || query.len() > 512 || query.chars().any(char::is_control) {
            return Err(HubError::InvalidRequest);
        }
        match kind {
            RepoTypeAny::Model => self
                .client
                .list_models()
                .search(query)
                .limit(limit)
                .send()
                .map_err(|_| HubError::Request)?
                .map_ok(|v| RepoInfo::Model(Box::new(v)))
                .try_collect()
                .await
                .map_err(|_| HubError::Request),
            RepoTypeAny::Dataset => self
                .client
                .list_datasets()
                .search(query)
                .limit(limit)
                .send()
                .map_err(|_| HubError::Request)?
                .map_ok(RepoInfo::Dataset)
                .try_collect()
                .await
                .map_err(|_| HubError::Request),
            RepoTypeAny::Space => self
                .client
                .list_spaces()
                .search(query)
                .limit(limit)
                .send()
                .map_err(|_| HubError::Request)?
                .map_ok(RepoInfo::Space)
                .try_collect()
                .await
                .map_err(|_| HubError::Request),
            RepoTypeAny::Kernel => Err(HubError::InvalidRequest),
        }
    }
}

fn validated_id(id: &str) -> Result<(&str, &str), HubError> {
    if id.len() > 256 {
        return Err(HubError::InvalidRequest);
    }
    let (owner, name) = id.split_once('/').ok_or(HubError::InvalidRequest)?;
    for component in [owner, name] {
        if component.is_empty()
            || component == "."
            || component == ".."
            || !component
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b"-_.".contains(&b))
        {
            return Err(HubError::InvalidRequest);
        }
    }
    Ok((owner, name))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_path_and_query_injection() {
        for id in [
            "a/b/c",
            "../b",
            "a/..",
            "a/b?token=x",
            "a/b#x",
            "/b",
            "a/",
            "a/b\n",
        ] {
            assert!(validated_id(id).is_err());
        }
        assert_eq!(
            validated_id("org-name/model.v2").unwrap(),
            ("org-name", "model.v2")
        );
    }

    #[test]
    fn bearer_validation_and_errors_do_not_expose_values() {
        assert!(validate_token(&SecretValue::from("hf_fixture_only")).is_ok());
        for value in ["", " ", "hf_fixture\r\nInjected: x", "hf fixture", "é"] {
            let error = validate_token(&SecretValue::from(value)).unwrap_err();
            assert!(!error.to_string().contains("fixture"));
        }
    }

    #[tokio::test]
    async fn selected_store_is_reused_and_missing_identity_is_explicit() {
        let dir = tempfile::tempdir().unwrap();
        let store = aphrody_secrets::FileSecretStore::new(dir.path().join("test-only.json"));
        assert!(matches!(
            resolve_token(&store, "HF_TOKEN").await,
            Err(HubError::MissingIdentity)
        ));
        store
            .set("HF_TOKEN", SecretValue::from("hf_fixture_only"))
            .await
            .unwrap();
        let hub = Hub::from_secret_store(&store, "HF_TOKEN").await.unwrap();
        assert!(!format!("{hub:?}").contains("fixture"));
        assert!(hub.authenticated);
        assert!(matches!(
            hub.search(RepoTypeAny::Model, "x", 101).await,
            Err(HubError::InvalidRequest)
        ));
        assert!(matches!(
            hub.info(RepoTypeAny::Dataset, "../x", "main").await,
            Err(HubError::InvalidRequest)
        ));
    }

    #[tokio::test]
    async fn anonymous_identity_check_never_contacts_network() {
        let hub = Hub::anonymous().unwrap();
        assert!(matches!(
            hub.verify_identity().await,
            Err(HubError::MissingIdentity)
        ));
    }

    #[tokio::test]
    async fn official_search_decodes_metadata_without_artifact_requests() {
        use std::io::{Read as _, Write as _};
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let address = listener.local_addr().unwrap();
        let server = std::thread::spawn(move || {
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
            let mut socket = loop {
                match listener.accept() {
                    Ok((socket, _)) => break socket,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            std::time::Instant::now() < deadline,
                            "fixture request timed out"
                        );
                        std::thread::sleep(std::time::Duration::from_millis(5));
                    }
                    Err(error) => panic!("fixture listener: {error}"),
                }
            };
            socket
                .set_read_timeout(Some(std::time::Duration::from_secs(5)))
                .unwrap();
            let mut request = Vec::new();
            let mut byte = [0];
            while !request.ends_with(b"\r\n\r\n") {
                assert!(request.len() < 8192);
                socket.read_exact(&mut byte).unwrap();
                request.push(byte[0]);
            }
            let request = String::from_utf8(request).unwrap();
            assert!(request.starts_with("GET /api/models?"));
            assert!(request.contains("search=fixture") && request.contains("limit=1"));
            assert!(!request.to_ascii_lowercase().contains("authorization:"));
            let body = r#"[{"id":"fixture/model"}]"#;
            write!(socket, "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len()).unwrap();
        });
        // A loopback endpoint is available only inside this unit test.
        let hub = Hub {
            client: HFClient::builder()
                .endpoint(format!("http://{address}"))
                .cache_enabled(false)
                .retry_max_attempts(1)
                .build()
                .unwrap(),
            authenticated: false,
        };
        let results = hub.search(RepoTypeAny::Model, "fixture", 1).await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].as_model().unwrap().id, "fixture/model");
        server.join().unwrap();
    }
}
