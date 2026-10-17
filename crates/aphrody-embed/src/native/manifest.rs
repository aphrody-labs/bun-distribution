//! Data-driven catalogue of supported embedding models.
//!
//! Every entry pins a Hugging Face commit so the downloaded bytes are reproducible and
//! verifiable (sha256 + size). All models share the BERT encoder code path; they only
//! differ in weights, tokenizer, pooling and instruction prefixes.

use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

/// Model used when nothing else is requested (`APHRODY_EMBED_MODEL` unset).
pub const DEFAULT_MODEL_ID: &str = "sentence-transformers/all-MiniLM-L6-v2";

/// Cross-encoder used when nothing else is requested (`APHRODY_RERANK_MODEL` unset).
/// (Hugging Face renamed `ms-marco-MiniLM-L-6-v2` to this id; the old name is an alias.)
pub const DEFAULT_RERANKER_ID: &str = "cross-encoder/ms-marco-MiniLM-L6-v2";

/// Common view of anything that is installed as a directory of verified files.
pub trait ModelFiles {
    /// Hugging Face repository id.
    fn id(&self) -> &str;
    /// Pinned Hugging Face commit hash.
    fn revision(&self) -> &str;
    /// Files to install.
    fn files(&self) -> &[FileSpec];

    /// Stable identifier to store next to produced vectors/scores: `<id>@<revision>`.
    fn versioned_id(&self) -> String {
        format!("{}@{}", self.id(), self.revision())
    }

    /// Directory name used under the models root: slashes become `--`.
    fn dir_name(&self) -> String {
        model_dir_name(self.id())
    }

    /// Default on-disk location (`models_root()/<dir_name>`).
    fn default_dir(&self) -> PathBuf {
        models_root().join(self.dir_name())
    }

    /// Total download size in bytes.
    fn total_size(&self) -> u64 {
        self.files().iter().map(|f| f.size).sum()
    }
}

/// How token states are reduced to one sentence vector.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Pooling {
    /// Attention-mask-aware average of all token states.
    Mean,
    /// State of the first (`[CLS]`) token.
    Cls,
}

/// One downloadable artefact of a model.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct FileSpec {
    /// File name inside the model directory.
    pub name: String,
    /// Immutable download URL (pinned revision).
    pub url: String,
    /// Lower-case hex sha256 of the file content.
    pub sha256: String,
    /// Size in bytes.
    pub size: u64,
}

/// Everything needed to fetch, verify and run a model.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ModelSpec {
    /// Hugging Face repository id, e.g. `sentence-transformers/all-MiniLM-L6-v2`.
    pub id: String,
    /// Pinned Hugging Face commit hash.
    pub revision: String,
    pub files: Vec<FileSpec>,
    /// Output embedding dimension.
    pub dim: usize,
    /// Maximum number of tokens (including special tokens) fed to the encoder.
    pub max_seq_len: usize,
    pub pooling: Pooling,
    /// Whether vectors are L2-normalised (all shipped models: yes).
    pub normalize: bool,
    /// Prefix prepended to search queries (`TextKind::Query`).
    pub query_prefix: String,
    /// Prefix prepended to indexed documents (`TextKind::Passage`).
    pub passage_prefix: String,
}

impl ModelFiles for ModelSpec {
    fn id(&self) -> &str {
        &self.id
    }

    fn revision(&self) -> &str {
        &self.revision
    }

    fn files(&self) -> &[FileSpec] {
        &self.files
    }
}

/// Mapping from the classifier logit to the reported score.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ScoreActivation {
    /// Raw logit (unbounded).
    Identity,
    /// `1 / (1 + e^-logit)` in (0, 1).
    Sigmoid,
}

/// A cross-encoder (query, passage) relevance model with a single-logit head.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct RerankerSpec {
    pub id: String,
    pub revision: String,
    pub files: Vec<FileSpec>,
    /// Token budget for the concatenated pair (including special tokens).
    pub max_seq_len: usize,
    /// Applied to the logit; mirrors `sentence_transformers.CrossEncoder.predict`.
    pub activation: ScoreActivation,
    /// Other ids accepted by [`find_reranker`].
    pub aliases: Vec<String>,
}

impl ModelFiles for RerankerSpec {
    fn id(&self) -> &str {
        &self.id
    }

    fn revision(&self) -> &str {
        &self.revision
    }

