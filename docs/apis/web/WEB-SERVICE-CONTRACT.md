<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody Web service contract

Status: 2026-10-03. Owner: `crates/web` (engine) and `packages/web/agent-browser`
(Bun client). Machine-readable configuration:
[`tools/config/web.json`](../../../tools/config/web.json). Architecture and consumers:
[`docs/architecture/web/ARCHITECTURE.md`](../../architecture/web/ARCHITECTURE.md).

Every product interface that needs the web (Shenron, RG, Achillea, Koharu, the
CLI, the kernel/OS, desktop apps) reaches it through one of the four surfaces
below. They all execute the same engine: Obscura (HTML5 parser, V8, CDP) wrapped
by `aphrody-web-service`, with `aphrody-web-extract` as the single content
extractor. Product code must not add its own scraper, headless Chrome driver or
HTML parser for remote pages.

## Capability map

| Capability               | CLI (`aphrody-web`)                       | Bun (`@aphrody/agent-browser/service`) | MCP (`aphrody-mcp`, feature `native-browser`) | Rust                                   |
| ------------------------ | ----------------------------------------- | --------------------------------------- | --------------------------------------------- | -------------------------------------- |
| Fetch a rendered page    | `fetch URL --dump html\|text\|links`      | `service.fetch(url, { dump })`          | `aphrody_browser_navigate`                    | `WebSession::call("browser_navigate")` |
| Markdown                 | `fetch URL --dump markdown`               | `service.markdown(url)`                 | `aphrody_browser_markdown`                    | `aphrody_web_service::html_to_markdown` |
| Extract (main content)   | `fetch URL --dump artifact`               | `service.artifact(url)`                 | `aphrody_web_extract_html`                    | `aphrody_web_service::page_artifact`   |
| Scrape many URLs         | `scrape URL... --format json`             | `service.scrape(urls)`                  | n/a                                           | `aphrody-web-worker` processes         |
| Crawl                    | `crawl SEED... --format json`             | `service.crawl(seeds, opts)`            | `aphrody_web_crawl`                           | `aphrody_web_crawl::crawl_bounded`     |
| Screenshot / PDF         | CDP `Page.captureScreenshot`, `printToPDF` | `service.screenshot(url)`, `page.pdf()` | `aphrody_browser_screenshot`, `_pdf`          | `obscura-render` (feature `render`)    |
| DOM query                | `fetch URL --selector S --eval JS`        | `service.query(url, selector)`          | `aphrody_browser_extract`, `_count`, `_links` | `obscura-dom`                          |
| CDP session              | `launch --port P`                         | `service.session(url)`, `service.cdp()` | n/a                                           | `obscura-cdp`                          |
| Test run                 | n/a                                       | `@aphrody/web-test` (`bun test`)        | n/a                                           | n/a                                    |

## 1. CLI: `aphrody-web`

Package `aphrody-web-engine`, binaries `aphrody-web` and `aphrody-web-worker`
(the worker must sit next to `aphrody-web` for `scrape`). Build:
`cargo build -p aphrody-web-engine` (default feature `render`).

| Subcommand           | Purpose and stable flags                                                                                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `launch` (`serve`)   | CDP server. `--host 127.0.0.1` `--port 9222` `--workers N` `--stealth` `--proxy URL` `--user-agent UA` `--allow-file-access`. Prints `ws://HOST:PORT/devtools/browser` on stdout as its first line. SIGINT/SIGTERM stop it (and, with `--workers`, every worker process).             |
| `fetch URL`          | `--dump html\|text\|links\|markdown\|artifact\|original` `--selector CSS` `--eval JS` `--wait SECS` `--timeout SECS` `--wait-until load\|domcontentloaded\|networkidle0` `--stealth` `--quiet` `-o FILE`. `original` streams the raw body and never runs the page.                       |
| `scrape URL...`      | `--concurrency N` `--format json` `--timeout SECS` `--eval JS` `--quiet`. One worker process per URL, bounded by a semaphore.                                                                                                                                                           |
| `crawl SEED...`      | `--max-depth 2` `--max-pages 25` `--concurrency 4` `--allowed-domain HOST` (default: seed hosts) `--obey-robots` `--sitemaps` `--delay-ms N` `--timeout SECS` `--user-agent UA` `--allow-private-network` `--include-html\|markdown\|links` `--format json\|ndjson\|markdown` `-o FILE`. |
| `chrome-path`        | Reports `APHRODY_WEB_CHROME_BIN`/`CHROME_PATH`; the headless engine itself needs no Chrome.                                                                                                                                                                                             |
| global               | `--proxy URL` `--v8-flags FLAGS` `--verbose`.                                                                                                                                                                                                                                           |

`crawl` uses the static Obscura HTTP stack (no V8), so its output is exactly
what a native crawler or an LLM agent sees in the initial HTML. It exits
non-zero when no page could be crawled. Its JSON report
(`schema: "aphrody-web.crawl/1"`) has `pages[]` (`url`, `depth`, `status`,
`contentType`, `title`, `lang`, `canonical`, `description`, `wordCount`,
`textChars`, `markdownChars`, `bytes`, `duplicate`, `discoveredLinks`, optional
`links`, `markdown`, `html`), `errors[]` and `stats{}`. A breaking change bumps
the schema suffix.

## 2. CDP

