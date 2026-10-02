// SPDX-License-Identifier: Apache-2.0
//! The crate's configuration as mistral.rs builders.
//!
//! [`Options`] and [`LoadSpec`] are plain data computed from the crate's own configuration types
//! by pure functions, so every decision (which ISQ, which dtype, where the token comes from,
//! whether the prefix cache stays on) is unit-tested without loading a model. The only code that
//! talks to a mistral.rs builder is [`LoadSpec::build`], and it does nothing but apply the
//! options and call `build`.
//!
//! Parsing happens when the client is constructed, not when the model loads, so a typo in
//! `isq` or `hf_token_source` is a configuration error at once instead of a failure minutes
//! into a download.

use std::fmt;
use std::path::PathBuf;
use std::str::FromStr;

use mistralrs::{
    EmbeddingModelBuilder, GgufModelBuilder, IsqBits, IsqSetting, MemoryGpuConfig, Model,
    ModelBuilder, ModelDType, MultimodalModelBuilder, PagedAttentionConfig,
    PagedAttentionMetaBuilder, PagedCacheType, TextModelBuilder, TokenSource,
    UqffMultimodalModelBuilder, UqffTextModelBuilder, parse_isq_value,
};

use crate::config::{
    EmbedderConfig, EngineConfig, ModelSource, PagedAttentionSpec, PagedCache, PagedMemory,
    RuntimeOptions,
};
use crate::error::EngineError;

/// Apply the options every builder has. mistral.rs gives its builders the same method names but
/// no common trait, so this is a macro: each expansion type-checks against one concrete builder.
macro_rules! apply_common {
    ($builder:expr, $options:expr) => {{
        let options: &Options = $options;
        let mut builder = $builder;
        builder = match options.isq {
            Some(IsqSetting::Auto(bits)) => builder.with_auto_isq(bits),
            Some(IsqSetting::Specific(isq)) => builder.with_isq(isq),
            None => builder,
        };
        builder = builder.with_dtype(options.dtype);
        if options.force_cpu {
            builder = builder.with_force_cpu();
        }
        if let Some(seqs) = options.max_num_seqs {
            builder = builder.with_max_num_seqs(seqs);
        }
        if let Some(path) = &options.tokenizer_json {
            builder = builder.with_tokenizer_json(path);
        }
        if let Some(revision) = &options.hf_revision {
            builder = builder.with_hf_revision(revision);
        }
        if let Some(dir) = &options.hf_cache_dir {
            builder = builder.from_hf_cache_path(dir.clone());
        }
        if let Some(Redacted(source)) = &options.token_source {
            builder = builder.with_token_source(source.clone());
        }
        if options.logging {
            builder = builder.with_logging();
        }
        builder
    }};
}

/// `apply_common!` plus what only the chat builders have: chat template, context cap, paged
/// attention and the prefix cache. The embedding builder has none of them, and
/// [`EmbedderConfig::validate`] refuses a configuration that sets one.
macro_rules! apply_chat {
    ($builder:expr, $options:expr) => {{
        let options: &Options = $options;
        let mut builder = apply_common!($builder, options);
        if let Some(template) = &options.chat_template {
            builder = builder.with_chat_template(template);
        }
        if let Some(tokens) = options.max_model_len {
            builder = builder.with_max_model_len(tokens);
        }
        if let Some(paged) = options.paged {
            builder = builder.with_paged_attn(paged);
        }
        match options.prefix_cache {
            PrefixCache::Upstream => {},
            PrefixCache::Off => builder = builder.with_prefix_cache_n(None),
            PrefixCache::Seqs(seqs) => builder = builder.with_prefix_cache_n(Some(seqs)),
        }
        builder
    }};
}

/// What to do with the prefix cache of the builder.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PrefixCache {
    /// Leave the builder's own default (16 prompts, or none for the multimodal builder).
    Upstream,
    /// Turn the cache off.
    Off,
    /// Keep this many prompts.
    Seqs(usize),
}

/// A token source kept out of `Debug` output: a `literal:` source is the token itself.
#[derive(Clone)]
pub(crate) struct Redacted(TokenSource);

impl fmt::Debug for Redacted {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("TokenSource(..)")
    }
}