    fn files(&self) -> &[FileSpec] {
        &self.files
    }
}

/// Replace path separators of a Hugging Face id so it becomes a single directory name.
pub fn model_dir_name(id: &str) -> String {
    id.replace('/', "--")
}

/// Root directory holding all models: `$APHRODY_MODELS_DIR`, else Aphrody's shared models directory.
pub fn models_root() -> PathBuf {
    let explicit = std::env::var_os("APHRODY_MODELS_DIR")
        .filter(|v| !v.is_empty())
        .map(PathBuf::from);
    let shared = aphrody_models::paths::models_dir().ok();
    resolve_models_root(explicit, shared)
}

fn resolve_models_root(explicit: Option<PathBuf>, shared: Option<PathBuf>) -> PathBuf {
    explicit
        .or(shared)
        .unwrap_or_else(|| PathBuf::from(".aphrody").join("models"))
}

/// Look up a model by id (exact match, or match on the part after the slash).
pub fn find_model(id: &str) -> Option<ModelSpec> {
    let manifest = model_manifest();
    let wanted = id.trim();
    manifest
        .iter()
        .find(|m| m.id == wanted || m.dir_name() == wanted)
        .or_else(|| {
            manifest
                .iter()
                .find(|m| m.id.rsplit('/').next() == Some(wanted))
        })
        .cloned()
}

/// The default model spec (`all-MiniLM-L6-v2`).
pub fn default_model() -> ModelSpec {
    find_model(DEFAULT_MODEL_ID).expect("default model present in manifest")
}

fn hf_file(repo: &str, revision: &str, name: &str, sha256: &str, size: u64) -> FileSpec {
    FileSpec {
        name: name.to_string(),
        url: format!("https://huggingface.co/{repo}/resolve/{revision}/{name}"),
        sha256: sha256.to_string(),
        size,
    }
}

/// Catalogue of supported models with pinned revisions and verified hashes.
///
/// Prefix conventions:
/// - `all-MiniLM-L6-v2`: symmetric, no prefixes.
/// - `bge-small-en-v1.5`: queries get `"Represent this sentence for searching relevant passages:
///   "`, passages none; CLS pooling.
/// - `multilingual-e5-small`: `"query: "` / `"passage: "` are mandatory for good quality.
pub fn model_manifest() -> Vec<ModelSpec> {
    const MINILM: &str = "sentence-transformers/all-MiniLM-L6-v2";
    const MINILM_REV: &str = "1110a243fdf4706b3f48f1d95db1a4f5529b4d41";
    const BGE: &str = "BAAI/bge-small-en-v1.5";
    const BGE_REV: &str = "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a";
    const E5: &str = "intfloat/multilingual-e5-small";
    const E5_REV: &str = "614241f622f53c4eeff9890bdc4f31cfecc418b3";

    vec![
        ModelSpec {
            id: MINILM.to_string(),
            revision: MINILM_REV.to_string(),
            files: vec![
                hf_file(
                    MINILM,
                    MINILM_REV,
                    "config.json",
                    "953f9c0d463486b10a6871cc2fd59f223b2c70184f49815e7efbcab5d8908b41",
                    612,
                ),
                hf_file(
                    MINILM,
                    MINILM_REV,
                    "tokenizer.json",
                    "be50c3628f2bf5bb5e3a7f17b1f74611b2561a3a27eeab05e5aa30f411572037",
                    466_247,
                ),
                hf_file(
                    MINILM,
                    MINILM_REV,
                    "model.safetensors",
                    "53aa51172d142c89d9012cce15ae4d6cc0ca6895895114379cacb4fab128d9db",
                    90_868_376,
                ),
            ],
            dim: 384,
            max_seq_len: 256,
            pooling: Pooling::Mean,
            normalize: true,
            query_prefix: String::new(),
            passage_prefix: String::new(),
        },
        ModelSpec {
            id: BGE.to_string(),
            revision: BGE_REV.to_string(),
            files: vec![
                hf_file(
                    BGE,
                    BGE_REV,
                    "config.json",
                    "094f8e891b932f2000c92cfc663bac4c62069f5d8af5b5278c4306aef3084750",
                    743,
                ),
                hf_file(
                    BGE,
                    BGE_REV,
                    "tokenizer.json",
                    "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66",
                    711_396,
                ),
                hf_file(
                    BGE,
                    BGE_REV,
                    "model.safetensors",
                    "3c9f31665447c8911517620762200d2245a2518d6e7208acc78cd9db317e21ad",
                    133_466_304,
                ),
            ],
            dim: 384,
            max_seq_len: 512,
            pooling: Pooling::Cls,
            normalize: true,
            query_prefix: "Represent this sentence for searching relevant passages: ".to_string(),
            passage_prefix: String::new(),
        },
        ModelSpec {
            id: E5.to_string(),
            revision: E5_REV.to_string(),
            files: vec![
                hf_file(
                    E5,
                    E5_REV,
                    "config.json",
                    "69137736cab8b8903a07fe8afaafdda25aac55415a12a55d1bffa9f581abf959",
                    655,
                ),
                hf_file(
                    E5,
                    E5_REV,
                    "tokenizer.json",
                    "0b44a9d7b51c3c62626640cda0e2c2f70fdacdc25bbbd68038369d14ebdf4c39",
                    17_082_730,
                ),
                hf_file(
                    E5,
                    E5_REV,
                    "model.safetensors",
                    "1a55775f53449dac10a2bcbc312469fac40b96d53198c407081a831f81c98477",
                    470_641_600,
                ),
            ],
            dim: 384,
            max_seq_len: 512,
            pooling: Pooling::Mean,
            normalize: true,
            query_prefix: "query: ".to_string(),
            passage_prefix: "passage: ".to_string(),
        },
    ]
}

