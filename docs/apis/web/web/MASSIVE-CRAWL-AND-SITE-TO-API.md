# Aphrody Web Massive Crawler & Site-to-API Synthesis Engine

Aphrody Web provides a high-throughput, 24/7 autonomous web crawler and an Apify-compatible Actor architecture that transforms arbitrary websites into typed, navigable OpenAPI 3.1 REST APIs.

---

## 1. Massive 24/7 Crawler Architecture

The crawler engine (`src/crawler/MassiveCrawler.ts`) is designed for continuous, high-concurrency indexing without subprocess churn or memory bloat:

```
                          ┌──────────────────────────┐
                          │  Persistent RequestQueue │ (SQLite WAL)
                          └─────────────┬────────────┘
                                        │ batch dequeue (up to 32)
                                        ▼
                          ┌──────────────────────────┐
                          │ Sliding-Window Limiter   │ (per-host politeness)
                          └─────────────┬────────────┘
                                        │
             ┌──────────────────────────┼──────────────────────────┐
             ▼                          ▼                          ▼
     Tier 1: Fast HTTP          Tier 2: Native FFI         Tier 3: Stealth CDP
  (curl-impersonate / Bun)     (lol_html / obscura_dom)   (Lightpanda / Patchright)
             │                          │                          │
             └──────────────────────────┼──────────────────────────┘
                                        ▼
                          ┌──────────────────────────┐
                          │  BxcDB Storage & Vector  │ (FTS5 BM25 + Embeddings)
                          └─────────────┬────────────┘
                                        │
                                        ▼
                          ┌──────────────────────────┐
                          │   Dataset Export / API   │ (SQLite / Postgres / REST)
                          └──────────────────────────┘
```

### Key Components

- **`WorkerPool` (`src/crawler/WorkerPool.ts`)**: Manages long-lived Bun worker threads communicating over `MessageChannel`, eliminating per-page process fork overhead.
- **`RateLimiter`**: Sliding-window rate limiter preventing IP bans through host-level politeness (per-second and per-minute sliding counters).
- **Multi-tiered extraction**:
  1. *Tier 1*: High-speed HTTP request with browser TLS fingerprinting (`chrome131`).
  2. *Tier 2*: In-process HTML parsing and link extraction via Rust (`lol_html`, `obscura_dom`, `url` normalization).
  3. *Tier 3*: Automatic escalation to full CDP JavaScript execution when bot protection or client-side rendering is detected.
- **Memory management**: Automated soft garbage collection (`Bun.gc(false)`) and WAL checkpoints preventing memory fragmentation during long-running crawls.

---

## 2. CLI Usage: `aphrody web crawl`

The unified crawl CLI provides flexible flags for both ad-hoc mirroring and continuous 24/7 indexing:

```bash
# Continuous 24/7 massive crawl with direct SQLite FTS5 index
aphrody web crawl --massive --daemon --sqlite ./web-index.sqlite https://news.ycombinator.com

# Multi-worker browser crawl with 16 parallel threads
aphrody web crawl --workers --concurrency 16 https://example.org

# Crawl with custom RequestQueue and PostgreSQL ingest
aphrody web crawl --massive --postgres postgresql://user:pass@localhost:5432/aphrody https://en.wikipedia.org
```

### Options

| Flag | Description | Default |
| --- | --- | --- |
| `--massive` | Enable 24/7 multi-tiered engine with rate limiting | `false` |
| `--workers` | Use persistent worker thread pool | `false` |
| `--daemon` | Continuous daemon mode (polls queue when empty) | `false` |
| `--concurrency <N>` | Maximum parallel requests | `10` (standard) / `50` (massive) |
| `--max-depth <N>` | Maximum link recursion depth | `5` |
| `--max-requests <N>` | Total request limit | `Infinity` |
| `--profile <p>` | `static` \| `http` \| `fast` \| `stealth` \| `max` | `stealth` |
| `--sqlite <path>` | Direct SQLite destination with FTS5 table | `undefined` |
| `--postgres <url>` | PostgreSQL database connection URL | `undefined` |
| `--queue <name>` | Persistent RequestQueue frontier name | `default` |

---

## 3. Dataset Export: `aphrody web export`

Export collected datasets from SQLite, memory, or disk to relational databases, search engines, or static files:

```bash
# Export to SQLite with full-text search (FTS5) and triggers
aphrody web export default --to sqlite --out ./crawled_data.sqlite

# Export to PostgreSQL with ON CONFLICT (url) DO UPDATE
aphrody web export default --to postgres --pg-url "$APHRODY_DATABASE_URL"

# Export to JSON, CSV, or HTML
aphrody web export products --to json --out ./products.json
aphrody web export articles --to csv --out ./articles.csv
aphrody web export report --to html --out ./report.html
```

---

## 4. Apify-Compatible Actor: `site-to-api`

Located at `src/actors/site-to-api/`, this Actor transforms any crawled website into a typed, navigable REST API compliant with **OpenAPI 3.1.0** and **JSON Schema Draft 2020-12**.

### Running the Actor

```bash
# Run locally using aphrody web actor CLI
aphrody web actor run src/actors/site-to-api --input '{
  "startUrls": ["https://news.ycombinator.com"],
  "maxPages": 10,
  "maxDepth": 2,
  "openApiVersion": "3.1.0",
  "exportSqlite": true,
  "serve": true,
  "port": 3456
}'
```

### Multi-Layered Extraction Pipeline (`src/utils/structured.ts`)

1. **JSON-LD**: Multi-script extraction with `@graph` resolution, trailing comma cleanup, and CDATA stripping.
2. **W3C Microdata**: Recursive extraction of `itemscope` and typed `itemprop` (`Schema.org/Product`, `Article`, `Recipe`, etc.).
3. **OpenGraph & Twitter Cards**: Title, description, canonical URL, images, and price metadata.
4. **HTML Tables**: Automatic parsing of table headers and data rows into structured JSON record arrays.
5. **Feed & Card Heuristics**: Automatic detection of listing items (`tr.athing`, `.product-card`, `article`).

### Dynamic OpenAPI 3.1 & REST Server (`src/utils/openapi.ts`)

The Actor synthesizes a domain OpenAPI specification and launches an **Elysia** HTTP server exposing:

- `GET /api/items`: Paginated collection of extracted entities (`?limit=&offset=`).
- `GET /api/items/:id`: Individual item retrieval by ID or URL hash.
- `GET /api/pages`: Raw crawled page metadata, title, and markdown approximation.
- `GET /api/tables`: Structured tabular datasets extracted from HTML tables.
- `GET /api/search?q=`: Full-text search over extracted content.
- `GET /openapi.json`: OpenAPI 3.1.0 specification.
- `GET /docs`: Interactive Swagger UI documentation.

---

## 5. MCP Tools

The stdio MCP server (`aphrody web mcp`) exposes these capabilities directly to AI agents:

| MCP Tool | Description |
| --- | --- |
| `aphrody_crawl_massive` | Launches continuous or bounded multi-tiered crawl with SQLite/Postgres persistence. |
| `aphrody_export_dataset` | Exports crawled datasets to SQLite (with FTS5), PostgreSQL, JSON, CSV, or HTML. |
| `aphrody_actor_run` | Executes Apify-compatible Actors in isolated runtime environments. |