/// [`RuntimeOptions`] with every string parsed into the type mistral.rs takes.
#[derive(Debug, Clone)]
pub(crate) struct Options {
    /// A bit width resolves per device when the model loads; an exact type is fixed.
    pub(crate) isq: Option<IsqSetting>,
    pub(crate) dtype: ModelDType,
    pub(crate) force_cpu: bool,
    pub(crate) paged: Option<PagedAttentionConfig>,
    pub(crate) max_num_seqs: Option<usize>,
    pub(crate) max_model_len: Option<usize>,
    pub(crate) prefix_cache: PrefixCache,
    pub(crate) chat_template: Option<String>,
    pub(crate) tokenizer_json: Option<String>,
    pub(crate) hf_revision: Option<String>,
    pub(crate) hf_cache_dir: Option<PathBuf>,
    pub(crate) token_source: Option<Redacted>,
    pub(crate) logging: bool,
}

impl Options {
    /// Parse `runtime`.
    ///
    /// # Errors
    /// [`EngineError::Config`] naming the field mistral.rs would not accept.
    pub(crate) fn from_runtime(runtime: &RuntimeOptions) -> Result<Self, EngineError> {
        Ok(Self {
            isq: runtime.isq.as_deref().map(parse_isq).transpose()?,
            dtype: runtime.dtype.as_deref().map(parse_dtype).transpose()?.unwrap_or_default(),
            force_cpu: runtime.force_cpu,
            paged: runtime.paged_attention.as_ref().map(paged_config).transpose()?,
            max_num_seqs: runtime.max_num_seqs,
            max_model_len: runtime.max_model_len,
            prefix_cache: match runtime.prefix_cache_seqs {
                None => PrefixCache::Upstream,
                Some(0) => PrefixCache::Off,
                Some(seqs) => PrefixCache::Seqs(seqs),
            },
            chat_template: set(runtime.chat_template.as_deref()),
            tokenizer_json: set(runtime.tokenizer_json.as_deref()),
            hf_revision: set(runtime.hf_revision.as_deref())
                .map(|revision| revision.trim().to_owned()),
            hf_cache_dir: runtime.hf_cache_dir.clone(),
            token_source: runtime
                .hf_token_source
                .as_deref()
                .filter(|spec| !spec.trim().is_empty())
                .map(parse_token_source)
                .transpose()?,
            logging: runtime.logging,
        })
    }
}

/// A setting that is present but blank counts as unset, so a settings file can say `""`.
fn set(value: Option<&str>) -> Option<String> {
    value.filter(|text| !text.trim().is_empty()).map(str::to_owned)
}

/// Blank entries of a file list are dropped; mistral.rs would look for a file named `""`.
fn files(names: &[String]) -> Vec<String> {
    names
        .iter()
        .map(|name| name.trim())
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .collect()
}

/// A bit width (`2` to `8`, resolved for the device when the model loads) or an exact type
/// (`q4k`, `q8_0`, `hqq4`, `afq4`, ...), in mistral.rs' own spelling.
fn parse_isq(spec: &str) -> Result<IsqSetting, EngineError> {
    let spec = spec.trim();
    if let Ok(bits) = IsqBits::try_from(spec) {
        return Ok(IsqSetting::Auto(bits));
    }
    parse_isq_value(spec, None)
        .map(IsqSetting::Specific)
        .map_err(|message| EngineError::Config(format!("`isq`: {message}")))
}

fn parse_dtype(spec: &str) -> Result<ModelDType, EngineError> {
    ModelDType::from_str(spec.trim())
        .map_err(|message| EngineError::Config(format!("`dtype`: {message}")))
}

fn parse_token_source(spec: &str) -> Result<Redacted, EngineError> {
    TokenSource::from_str(spec.trim()).map(Redacted).map_err(|_| {
        // The value is not echoed: a `literal:` source is the token.
        EngineError::Config(
            "`hf_token_source` must be `cache`, `none`, `env:VAR`, `path:FILE` or `literal:TOKEN`"
                .to_owned(),
        )
    })
}

/// The three pieces mistral.rs' paged attention builder takes.
fn paged_parts(spec: &PagedAttentionSpec) -> (Option<usize>, MemoryGpuConfig, PagedCacheType) {
    let memory = match spec.memory {
        PagedMemory::ContextTokens(tokens) => MemoryGpuConfig::ContextSize(tokens),
        PagedMemory::Megabytes(megabytes) => MemoryGpuConfig::MbAmount(megabytes),
        PagedMemory::Utilization(fraction) => MemoryGpuConfig::Utilization(fraction),
    };
    let cache = match spec.cache {
        PagedCache::Auto => PagedCacheType::Auto,
        PagedCache::F8e4m3 => PagedCacheType::F8E4M3,
    };
    (spec.block_size, memory, cache)
}

