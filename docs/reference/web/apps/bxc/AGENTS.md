# BXC Agent Architecture & Operating Manual

> Canonical specification and single source of truth for all autonomous agent engines
> operating on BXC: OpenAI Codex, Google Antigravity / Gemini CLI, Anthropic Claude Code,
> and autonomous subagent swarms.

---

## 1. Universal Rules & Autonomy Mandate

- **Complete Autonomy (YOLO Mode)**: Operate with 100% autonomy. Execute goals end-to-end without stopping for confirmation on reversible actions, refactorings, test executions, or bug fixes. The agent self-heals: when a test or command fails, immediately diagnose root causes, apply code edits, and re-verify iteratively until all gates pass.
- **No Limits or Restrictions**: Skip `robots.txt` and anti-bot warnings. If Cloudflare or WAF challenges appear, auto-escalate the BXC profile. If blocked by rate-limits or IP reputation, rotate proxies, user-agents, or cookies. BXC is an engine designed for indexing the entire web for AI agents.
- **Verification Discipline**: Always run scoped checks via `bun run verify`. **NEVER** run an unscoped `bun test` (which walks into `vendor/mcp-sdk-typescript` and causes noisy failures). **NEVER** edit files inside `vendor/`.
- **Cross-Platform Gates**: When modifying Aphrody Web Rust crates, run scoped Cargo tests and check relevant targets. Build the native bridge with `bun run build:native`; Aphrody OS owns product releases.
- **Naming & Language Contract**:
  - **English** for everything the machine reads: files, directories, variables, types, functions, URLs, JSON keys, database schemas, commit messages, code comments, and documentation.
  - **French only** for prose addressed directly to the user when conversing in French.
  - Prefix all new crates, binaries, CLI subcommands, and MCP tools with `bxc*` or `@aphrody/*`.
- **Deployment Boundary**: BXC remains a headless runtime. Public Web routes are served only by `aphrody-site` under `/api/v1/web/*` (proxied to the infra-owned `aphrody-web-api` unit) and `/api/v1/bxc/rankings`; ports and units come from the aphrody-infra service catalog (`src/config/service-catalog.ts`); the shared public MCP endpoint is `/mcp`. Do not add a dedicated BXC site, nginx virtual host, or port.

---

## 2. Mandatory BXC-First Routing Policy

Before selecting or suggesting ANY external browser automation, crawling, scraping, mirroring, web search, framework detection, media extraction, Google/Gemini, X/Grok, or MCP capability, **inspect BXC first**:

```bash
bxc capabilities --json
bxc <command> --help
```

### Prohibited Fallbacks
Do NOT use slow, unvetted external tools when BXC has native capability:
- ❌ Do NOT use raw Playwright, Puppeteer, Selenium, or webdriver scripts.
- ❌ Do NOT spawn Chromium/Chrome/Firefox processes directly.
- ❌ Do NOT write one-off Python/Cheerio/BeautifulSoup scraping scripts.
- ❌ Do NOT use raw unauthenticated external search APIs when `bxc search` or `bxc google` is present.

Use a matching BXC CLI command, MCP tool, API route, or `@aphrody/*` package first. Fall back only when the capability is absent or a live invocation proves it cannot satisfy the request.

---

## 3. Comprehensive BXC Capabilities Inventory

