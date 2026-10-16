// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: 2026 aphrody contributors
//! Read-only view of an Ollama model store, in process.
//!
//! Ollama keeps models as an OCI-style layout under `$OLLAMA_MODELS`
//! (default `~/.ollama/models`):
//!
//! ```text
//! manifests/<host>/<namespace>/<model>/<tag>     JSON manifest
//! blobs/sha256-<hex>                             content-addressed layers
//! ```
//!
//! A manifest lists layers by media type; the GGUF weights are the layer typed
//! `application/vnd.ollama.image.model`. This module resolves an Ollama model
//! name (`gpt-oss:20b`, `library/llama3`, `host/ns/name:tag`) to that blob so
//! an in-process engine can load it directly: no `ollama` binary is spawned
//! and nothing is copied or written. Layout contract taken from the upstream
//! Ollama source (`manifest/` and `types/model/name.go`).

use std::path::{Path, PathBuf};

use crate::error::{ModelError, Result};

const DEFAULT_HOST: &str = "registry.ollama.ai";
const DEFAULT_NAMESPACE: &str = "library";
const DEFAULT_TAG: &str = "latest";

/// Media type of the GGUF weights layer.
pub const MEDIA_TYPE_MODEL: &str = "application/vnd.ollama.image.model";
/// Media type of the chat template layer.
pub const MEDIA_TYPE_TEMPLATE: &str = "application/vnd.ollama.image.template";
/// Media type of the system prompt layer.
pub const MEDIA_TYPE_SYSTEM: &str = "application/vnd.ollama.image.system";
/// Media type of the sampling parameters layer (JSON).
pub const MEDIA_TYPE_PARAMS: &str = "application/vnd.ollama.image.params";
/// Media type of the multimodal projector layer.
pub const MEDIA_TYPE_PROJECTOR: &str = "application/vnd.ollama.image.projector";
/// Media type of a `LoRA` adapter layer.
pub const MEDIA_TYPE_ADAPTER: &str = "application/vnd.ollama.image.adapter";

/// A fully-qualified Ollama model name.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OllamaName {
    /// Registry host, default `registry.ollama.ai`.
    pub host: String,
    /// Namespace, default `library`.
    pub namespace: String,
    /// Model name.
    pub model: String,
    /// Tag, default `latest`.
    pub tag: String,
}

impl OllamaName {
    /// Parse `[host/][namespace/]model[:tag]`, applying Ollama's defaults.
    ///
    /// # Errors
    ///
    /// [`ModelError::BadRef`] for an empty name, an empty segment, or a
    /// segment that could escape the store (`..`, separators, NUL).
    pub fn parse(input: &str) -> Result<Self> {
        let bad = |reason| ModelError::BadRef { input: input.to_owned(), reason };
        let (path, tag) = match input.rsplit_once(':') {
            // A ':' before the last '/' is a host port, not a tag separator.
            Some((path, tag)) if !tag.contains('/') => (path, tag),
            _ => (input, DEFAULT_TAG),
        };
        let parts: Vec<&str> = path.split('/').collect();
        let (host, namespace, model) = match parts.as_slice() {
            [model] => (DEFAULT_HOST, DEFAULT_NAMESPACE, *model),
            [namespace, model] => (DEFAULT_HOST, *namespace, *model),
            [host, namespace, model] => (*host, *namespace, *model),
            _ => return Err(bad("expected [host/][namespace/]model[:tag]")),
        };
        for seg in [host, namespace, model, tag] {
            if seg.is_empty() {
                return Err(bad("empty name segment"));
            }
            if seg == "." || seg == ".." || seg.contains(['\\', '\0']) {
                return Err(bad("illegal characters in name segment"));
            }
        }
        Ok(Self {
            host: host.to_owned(),
            namespace: namespace.to_owned(),
            model: model.to_owned(),
            tag: tag.to_owned(),
        })
    }

    fn manifest_rel(&self) -> PathBuf {
        [self.host.as_str(), self.namespace.as_str(), self.model.as_str(), self.tag.as_str()]
            .iter()
            .collect()
    }
}

/// One layer of a manifest.
#[derive(Debug, Clone, serde::Deserialize)]
pub struct OllamaLayer {
    /// OCI-style media type, see the `MEDIA_TYPE_*` constants.
    #[serde(rename = "mediaType")]
    pub media_type: String,
    /// `sha256:<hex>`.
    pub digest: String,
    /// Blob size in bytes.
    #[serde(default)]
    pub size: u64,
}

#[derive(Debug, serde::Deserialize)]
struct Manifest {
    #[serde(default)]
    layers: Vec<OllamaLayer>,
}

/// A read-only handle on an Ollama models directory.
#[derive(Debug, Clone)]
pub struct OllamaStore {
    root: PathBuf,
}

/// A model resolved against an [`OllamaStore`].
#[derive(Debug, Clone)]
pub struct OllamaModel {
    /// The resolved name.
    pub name: OllamaName,
    /// Every layer of the manifest, in manifest order.
    pub layers: Vec<OllamaLayer>,
    root: PathBuf,
}

impl OllamaStore {
    /// Use an explicit models directory.
    #[must_use]
    pub fn at(root: impl Into<PathBuf>) -> Self {
        Self { root: root.into() }
    }

    /// `$OLLAMA_MODELS`, else `~/.ollama/models`. `None` when neither resolves.
    #[must_use]
    pub fn discover() -> Option<Self> {
        if let Some(dir) = std::env::var_os("OLLAMA_MODELS").filter(|v| !v.is_empty()) {
            return Some(Self::at(dir));
        }
        dirs::home_dir().map(|home| Self::at(home.join(".ollama").join("models")))
    }

