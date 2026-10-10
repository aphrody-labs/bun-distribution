// SPDX-License-Identifier: Apache-2.0
//! In-process llama.cpp engine over `aphrody-llama`.
//!
//! [`InProcessLlama`] is a [`ModelClient`] over one GGUF file: the model stays loaded in this
//! process, every turn gets its own context, decoding runs on a blocking thread and the decoded
//! pieces go through the [`router`] (reasoning split, stop strings, textual tool calls).
//! [`InProcessServer`] puts a loopback OpenAI-compatible endpoint on top of it, so the
//! HTTP-shaped entry points keep working without any child process.
//!
//! `libllama` itself is installed and loaded at run time by `aphrody-ml-runtime`; nothing is linked.

pub mod router;
pub mod server;

use std::{
    num::NonZeroU32,
    path::{Path, PathBuf},
    sync::Arc,
};

use aphrody_llama::{
    context::params::{LlamaAttentionType, LlamaContextParams},
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{AddBos, LlamaChatMessage, LlamaLoraAdapter, LlamaModel, params::LlamaModelParams},
    mtmd::{
        MtmdBitmap, MtmdContext, MtmdContextParams, MtmdInputChunks, MtmdInputText,
        mtmd_default_marker,
    },
    sampling::LlamaSampler,
};
use aphrody_model_client::{
    ChatMessage, ChatTurn, ImageSource, ModelCapabilities, ModelClient, ModelError, ModelStream,
    ModelStreamEvent, Part, Role, ToolDecl,
};
use async_trait::async_trait;
use base64::Engine as _;
use router::{Finish, Router, RouterConfig};
use serde_json::json;
use tokio::sync::{OnceCell, Semaphore, mpsc};

pub use server::InProcessServer;

/// Upper bound of the default context: the trained context of a modern model can be 128k tokens,
/// whose KV cache would not fit next to the weights.
const DEFAULT_MAX_CTX: u32 = 8192;

/// Why a model could not be brought up in this process.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LlamaLoadError {
    /// The llama.cpp runtime could not be installed or loaded.
    #[error("llama.cpp runtime: {0}")]
    Runtime(String),
    /// The llama.cpp backend failed to initialise.
    #[error("llama.cpp backend: {0}")]
    Backend(String),
    /// The GGUF file could not be loaded.
    #[error("cannot load {path}: {message}")]
    Model {
        /// The file.
        path: String,
        /// The loader's message.
        message: String,
    },
    /// The multimodal projector (`mmproj`) could not be loaded.
    #[error("cannot load projector {path}: {message}")]
    Projector {
        /// The file.
        path: String,
        /// The loader's message.
        message: String,
    },
    /// The LoRA adapter could not be loaded.
    #[error("cannot load LoRA adapter {path}: {message}")]
    Lora {
        /// The file.
        path: String,
        /// The loader's message.
        message: String,
    },
}

/// A LoRA adapter to apply to every turn.
#[derive(Debug, Clone, PartialEq)]
pub struct LoraSpec {
    /// The GGUF adapter file.
    pub path: PathBuf,
    /// Scale (`0.0` = loaded but inactive).
    pub scale: f32,
}

/// What to load and how.
#[derive(Debug, Clone)]
pub struct LoadOptions {
    /// Context size in tokens; `None` = `min(trained context, 8192)`.
    pub ctx: Option<u32>,
    /// Layers offloaded to the GPU (`u32::MAX` = all the runtime supports).
    pub gpu_layers: u32,
    /// Multimodal projector GGUF; enables `Part::Image` and `capabilities().images`.
    pub mmproj: Option<PathBuf>,
    /// LoRA adapters. The llama.cpp wrapper applies one adapter per context, so at most one is
    /// accepted for now (more is a [`LlamaLoadError::Lora`]).
    pub lora: Vec<LoraSpec>,
}

impl Default for LoadOptions {
    fn default() -> Self {
        Self { ctx: None, gpu_layers: u32::MAX, mmproj: None, lora: Vec::new() }
    }
}