/// Catalogue of supported cross-encoder rerankers.
///
/// - `cross-encoder/ms-marco-MiniLM-L6-v2` (default): BERT, 6 layers, raw-logit scores (its config
///   pins `Identity`).
/// - `BAAI/bge-reranker-base`: XLM-RoBERTa base, 12 layers x 768, multilingual; scores are
///   `sigmoid(logit)` like `CrossEncoder.predict`. About 8x the compute of the default.
pub fn reranker_manifest() -> Vec<RerankerSpec> {
    const MSMARCO: &str = "cross-encoder/ms-marco-MiniLM-L6-v2";
    const MSMARCO_REV: &str = "233902d25c440f23af6f7d6e94d2946bac0bee0a";
    const BGE: &str = "BAAI/bge-reranker-base";
    const BGE_REV: &str = "2cfc18c9415c912f9d8155881c133215df768a70";
    vec![
        RerankerSpec {
            id: MSMARCO.to_string(),
            revision: MSMARCO_REV.to_string(),
            files: vec![
                hf_file(
                    MSMARCO,
                    MSMARCO_REV,
                    "config.json",
                    "380e02c93f431831be65d99a4e7e5f67c133985bf2e77d9d4eba46847190bacc",
                    794,
                ),
                hf_file(
                    MSMARCO,
                    MSMARCO_REV,
                    "tokenizer.json",
                    "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66",
                    711_396,
                ),
                hf_file(
                    MSMARCO,
                    MSMARCO_REV,
                    "model.safetensors",
                    "821d1aa69520101d6e0737f78a042ae25b19e5cb9160701909d10434f4aeb0ae",
                    90_870_598,
                ),
            ],
            max_seq_len: 512,
            activation: ScoreActivation::Identity,
            aliases: vec!["cross-encoder/ms-marco-MiniLM-L-6-v2".to_string()],
        },
        RerankerSpec {
            id: BGE.to_string(),
            revision: BGE_REV.to_string(),
            files: vec![
                hf_file(
                    BGE,
                    BGE_REV,
                    "config.json",
                    "289adf7ada1eb6b4afa7589a48a032d45a076cf2e46dcdb3b4cabc33be14f708",
                    799,
                ),
                hf_file(
                    BGE,
                    BGE_REV,
                    "tokenizer.json",
                    "9eb652ac4e40cc093272bbbe0f55d521cf67570060227109b5cdc20945a4489e",
                    17_098_107,
                ),
                hf_file(
                    BGE,
                    BGE_REV,
                    "model.safetensors",
                    "ced967c45fd1902eb92716c9ceeca7c95a936770ea9db611f5a841b926e33fbd",
                    1_112_206_140,
                ),
            ],
            max_seq_len: 512,
            activation: ScoreActivation::Sigmoid,
            aliases: Vec::new(),
        },
    ]
}