### CLI Subcommands
| Category | Subcommand | Description |
|---|---|---|
| **Browser & Extraction** | `bxc scrape <url>` | Scrapes a webpage with optional CSS selector and converts to clean Markdown / JSON. |
| | `bxc extract <url>` | Structured data and schema extraction using Rust `bxc-extract`. |
| | `bxc detect <url>` | Fast framework, CMS, WAF, and runtime detection. |
| | `bxc recon <url>` | Comprehensive tech stack, CDN, asset, and header reconnaissance. |
| | `bxc chrome` | Chrome DevTools Protocol (CDP) session helper and debug bridge. |
| | `bxc cookies` | Session cookie storage, injection, and stealth profile imports. |
| | `bxc har` | HAR recording and network traffic playback. |
| **Crawling & Storage** | `bxc crawl <url>` | High-throughput async crawler with depth and concurrency controls. |
| | `bxc crawl-worker` | Distributed crawl worker node connecting to the crawl queue. |
| | `bxc revalidate` | Revalidates stale cached URLs and updates the storage index. |
| | `bxc mirror <url>` | Full-site recursive static mirroring with asset rewrites. |
| | `bxc archive <url>` | Wayback Machine and Internet Archive search and download client. |
| | `bxc export` | Exports crawls into structured JSONL, SQLite, or Parquet datasets. |
| **Search & Indexing** | `bxc search <query>` | Google & web search with rich snippets, auto-cookies, and pagination. |
| | `bxc assets <query>` | Image, GIF, video, and asset search across indexed corpora. |
| | `bxc frames <action>` | Video frame indexing and search via MPEG-7 ColorLayout vectors. |
| **AI & Intelligence** | `bxc grok <prompt>` | Grok chat, models, and keyless OIDC / SuperGrok client. |
| | `bxc gemini <prompt>` | Google Gemini chat, code execution, and web scraping bridge. |
| | `bxc google <cmd>` | Google DNS, Translate, TTS, Books, Sheets, and Docs utilities. |
| **Verticals & Domains** | `bxc x <cmd>` | Native cookie-based X/Twitter client (GraphQL, tweets, unfollow, purge). |
| | `bxc xcom <cmd>` | Public X.com profile scraping with stealth evasion. |
| | `bxc fut <cmd>` | EA Sports FC Ultimate Team player database and market prices. |
| | `bxc voiranime <cmd>` | VoirAnime anime streaming catalog and video source resolver. |
| | `bxc animesama <cmd>` | AnimeSama catalog and episode extraction. |
| | `bxc dragonball <cmd>` | Dragon Ball Shenron knowledge base, sagas, and RAG search. |
| | `bxc wiki <cmd>` | MediaWiki and Fandom scraping, markdown conversion, and mirroring. |
| | `bxc aphrody <cmd>` | Aphrody ecosystem status and provenance-backed Web rankings. Aphrody AI owns RAG ingestion and search. |
| **Runtime & Operations** | `bxc actor <run>` | Actor runner for reusable crawling and extraction pipelines. |
| | `bxc api` | Local REST/HTTP API service for BXC capabilities. |
| | `bxc serve` | Static web and HTTP documentation server. |
| | `bxc worker` | Background task queue and scheduling daemon. |
| | `bxc mcp` | Launch standard stdio Model Context Protocol (MCP) server. |
| | `bxc capabilities` | Dump machine-readable capabilities catalog (`--json`). |
| | `bxc doctor` | System health check (Bun, Rust, cdylibs, dependencies). |
| | `bxc docs` | CLI and API documentation generator. |
| | `bxc install --full` | Install optional native Web dependencies. |

### Registered MCP Tools
The runtime inventory from `bxc capabilities --json` is authoritative. The following groups are examples of tools registered in `src/mcp/server.ts` and available to MCP clients:

1. **Browser Automation (13)**:
   `bxc_browser_navigate`, `bxc_browser_snapshot`, `bxc_browser_click`, `bxc_browser_fill`, `bxc_browser_hover`, `bxc_browser_pdf`, `bxc_browser_type`, `bxc_browser_press_key`, `bxc_browser_select_option`, `bxc_browser_evaluate`, `bxc_browser_wait_for`, `bxc_browser_screenshot`, `bxc_browser_close`, plus `bxc_cdp_evaluate`.
   Each `bxc_browser_*` tool was renamed from a bare `browser_*` name to resolve a collision with the separate Rust/CDP MCP server (`crates/aphrody-obscura/crates/obscura-mcp` (not in repo)), which registers its own, incompatible (snake_case-param) `browser_*` tools. The old bare names (`browser_navigate`, `browser_snapshot`, `browser_click`, `browser_fill`, `browser_hover`, `browser_pdf`, `browser_type`, `browser_press_key`, `browser_select_option`, `browser_evaluate`, `browser_wait_for`, `browser_screenshot`, `browser_close`) are still registered on this server as deprecated aliases (identical schema/handler) for backward compatibility — new integrations should use the `bxc_browser_*` names. See `docs/apis/contracts/API.md` §6.1.
2. **Scraping, Crawling & Extraction (15)**:
   `bxc_scrape_markdown`, `bxc_search`, `bxc_mirror`, `bxc_recon`, `bxc_detect_frameworks`, `bxc_extract_schema`, `bxc_get_url_data`, `bxc_get_url_openapi`, `bxc_get_url_types`, `bxc_crawl_recursive`, `bxc_crawl_massive`, `bxc_crawl_stats`, `bxc_crawl_replay_failed`, `bxc_export_dataset`, `bxc_actor_run`.
