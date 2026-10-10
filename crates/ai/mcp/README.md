<!-- SPDX-License-Identifier: Apache-2.0 -->

# aphrody-mcp

## What is `aphrody-mcp`?

`aphrody-mcp` is the Aphrody MCP (Model Context Protocol) server. It exposes
forensics, reconnaissance, and host-introspection tools to any MCP-aware agent
host (Claude Desktop, Cursor, Continue, Zed) through stdio or HTTP. The server
is built on `rmcp` (the official MCP Rust SDK), `axum` for HTTP, and the local
`backend` crate for real DNS / Chromium / process work. Every tool issues real
OS calls — no stubs.

## Install

Add to `Cargo.toml`:

```toml
[dependencies]
aphrody-mcp = { path = "crates/aphrody-mcp", version = "1.0.0-canary" }
```

The crate also ships a binary; install from the workspace with:

```bash
cargo install --path crates/aphrody-mcp --locked
```

## Quick start

Run the server over the default stdio transport (used by Claude Desktop and
most MCP clients):

```bash
cargo run -p aphrody-mcp
```

Then point your MCP client at the binary. Example `mcp.json` snippet:

```json
{
  "mcpServers": {
    "aphrody": { "command": "aphrody-mcp" }
  }
}
```

## Exposed tools

The registry is assembled from feature-gated Rust modules and internal
providers. `tools/list` from the running binary is the exact catalog; tool names
and schemas can change with enabled features. Web's native crawl tool is
`aphrody_web_crawl` and is served by this MCP or proxied by the unified kernel.

### Crawl limits

`aphrody_web_crawl` validates HTTP(S) seed URLs, caps input URLs and allowed
domains at 100, bounds depth, request count and concurrency, and obeys robots
by default. Call execution has a 120-second budget. The response returns at
most 100 pages (default 50) and 50 errors, with counts and truncation flags.
Use `resultLimit` to request fewer pages. These limits bound the MCP response;
`maxRequests` controls crawl work. Persistent SQLite frontier paths should be
provided only when the caller intends to retain crawl state.

### Dragon Ball tools