/// The process-wide backend. Never dropped: `llama_backend_free` must not run while another
/// owner of the same process may still use the library.
static BACKEND: OnceCell<&'static LlamaBackend> = OnceCell::const_new();

async fn backend() -> Result<&'static LlamaBackend, LlamaLoadError> {
    BACKEND
        .get_or_try_init(|| async {
            aphrody_ml_runtime::Runtime::discover([aphrody_ml_runtime::Feature::Llama])
                .map_err(|error| LlamaLoadError::Runtime(format!("{error:#}")))?
                .initialize()
                .await
                .map_err(|error| LlamaLoadError::Runtime(format!("{error:#}")))?;
            let backend = match LlamaBackend::init() {
                Ok(backend) => backend,
                // Initialised elsewhere in the process (the empty handle only proves it).
                Err(aphrody_llama::LlamaCppError::BackendAlreadyInitialized) => LlamaBackend {},
                Err(error) => return Err(LlamaLoadError::Backend(error.to_string())),
            };
            Ok::<_, LlamaLoadError>(&*Box::leak(Box::new(backend)))
        })
        .await
        .copied()
}

/// A loaded adapter plus its scale. The adapter is owned by the model (freed with it) and only
/// read once initialised; the mutex serialises the `&mut` the wrapper wants.
struct LoraHandle {
    adapter: std::sync::Mutex<SendAdapter>,
    scale: f32,
}

struct SendAdapter(LlamaLoraAdapter);
// SAFETY: a `llama_adapter_lora` is immutable after init and tied to the (Send + Sync) model.
unsafe impl Send for SendAdapter {}

struct Inner {
    /// Declared before `model`: dropped first.
    mtmd: Option<MtmdContext>,
    lora: Option<LoraHandle>,
    model: LlamaModel,
    backend: &'static LlamaBackend,
    path: PathBuf,
    n_ctx: u32,
    /// One generation at a time: a context per turn is expensive on a GPU.
    gate: Arc<Semaphore>,
    /// Host resource ownership follows every decoder clone and drops after native weights.
    _residency_guard: Option<Arc<dyn Send + Sync>>,
}

/// An in-process `ModelClient` over a GGUF model via `aphrody-llama`.
#[derive(Clone)]
pub struct InProcessLlama {
    inner: Arc<Inner>,
    model_name: String,
}

impl std::fmt::Debug for InProcessLlama {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("InProcessLlama")
            .field("model", &self.model_name)
            .field("path", &self.inner.path)
            .field("n_ctx", &self.inner.n_ctx)
            .finish_non_exhaustive()
    }
}

impl InProcessLlama {
    /// Load `path` into this process.
    ///
    /// # Errors
    ///
    /// See [`LlamaLoadError`].
    pub async fn load(
        path: impl AsRef<Path>,
        model_name: impl Into<String>,
        options: LoadOptions,
    ) -> Result<Self, LlamaLoadError> {
        Self::load_inner(path.as_ref().to_path_buf(), model_name.into(), options, None).await
    }

    /// Load a model while retaining a host resource through loading and every decoder.
    /// The guard remains owned by native work even if the caller cancels this future.
    ///
    /// # Errors
    /// See [`LlamaLoadError`].
    pub async fn load_with_residency_guard(
        path: impl AsRef<Path>,
        model_name: impl Into<String>,
        options: LoadOptions,
        guard: Arc<dyn Send + Sync>,
    ) -> Result<Self, LlamaLoadError> {
        Self::load_inner(path.as_ref().to_path_buf(), model_name.into(), options, Some(guard)).await
    }

