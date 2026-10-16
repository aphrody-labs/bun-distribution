<!-- SPDX-License-Identifier: Apache-2.0 -->

# vLLM Rust and HTTP integration review — 2026-10-01

> Qualification du 2026-10-09 : les owners IA retirés du checkout sont signalés « not in repo ». Les constats datés ci-dessous ne prouvent pas leur présence ou leur fonctionnement actuel.

The source checkout is a complete vLLM repository containing an experimental
Rust frontend. Aphrody's integration remains an HTTP client in
`crates/ai/model-client/src/vllm`, as required by the
[native integration master plan](../../plans/ai/native-integration-master.md).
A Rust frontend is not a Rust replacement for the Python/PyTorch inference
engine. Connecting the existing client does not require embedding that
frontend, duplicating its engine protocol or starting another process.

## Source state and provenance

Inspected `.cache/upstream/vllm` (not in repo) (generated or machine-local artifact; presence depends on the build host), clean at commit
`ab5266769e702434a0968d47319d0731d8ccac35`, identical to the catalogue's recorded
commit. The catalogue entry remains `pinned: false`, `role: reference`,
`ref: main`; a recorded revision must not be described as an immutable sync pin.
No upstream source, Git revision, catalogue or dependency manifest was changed
by this repair. Sources stay outside the Aphrody checkout; no vendoring.

Read the source's root and Rust `AGENTS.md`, root plan and integration resume
plan. The existing ecosystem owner is `aphrody-model-client`; the current
catalogues are `docs/ecosystem/ECOSYSTEM.md` and
`docs/reference/infra/BEST-AI-STACK-CANONICAL.md`. The old sibling Infra catalogue
path mentioned by the ecosystem skill is no longer present. Local pinned
Rust is 1.98.1; shared dependencies include reqwest 0.13.5, Tokio 1.53.1,
serde_json 1.0.151 and futures 0.3.34. Skill version snapshots were not used
as package-resolution evidence. Global sccache and serialized build policy
remain in force.