/// Look up a reranker by id, alias, directory name or the part after the slash.
pub fn find_reranker(id: &str) -> Option<RerankerSpec> {
    let wanted = id.trim();
    let manifest = reranker_manifest();
    manifest
        .iter()
        .find(|m| m.id == wanted || m.aliases.iter().any(|a| a == wanted) || m.dir_name() == wanted)
        .or_else(|| {
            manifest.iter().find(|m| {
                std::iter::once(&m.id)
                    .chain(&m.aliases)
                    .any(|name| name.rsplit('/').next() == Some(wanted))
            })
        })
        .cloned()
}

/// The default reranker spec (`ms-marco-MiniLM-L6-v2`).
pub fn default_reranker() -> RerankerSpec {
    find_reranker(DEFAULT_RERANKER_ID).expect("default reranker present in manifest")
}

/// Paths of the three files the BERT loader needs inside `dir`.
pub(crate) struct ModelPaths {
    pub config: PathBuf,
    pub tokenizer: PathBuf,
    pub weights: PathBuf,
}

impl ModelPaths {
    pub(crate) fn in_dir(dir: &Path) -> Self {
        Self {
            config: dir.join("config.json"),
            tokenizer: dir.join("tokenizer.json"),
            weights: dir.join("model.safetensors"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn model_root_prefers_override_then_shared_state() {
        let explicit = PathBuf::from("/custom/models");
        let shared = PathBuf::from("/state/models");
        assert_eq!(
            resolve_models_root(Some(explicit.clone()), Some(shared.clone())),
            explicit
        );
        assert_eq!(resolve_models_root(None, Some(shared.clone())), shared);
        assert_eq!(
            resolve_models_root(None, None),
            PathBuf::from(".aphrody/models")
        );
    }

    #[test]
    fn manifest_is_well_formed() {
        let manifest = model_manifest();
        assert_eq!(manifest.len(), 3);
        for spec in &manifest {
            assert_eq!(spec.revision.len(), 40, "{} revision", spec.id);
            assert!(spec.dim > 0 && spec.max_seq_len > 0);
            for file in &spec.files {
                assert_eq!(file.sha256.len(), 64, "{} sha256", file.name);
                assert!(file.sha256.chars().all(|c| c.is_ascii_hexdigit()));
                assert!(file.url.contains(&spec.revision));
                assert!(file.size > 0);
            }
            let names: Vec<_> = spec.files.iter().map(|f| f.name.as_str()).collect();
            assert!(names.contains(&"config.json"));
            assert!(names.contains(&"tokenizer.json"));
            assert!(names.contains(&"model.safetensors"));
        }
    }

    #[test]
    fn reranker_manifest_is_well_formed() {
        for spec in reranker_manifest() {
            assert_eq!(spec.revision.len(), 40);
            assert_eq!(spec.files.len(), 3);
            assert!(
                spec.files
                    .iter()
                    .all(|f| f.sha256.len() == 64 && f.size > 0)
            );
            assert!(spec.versioned_id().ends_with(&spec.revision));
        }
        assert_eq!(default_reranker().activation, ScoreActivation::Identity);
        assert_eq!(
            find_reranker("cross-encoder/ms-marco-MiniLM-L-6-v2")
                .unwrap()
                .id,
            DEFAULT_RERANKER_ID
        );
        assert_eq!(
            find_reranker("ms-marco-MiniLM-L-6-v2").unwrap().id,
            DEFAULT_RERANKER_ID
        );
        assert_eq!(
            find_reranker("bge-reranker-base").unwrap().activation,
            ScoreActivation::Sigmoid
        );
        assert!(find_reranker("nope").is_none());
    }

    #[test]
    fn lookup_by_id_short_name_and_dir_name() {
        assert_eq!(find_model(DEFAULT_MODEL_ID).unwrap().dim, 384);
        assert_eq!(
            find_model("bge-small-en-v1.5").unwrap().id,
            "BAAI/bge-small-en-v1.5"
        );
        assert_eq!(
            find_model("intfloat--multilingual-e5-small")
                .unwrap()
                .query_prefix,
            "query: "
        );
        assert!(find_model("nope").is_none());
        assert_eq!(
            default_model().dir_name(),
            "sentence-transformers--all-MiniLM-L6-v2"
        );
        assert_eq!(
            default_model().versioned_id(),
            "sentence-transformers/all-MiniLM-L6-v2@1110a243fdf4706b3f48f1d95db1a4f5529b4d41"
        );
    }
}