    /// The models directory.
    #[must_use]
    pub fn root(&self) -> &Path {
        &self.root
    }

    /// Resolve `name` to its manifest.
    ///
    /// # Errors
    ///
    /// [`ModelError::BadRef`] for a malformed name, [`ModelError::NotInstalled`]
    /// when no manifest exists, [`ModelError::Io`] / [`ModelError::Registry`]
    /// when it cannot be read or decoded.
    pub fn resolve(&self, name: &str) -> Result<OllamaModel> {
        let name = OllamaName::parse(name)?;
        let path = self.root.join("manifests").join(name.manifest_rel());
        let bytes = match std::fs::read(&path) {
            Ok(bytes) => bytes,
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
                return Err(ModelError::NotInstalled(format!(
                    "{}/{}/{}:{}",
                    name.host, name.namespace, name.model, name.tag
                )));
            },
            Err(source) => return Err(ModelError::Io { path, source }),
        };
        let manifest: Manifest = serde_json::from_slice(&bytes)
            .map_err(|source| ModelError::Registry { path, source })?;
        Ok(OllamaModel { name, layers: manifest.layers, root: self.root.clone() })
    }

    /// Names of every installed manifest, as `host/namespace/model:tag`.
    ///
    /// # Errors
    ///
    /// [`ModelError::Io`] when the manifests directory exists but cannot be read.
    pub fn list(&self) -> Result<Vec<String>> {
        let base = self.root.join("manifests");
        let mut out = Vec::new();
        if !base.is_dir() {
            return Ok(out);
        }
        // host / namespace / model / tag: exactly four levels.
        let mut stack = vec![(base.clone(), 0_usize)];
        while let Some((dir, depth)) = stack.pop() {
            let entries = std::fs::read_dir(&dir)
                .map_err(|source| ModelError::Io { path: dir.clone(), source })?;
            for entry in entries.flatten() {
                let path = entry.path();
                if depth < 3 && path.is_dir() {
                    stack.push((path, depth + 1));
                } else if depth == 3
                    && path.is_file()
                    && let Ok(rel) = path.strip_prefix(&base)
                {
                    let parts: Vec<_> = rel.iter().map(|p| p.to_string_lossy()).collect();
                    if let [host, ns, model, tag] = parts.as_slice() {
                        out.push(format!("{host}/{ns}/{model}:{tag}"));
                    }
                }
            }
        }
        out.sort();
        Ok(out)
    }
}

impl OllamaModel {
    fn blob(&self, layer: &OllamaLayer) -> PathBuf {
        // Ollama stores `sha256:<hex>` as `sha256-<hex>`.
        self.root.join("blobs").join(layer.digest.replace(':', "-"))
    }

    /// First layer of `media_type`, with its blob path.
    #[must_use]
    pub fn layer(&self, media_type: &str) -> Option<(&OllamaLayer, PathBuf)> {
        self.layers.iter().find(|l| l.media_type == media_type).map(|l| (l, self.blob(l)))
    }

    /// Path to the GGUF weights blob, when present on disk.
    #[must_use]
    pub fn gguf_path(&self) -> Option<PathBuf> {
        self.layer(MEDIA_TYPE_MODEL).map(|(_, p)| p).filter(|p| p.is_file())
    }

    /// UTF-8 text of a text layer (template, system, params).
    ///
    /// # Errors
    ///
    /// [`ModelError::Io`] when the blob cannot be read.
    pub fn read_text(&self, media_type: &str) -> Result<Option<String>> {
        let Some((_, path)) = self.layer(media_type) else { return Ok(None) };
        std::fs::read_to_string(&path).map(Some).map_err(|source| ModelError::Io { path, source })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn name_defaults() {
        let n = OllamaName::parse("gpt-oss:20b").unwrap();
        assert_eq!(
            (n.host.as_str(), n.namespace.as_str(), n.model.as_str(), n.tag.as_str()),
            ("registry.ollama.ai", "library", "gpt-oss", "20b")
        );
        assert_eq!(OllamaName::parse("llama3").unwrap().tag, "latest");
        assert_eq!(OllamaName::parse("me/tuned:q4").unwrap().namespace, "me");
    }

    #[test]
    fn name_rejects_traversal() {
        assert!(OllamaName::parse("../x").is_err());
        assert!(OllamaName::parse("").is_err());
        assert!(OllamaName::parse("a/b/c/d").is_err());
    }

    #[test]
    fn resolves_gguf_blob() {
        let dir = tempfile::tempdir().unwrap();
        let mdir = dir.path().join("manifests/registry.ollama.ai/library/tiny");
        std::fs::create_dir_all(&mdir).unwrap();
        std::fs::create_dir_all(dir.path().join("blobs")).unwrap();
        std::fs::write(dir.path().join("blobs/sha256-abc"), b"GGUF").unwrap();
        std::fs::write(
            mdir.join("latest"),
            br#"{"schemaVersion":2,"layers":[{"mediaType":"application/vnd.ollama.image.model","digest":"sha256:abc","size":4}]}"#,
        )
        .unwrap();
        let store = OllamaStore::at(dir.path());
        let model = store.resolve("tiny").unwrap();
        assert_eq!(model.gguf_path().unwrap(), dir.path().join("blobs/sha256-abc"));
        assert_eq!(store.list().unwrap(), ["registry.ollama.ai/library/tiny:latest"]);
        assert!(matches!(store.resolve("absent"), Err(ModelError::NotInstalled(_))));
    }
}