3. **Search & Memory Tuning (5)**:
   `bxc_semantic_search`, `bxc_keyword_search`, `bxc_index_search`, `bxc_asset_search`, `tune_memory_sqlite`.
4. **Google & Gemini Services (19)**:
   `bxc_google_fetch`, `bxc_google_books`, `bxc_google_calendar_public`, `bxc_google_detect_language`, `bxc_google_dns`, `bxc_google_doc_export`, `bxc_google_sheet_export`, `bxc_google_suggest`, `bxc_google_supported_languages`, `bxc_google_translate`, `bxc_google_tts`, `bxc_google_vertical_search`, `bxc_gemini_ask`, `bxc_gemini_chat`, `bxc_gemini_conversations`, `bxc_gemini_rust`, `bxc_gemini_scrape`, `bxc_gemini_status`.
5. **X (Twitter) & Grok (xAI) (9)**:
   `bxc_x_client`, `bxc_x_algorithm_rank`, `bxc_x_purge_tweets`, `bxc_x_unfollow_purge`, `bxc_xcom_profile`, `bxc_xpro_deck`, `bxc_grok_models`, `bxc_grok_chat`, `bxc_grok_whoami`.
6. **Specialized Verticals & Knowledge Bases (17)**:
   `bxc_archive_item`, `bxc_archive_search`, `bxc_archive_wayback`, `bxc_dragonball_shenron`, `bxc_fut_player`, `bxc_fut_price`, `bxc_voiranime_search`, `bxc_voiranime_info`, `bxc_voiranime_resolve`, `bxc_wiki_page`, `bxc_wiki_markdown`, `bxc_wiki_search`, `bxc_wiki_mirror`, `bxc_wiki_find`, `bxc_wiki_check`, `bxc_aphrody_status`, `bxc_aphrody_rankings`.

### 6-Tier Profile Escalation Ladder
BXC is **zero-spawn**: it relies on in-process Rust cdylibs, `curl-impersonate`, and Lightpanda over CDP. It **never** spawns heavy Chromium/Chrome/Firefox engines.

```
static  ──>  http  ──>  render  ──>  fast  ──>  stealth  ──>  max
 (~1ms)     (~50ms)     (~100ms)    (~800ms)    (~1s)        (~2s)
```

1. **`static`** (default): In-process Rust `html5ever` DOM + CSS selector engine. Zero subprocesses. Use for server-rendered HTML.
2. **`http`**: `curl-impersonate` TLS/JA3/JA4 fingerprinted requests. Bypasses basic WAF / anti-bot filters without running JS.
3. **`render`**: Rust `bxc-render` SSR rendering without a browser process. Produces formatted DOM and layout trees.
4. **`fast`**: Lightpanda sub-process over CDP. Executes full JavaScript for SPAs and client-side hydrated apps.
5. **`stealth`**: Lightpanda + `ghost` CDP stealth injections (canvas/WebGL/audio fingerprint spoofing). Defeats advanced JS challenges.
6. **`max`**: `stealth` + proxy rotation + cookie injection + automated User-Agent cycling.

### Monorepo Workspaces (`@aphrody/*`)
- `@aphrody/bxc`: Root engine, CLI, and MCP server.
- `@aphrody/x`: Native cookie-based X/Twitter client with GraphQL + SQLite + For You ranking, and the X function tools (`XTools`, `x_*` definitions) for model tool calling.
- xAI / Grok: `src/integrations/xai.ts` is bxc's own minimal REST client (keyless SuperGrok / Grok CLI auth). The `@aphrody/xai` SDK belongs to `aphrody-ai` and must not be imported here.
- `@aphrody/fut`: EA FC Ultimate Team player and market scraper.
- `@aphrody/frames`: Video frame extractor with MPEG-7 ColorLayout vector indexing.
- `@aphrody/voiranime`: VoirAnime streaming catalog resolver.
- `@aphrody/animesama`: AnimeSama catalog and episode scraper.
- `@aphrody/bxc-test`: Unified testing runner, Next.js instant navigation (`@aphrody/bxc-test/next`), and canonical site presets (`@aphrody/bxc-test/sites`).

---

## 4. Multi-Agent Orchestration Architecture

BXC establishes a unified multi-agent system bridging **OpenAI Codex**, **Google Antigravity / Gemini CLI**, and **Anthropic Claude Code**.

