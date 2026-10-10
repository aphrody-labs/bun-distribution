<!-- SPDX-License-Identifier: Apache-2.0 -->
# Local inference stacks and SQL state (2026-10-01)

> Qualification du 2026-10-09 : les owners IA retirés du checkout sont signalés « not in repo ». Les constats datés ci-dessous ne prouvent pas leur présence ou leur fonctionnement actuel.

Question: how do llama.cpp, mistral.rs, Ollama and vLLM keep prompts, caches
and state, and where does SQL belong? Short answer: **no engine keeps
inference state in SQL.**
- KV and prefix caches live in VRAM or RAM, files, or object stores, keyed by
  token-block hashes.
- SQL belongs to the application layer: prompt templates, conversation
  history, response and semantic caches, request logs, eval traces and the
  model registry.

## 1. Engines

| Engine | Version (date) | Licence | API | Cache / persistence | SQL |
|---|---|---|---|---|---|
| llama.cpp | b11321 (2026-10-01) | MIT | `llama-server`: OpenAI `/v1/chat/completions`, `/v1/embeddings` (`--embedding`), `/v1/rerank` (`--embedding --pooling rank`, bge-reranker-v2-m3); native `/completion`, `/slots` | `cache_prompt` (default true) reuses the KV cache for a shared prefix but can make results nondeterministic; `--cache-reuse N` uses KV shifting; `--slot-save-path DIR` + `POST /slots/{id}?action=save\|restore` writes the KV cache to files. GGUF models. | none |
| mistral.rs | v0.9.4 (2026-09-24) | MIT | OpenAI `/v1` incl. embeddings; Anthropic `/v1/messages`; MCP client and server; Rust crate `mistralrs` | PagedAttention; `PrefixCacheManagerV2` (in-memory, block-hash keyed); agent sessions in memory (128, LRU), exported as JSON via `GET/PUT/DELETE /v1/sessions/{id}`. GGUF, ISQ, UQFF. | none |
| Ollama | v0.35.0 (2026-09-28) | MIT | `/api/chat`, `/api/generate`, `/api/embed` (`/api/embeddings` superseded); `keep_alive` (`-1` pins, `0` unloads) | Content-addressed blobs `sha256:<digest>` under `~/.ollama/models` (`OLLAMA_MODELS`). | **Desktop app only**: SQLite (`mattn/go-sqlite3`, WAL) with tables `settings`, `chats`, `messages`, `tool_calls`, `attachments`, `users`. The server persists no prompts. |
| vLLM | v0.30.0 (2026-09-22) | Apache-2.0 | OpenAI server, `/v1/embeddings`, `/score`, `/rerank` (Cohere-style); LoRA via `--enable-lora`, runtime `/v1/load_lora_adapter` | V1 engine only. Automatic prefix caching is **on by default**; block hash = parent hash + tokens + extras (LoRA id, multimodal hash, cache salt); `--prefix-caching-hash-algo sha256\|sha256_cbor\|xxhash\|xxhash_cbor`. `OffloadingConnector` to CPU, filesystem or object store. | none |
| LMCache | 0.5.5 (2026-09-12) | Apache-2.0 | vLLM/SGLang KV connector | Tiered KV: CPU, disk, Redis/Valkey, S3, Mooncake, NIXL, GDS and more. | **no SQL backend** |