fn paged_config(spec: &PagedAttentionSpec) -> Result<PagedAttentionConfig, EngineError> {
    let (block_size, memory, cache) = paged_parts(spec);
    let mut builder =
        PagedAttentionMetaBuilder::default().with_gpu_memory(memory).with_paged_cache_type(cache);
    if let Some(block_size) = block_size {
        builder = builder.with_block_size(block_size);
    }
    builder.build().map_err(|error| EngineError::Config(format!("paged attention: {error:#}")))
}

/// What a [`LoadSpec`] loads.
#[derive(Debug, Clone)]
pub(crate) enum Target {
    /// A chat model, whatever its format.
    Chat(ModelSource),
    /// An embedding model.
    Embedding { id: String },
}

/// Everything the loader needs, parsed and validated, with no mistral.rs builder in it yet.
#[derive(Debug, Clone)]
pub(crate) struct LoadSpec {
    pub(crate) target: Target,
    pub(crate) options: Options,
}

impl LoadSpec {
    /// The load of a chat client.
    ///
    /// # Errors
    /// [`EngineError::Config`] for anything [`EngineConfig::validate`] or the option parsers
    /// reject.
    pub(crate) fn chat(config: &EngineConfig) -> Result<Self, EngineError> {
        config.validate()?;
        Ok(Self {
            target: Target::Chat(config.model.clone()),
            options: Options::from_runtime(&config.runtime)?,
        })
    }

    /// The load of an embedder.
    ///
    /// # Errors
    /// [`EngineError::Config`] for anything [`EmbedderConfig::validate`] or the option parsers
    /// reject.
    pub(crate) fn embedding(config: &EmbedderConfig) -> Result<Self, EngineError> {
        config.validate()?;
        Ok(Self {
            target: Target::Embedding { id: config.id.clone() },
            options: Options::from_runtime(&config.runtime)?,
        })
    }

    /// The model id or directory being loaded, for messages.
    pub(crate) fn model_id(&self) -> &str {
        match &self.target {
            Target::Chat(source) => source.id(),
            Target::Embedding { id } => id,
        }
    }

    /// Run the load: select the builder for the source, apply the options, build.
    ///
    /// This blocks the thread for as long as mistral.rs reads, quantizes and uploads the weights
    /// (and downloads them first, when they are not local), so callers run it on a blocking
    /// thread. The error is mistral.rs' own chain, rendered.
    pub(crate) async fn build(&self) -> Result<Model, String> {
        let options = &self.options;
        let built = match &self.target {
            Target::Chat(ModelSource::Auto { id }) => {
                apply_chat!(ModelBuilder::new(id), options).build().await
            },
            Target::Chat(ModelSource::Text { id }) => {
                apply_chat!(TextModelBuilder::new(id), options).build().await
            },
            Target::Chat(ModelSource::Vision { id }) => {
                apply_chat!(MultimodalModelBuilder::new(id), options).build().await
            },
            Target::Chat(ModelSource::Gguf { id, files: names, tokenizer_from, mmproj_files }) => {
                let mut builder = GgufModelBuilder::new(id, files(names));
                if let Some(tokenizer) = set(tokenizer_from.as_deref()) {
                    builder = builder.with_tok_model_id(tokenizer);
                }
                let projectors = files(mmproj_files);
                if !projectors.is_empty() {
                    builder = builder.with_mmproj_files(projectors);
                }
                apply_chat!(builder, options).build().await
            },
            Target::Chat(ModelSource::Uqff { id, files: names, vision }) => {
                if *vision {
                    let builder = UqffMultimodalModelBuilder::new(id, names.clone()).into_inner();
                    apply_chat!(builder, options).build().await
                } else {
                    let builder = UqffTextModelBuilder::new(id, names.clone()).into_inner();
                    apply_chat!(builder, options).build().await
                }
            },
            Target::Embedding { id } => {
                apply_common!(EmbeddingModelBuilder::new(id), options).build().await
            },
        };
        built.map_err(|error| format!("{error:#}"))
    }
}

#[cfg(test)]
mod tests {
    use mistralrs::IsqType;