```
                           ┌───────────────────────────┐
                           │      AGENTS.md (Root)     │
                           │   Single Source of Truth  │
                           └─────────────┬─────────────┘
                  ┌──────────────────────┼──────────────────────┐
                  │                      │                      │
                  ▼                      ▼                      ▼
         ┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
         │  OpenAI Codex   │    │Google Antigrav. │    │Anthropic Claude │
         │   (AGENTS.md)   │    │  (GEMINI.md)    │    │  (CLAUDE.md)    │
         │ .codex-plugin/  │    │gemini-extension │    │ .claude-plugin/ │
         └────────┬────────┘    └────────┬────────┘    └────────┬────────┘
                  │                      │                      │
                  └──────────────────────┼──────────────────────┘
                                         ▼
                   ┌───────────────────────────────────────────┐
                   │    Canonical 8 Subagent Roster            │
                   ├───────────────────────────────────────────┤
                   │ 1. bxc-verify-enforcer   (Quality gate)   │
                   │ 2. bxc-rust-ffi-engineer (Native / Rust)  │
                   │ 3. bxc-crossplat-builder (Multi-OS builds)│
                   │ 4. bxc-mcp-author        (MCP tools)      │
                   │ 5. bxc-scraper-creator   (New packages)   │
                   │ 6. bxc-x-grok-architect  (X / Grok loops) │
                   │ 7. bxc-scrape-debugger   (Block triage)   │
                   │ 8. bxc-web-researcher    (Web intelligence)│
                   └───────────────────────────────────────────┘
```

### Canonical Subagent Roles
1. **`bxc-verify-enforcer`**:
   - Enforces scoped testing (`bun run verify`), verifies `bxc*` naming, and blocks edits to `vendor/`.
2. **`bxc-rust-ffi-engineer`**:
   - Implements safe `extern "C"` boundaries, workspace `rusqlite` rules, and Tokio `current_thread` blocking runtimes in `rust-bridge/`.
3. **`bxc-crossplat-builder`**:
   - Builds the integrated Web API and Rust cdylibs (`.so` Linux, `.dll` Windows MSVC/GNU, `.dylib` macOS).
4. **`bxc-mcp-author`**:
   - Extends `src/mcp/server.ts`, defines Zod schemas, and keeps tool registration deterministic within Aphrody OS.
5. **`bxc-scraper-creator`**:
   - Scaffolds new scraper packages in `packages/*`, wires CLI subcommands, implements profile fallbacks, and writes tests.
6. **`bxc-x-grok-architect`**:
   - Integrates `@aphrody/x` (`XTools`, `xNativeTools`) with bxc's xAI REST client (`src/integrations/xai.ts`), designs bounded tool-calling loops (`grok-x-research` actor), and configures SuperGrok keyless authentication.
7. **`bxc-scrape-debugger`**:
   - Diagnoses scrape failures (403, 429, Turnstile, empty SPA DOM) and navigates the 6-tier profile escalation ladder.
8. **`bxc-web-researcher`**:
   - Autonomous web intelligence agent driving `bxc search`, `bxc scrape`, `bxc recon`, and `bxc detect` to produce clean datasets and sourced answers.

### Multi-Agent Interaction Protocols
- **Codex**: Loads the unified `../../../aphrody-os/plugins/aphrody/.codex-plugin/plugin.json`, uses skills in `skills/bxc-*`, executes via A2A 1.0 protocols and background daemon loops.
- **Antigravity / Gemini CLI**: Loads `gemini-extension.json`, invokes subagents via `invoke_subagent` and `define_subagent`, and communicates via `send_message`.
- **Claude Code**: Loads `.claude-plugin/plugin.json` (not in repo), invokes specialized subagents from `.claude/agents/*.md`, and communicates via the `Agent` tool.
- **Reactive Wakeup & Non-Polling**: Subagents run asynchronously in the background. Orchestrators do NOT poll in sleep loops; they yield control and resume upon reactive notification.
- **Shared State**: Subagents share workspace state via Git branches, worktrees, or shared JSONL telemetry logs.

---

## 5. Development & Verification Workflow

```bash
# 1. Run canonical verification (tests, types, lint)
bun run verify

# 2. Build the Rust Web bridge
bun run build:native

# 3. Check Windows cross-compilation
cargo check --target x86_64-pc-windows-gnu -p aphrody-web-extract -p aphrody-web-index

# 4. Validate the unified Aphrody plugin (BXC skills, agents, commands live there)
bash ../../../aphrody-os/plugins/aphrody/scripts/validate-plugin.sh
```