    async fn load_inner(
        path: PathBuf,
        model_name: String,
        options: LoadOptions,
        residency_guard: Option<Arc<dyn Send + Sync>>,
    ) -> Result<Self, LlamaLoadError> {
        let backend = backend().await?;
        let load_path = path.clone();
        let model = tokio::task::spawn_blocking(move || {
            let params = LlamaModelParams::default().with_n_gpu_layers(options.gpu_layers);
            LlamaModel::load_from_file(backend, &load_path, &params)
                .map(|model| (model, options.ctx, residency_guard))
                .map_err(|error| LlamaLoadError::Model {
                    path: load_path.display().to_string(),
                    message: error.to_string(),
                })
        })
        .await
        .map_err(|error| LlamaLoadError::Model {
            path: path.display().to_string(),
            message: error.to_string(),
        })??;
        // Bind the guard first so every early-error path drops native weights before it.
        let residency_guard = model.2;
        let (model, ctx, _) = model;
        if options.lora.len() > 1 {
            return Err(LlamaLoadError::Lora {
                path: options.lora[1].path.display().to_string(),
                message: "only one LoRA adapter can be applied in-process".to_owned(),
            });
        }
        let lora = match options.lora.first() {
            Some(spec) => {
                let adapter =
                    model.lora_adapter_init(&spec.path).map_err(|error| LlamaLoadError::Lora {
                        path: spec.path.display().to_string(),
                        message: error.to_string(),
                    })?;
                Some(LoraHandle {
                    adapter: std::sync::Mutex::new(SendAdapter(adapter)),
                    scale: spec.scale,
                })
            },
            None => None,
        };
        let mtmd = match &options.mmproj {
            Some(path) => {
                let text = path.to_str().ok_or_else(|| LlamaLoadError::Projector {
                    path: path.display().to_string(),
                    message: "path is not valid UTF-8".to_owned(),
                })?;
                let context =
                    MtmdContext::init_from_file(text, &model, &MtmdContextParams::default())
                        .map_err(|error| LlamaLoadError::Projector {
                            path: path.display().to_string(),
                            message: error.to_string(),
                        })?;
                Some(context)
            },
            None => None,
        };
        let n_ctx = ctx.unwrap_or_else(|| model.n_ctx_train().min(DEFAULT_MAX_CTX)).max(512);
        Ok(Self {
            inner: Arc::new(Inner {
                mtmd,
                lora,
                model,
                backend,
                path,
                n_ctx,
                gate: Arc::new(Semaphore::new(1)),
                _residency_guard: residency_guard,
            }),
            model_name,
        })
    }

    /// The GGUF file.
    #[must_use]
    pub fn model_path(&self) -> &Path {
        &self.inner.path
    }

    /// Whether a projector with vision support is loaded.
    #[must_use]
    pub fn supports_images(&self) -> bool {
        self.inner.mtmd.as_ref().is_some_and(MtmdContext::support_vision)
    }

    /// The context size every turn runs with.
    #[must_use]
    pub fn context_window(&self) -> u32 {
        self.inner.n_ctx
    }
}

#[async_trait]
impl ModelClient for InProcessLlama {
    fn model_id(&self) -> &str {
        &self.model_name
    }

    fn capabilities(&self) -> ModelCapabilities {
        ModelCapabilities {
            tools: true,
            parallel_tool_calls: true,
            images: self.supports_images(),
            reasoning: true,
            json_schema: false,
            context_window: Some(u64::from(self.inner.n_ctx)),
        }
    }

    async fn stream(&self, turn: ChatTurn) -> Result<ModelStream, ModelError> {
        let permit = Arc::clone(&self.inner.gate)
            .acquire_owned()
            .await
            .map_err(|error| ModelError::Stream(error.to_string()))?;
        let inner = Arc::clone(&self.inner);
        let (tx, rx) = mpsc::unbounded_channel();
        tokio::task::spawn_blocking(move || {
            let _permit = permit;
            let _ = tx.send(Ok(ModelStreamEvent::Created));
            if let Err(message) = generate(&inner, &turn, &tx) {
                let _ = tx.send(Err(ModelError::Stream(message)));
            }
        });
        Ok(Box::pin(futures::stream::unfold(rx, |mut rx| async move {
            rx.recv().await.map(|item| (item, rx))
        })))
    }
}