The [Rust README at the inspected revision](https://github.com/vllm-project/vllm/blob/ab5266769e702434a0968d47319d0731d8ccac35/rust/README.md)
describes Python-owned engine processes, a ZeroMQ/MessagePack boundary,
an OpenAI-compatible Rust API server and an engine-free renderer. Its own
experimental/feature-incomplete qualification still matters.

`rust/Cargo.toml` declares **16 members**, edition 2024 and Apache-2.0. Fifteen
inherit workspace version 0.1.0; `vllm-proto` explicitly overrides it to 0.4.0:

| Member | Package | Role |
| --- | --- | --- |
| `proto` | `vllm-proto` | Protobuf/gRPC inference types |
| `src/bench` | `vllm-bench` | HTTP benchmark application |
| `src/build-info` | `vllm-build-info` | Build metadata |
| `src/chat` | `vllm-chat` | Templates, tools and reasoning |
| `src/cmd` | `vllm-cmd` | `vllm-rs` application |
| `src/engine-core-client` | `vllm-engine-core-client` | Engine ZeroMQ transport |
| `src/llm` | `vllm-llm` | Token generation facade |
| `src/managed-engine` | `vllm-managed-engine` | Python engine process management |
| `src/metrics` | `vllm-metrics` | Engine/frontend metrics |
| `src/mock-engine` | `vllm-mock-engine` | Engine protocol test double |
| `src/parser` | `vllm-parser` | Model reasoning/tool parsers |
| `src/parser/python` | `vllm-tool-parser-py` | Python parser bindings |
| `src/server` | `vllm-server` | Axum frontend |
| `src/text` | `vllm-text` | Tokenization and text preparation |
| `src/tokenizer` | `vllm-tokenizer` | Tokenizer backends |
| `src/tracing` | `vllm-tracing` | Shared tracing configuration |

## Repositories and registry crates researched

Live primary-source checks on 2026-10-01 used repository READMEs, official
vLLM documentation, docs.rs and the crates.io API. Registry response snapshots
are available in `/tmp/aphrody-vllm-fix/research`; URLs below remain the durable
source references. An advertised API or recent release is not independent
production certification.

| Candidate | Observed state/licence | Decision for this integration |
| --- | --- | --- |
| [vllm-project/vllm Rust workspace](https://github.com/vllm-project/vllm/tree/main/rust) | Active canonical frontend; Apache-2.0 | Use its pinned protocol/router as reference. Do not link engine/process/frontend crates into an HTTP client. |
| [Inferact/vllm-frontend-rs](https://github.com/Inferact/vllm-frontend-rs) | Archived 2026-05-22; development moved into vLLM `rust/`; Apache-2.0 | Historical reference only; do not add a second checkout/dependency for the same frontend. |
| [vllm-client](https://github.com/limoncc/vllm-client), [registry API](https://crates.io/api/v1/crates/vllm-client) | 0.1.4, updated 2026-07-22; MIT OR Apache-2.0 | OpenAI chat/completions/SSE SDK, but would duplicate the existing shared wire/retries/model events. Native pooling extras still need their contracts. Keep existing owner. |
| [vllm-proto registry](https://crates.io/api/v1/crates/vllm-proto) | 0.4.0, updated 2026-09-30; Apache-2.0 | gRPC bindings, not HTTP extras. Matches the package version in the inspected checkout; version equality alone does not prove an identical source/protocol revision. |
| `vllm-engine-core-client`, `vllm-llm`, `vllm-server` | Exact crates.io API requests returned 404 on this date | Available as source workspace packages, not established published registry SDKs. |
| [candle-vllm](https://github.com/EricLBuehler/candle-vllm) | Separate Candle inference/server project; [library usage](https://github.com/EricLBuehler/candle-vllm/blob/master/docs/rust_crate.md); repository MIT licence | Potential inference research, not a transport replacement. Exact `candle-vllm` registry request returned 404. |
| [guoqingbao/xinfer](https://github.com/guoqingbao/xinfer) | Former `guoqingbao/vllm.rs` redirects here; separate native inference stack, MIT | Another engine architecture, not upstream vLLM HTTP contract authority. |
| [vllm-cpp](https://github.com/querymt/vllm-cpp-rs), [registry API](https://crates.io/api/v1/crates/vllm-cpp) | 0.0.1, updated 2026-08-24; MIT OR Apache-2.0 | FFI for a different C++ engine; inappropriate dependency for this client. |
| [vllm-doctor](https://github.com/vllm-doctor/vllm-doctor), [registry API](https://crates.io/api/v1/crates/vllm-doctor) | 0.10.0, updated 2026-07-31; Apache-2.0 | Diagnostic application, not inference/client library. |
| [async-openai](https://github.com/64bit/async-openai), [registry API](https://crates.io/api/v1/crates/async-openai) | 0.42.1, updated 2026-09-28; MIT; vLLM source uses 0.33.1 | Valid general SDK, but adding it would duplicate already implemented OpenAI wire, SSE and retry policy. |
| [vllm-project/agentic-api](https://github.com/vllm-project/agentic-api) | Rust gateway owning stateful Responses APIs ahead of vLLM; Apache-2.0 | Relevant architecture reference for gateway work, not a dependency for direct native endpoints. |

The actual choice is the existing **reqwest + Tokio + serde + shared
OpenAiCompatClient** stack. Cloning reqwest clients shares the existing
connection pool; see [reqwest Client documentation](https://docs.rs/reqwest/0.13.5/reqwest/struct.Client.html).
No new direct dependencies were required. Licence records inform eventual
distribution decisions and do not block private development.

## Contract findings and corrections

The interrupted original implementation referenced six obsolete APIs:
`OpenAiCompatClient::new`, `with_api_key`, `OpenAiWire::ChatCompletions`, a
nonexistent ProviderRuntime default, and a borrowed rather than owned
`ModelClient::stream` parameter. It also joined native routes onto `/v1`,
silently assigned a missing embedding index to zero, failed to check vector
cardinality, and mapped `top_n=0` to vLLM's "return all" semantics despite the
rerank trait promising at most zero results.

The replacement uses `OpenAiCompatClient::from_provider`, `OpenAiWire::Chat`
and `ProviderRuntime::keyless`. Existing config fields and constructors remain
usable. Additive `from_provider`, `with_http_client`, `with_request_timeout`
and `api()` methods carry headers, queries, auth, capabilities, decoding
options and connection pools to every endpoint. Config Debug output redacts
the API key.

Native roots preserve reverse-proxy prefixes and remove only a trailing
`/v1` or `/api`; chat appends exactly `/v1/chat/completions`. Models use
server-configured IDs (including aliases), not a guessed Hugging Face ID.
Health consumes an empty response, metrics returns verbatim Prometheus text,
and native JSON failures use the shared transport/decode/error helpers.

| Surface | Pinned Python server | Pinned Rust frontend | Client contract |
| --- | --- | --- | --- |
| Chat | `/v1/chat/completions` | Same | Shared neutral SSE events, usage, tools, reasoning and provider defaults |
| Models | `/v1/models` | Same | Preserve IDs/served aliases |
| Health | `/health`, empty successful body | Same | Success/status errors, no JSON requirement |
| Version | `/version` | Same | Version string |
| Metrics | `/metrics`, Prometheus text | Same | Plain text response |
| Tokenize | `/tokenize`, prompt or messages | Same | Typed count/length/token IDs/optional strings; advanced request JSON preserves template/tools/media parameters |
| Detokenize | `/detokenize` | Same | Model and nonnegative signed-64-bit token IDs, prompt result |
| Embeddings | `/v1/embeddings` | Not in inspected Rust router | Float encoding, exact input-order reconstruction, required unique indices, complete cardinality, finite consistent nonempty vectors |
| Rerank | `/rerank` (also legacy aliases) | Not in inspected Rust router | Canonical root route; validate indices/cardinality, descending score; empty/zero limit returns empty without network |
| Score | `/score` (also `/v1/score`) | Not in inspected Rust router | Preserve four request aliases and vLLM options; typed scores with metadata |
| Pooling | `/pooling` | Not in inspected Rust router | Preserve vector/nested-vector/base64/plugin JSON; advanced raw bytes and `metadata` headers retain dtype/endianness/shape |

Evidence: [Rust route table at the inspected commit](https://github.com/vllm-project/vllm/blob/ab5266769e702434a0968d47319d0731d8ccac35/rust/src/server/src/routes.rs),
Python `vllm/entrypoints/pooling/{scoring,embed,pooling}/protocol.py` and
`api_router.py`, `serve/tokenize/protocol.py`, and
`serve/instrumentator/{health,metrics}.py`. The frontend distinction is a
measured contract boundary, not a claim that the HTTP client enables APIs
missing from a server.

## Runtime practices

- Deadlines cover native response headers, retry sleeps and the response body.
  Chat uses a deadline until headers and the shared separate stream idle
  timeout after headers. Default total native/handshake deadline is 300 seconds;
  callers can change it. [Tokio timeout cancels the wrapped future](https://docs.rs/tokio/1.53.1/tokio/time/fn.timeout.html).
- Reuse the shared bounded retry budget and Retry-After handling. Native calls
  have no second private retry loop. HTTP 400/401/404 errors preserve statuses
  and extract vLLM/FastAPI messages; malformed success JSON fails decoding.
- Turn-specific options win over provider defaults. vLLM `top_k`,
  `chat_template_kwargs`, structured output and other supported extensions
  travel through `TurnOptions.extra`; the server remains responsible for
  model/version-specific validation. See the [current OpenAI-compatible serving documentation](https://docs.vllm.ai/en/latest/serving/online_serving/openai_compatible_server/).
- A streaming client holds the response as a pull-based stream, with no local
  unbounded channel or background reader. Dropping the stream drops HTTP body
  ownership. The server's actual engine abort depends on its disconnect
  cancellation path; an HTTP mock cannot prove GPU resource reclamation.
- Native pooling capability must be selected by caller/model/frontend. A
  generation server can legitimately reject pooling routes. Chat templates,
  tool-parser flags and reasoning-parser configuration are server deployment
  concerns; a client cannot infer support from a model name alone.

A further audit identified shared chat SSE decoder defects: UTF-8 could be
split across HTTP byte chunks, error handling could continue to a synthetic
Completed event, and `[DONE]` could leave the connection read pending. These
are repaired in the shared OpenAI owner, rather than forked into a private vLLM
decoder. Regression cases cover all byte splits of UTF-8 plus LF/CRLF/CR
line endings, EOF with a missing terminal event or incomplete frame, terminal
errors followed by `[DONE]`, and `[DONE]` without socket EOF. Completed frames
with a finish reason may end at EOF; partial frames never become success.
The decoder caps a pending frame at 8 MiB and accumulating tool-call payload
(id/name/arguments) at 8 MiB and 1024 calls, with payload accounting updated
once per delta. Fragmented `<think>` and `</think>` tags retain only a possible
marker suffix until the next delta. See the [WHATWG SSE parsing standard](https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation).

## Verification and limits

The worker must not run Cargo. Executed by the lead, sequentially through the repository lock wrapper:

```sh
scripts/build/rust/cargo-serial.sh check -p aphrody-model-client -p aphrody-engine-mistralrs --all-targets --locked
scripts/build/rust/cargo-serial.sh test -p aphrody-model-client -p aphrody-engine-mistralrs --locked
scripts/build/rust/cargo-serial.sh clippy -p aphrody-model-client --all-targets --locked -- -D warnings
```

The mock suite exercises actual local HTTP requests and response streams:
root/version paths under a proxy, headers/auth/query encoding, input bodies,
empty health, text metrics, tokenize/detokenize/score/pooling shapes,
embeddings ordering and malformed batches, rerank limits, HTTP retry/error
messages/decode failure, chat options/usage, header/body/idle deadlines, and
observable body release on stream drop. No timing sleep is used to infer
cancellation. These checks establish the client contract against fixtures
reconstructed from pinned schemas. They do not prove deployment of vLLM,
model inference correctness, GPU performance, Python installation or full
Rust/Python frontend feature parity. No model, weight or secret is downloaded.

The dependent Mistral shell had three further obsolete contract references,
repaired minimally in `crates/ai/engine-mistralrs/src/client.rs` (not in repo): owned
`ChatTurn`, `ModelCapabilities.images`, and remaining capability defaults.
This does not implement inference: the existing `engine` feature stream branch
returns an error stub, and the default constructor reports feature-disabled.
Tests/checks of this shell do not qualify an in-process Mistral engine.

Final gates passed:

- [All-targets check log](vllm-rust-review-2026-10-01/check.log): model client and default-feature Mistral shell, 28.71 seconds. Mistral retains 32 pre-existing dead-code warnings because its shell does not wire the engine/plan/events into live inference.
- [Complete test log](vllm-rust-review-2026-10-01/test.log): **158 passed**, zero failed/ignored: 125 model-client unit tests, 32 Mistral-shell tests, one Ollama doctest. The model-client suite ran in 0.61 seconds; Cargo command completed in 5.93 seconds. Nine dedicated vLLM tests plus ten shared SSE/helper regression tests cover the repaired contracts.
- [Strict Clippy log](vllm-rust-review-2026-10-01/clippy.log): model-client all-targets with `-D warnings`, passed in 3.17 seconds. This strict result does not include the warning-bearing Mistral shell.
- Formatting of owned files and `git diff --check` passed. The source clone remained clean and at the same revision. No publication, live server inference, GPU check, engine-feature build, cross-platform build or clean-clone deployment was performed.
- [Registry observations](vllm-rust-review-2026-10-01/registry-summary.json) retain the published-version/404 evidence used in the crate comparison.

The complete gate also exposed an existing broken Ollama doctest: `Think`
was documented at the crate root but only available in its module. The lead
restored the root re-export and replaced three `.err().expect()` calls with
`expect_err` in Ollama tests to satisfy strict Clippy. Those repairs preserve
the existing documented API; they do not add another provider implementation.

The lead integrated the previously untracked Mistral bridge module alongside
its three contract corrections so that the combined workspace consumers compile.
The default-feature shell checks and tests remain separate from inference
qualification. All fixes reuse the existing shared HTTP/OpenAI owners, and
no package/version was added or upstream crate source copied.