    use super::*;

    fn runtime(edit: impl FnOnce(&mut RuntimeOptions)) -> RuntimeOptions {
        let mut runtime = RuntimeOptions::default();
        edit(&mut runtime);
        runtime
    }

    fn options(runtime: &RuntimeOptions) -> Options {
        Options::from_runtime(runtime).expect("valid options")
    }

    #[test]
    fn the_default_leaves_every_choice_to_mistralrs() {
        let options = options(&RuntimeOptions::default());
        assert_eq!(options.isq, None);
        assert_eq!(options.dtype, ModelDType::Auto);
        assert!(!options.force_cpu && !options.logging);
        assert!(options.paged.is_none());
        assert_eq!(options.prefix_cache, PrefixCache::Upstream);
        assert!(options.chat_template.is_none() && options.tokenizer_json.is_none());
        assert!(options.hf_revision.is_none() && options.token_source.is_none());
    }

    #[test]
    fn isq_takes_a_bit_width_or_an_exact_type() {
        assert_eq!(parse_isq("4").unwrap(), IsqSetting::Auto(IsqBits::Four));
        assert_eq!(parse_isq(" 8 ").unwrap(), IsqSetting::Auto(IsqBits::Eight));
        assert_eq!(parse_isq("Q4K").unwrap(), IsqSetting::Specific(IsqType::Q4K));
        assert_eq!(parse_isq("q8_0").unwrap(), IsqSetting::Specific(IsqType::Q8_0));
        assert_eq!(parse_isq("hqq4").unwrap(), IsqSetting::Specific(IsqType::HQQ4));
        let error = parse_isq("q9z").unwrap_err().to_string();
        assert!(error.contains("`isq`") && error.contains("q9z"), "{error}");
    }

    #[test]
    fn dtype_is_parsed_case_insensitively_and_unknown_ones_are_refused() {
        assert_eq!(parse_dtype("BF16").unwrap(), ModelDType::BF16);
        assert_eq!(parse_dtype(" f32").unwrap(), ModelDType::F32);
        assert_eq!(parse_dtype("auto").unwrap(), ModelDType::Auto);
        assert!(parse_dtype("fp4").unwrap_err().to_string().contains("`dtype`"));
    }

    #[test]
    fn token_sources_follow_mistralrs_syntax_and_never_leak_in_messages() {
        let spelled =
            |spec: &str| parse_token_source(spec).map(|Redacted(source)| source.to_string());
        assert_eq!(spelled("cache").unwrap(), "cache");
        assert_eq!(spelled("none").unwrap(), "none");
        assert_eq!(spelled("env:MY_TOKEN").unwrap(), "env:MY_TOKEN");
        assert_eq!(spelled("path:/run/secrets/hf").unwrap(), "path:/run/secrets/hf");

        let error = spelled("bogus:hunter2").unwrap_err().to_string();
        assert!(error.contains("hf_token_source") && !error.contains("hunter2"), "{error}");

        let literal = options(&runtime(|r| r.hf_token_source = Some("literal:hunter2".into())));
        assert!(!format!("{literal:?}").contains("hunter2"), "Debug must redact the token");
        assert_eq!(spelled("literal:hunter2").unwrap(), "literal:hunter2");
    }

    #[test]
    fn paged_attention_maps_onto_the_three_builder_inputs() {
        let spec = PagedAttentionSpec {
            block_size: Some(16),
            memory: PagedMemory::Megabytes(2048),
            cache: PagedCache::F8e4m3,
        };
        let (block, memory, cache) = paged_parts(&spec);
        assert_eq!(block, Some(16));
        assert!(matches!(memory, MemoryGpuConfig::MbAmount(2048)), "{memory:?}");
        assert_eq!(cache, PagedCacheType::F8E4M3);

        let (block, memory, cache) = paged_parts(&PagedAttentionSpec::default());
        assert_eq!(block, None);
        assert!(matches!(memory, MemoryGpuConfig::ContextSize(4096)), "{memory:?}");
        assert_eq!(cache, PagedCacheType::Auto);

        let utilization = PagedAttentionSpec {
            memory: PagedMemory::Utilization(0.5),
            ..PagedAttentionSpec::default()
        };
        assert!(matches!(paged_parts(&utilization).1, MemoryGpuConfig::Utilization(f) if f == 0.5));
        assert!(paged_config(&spec).is_ok());
    }