/// Tool declarations as the system prompt text most chat models were trained on (Hermes style),
/// which [`router`] reads back as `<tool_call>` blocks.
fn tools_prompt(tools: &[ToolDecl]) -> String {
    let mut text = String::from(
        "# Tools\n\nYou may call one or more functions to assist with the user query.\n\n\
         You are provided with function signatures within <tools></tools> XML tags:\n<tools>\n",
    );
    for tool in tools {
        let line = json!({
            "type": "function",
            "function": {
                "name": tool.name,
                "description": tool.description,
                "parameters": tool.parameters,
            },
        });
        text.push_str(&line.to_string());
        text.push('\n');
    }
    text.push_str(
        "</tools>\n\nFor each function call, return a json object with the function name and \
         arguments within <tool_call></tool_call> XML tags:\n<tool_call>\n\
         {\"name\": <function-name>, \"arguments\": <args-json-object>}\n</tool_call>",
    );
    text
}

/// The `(role, content)` pairs handed to the model's chat template.
///
/// Tool results travel as `user` messages wrapped in `<tool_response>`: that is the one shape
/// every template accepts.
fn render_messages(turn: &ChatTurn, marker: Option<&str>) -> Vec<(&'static str, String)> {
    let mut out = Vec::new();
    let mut system = turn.system.clone().unwrap_or_default();
    if !turn.tools.is_empty() {
        if !system.is_empty() {
            system.push_str("\n\n");
        }
        system.push_str(&tools_prompt(&turn.tools));
    }
    if !system.is_empty() {
        out.push(("system", system));
    }
    for ChatMessage { role, parts } in &turn.messages {
        let mut text = String::new();
        let mut push = |piece: &str| {
            if !text.is_empty() {
                text.push('\n');
            }
            text.push_str(piece);
        };
        for part in parts {
            match part {
                Part::Text(value) => push(value),
                Part::Image(_) => {
                    push(marker.unwrap_or("[image omitted: no multimodal projector is loaded]"))
                },
                Part::Reasoning { .. } => {},
                Part::FunctionCall { name, args, .. } => push(&format!(
                    "<tool_call>\n{}\n</tool_call>",
                    json!({ "name": name, "arguments": args })
                )),
                Part::FunctionResponse { response, .. } => {
                    push(&format!("<tool_response>\n{response}\n</tool_response>"));
                },
            }
        }
        let role = match role {
            Role::User | Role::Tool => "user",
            Role::Model => "assistant",
        };
        if !text.is_empty() {
            out.push((role, text));
        }
    }
    out
}

/// The bytes behind an image: inline base64, a `file://` URL or a plain path. Remote `http(s)`
/// URLs are not fetched (the engine does no network I/O).
fn image_bytes(source: &ImageSource) -> Result<Vec<u8>, String> {
    match source {
        ImageSource::Base64 { data, .. } => base64::engine::general_purpose::STANDARD
            .decode(data.trim())
            .map_err(|error| format!("invalid base64 image: {error}")),
        ImageSource::Url(url) => {
            if url.starts_with("http://") || url.starts_with("https://") {
                return Err(format!("remote image URLs are not fetched in-process: {url}"));
            }
            let path = url.strip_prefix("file://").unwrap_or(url);
            std::fs::read(path).map_err(|error| format!("cannot read image {path}: {error}"))
        },
    }
}

/// Every image of the turn, in prompt order.
fn turn_images(turn: &ChatTurn) -> Vec<&ImageSource> {
    turn.messages
        .iter()
        .flat_map(|message| message.parts.iter())
        .filter_map(|part| if let Part::Image(image) = part { Some(image) } else { None })
        .collect()
}

fn seed() -> u32 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(1, |elapsed| elapsed.subsec_nanos().max(1))
}