Sources:
- [llama.cpp server README](https://github.com/ggml-org/llama.cpp/blob/master/tools/server/README.md),
  [GGUF spec](https://github.com/ggml-org/ggml/blob/master/docs/gguf.md)
- [mistral.rs](https://github.com/EricLBuehler/mistral.rs),
  [persist sessions](https://github.com/EricLBuehler/mistral.rs/blob/master/docs/src/content/docs/guides/agents/persist-sessions.mdx)
- [Ollama API](https://github.com/ollama/ollama/blob/main/docs/api.md),
  [FAQ](https://github.com/ollama/ollama/blob/main/docs/faq.mdx),
  [app/store/database.go](https://github.com/ollama/ollama/blob/main/app/store/database.go)
- [vLLM prefix caching](https://github.com/vllm-project/vllm/blob/main/docs/design/prefix_caching.md),
  [KV offloading](https://github.com/vllm-project/vllm/blob/main/docs/features/kv_offloading_usage.md),
  [LoRA](https://github.com/vllm-project/vllm/blob/main/docs/features/lora.md),
  [pooling models](https://github.com/vllm-project/vllm/tree/main/docs/models/pooling_models)
- [LMCache backends](https://github.com/LMCache/LMCache/tree/dev/docs/source/kv_cache/storage_backends)

## 2. Making engine caches effective from the application

- **Keep the prefix stable.** Put the system prompt, tool schemas and
  retrieved context in a deterministic order, with variable content last. A
  prefix cache only hits on byte-identical token prefixes.
- **Use one template source of truth.** Store prompt templates in SQL (or in
  git) with a `template_sha256`. Log that hash per request, so cache-hit rates
  and evals can be split by template version.
- **Use vLLM's cache salt** to isolate tenants or users when prompts share
  prefixes but must not share KV.
- **Persist and restore llama.cpp slots** for long-lived agent sessions:
  - Save slot files under a dedicated directory.
  - Keep a SQL row `(session_id, slot_file, model_sha256, n_ctx, created_at)`
    pointing to each file. The file is only valid for the same model and
    context parameters.
- **Snapshot mistral.rs sessions** through `/v1/sessions/{id}` as JSON. They
  can be stored in a `jsonb` or SQLite `TEXT` column with the model id.

## 3. Response and semantic caches in SQL

There is no maintained Postgres-native "semantic cache" product.
- GPTCache (MIT) is stale (last release 0.1.44, 2024-08-01).
  [repo](https://github.com/zilliztech/GPTCache)
- RedisVL `SemanticCache` (0.27.2, MIT) is the reference design: a cosine
  distance threshold, TTL that slides on hit, filter fields for model/user
  isolation, and entry id = SHA-256 of prompt plus filters.
  [docs](https://docs.redisvl.com/en/latest/user_guide/03_llmcache.html)

The same design in PostgreSQL, synthesised from the RedisVL design (not a
standard):

```sql
CREATE TABLE llm_cache (
  prompt_sha256 bytea NOT NULL,          -- normalised prompt
  model_id text NOT NULL,                -- includes quantisation/adapter hash
  params_sha256 bytea NOT NULL,          -- temperature, top_p, max_tokens, template hash
  prompt_embedding halfvec(384),         -- optional, semantic hits
  response jsonb NOT NULL,
  hits int NOT NULL DEFAULT 0,
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (prompt_sha256, model_id, params_sha256)
);
CREATE INDEX ON llm_cache USING hnsw (prompt_embedding halfvec_cosine_ops);
-- Exact lookup first; semantic lookup only with model_id/params filters and a strict threshold.
```

Rules:
- Never serve a semantic hit across `model_id` or params.
- Cache only deterministic requests (temperature 0) by default.
- Purge expired rows with a partitioned table or a periodic `DELETE`.

Aphrody note: `crates/ai/rag/src/redis_cache.rs` caches RAG *results* in
Redis keyed by query and mode. It is a retrieval cache, not an LLM response
cache. Keep it that way unless measurements show repeated identical
generations.

## 4. Aphrody engine owners (from docs/plans/ai/native-integration-master.md)

| Track | Owner crates | Engine |
|---|---|---|
| T2a in-process llama | `crates/ai/llama-server`, `crates/ai/infer`, `crates/ai/engine` | llama.cpp |
| T2b wire protocols | `crates/ai/model-client`, `crates/ai/models`, `crates/ai/providers` (not in repo) | Ollama, vLLM, HF |
| T2c mistral.rs | `crates/ai/engine-mistralrs` (not in repo) (git rev `3f2515e9`, v0.9.4) | mistral.rs |

- None of these crates depends on rusqlite or tokio-postgres today.
- `crates/ai/models` (`ModelStore`) already uses `sha2`, so model identity is
  content-hash based. Reuse that hash as `model_id` in caches, evals and the
  training registry.
- The training lease (`crates/ai/train`) preempts `llama-server` for the GPU.
  Record lease and preemption events in the registry `runs` table if
  utilisation history becomes useful.