The `dragonball.*` tools left with the Shenron product: they are served by
`shenron-mcp` (`shenron:crates/shenron-mcp` in
[aphrody-labs/shenron](https://github.com/aphrody-labs/shenron)). This server keeps
only the Aphrody AI gateway Shenron calls (`/api/v1/shenron/*`, below).

## Transports

`stdio` is the default (line-delimited JSON-RPC over `stdin`/`stdout`). To run
the same tool catalog using the official RMCP Streamable HTTP transport:

```bash
aphrody-mcp http --bind 127.0.0.1:8789
```

The endpoint is `http://127.0.0.1:8789/mcp`. The bind address must be loopback;
the HTTP transport is for local clients or an authenticated, tool-filtering
gateway. Its default session mode may return SSE and `Mcp-Session-Id`; a gateway
must forward the MCP session and protocol headers and stream response bodies.

### Authentication of `/mcp`

`/mcp` exposes every tool, so it answers only to `Authorization: Bearer <token>`. The token is read once at start from
`APHRODY_MCP_HTTP_TOKEN`, else from the AI HTTP token (`APHRODY_AI_HTTP_TOKEN`, alias `APHRODY_SHENRON_API_TOKEN`), so a
gateway that already injects that bearer keeps working; the dedicated name scopes `/mcp` apart from the REST bridge. It
must be at least 32 bytes (`openssl rand -hex 32`) and belongs in a host `EnvironmentFile`, never in a repository or a
command line. Without a usable token `/mcp` answers 503 (fail-closed); a missing or wrong header is 401; the comparison is
constant time. `/healthz` and the REST routes are outside this layer. A client reads the token from its environment, for
example in a `.mcp.json`:

```json
{ "mcpServers": { "aphrody-http": { "type": "http", "url": "http://127.0.0.1:8793/mcp",
  "headers": { "Authorization": "Bearer ${APHRODY_MCP_HTTP_TOKEN}" } } } }
```

`bun scripts/tools/infra/mcp-tools-count.ts <url> --token-env APHRODY_MCP_HTTP_TOKEN` counts the tools of a running server.

### Shenron AI REST bridge

The same loopback listener serves `/api/v1/shenron/*`. Set a non-empty
`APHRODY_SHENRON_API_TOKEN` and send it as `Authorization: Bearer <token>` on
every request. An unset token returns HTTP 503; a missing or incorrect header
returns 401. Keep this listener private and apply authentication on any gateway.

| Route | Request | Response |
| --- | --- | --- |
| `GET /api/v1/shenron/health` | None | `{status, capabilities:{rag,llm,ocr}}` |
| `GET /api/v1/shenron/rag/search?q=...&limit=5` | Optional `lang`, `kind`, `sourceId`, `entity`; `limit` capped at 20 | `{mode:"lexical",results:[{sourceId,originSourceId,title,url,snippet,content,contentTruncated,score,kind,lang,entity}]}` |
| `GET /api/v1/shenron/rag/document?sourceId=shenron:<rowid>` | Original SQLite chunk identifier | `{document:{sourceId,title,url,kind,snippet,entity,originSourceId}}` or 404 |
| `GET /api/v1/shenron/rag/stats` | None | `{chunks,vectors:0,sources:[{sourceId,kind,count}]}`; active documents only |
| `POST /api/v1/shenron/rag/ingest` | `{sourceId,title,url,content,kind?,lang?,originSourceId?,entity?,syncGeneration?}` | `{id,sourceId,indexed:true,retrieval:"lexical"}` |
| `POST /api/v1/shenron/rag/sync/finish` | `{originSourceId,syncGeneration,expectedCount}` | `{status:"complete",active,retired}` after count verification and logical retirement |
| `POST /api/v1/shenron/embed` | `{texts:[...],kind:"query"|"passage"}` | `{vectors,model}` from a configured embedding backend |
| `POST /api/v1/shenron/llm/chat` | `{messages:[{role,content}],model?}` | `{answer,model}` |
| `POST /api/v1/shenron/ocr` | `{image_base64,language?,engine?,model?,include_geometry?}` | `{text,language,languageApplied:false,textless,suspect,findings,model,elapsed_ms,blocks?,quality?}` |
| `POST /api/v1/shenron/vision/structured` | `{image_base64,image_mime,prompt,model?,reasoning_effort?}` | `{result,model}`; `result` is parsed JSON from the vision backend |

RAG uses `APHRODY_MCP_DATABASE_URL` and writes `corpus='shenron'` in
`aphrody_rag_documents`. Search also reads the existing `dragonball_shenron`
corpus. A Shenron SQLite chunk can use `sourceId:"shenron:<rowid>"` for stable,
idempotent export. Its original `rag_chunks.source_id` goes in `originSourceId`.
`kind`, `lang`, `originSourceId` and `entity` are stored in document metadata.
Search filters use exact metadata equality; older records without these keys
cannot match the corresponding filter. Retrieval is lexical, with title, URL,
content and document type contributing to the score. Returned URLs are
deduplicated while distinct manga pages remain separate. `content` carries at
most 8192 characters per hit, enough for Shenron's default 6000-character
citation context. Scores are not vector similarity. Ingestion does not generate
vector chunks. A completed source generation marks its older documents
`metadata.visible=false`; they remain stored and are excluded from search and
statistics. The embedding route requires `APHRODY_SHENRON_EMBED_MODEL` and an
OpenAI-compatible `/embeddings` backend at `APHRODY_SHENRON_EMBED_BASE_URL`
(defaulting to the LLM backend URL). The LLM route uses an
OpenAI-compatible server at `APHRODY_SHENRON_LLM_BASE_URL` (default
`http://127.0.0.1:8080/v1`); `APHRODY_SHENRON_LLM_MODEL` defaults to `local`.
OCR needs a binary built with `--features ocr`; `image_base64` is raw padded
base64, without a data URL prefix. The `language` field is returned to the
caller but is not applied to the Aphrody OCR engine. OCR preserves textless and
suspect results so a caller can hold back an uncertain transcription.
The OCR route accepts a 24 MiB JSON request body and the OCR engine accepts at
most 16 MiB decoded image bytes. Set `engine:"ppocr"` and
`include_geometry:true` to receive original-pixel polygons and confidence
scores; this is the geometry contract used by Shenron's manga batches.
The Aphrody CLI `ocr audit` reads both v2 OCR records and historical JSONL;
it refuses malformed records and pages marked unreadable or needing review.
The vision route sends the image and prompt to the OpenAI-compatible backend
at `APHRODY_SHENRON_VISION_BASE_URL` (defaults to the Shenron LLM backend URL).
Set `APHRODY_SHENRON_VISION_MODEL` to a model that accepts images and returns
JSON. Shenron's manga reviewer requests `gpt-5.6-luna` and `low` reasoning;
the backend must return that model identifier. The caller validates the
structured review and independent coverage audit before editorial deposit.

The same implementation is available to trusted local MCP clients as
`aphrody_shenron_rag_search`, `aphrody_shenron_rag_ingest`, and
`aphrody_shenron_llm_chat`; `aphrody_shenron_ocr` is present only with the
`ocr` feature. MCP calls use the local process authority and do not need the
REST Bearer token. These tools operate the Aphrody AI backend; editorial DBFR
commands remain in Shenron.

## Cross-platform

Linux (cible #1) and Windows 11 Canary are fully supported. Windows-only tools
(`auth_extract`, `chrome_autopsy`) return an explicit `unsupported` message on
Linux instead of failing the request, so an agent can probe capability cleanly.

## License

Apache-2.0. Copyright aphrody-code contributors.

## Related

- `aphrody` — the CLI binary that consumes the same `backend` primitives.
- `a2a` / `a2a-client` / `a2a-server` — peer-to-peer agent protocol used in
  parallel with MCP for cross-agent coordination.
- `rmcp` — upstream Rust SDK powering the tool router and stdio transport.