`ws://HOST:PORT/devtools/browser` plus the HTTP discovery endpoints
`/json/version`, `/json/list`, `/json/protocol`. Domains implemented by
`obscura-cdp`: Accessibility, Browser, DOM, DOMSnapshot, Emulation, Fetch, Input,
IO, LP, Network, Page, PDF, Runtime, Storage, Target. One connection owns one
target. `OBSCURA_CDP_TOKEN` (at least 32 bytes) makes the server require a
bearer token; `Host` headers are validated. Loopback and private addresses are
refused as navigation targets unless `OBSCURA_ALLOW_PRIVATE_NETWORK=1` (tests,
local fixtures). `file://` is refused unless `--allow-file-access`.

## 3. MCP

`aphrody-mcp` (crate `crates/ai/mcp`, default feature `native-browser`) publishes
every Obscura browser tool as `aphrody_browser_*` (35 tools, 37 with `render`),
run in-process through `aphrody_web_service::WebSession` on one dedicated
thread with a 180 s call timeout and one shared page. Environment:
`APHRODY_BROWSER_PROXY`, `APHRODY_BROWSER_STEALTH`, `APHRODY_MCP_NO_WEB`.
Additional web tools: `aphrody_web_crawl` (robots on by default),
`universal_web_fetch`, `aphrody_web_extract_html`, `aphrody_detect_frameworks`.

Desktop webviews are a separate surface: `aphrody-mcp` publishes
`aphrody_tauri_*` tools for the Aphrody Tauri apps (see
[Tauri debug guide](../../guides/web/TAURI-DEBUG.md)). They are never mixed with
`aphrody_browser_*`, which only drive remote pages.

## 4. Bun client: `@aphrody/agent-browser`

```ts
import { WebService } from "@aphrody/agent-browser/service";

const web = new WebService();               // reads tools/config/web.json, env, then overrides
const md = await web.markdown("https://example.com/");
const report = await web.crawl(["https://example.com/"], { maxPages: 10 });
const page = await web.session("https://example.com/");   // snapshot refs, click, fill, evaluate
await page.close();
await web.close();                            // stops the private engine, if one was started
```

| Module                                | Contents                                                                                                    |
| ------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `@aphrody/agent-browser`              | `AgentBrowser`, `AgentPage`, `WebCdpPage` (CDP client), types.                                              |
| `@aphrody/agent-browser/service`      | `WebService` (fetch, markdown, artifact, scrape, crawl, session, cdp, screenshot, query), argument builders. |
| `@aphrody/agent-browser/engine`       | `startEngine`, `withEngine`, `ensureTestEngine`, `stopAllEngines`: engine lifecycle on an ephemeral port.   |
| `@aphrody/agent-browser/config`       | `loadWebConfig`, `resolveEngineBinary`, typed `tools/config/web.json`.                                            |
| `@aphrody/agent-browser/test-preload` | `bun test` preload that owns one engine per test run and stops it afterwards.                               |
| `@aphrody/web-test`                   | Playwright-compatible `test`, `expect`, locators on the same engine.                                        |

One-shot calls run the CLI with a hard timeout (fetch timeout plus 15 s, crawl
timeout plus 15 s) and raise `WebServiceError` with the exit code and the tail
of stderr. Engine and one-shot calls share the Yolo SDK supervisor through
`@aphrody/runtime-sdk/modules`, with a pinned ABI 1.4+ runtime. Output is raw
bytes, with a lifetime budget of 64 MiB per stream by default. Set
`new WebService({ maxOutputBytes })` to a smaller budget; overflow raises
`WebServiceError` with a null exit code and never returns truncated success.
Timeout and caller abort stop and release the owning child; abort preserves
the original reason. On Unix the runtime also stops descendants in its owned
process group. The SDK joins its native workers before unload.

Interactive calls start one private engine on an ephemeral port
unless `APHRODY_BROWSER_CDP_URL` names a running one.

## Configuration precedence

Defaults, then `tools/config/web.json`, then environment variables, then explicit
options. Binary resolution: `APHRODY_WEB_BIN`, otherwise the most recently built
of `target/debug/aphrody-web` (not in repo), `target/release/aphrody-web` (not in repo) (generated or machine-local artifact; presence depends on the build host) and
`~/.local/bin/aphrody-web`, otherwise `PATH`. Secrets, cookies and browser
profiles are never read from or written to this configuration; the Chromium
cookie reader (`aphrody-web-chromium`) redacts values from `Debug` output.

## Security boundaries

- Navigation inputs are `http`/`https` URLs with a host; `file:`, `data:` and
  custom schemes are rejected (`validate_page_url`).
- SSRF guard: loopback, RFC1918, link-local (including cloud metadata),
  unspecified and unique-local addresses are refused, both for literal hosts and
  after DNS resolution, unless explicitly allowed per process.
- `crawl` stays on the seed hosts unless `--allowed-domain` widens it, and
  honours `robots.txt` with `--obey-robots` (default in `tools/config/web.json`).
- Stealth mode cannot be combined with a SOCKS5 proxy.

## Known limits

- `crawl` does not execute JavaScript; use `fetch` or a CDP session for client
  rendered pages.
- `aphrody-web fetch --dump markdown` converts the live DOM with the native
  extractor; the V8-side converter in `obscura-js` remains for the CDP `LP`
  domain and the Obscura MCP tools.
- `bxc` (Bun x Chrome) is a name of the `aphrody` binary: `bxc <subcommand>` and
  `aphrody bxc <subcommand>` run the unified commands (`aphrody web ...`, `aphrody x`,
  `aphrody google`, `aphrody kernel mcp`) or fail with their replacement; no legacy bridge
  binary is called. The parity table is in
  bxc-n2b-unification-2026-10-05.
