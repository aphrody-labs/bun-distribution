// SPDX-License-Identifier: Apache-2.0
//! In-process llama.cpp engine over `koharu-llama`.
//!
//! [`InProcessLlama`] is a [`ModelClient`] over one GGUF file: the model stays loaded in this
//! process, every turn gets its own context, decoding runs on a blocking thread and the decoded
//! pieces go through the [`router`] (reasoning split, stop strings, textual tool calls).
//! [`InProcessServer`] puts a loopback OpenAI-compatible endpoint on top of it, so the
//! HTTP-shaped entry points keep working without any child process.
//!
//! `libllama` itself is installed and loaded at run time by `koharu-runtime`; nothing is linked.

pub mod router;
pub mod server;

use std::{
    num::NonZeroU32,
    path::{Path, PathBuf},
    sync::Arc,
};

use aphrody_model_client::{
    ChatMessage, ChatTurn, ModelCapabilities, ModelClient, ModelError, ModelStream,
    ModelStreamEvent, Part, Role, ToolDecl,
};
use async_trait::async_trait;
use koharu_llama::{
    llama_backend::LlamaBackend,
    llama_batch::LlamaBatch,
    model::{AddBos, LlamaChatMessage, LlamaModel, params::LlamaModelParams},
    context::params::LlamaContextParams,
    sampling::LlamaSampler,
};
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
}

/// What to load and how.
#[derive(Debug, Clone)]
pub struct LoadOptions {
    /// Context size in tokens; `None` = `min(trained context, 8192)`.
    pub ctx: Option<u32>,
    /// Layers offloaded to the GPU (`u32::MAX` = all the runtime supports).
    pub gpu_layers: u32,
}

impl Default for LoadOptions {
    fn default() -> Self {
        Self { ctx: None, gpu_layers: u32::MAX }
    }
}

/// The process-wide backend. Never dropped: `llama_backend_free` must not run while another
/// owner (`koharu-ml`) may still use the library.
static BACKEND: OnceCell<&'static LlamaBackend> = OnceCell::const_new();

async fn backend() -> Result<&'static LlamaBackend, LlamaLoadError> {
    BACKEND
        .get_or_try_init(|| async {
            koharu_runtime::Runtime::discover([koharu_runtime::Feature::Llama])
                .map_err(|error| LlamaLoadError::Runtime(format!("{error:#}")))?
                .initialize()
                .await
                .map_err(|error| LlamaLoadError::Runtime(format!("{error:#}")))?;
            let backend = match LlamaBackend::init() {
                Ok(backend) => backend,
                // Initialised elsewhere in the process (the empty handle only proves it).
                Err(koharu_llama::LlamaCppError::BackendAlreadyInitialized) => LlamaBackend {},
                Err(error) => return Err(LlamaLoadError::Backend(error.to_string())),
            };
            Ok::<_, LlamaLoadError>(&*Box::leak(Box::new(backend)))
        })
        .await
        .copied()
}

struct Inner {
    model: LlamaModel,
    backend: &'static LlamaBackend,
    path: PathBuf,
    n_ctx: u32,
    /// One generation at a time: a context per turn is expensive on a GPU.
    gate: Arc<Semaphore>,
}

/// An in-process `ModelClient` over a GGUF model via `koharu-llama`.
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
        let backend = backend().await?;
        let path = path.as_ref().to_path_buf();
        let load_path = path.clone();
        let model = tokio::task::spawn_blocking(move || {
            let params = LlamaModelParams::default().with_n_gpu_layers(options.gpu_layers);
            LlamaModel::load_from_file(backend, &load_path, &params)
                .map(|model| (model, options.ctx))
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
        let (model, ctx) = model;
        let n_ctx = ctx.unwrap_or_else(|| model.n_ctx_train().min(DEFAULT_MAX_CTX)).max(512);
        Ok(Self {
            inner: Arc::new(Inner { model, backend, path, n_ctx, gate: Arc::new(Semaphore::new(1)) }),
            model_name: model_name.into(),
        })
    }

    /// The GGUF file.
    #[must_use]
    pub fn model_path(&self) -> &Path {
        &self.inner.path
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
            images: false,
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
fn render_messages(turn: &ChatTurn) -> Vec<(&'static str, String)> {
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
                Part::Image(_) => push("[image omitted: this local engine is text-only]"),
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

fn seed() -> u32 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(1, |elapsed| elapsed.subsec_nanos().max(1))
}

/// Decode one turn, sending events as they become final. `Err` = a failure to report.
fn generate(
    inner: &Inner,
    turn: &ChatTurn,
    tx: &mpsc::UnboundedSender<Result<ModelStreamEvent, ModelError>>,
) -> Result<(), String> {
    let model = &inner.model;
    let messages = render_messages(turn)
        .into_iter()
        .map(|(role, content)| LlamaChatMessage::new(role.to_owned(), content))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    let template = model.chat_template(None).map_err(|error| error.to_string())?;
    let prompt = model
        .apply_chat_template(&template, &messages, true)
        .map_err(|error| error.to_string())?;

    // Most templates write the BOS token themselves; add it only when they did not.
    let mut decoder = encoding_rs::UTF_8.new_decoder();
    let bos = model.token_to_piece(model.token_bos(), &mut decoder, true, None).unwrap_or_default();
    let add_bos = if !bos.is_empty() && prompt.starts_with(&bos) { AddBos::Never } else { AddBos::Always };
    let tokens = model.str_to_token(&prompt, add_bos).map_err(|error| error.to_string())?;

    let n_ctx = inner.n_ctx;
    let prompt_len = tokens.len();
    if prompt_len + 1 >= n_ctx as usize {
        return Err(format!("the prompt ({prompt_len} tokens) does not fit the {n_ctx}-token context"));
    }
    let room = n_ctx as usize - prompt_len - 1;
    let budget = turn
        .options
        .max_output_tokens
        .map_or(room, |max| (max as usize).min(room));

    let params = LlamaContextParams::default().with_n_ctx(NonZeroU32::new(n_ctx));
    let mut ctx =
        model.new_context(inner.backend, params).map_err(|error| error.to_string())?;
    let n_batch = (ctx.n_batch() as usize).max(1);
    let mut batch = LlamaBatch::new(n_batch, 1);

    let mut position = 0_i32;
    let chunk_count = tokens.len().div_ceil(n_batch);
    for (chunk_index, chunk) in tokens.chunks(n_batch).enumerate() {
        batch.clear();
        let last_chunk = chunk_index + 1 == chunk_count;
        for (index, token) in chunk.iter().enumerate() {
            let wants_logits = last_chunk && index + 1 == chunk.len();
            batch.add(*token, position, &[0], wants_logits).map_err(|error| error.to_string())?;
            position += 1;
        }
        ctx.decode(&mut batch).map_err(|error| error.to_string())?;
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
        let token = sampler.sample(&ctx, batch.n_tokens() - 1);
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
        let rendered = render_messages(&turn);
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
        let rendered = render_messages(&turn);
        assert_eq!(rendered[0].0, "assistant");
        assert!(rendered[0].1.starts_with("<tool_call>"));
        assert_eq!(rendered[1].0, "user");
        assert!(rendered[1].1.contains("<tool_response>"));
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
        assert!(render_messages(&turn).is_empty());
    }
}