/// Render the model's embedded Jinja template rather than the C API's template recogniser.
/// Modern model templates require Python-compatible methods and preserve their own role rules.
fn render_jinja_prompt(
    template: &str,
    messages: &[(&str, String)],
    bos: &str,
    eos: &str,
) -> Result<String, String> {
    let mut environment = minijinja::Environment::new();
    environment.set_unknown_method_callback(minijinja_contrib::pycompat::unknown_method_callback);
    environment.add_function(
        "raise_exception",
        |message: String| -> Result<String, minijinja::Error> {
            Err(minijinja::Error::new(minijinja::ErrorKind::InvalidOperation, message))
        },
    );
    environment.add_function("strftime_now", |format: String| {
        chrono::Utc::now().format(&format).to_string()
    });
    environment
        .add_template("chat", template)
        .map_err(|error| format!("chat template: {error}"))?;
    let messages: Vec<_> =
        messages.iter().map(|(role, content)| json!({"role":role,"content":content})).collect();
    environment.get_template("chat").map_err(|error| format!("chat template: {error}"))?
        .render(minijinja::context! { messages, bos_token => bos, eos_token => eos,
            add_generation_prompt => true, enable_thinking => false, tools => Vec::<serde_json::Value>::new() })
        .map_err(|error| format!("chat template: {error}"))
}