    #[test]
    fn the_prefix_cache_distinguishes_unset_off_and_a_size() {
        let cache = |seqs| options(&runtime(|r| r.prefix_cache_seqs = seqs)).prefix_cache;
        assert_eq!(cache(None), PrefixCache::Upstream);
        assert_eq!(cache(Some(0)), PrefixCache::Off);
        assert_eq!(cache(Some(32)), PrefixCache::Seqs(32));
    }

    #[test]
    fn plain_runtime_fields_pass_through_and_blank_strings_count_as_unset() {
        let parsed = options(&runtime(|r| {
            r.isq = Some("4".into());
            r.dtype = Some("bf16".into());
            r.force_cpu = true;
            r.max_num_seqs = Some(8);
            r.max_model_len = Some(8192);
            r.chat_template = Some("{{ messages }}".into());
            r.tokenizer_json = Some("/models/tokenizer.json".into());
            r.hf_revision = Some(" main ".into());
            r.hf_cache_dir = Some(PathBuf::from("/cache/hf"));
            r.logging = true;
        }));
        assert_eq!(parsed.isq, Some(IsqSetting::Auto(IsqBits::Four)));
        assert_eq!(parsed.dtype, ModelDType::BF16);
        assert!(parsed.force_cpu && parsed.logging);
        assert_eq!((parsed.max_num_seqs, parsed.max_model_len), (Some(8), Some(8192)));
        assert_eq!(parsed.chat_template.as_deref(), Some("{{ messages }}"));
        assert_eq!(parsed.tokenizer_json.as_deref(), Some("/models/tokenizer.json"));
        assert_eq!(parsed.hf_revision.as_deref(), Some("main"));
        assert_eq!(parsed.hf_cache_dir, Some(PathBuf::from("/cache/hf")));

        let blank = options(&runtime(|r| {
            r.chat_template = Some("  ".into());
            r.tokenizer_json = Some(String::new());
            r.hf_revision = Some("\n".into());
            r.hf_token_source = Some(" ".into());
        }));
        assert!(blank.chat_template.is_none() && blank.tokenizer_json.is_none());
        assert!(blank.hf_revision.is_none() && blank.token_source.is_none());
    }

    #[test]
    fn a_bad_option_is_a_configuration_error_naming_the_field() {
        for (edit, field) in [
            (runtime(|r| r.isq = Some("q9z".into())), "isq"),
            (runtime(|r| r.hf_token_source = Some("nope".into())), "hf_token_source"),
        ] {
            let error = Options::from_runtime(&edit).unwrap_err();
            assert!(matches!(error, EngineError::Config(_)), "{error}");
            assert!(error.to_string().contains(field), "{error}");
        }
    }

    #[test]
    fn file_lists_drop_blank_names() {
        assert_eq!(files(&["a.gguf".into(), " ".into(), " b.gguf ".into()]), ["a.gguf", "b.gguf"]);
        assert!(files(&[]).is_empty());
    }

    #[test]
    fn chat_specs_validate_and_keep_the_source() {
        let config = EngineConfig::new(ModelSource::auto("Qwen/Qwen3-4B"));
        let spec = LoadSpec::chat(&config).unwrap();
        assert_eq!(spec.model_id(), "Qwen/Qwen3-4B");
        assert!(matches!(spec.target, Target::Chat(ModelSource::Auto { .. })));

        let blank = LoadSpec::chat(&EngineConfig::new(ModelSource::auto(" "))).unwrap_err();
        assert!(blank.to_string().contains("model id"), "{blank}");
        let no_files = LoadSpec::chat(&EngineConfig::new(ModelSource::gguf("r", vec![])));
        assert!(no_files.unwrap_err().to_string().contains("GGUF"));
    }

    #[test]
    fn embedding_specs_refuse_options_the_embedding_builder_lacks() {
        let spec = LoadSpec::embedding(&EmbedderConfig::new("google/embeddinggemma-300m")).unwrap();
        assert_eq!(spec.model_id(), "google/embeddinggemma-300m");
        assert!(matches!(spec.target, Target::Embedding { .. }));

        let mut config = EmbedderConfig::new("e/m");
        config.runtime.prefix_cache_seqs = Some(4);
        let error = LoadSpec::embedding(&config).unwrap_err().to_string();
        assert!(error.contains("prefix_cache_seqs"), "{error}");
    }
}
