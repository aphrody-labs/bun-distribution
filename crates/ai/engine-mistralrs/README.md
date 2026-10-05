<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-engine-mistralrs

In-process inference over [mistral.rs](https://github.com/EricLBuehler/mistral.rs): a
`ModelClient` (text, vision, tool calls, streaming, JSON-schema constraints) and an
`EmbedClient`, for safetensors, GGUF and UQFF weights, with ISQ and paged attention.
Internal developer document; the crate is not published.

Scope (decision D1 of `docs/plans/ai/native-integration-master.md`): mistral.rs is an optional
git dependency pinned to rev `3f2515e9`, behind the `engine` feature, off by default. For plain
GGUF files `aphrody-llama` stays the preferred in-process path; this crate is for what llama.cpp
does not give: safetensors, ISQ, UQFF, paged attention, vision pipelines.

## Features and build weight

| feature | effect |
|---|---|
| (none) | a small shell: `config` and `error` on every target (wasm32 included), clients on host targets that only report `Unavailable` |
| `engine` | the driver: mistral.rs, `image`, `base64`, `url`. CPU only, pure Rust, no system library |
| `cuda`, `metal`, `accelerate`, `mkl` | compute backends, each implies `engine` |
| `cudnn`, `cutile`, `flash-attn`, `nccl` | CUDA add-ons, each implies `cuda` |

The names are upstream's. `ring` and `code-execution` of `mistralrs` are not exposed.

`engine` is heavy. It builds mistral.rs and its own pinned copy of candle (a git revision,
apart from any crates.io candle another crate of the graph builds) and its tokenizers,
llguidance and minijinja stacks. No candle type crosses this crate's API, so two candle copies
never meet.
`cuda` needs the CUDA toolkit at build time, `metal` and `accelerate` need macOS, `mkl` needs
Intel MKL. None of it is in a default CLI build. Build through the serialized wrapper:

```text
scripts/build/rust/cargo-serial.sh check -p aphrody-engine-mistralrs
scripts/build/rust/cargo-serial.sh check -p aphrody-engine-mistralrs --features engine --all-targets
scripts/build/rust/cargo-serial.sh check -p aphrody-engine-mistralrs --target wasm32-unknown-unknown
```

## Layout

| path | job | compiled |
|---|---|---|
| `src/config.rs` | plain-data configuration: `EngineConfig`, `ModelSource`, `RuntimeOptions`, `EmbedderConfig` | always |
| `src/error.rs` | `EngineError`, mapped onto `ModelError` | always |
| `src/plan.rs` | a neutral `ChatTurn` as a `PlannedTurn`: message flattening, tool-call pairing, option mapping | host, with `engine` or in tests |
| `src/events.rs` | streamed chunks through `StreamState` onto `ModelStreamEvent` | host, with `engine` or in tests |
| `src/client.rs` | `MistralRsClient`, `MistralRsEmbedder` | host |
| `src/driver/load.rs` | configuration as mistral.rs builders | host, with `engine` |
| `src/driver/shared.rs` | the lazily loaded model clones share | host, with `engine` |
| `src/driver/request.rs` | a planned turn as a mistral.rs request | host, with `engine` |
| `src/driver/response.rs` | mistral.rs responses as raw chunks and errors | host, with `engine` |
| `src/driver/stream.rs` | one upstream response channel as one `ModelStream` | host, with `engine` |
| `tests/smoke.rs` | end-to-end smoke tests on real weights, ignored by default | with `engine` |

`plan.rs` and `events.rs` import nothing from mistral.rs. They are compiled for the driver and for
their own unit tests, so a default build carries no code that nothing calls.

## Configuration

`EngineConfig` is plain serde data, tagged by `kind`. Every field of `runtime` is optional;
the default leaves each choice to mistral.rs.

```json
{
  "model": { "kind": "auto", "id": "Qwen/Qwen3-4B" },
  "name": "qwen3-local",
  "runtime": {
    "isq": "4",
    "dtype": "bf16",
    "force_cpu": false,
    "paged_attention": { "block_size": 32, "memory": { "context_tokens": 8192 }, "cache": "auto" },
    "max_num_seqs": 8,
    "max_model_len": 16384,
    "prefix_cache_seqs": 16,
    "hf_revision": "main",
    "hf_token_source": "env:HF_TOKEN",
    "logging": false
  }
}
```

Other sources: `{"kind":"text"|"vision","id":..}` force a pipeline, `{"kind":"gguf","id":..,
"files":[..],"tokenizer_from":..,"mmproj_files":[..]}`, `{"kind":"uqff","id":..,"files":[..],
"vision":false}`. `isq` is a bit width (`2`..`8`, resolved for the device when the model loads) or
an exact type (`q4k`, `q8_0`, `hqq4`, ...). `hf_token_source` is `cache`, `none`, `env:VAR`,
`path:FILE` or `literal:TOKEN`; error messages and `Debug` output never print it.

```rust
let config: EngineConfig = serde_json::from_str(&json)?;
let client = MistralRsClient::new(config)?; // cheap: validates and parses, loads nothing
client.load().await?;                       // optional warm-up; stream() loads on first use
let mut events = client.stream(turn).await?;
```

## Loading

- `new` is cheap. It validates the configuration and parses every option (ISQ, dtype, token
  source, paged attention) with mistral.rs' own parsers, so a typo is an error at construction.
- The model loads on first use or through `load()`, once, and every clone of the client shares
  it. A failed load is not remembered: a later call retries.
- The load runs on a blocking thread. mistral.rs reads and uploads the weights synchronously
  inside its async builder, and panics when it cannot create its engine thread; here that is an
  `EngineError::Load { model, message }`.
- Loads are serialized and outlive the caller that started them. A request cancelled while the
  model loads (the turn loop races `stream` against an interrupt) leaves the load running, and
  the next caller finds the model instead of loading the weights a second time. Callers that
  queued behind a load that failed report its error instead of each retrying it in turn.
- With `ModelSource::Auto` the pipeline, and so image support, is only known after loading:
  `capabilities()` reads the configuration until then and the loaded model afterwards. Call
  `load()` before handing an `Auto` client to the turn loop if images matter.

## Streaming

`stream` plans the turn (`plan_turn`, a `400` when the model cannot take it), builds the request,
starts it, and returns a `ModelStream` fed by a task that owns the upstream channel.

| mistral.rs | neutral |
|---|---|
| first chunk of the answer | `Created`, once, before any content |
| `delta.reasoning_content` | `ReasoningDelta` |
| `delta.content` | `TextDelta` |
| `delta.tool_calls[]`, complete and parsed by the engine | `ToolCall { id, name, arguments }`; the arguments text becomes JSON (kept as a string when it does not parse), an empty id is generated |
| `finish_reason` and `usage` on the last chunk, then the channel closes | `Completed { usage, finish_reason }`, exactly once |

`Usage` maps to `input_tokens`, `output_tokens`, `total_tokens` and, when the prefix cache served
part of the prompt, `cached_input_tokens`. `ReasoningItem` and `ToolCallDelta` are never produced:
mistral.rs has no opaque reasoning payload to replay, and it delivers a tool call whole.

Errors follow the network clients: an engine error before the first event (a prompt longer than
the context, a template mistral.rs cannot render) is the error of `stream()` itself; later ones
are `Err` items, after which the stream ends.

| upstream | `ModelError::Api` status |
|---|---|
| `ValidationError`, `RequestValidation` | `400` |
| `InternalError`, `ModelError` | `500` |
| `InternalError` carrying `ServiceUnavailableError` | `503` |

A response channel that closes without a finish reason (the engine thread died) is a
`ModelError::Stream`, never a plain end of stream: the turn loop would take that for a finished
answer. Dropping the stream cancels the generation: mistral.rs' scheduler cancels a sequence whose
response channel closed. The pump drains upstream at engine speed into an unbounded queue,
because mistral.rs awaits every send and a slow reader would otherwise stall every sequence.

## Requests

| neutral | mistral.rs |
|---|---|
| system, user and model text | `RequestBuilder::add_message` |
| a model message with tool calls | `add_message_with_tool_call`; the arguments are JSON text, which mistral.rs parses for templates that walk them |
| a tool result | `add_tool_message(content, call_id)` |
| images, inline base64 or a `data:` URL | decoded with `image`, `add_image_message`; mistral.rs adds the model's image tokens |
| `ToolDecl` | `Tool` with a `Function` (name, description, parameters) |
| `tool_choice` extra | `ToolChoice::Auto`, `None`, `Required`, `NamedFunction` |
| temperature, `top_p`, `top_k`, `min_p`, penalties, max tokens, stop | `SamplingParams::neutral()` plus the fields that were set |
| `response_schema` or `response_format` | `Constraint::JsonSchema` |
| `reasoning_effort`, `enable_thinking` | `with_reasoning_effort`, `enable_thinking` |
| `truncate_sequence` | `with_truncate_sequence` |

Unset sampling stays unset on purpose: mistral.rs fills it from the model's
`generation_config.json`, which `SamplingParams::deterministic()` would defeat by forcing
`top_k = 1`.

## Limits

- Remote `http(s)` image URLs and `file:` URLs are refused with a message that says so: the
  in-process engine has no HTTP client, and a gateway in front of it must not turn an image URL
  into a local file read. Send the image inline; the turn loop already does for local files.
- A JSON-schema constraint applies from the first token, so a turn that declares tools and a
  schema cannot call the tools. This is how mistral.rs' constrained decoding works.
- Embedding inputs longer than the model's context are refused: chunk before embedding.
- mistral.rs' agentic features (MCP, code execution, shell, web search) are never switched on;
  tool execution stays with Aphrody's own tool runtime. No LoRA, X-LoRA or AnyMoE.
- One model per client.

## Tests

The unit tests need no network, weights or GPU. The default build tests `config`, `error`,
`plan`, `events` and the client shell; `--features engine` adds the loader options, the request
and response mappings and the stream plumbing.

```text
scripts/build/rust/cargo-serial.sh test -p aphrody-engine-mistralrs
scripts/build/rust/cargo-serial.sh test -p aphrody-engine-mistralrs --features engine
```

`tests/smoke.rs` loads real weights. It is `#[ignore]`d and driven by environment variables; a
test whose variable is unset says so and passes.

```text
APHRODY_ENGINE_SMOKE_MODEL=Qwen/Qwen3-0.6B \
  scripts/build/rust/cargo-serial.sh test -p aphrody-engine-mistralrs --features engine \
  --test smoke -- --ignored --nocapture
```

| variable | meaning |
|---|---|
| `APHRODY_ENGINE_SMOKE_MODEL` | small chat model, repo id or directory |
| `APHRODY_ENGINE_SMOKE_TOOLS` | any value: also run the tool-call test on that model |
| `APHRODY_ENGINE_SMOKE_EMBED_MODEL` | embedding model, repo id or directory |
| `APHRODY_ENGINE_SMOKE_ISQ` | optional ISQ for the chat model |
| `APHRODY_ENGINE_SMOKE_CPU` | any value: never use a GPU |