/// Decode one turn, sending events as they become final. `Err` = a failure to report.
fn generate(
    inner: &Inner,
    turn: &ChatTurn,
    tx: &mpsc::UnboundedSender<Result<ModelStreamEvent, ModelError>>,
) -> Result<(), String> {
    let model = &inner.model;
    let mtmd = inner.mtmd.as_ref().filter(|context| context.support_vision());
    let images = turn_images(turn);
    let marker = mtmd.map(|_| mtmd_default_marker());
    let messages = render_messages(turn, marker)
        .into_iter()
        .map(|(role, content)| LlamaChatMessage::new(role.to_owned(), content))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    // Base and instruction-less models ship no template; fall back to ChatML, as llama.cpp does.
    let template = match model.chat_template(None) {
        Ok(template) => template,
        Err(_) => aphrody_llama::model::LlamaChatTemplate::new("chatml")
            .map_err(|error| error.to_string())?,
    };
    let raw_template = template.to_str().map_err(|error| error.to_string())?;
    let prompt = if raw_template.contains("{{") || raw_template.contains("{%") {
        let mut decoder = encoding_rs::UTF_8.new_decoder();
        let bos = model
            .token_to_piece(model.token_bos(), &mut decoder, true, None)
            .map_err(|error| error.to_string())?;
        let eos = model
            .token_to_piece(model.token_eos(), &mut decoder, true, None)
            .map_err(|error| error.to_string())?;
        render_jinja_prompt(raw_template, &render_messages(turn, marker), &bos, &eos)?
    } else {
        model
            .apply_chat_template(&template, &messages, true)
            .map_err(|error| format!("named chat template: {error}"))?
    };

    // Most templates write the BOS token themselves; add it only when they did not.
    let mut decoder = encoding_rs::UTF_8.new_decoder();
    let bos = model.token_to_piece(model.token_bos(), &mut decoder, true, None).unwrap_or_default();
    let templated_bos = !bos.is_empty() && prompt.starts_with(&bos);
    let add_bos = if templated_bos { AddBos::Never } else { AddBos::Always };

    // Text: one token list. Images: projector chunks (text + encoded image embeddings).
    let mut tokens = Vec::new();
    let mut chunks: Option<(MtmdInputChunks, Vec<MtmdBitmap>)> = None;
    let (prompt_len, positions, max_chunk, non_causal) =
        if let (Some(context), false) = (mtmd, images.is_empty()) {
            let mut bitmaps = Vec::with_capacity(images.len());
            for image in &images {
                let bytes = image_bytes(image)?;
                bitmaps.push(
                    MtmdBitmap::from_buffer(context, &bytes, false)
                        .map_err(|error| format!("cannot decode image: {error}"))?,
                );
            }
            let refs = bitmaps.iter().collect::<Vec<_>>();
            let parsed = context
                .tokenize(
                    MtmdInputText {
                        text: prompt.clone(),
                        add_special: !templated_bos,
                        parse_special: true,
                    },
                    &refs,
                )
                .map_err(|error| format!("cannot tokenize the multimodal prompt: {error}"))?;
            let positions = usize::try_from(parsed.total_positions()).unwrap_or(usize::MAX);
            let max_chunk = (0..parsed.len())
                .filter_map(|index| parsed.get(index))
                .map(|chunk| chunk.n_tokens())
                .max();
            let result = (
                parsed.total_tokens(),
                positions,
                max_chunk.unwrap_or(1),
                context.decode_use_non_causal(),
            );
            chunks = Some((parsed, bitmaps));
            result
        } else {
            tokens = model.str_to_token(&prompt, add_bos).map_err(|error| error.to_string())?;
            (tokens.len(), tokens.len(), 1, false)
        };

    let n_ctx = inner.n_ctx;
    if positions + 1 >= n_ctx as usize {
        return Err(format!(
            "the prompt ({positions} positions) does not fit the {n_ctx}-token context"
        ));
    }
    let room = n_ctx as usize - positions - 1;
    let budget = turn.options.max_output_tokens.map_or(room, |max| (max as usize).min(room));

    let mut params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(n_ctx));
    if chunks.is_some() {
        // A whole image must fit one batch (and, non-causal, one micro-batch).
        let n_batch = 2048_u32.max(u32::try_from(max_chunk).unwrap_or(u32::MAX));
        params = params.with_n_batch(n_batch);
        if non_causal {
            params =
                params.with_n_ubatch(n_batch).with_attention_type(LlamaAttentionType::NonCausal);
        }
    }
    let mut ctx = model.new_context(inner.backend, params).map_err(|error| error.to_string())?;
    if let Some(lora) = &inner.lora
        && lora.scale != 0.0
    {
        let mut adapter = lora.adapter.lock().map_err(|error| error.to_string())?;
        ctx.lora_adapter_set(&mut adapter.0, lora.scale).map_err(|error| error.to_string())?;
    }
    let n_batch = (ctx.n_batch() as usize).max(1);
    let mut batch = LlamaBatch::new(n_batch, 1);

    let mut position = 0_i32;
    // Index of the logits row to sample from after the prompt.
    let mut logits_row;
    if let (Some((parsed, _bitmaps)), Some(context)) = (&chunks, mtmd) {
        position = parsed
            .eval_chunks(context, &ctx, 0, 0, i32::try_from(n_batch).unwrap_or(i32::MAX), true)
            .map_err(|error| format!("cannot evaluate the multimodal prompt: {error}"))?;
        logits_row = -1;
    } else {
        let chunk_count = tokens.len().div_ceil(n_batch);
        for (chunk_index, chunk) in tokens.chunks(n_batch).enumerate() {
            batch.clear();
            let last_chunk = chunk_index + 1 == chunk_count;
            for (index, token) in chunk.iter().enumerate() {
                let wants_logits = last_chunk && index + 1 == chunk.len();
                batch
                    .add(*token, position, &[0], wants_logits)
                    .map_err(|error| error.to_string())?;
                position += 1;
            }
            ctx.decode(&mut batch).map_err(|error| error.to_string())?;
        }
        logits_row = batch.n_tokens() - 1;
    }

    let temperature = turn.options.temperature.unwrap_or(0.7);
    let mut sampler = if temperature <= 0.0 {
        LlamaSampler::greedy()
    } else {
        LlamaSampler::chain_simple([
            LlamaSampler::top_k(40),
            LlamaSampler::top_p(0.95, 1),
            LlamaSampler::temp(temperature),
            LlamaSampler::dist(seed()),
        ])
    };

    let mut router = Router::new(RouterConfig {
        tools: turn.tools.iter().map(|tool| tool.name.clone()).collect(),
        stops: turn.options.stop.clone(),
        think_open: prompt.trim_end().ends_with("<think>"),
    });
    let mut decoder = encoding_rs::UTF_8.new_decoder();
    let mut produced = 0_usize;
    let mut finish = Finish::Length;
    let mut listener_gone = false;

    while produced < budget {
        let token = sampler.sample(&ctx, logits_row);
        if model.is_eog_token(token) {
            finish = Finish::Stop;
            break;
        }
        produced += 1;
        let piece = model
            .token_to_piece(token, &mut decoder, false, None)
            .map_err(|error| error.to_string())?;
        for event in router.push(&piece) {
            if tx.send(Ok(event)).is_err() {
                listener_gone = true;
            }
        }
        if listener_gone {
            return Ok(());
        }
        if router.stopped() {
            finish = Finish::Stop;
            break;
        }
        batch.clear();
        batch.add(token, position, &[0], true).map_err(|error| error.to_string())?;
        position += 1;
        ctx.decode(&mut batch).map_err(|error| error.to_string())?;
        logits_row = batch.n_tokens() - 1;
    }

    for event in router.finish(finish, prompt_len, produced) {
        if tx.send(Ok(event)).is_err() {
            break;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[tokio::test(flavor = "multi_thread")]
    #[ignore = "needs APHRODY_LLAMA_TEST_MODEL and the host libllama runtime"]
    async fn cancelled_decoder_keeps_the_model_resource_until_native_work_stops() {
        let path = std::env::var("APHRODY_LLAMA_TEST_MODEL").expect("protected model path");
        let resource = Arc::new(std::sync::atomic::AtomicBool::new(false));
        struct Resident(Arc<std::sync::atomic::AtomicBool>);
        impl Drop for Resident {
            fn drop(&mut self) {
                self.0.store(true, std::sync::atomic::Ordering::SeqCst);
            }
        }
        let engine = InProcessLlama::load_with_residency_guard(
            &path,
            "resident-test",
            LoadOptions { ctx: Some(1024), gpu_layers: 0, ..LoadOptions::default() },
            Arc::new(Resident(Arc::clone(&resource))),
        )
        .await
        .expect("host model");
        let observer = Arc::downgrade(&engine.inner);
        let mut stream = engine
            .stream(ChatTurn {
                system: Some("Answer briefly and preserve these system instructions.".into()),
                messages: vec![ChatMessage {
                    role: Role::User,
                    parts: vec![Part::Text("Count from one to ten.".into())],
                }],
                options: aphrody_model_client::TurnOptions {
                    max_output_tokens: Some(16),
                    ..Default::default()
                },
                ..Default::default()
            })
            .await
            .expect("decoder");
        let decoded = tokio::time::timeout(std::time::Duration::from_secs(90), async {
            while let Some(event) = futures::StreamExt::next(&mut stream).await {
                match event.expect("native decoder with system instructions") {
                    ModelStreamEvent::TextDelta(text) if !text.is_empty() => return true,
                    _ => {},
                }
            }
            false
        })
        .await
        .expect("native first token deadline");
        assert!(decoded, "native decoder produced text");
        assert!(!resource.load(std::sync::atomic::Ordering::SeqCst));
        drop(engine);
        drop(stream);
        tokio::time::timeout(std::time::Duration::from_secs(60), async {
            while !resource.load(std::sync::atomic::Ordering::SeqCst) {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("cancelled producer eventually releases resource");
        assert!(observer.upgrade().is_none());
    }

    #[test]
    fn embedded_jinja_preserves_system_and_python_methods() {
        let template = "{{ bos_token }}{% for m in messages %}<{{ m.role }}>{{ m.content.strip() }}{% endfor %}{% if add_generation_prompt %}<assistant>{% endif %}";
        let rendered = render_jinja_prompt(
            template,
            &[("system", " actual soul ".into()), ("user", " hello ".into())],
            "<bos>",
            "<eos>",
        )
        .unwrap();
        assert_eq!(rendered, "<bos><system>actual soul<user>hello<assistant>");
        assert!(
            render_jinja_prompt("{{ raise_exception('unsupported role') }}", &[], "", "")
                .unwrap_err()
                .contains("unsupported role")
        );
    }

    fn tool() -> ToolDecl {
        ToolDecl {
            name: "get_weather".into(),
            description: "Weather".into(),
            parameters: json!({"type": "object"}),
        }
    }

    #[test]
    fn tools_are_declared_in_the_system_message() {
        let turn = ChatTurn {
            system: Some("Be brief.".into()),
            messages: vec![ChatMessage { role: Role::User, parts: vec![Part::Text("hi".into())] }],
            tools: vec![tool()],
            ..ChatTurn::default()
        };
        let rendered = render_messages(&turn, None);
        assert_eq!(rendered[0].0, "system");
        assert!(rendered[0].1.starts_with("Be brief."));
        assert!(rendered[0].1.contains("<tools>"));
        assert!(rendered[0].1.contains("get_weather"));
        assert_eq!(rendered[1], ("user", "hi".to_owned()));
    }

    #[test]
    fn a_tool_round_trip_uses_the_text_shape_the_router_reads_back() {
        let turn = ChatTurn {
            messages: vec![
                ChatMessage {
                    role: Role::Model,
                    parts: vec![Part::function_call("c1", "get_weather", json!({"city": "Paris"}))],
                },
                ChatMessage {
                    role: Role::Tool,
                    parts: vec![Part::function_response("c1", "get_weather", json!({"t": 21}))],
                },
            ],
            ..ChatTurn::default()
        };
        let rendered = render_messages(&turn, None);
        assert_eq!(rendered[0].0, "assistant");
        assert!(rendered[0].1.starts_with("<tool_call>"));
        assert_eq!(rendered[1].0, "user");
        assert!(rendered[1].1.contains("<tool_response>"));
    }

    #[test]
    fn images_become_the_projector_marker_or_an_omission_note() {
        let turn = ChatTurn {
            messages: vec![ChatMessage {
                role: Role::User,
                parts: vec![
                    Part::Text("look".into()),
                    Part::Image(ImageSource::base64("image/png", "AAAA")),
                ],
            }],
            ..ChatTurn::default()
        };
        assert_eq!(render_messages(&turn, Some("<__media__>"))[0].1, "look\n<__media__>");
        assert!(render_messages(&turn, None)[0].1.contains("no multimodal projector"));
        assert_eq!(turn_images(&turn).len(), 1);
    }

    #[test]
    fn image_bytes_reads_base64_and_files_but_never_the_network() {
        let png = base64::engine::general_purpose::STANDARD.encode(b"abc");
        assert_eq!(image_bytes(&ImageSource::base64("image/png", png)).unwrap(), b"abc");
        assert!(image_bytes(&ImageSource::base64("image/png", "!!!")).is_err());
        assert!(image_bytes(&ImageSource::Url("https://example.test/a.png".into())).is_err());
        let dir = std::env::temp_dir().join(format!("aphrody-img-{}", std::process::id()));
        std::fs::write(&dir, b"xyz").unwrap();
        assert_eq!(image_bytes(&ImageSource::Url(dir.display().to_string())).unwrap(), b"xyz");
        assert_eq!(
            image_bytes(&ImageSource::Url(format!("file://{}", dir.display()))).unwrap(),
            b"xyz"
        );
        let _ = std::fs::remove_file(dir);
    }

    #[test]
    fn empty_messages_and_reasoning_are_dropped() {
        let turn = ChatTurn {
            messages: vec![ChatMessage {
                role: Role::Model,
                parts: vec![Part::Reasoning { text: "hm".into(), opaque: json!(null) }],
            }],
            ..ChatTurn::default()
        };
        assert!(render_messages(&turn, None).is_empty());
    }
}
