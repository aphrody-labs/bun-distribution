<!-- SPDX-License-Identifier: Apache-2.0 -->

# Aphrody Web layer: architecture, owners, consumers and gaps

Inventory of 2026-10-01, taken from the working tree (not from historical plans).
Contract of the public surfaces: [`docs/apis/web/WEB-SERVICE-CONTRACT.md`](../../apis/web/WEB-SERVICE-CONTRACT.md).
Configuration: [`config/web.json`](../../../config/web.json). Operations:
[`docs/operations/web/AUTOMATION.md`](../../operations/web/AUTOMATION.md).
Guides: [smoke and crawl](../../guides/web/WEB-SMOKE-AND-CRAWL.md),
[debugging Tauri apps](../../guides/web/TAURI-DEBUG.md),
[crawlable UI](../../guides/web/CRAWLABLE-UI.md).

## Layers

```text
 Product interfaces        Shenron    RG / Achillea    Koharu    CLI (apps/cli)    kernel / OS    desktop apps (aphrody-app)
                              |            |              |            |                |                 |
 Access surfaces       -------+------------+--------------+------------+----------------+-----------------+--------
   Bun client           @aphrody/agent-browser  (service, engine, config, cdp)      @aphrody/web-test   @aphrody/x
   MCP                  aphrody-mcp (aphrody_browser_*, aphrody_web_crawl; aphrody_tauri_* desktop webviews)
   CLI                  aphrody-web  launch | fetch | scrape | crawl          aphrody web / bxc  (apps/cli, legacy bridge)
   Rust                 aphrody-web-bridge (fetch, search, session)  aphrody-web-index    (desktop: `WebSubsystem` in crates/ui/app)
                              |
 Service contract      aphrody-web-service   WebSession (JSON tools) | page_artifact | validate_page_url | flags
                              |
 Extraction / crawl    aphrody-web-extract (single extractor)   aphrody-web-crawl (frontier, robots, sitemap)
                       aphrody-web-detect   aphrody-web-chromium (cookie reader, redacted)   (aphrody-web-extract also hosts `media`)
                              |
 Engine (Obscura)      obscura-cdp   obscura-mcp   obscura-browser   obscura-js (V8)   obscura-net   obscura-dom   obscura-render (+ taffy)
                              |
 Native webviews       Tauri 3 + wry (system webview) | tauri-runtime-cef (Koharu)  <-- debug bridge: crates/ui/tauri-wrap `debug` (feature gated)
```

Rules that hold across the layers:

- One engine per role: Obscura/V8 renders remote pages; N2B (OXC) analyses source
  statically; Bun runs tooling; Tauri/wry hosts trusted desktop UI. Remote pages
  never run in the desktop webview, and the desktop webview is never a crawler
  (see `crates/web/web-service/src/lib.rs`).
- One extractor: `aphrody-web-extract` (`extract_main`, `html_to_markdown`).
- One crawl scheduler: `aphrody-web-crawl` (`Frontier`, `crawl_bounded`).
- One configuration file: `config/web.json`.

## Rust crates (`crates/web`)

| Crate (package)                           | Lines of Rust | Role                                                                          | Direct consumers (workspace)                                        |
| ----------------------------------------- | ------------: | ----------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `obscura-render` (+ `taffy`)              |  68 787 / 23 004 | Layout and paint for screenshots/PDF; `taffy` replaces the registry crate by `[patch]` | `obscura-js` (feature `render`)                                     |
| `obscura-js`                              |        29 518 | V8 runtime (deno_core), DOM/fetch/XHR bindings, V8-side Markdown              | `obscura-browser`, `obscura-cdp`, `aphrody-web-engine`              |
| `obscura-cdp`                             |        19 962 | CDP server (Accessibility, DOM, Input, Network, Page, PDF, Runtime, Target, ...) | `aphrody-web-engine`                                                |
| `obscura-browser`                         |        10 548 | Page/context lifecycle, navigation, profiles                                  | `obscura`, `obscura-cdp`, `obscura-mcp`, `aphrody-web-engine`       |
| `obscura-net`                             |         6 035 | HTTP client, SSRF guard, cookies, robots (prefix only)                        | `aphrody-web-crawl`, `aphrody-web-bridge`, engine crates, ai tools  |
| `obscura-dom`                             |         5 136 | html5ever DOM                                                                 | extract, crawl, bridge, service, engine crates                      |
| `obscura-mcp`                             |         3 602 | MCP tool set (35 tools, 37 with `render`); library only, no transport         | `aphrody-web-service` (`aphrody` module)                            |
| `obscura`                                 |         2 188 | Facade over the engine                                                        | `apps/cli`, `aphrody-web-bridge`, `crates/google/google`                |
| `aphrody-web-service`                     |           264 | Service contract: `WebSession`, `page_artifact`, validators                   | `aphrody-web-bridge`, `aphrody-web-engine`, `crates/ai/mcp`         |
| `aphrody-web-engine`                      |         1 421 + crawl | Binaries `aphrody-web` (launch, fetch, scrape, crawl) and `aphrody-web-worker` | none in Cargo; spawned by Bun clients, tests, systemd             |
| `aphrody-web-extract`                     |         5 588 + 1 039 (`media`) | Main-content extraction, Markdown, chunking, SimHash, URL normalisation; `media` module: media candidates, HLS, embed resolution (formerly `aphrody-web-media`) | CLI, crawl, bridge, service, ai mcp/tools, interop ffi |
| `aphrody-web-crawl`                       |         2 026 | SQLite frontier, bounded crawler, robots, sitemap, revisit policy             | `apps/cli`, `crates/ai/mcp`, `aphrody-web-engine`                   |
| `aphrody-web-bridge`                      |         3 764 | Fetch/search/CLI bridge and native session; legacy `bxc` resolution           | `apps/cli`, ai messaging/mcp/mcp-client/tools                       |
| `aphrody-web-index`                       |         4 234 | Page index                                                                    | `crates/interop/ffi` only                                           |
| `aphrody-web-detect`                      |         1 132 | Framework detection                                                           | `apps/cli`, `crates/ai/mcp`                                         |
| `aphrody-web-chromium`                    |           280 | Chromium profile discovery and cookie reader (values redacted from `Debug`)   | `crates/interop/ffi` only                                           |
| `aphrody-x`                               |  7 655 + 326 (`algorithm`) | X (Twitter) client; `algorithm` module: For You ranking (formerly `aphrody-x-algorithm`) | CLI, ai mcp, interop ffi, `@aphrody/x`                              |
| `sd-server` (`drive-server`)              |           774 | Excluded from the workspace; isolated                                         | none                                                                |

Consolidation of 2026-10-01 (Rust workspace, dependency rule: a merge must not add a
dependency to any dependent): `aphrody-web-media` became `aphrody_web_extract::media`,
`aphrody-x-algorithm` became `aphrody_x::algorithm`, and the `aphrody-web` facade crate was
removed (`WebSubsystem` now lives in `crates/ui/app`, its only consumer; the re-exports of
bridge, extract, index, service and `obscura` had no user). Kept separate on purpose:
`aphrody-web-service` (merging it with `aphrody-web-bridge` would give `aphrody-web-engine`
13 third-party packages and the `aphrody-translate`, `aphrody-web-bridge` and `obscura`
crates) and `aphrody-web-chromium` (`rookie-cookies` alone is 182 third-party packages and
only `crates/interop/ffi` needs them; no `crates/web` crate that has other dependents can host
it without giving them 40 to 71 extra packages).

Owner of all of the above: the web domain (`crates/web`). Imported crates
(`obscura-*`, `taffy`) keep upstream names and attribution; `obscura-mcp` keeps the
upstream lint relaxations declared in its manifest.

## Bun packages (`packages/web`)

| Package                | Surface                                                                                                   | Consumers                                                                                              |
| ---------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `@aphrody/agent-browser` | `AgentBrowser`/`AgentPage`/`WebCdpPage` (CDP), `/service`, `/engine`, `/config`, `/test-preload`; bin `agent-browser` | `iecode/packages/rg/cron` (`web-cdp.ts`), `packages/rg/inagle` (not in repo) (`web-cdp.ts`), `@aphrody/web-test`, `config/pipeline.json` |
| `@aphrody/web-test`    | Playwright-compatible runner on the same engine; site presets (Rose Griffon, Shenron, Aphrody UI)         | `config/pipeline.json` only; live audits under `scripts/audit/live` still point at a retired sibling checkout   |
| `@aphrody/x`           | Headless X client, function tools                                                                         | `iecode/packages/rg/cron`, `packages/ai/xai`, `packages/fut/*` (some imports undeclared, see gaps)           |

## Public surfaces

| Surface        | Where                                                                                       | Notes                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| CLI            | `aphrody-web launch\|fetch\|scrape\|crawl\|chrome-path`                                     | `crawl` added 2026-10-01; contract in the API document                                             |
| CDP            | `ws://127.0.0.1:9222/devtools/browser`, `/json/version`, `/json/list`                       | Default port 9222; workers on `port + 1 + i`; tests use an ephemeral port                          |
| MCP (remote)   | `aphrody-mcp` tools `aphrody_browser_*`, `aphrody_web_crawl`, `universal_web_fetch`         | Built from `WebSession::tools()`; wired through `aphrody-kernel mcp` (plugin `plugins/aphrody`)    |
| MCP (desktop)  | `aphrody-mcp`: 14 `aphrody_tauri_*`/`aphrody_webview_*` tools, forwarded to the per-user kernel | Only the Aphrody apps that register `TauriWebviewSubsystem`; see the Tauri debug guide             |
| Rust           | `aphrody_web_service::WebSession`, `page_artifact`, `aphrody_web_crawl::crawl_bounded`      | Stable JSON shapes are the contract                                                                |
| Bun            | `@aphrody/agent-browser/service`                                                            | One-shot calls spawn the CLI with a timeout                                                        |

## Configuration and state

| What                         | Where                                                                                                       |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Layered configuration        | `config/web.json` (read by `@aphrody/agent-browser/config`), environment, flags                              |
| Engine binary                | `APHRODY_WEB_BIN`, `target/{debug,release}/aphrody-web`, `~/.local/bin/aphrody-web`                         |
| CDP endpoint                 | `APHRODY_BROWSER_CDP_URL` (alias `APHRODY_CDP_URL`); tests: `APHRODY_WEB_TEST_CDP_URL`                       |
| Engine tuning                | `OBSCURA_*` (30+ variables: private network, proxy, timeouts, body cap, tokens, profiles, snapshots)        |
| User agents                  | bridge Chrome/146 (Windows), engine Chrome/145 (Linux), crawl `AphrodyWeb/1.0`                              |
| Robots                       | off in `obscura-browser` and `crawl_bounded` by default; on in `aphrody_web_crawl` (MCP) and `config/web.json` |
| Timeouts                     | fetch 30 s, scrape 60 s, crawl 300 s, MCP call 180 s, HTTP client 30 s, bridge fetch 30 s / 2 MiB          |
| Storage                      | `~/.aphrody/web` (frontier, reports), `~/.aphrody/x-*` (X session/store); secrets in protected stores only |
| Service unit                 | yolo unit catalog `aphrody-web.service` (template, not installed)                                         |

## Who uses aphrody-web today

| Product interface      | Uses the web layer?     | How                                                                                                                                       |
| ---------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| RG (cron, inagle)      | Yes, partly             | `@aphrody/agent-browser` `WebCdpPage` for rendering, then `cheerio` for parsing (about 14 files); still `scripts/rg/inagle/pipeline/*` (not in repo) cheerio |
| Achillea bot           | No                      | axios REST clients (Twitch, Challonge), not scraping; nothing to migrate                                                                  |
| Shenron                | Mostly bypassed         | `curl`/regex scripts (`shenron:apps/site/scripts`, `shenron:apps/bot/scripts`), legacy `bxc` spawn in `shenron:packages/pipeline`, client of a retired HTTP API |
| Koharu                 | No                      | CEF with remote debugging port 4000 in debug builds; no web-layer dependency                                                              |
| CLI (`apps/cli`)       | Yes                     | `aphrody web` over `aphrody-web-bridge`, `-crawl`, `-extract` (including `media`), `-detect`; `aphrody bxc`/`google` call a legacy bridge binary |
| Kernel / OS            | Indirect                | `aphrody-kernel mcp` proxies `aphrody-mcp`; optional plugin `aphrody-browser-mcp` has no crate that builds it                             |
| Desktop app            | Yes                     | `crates/ui/app` defines and registers `WebSubsystem` (the former `aphrody-web` facade crate); Tauri debug tools live in the same kernel |
| AI tools               | Partly                  | `crates/ai/mcp` native browser; `crates/ai/tools` `web_fetch` keeps a private `reqwest` scraping client                                   |

## Gaps

Resolved in this change set are marked `FIXED`; the rest are open.

1. FIXED. `aphrody-web` had no crawl command although `aphrody-web-crawl` existed; `aphrody-web crawl` now wraps `crawl_bounded`.
2. FIXED (compiled, not exercised). `launch --workers N` spawned children that outlived the load balancer; a guard now kills and reaps them on shutdown and every exit path.
3. FIXED. Test harnesses relied on `process.on("exit")`, which `bun test` does not run, leaking one engine per run; the engine lifecycle is now owned by `@aphrody/agent-browser/engine` and a `[test] preload` hook.
4. FIXED (written, not yet compiled). `Cookie` derived `Debug` and printed cookie values; a manual `Debug` now redacts them.
5. FIXED. `cargo clippy -D warnings` failed on three lints in `aphrody-translate` (a dependency of `aphrody-web-bridge`).
6. OPEN. `aphrody-web-engine` has no Cargo consumer and nothing builds `target/debug/aphrody-web` (not in repo) in the default gates; `web:verify` builds it explicitly.
7. OPEN. `aphrody-web-bridge` still resolves a `bxc` executable (`BIN_NAME`, `BXC_BIN`), and `apps/cli` `aphrody bxc`/`google` send bxc-style arguments that `aphrody-web` does not implement.
8. DONE 2026-10-05. `obscura-mcp` keeps only the tool library (upstream stdio/HTTP loops removed); MCP reaches the engine only through `aphrody-mcp`. The kernel's optional `aphrody-browser-mcp` plugin has no builder.
9. OPEN. Duplicates: HTML to Markdown (V8-side `obscura-js/src/markdown.rs` and native `aphrody-web-extract`), robots.txt (`obscura-net/src/robots.rs` prefix-only and `aphrody-web-crawl/src/robots.rs`), four HTTP stacks (`ObscuraHttpClient`, bridge `fetch.rs`, `crates/ai/tools` `ScrapingClient`, bridge `cli.rs` search client), two Google result parsers (`web-bridge/src/cli.rs`, `crates/google/google/src/search/serp.rs`).
10. OPEN. Product code outside the layer: `crates/ai/tools/src/builtin/scraping.rs` and `web_fetch.rs` (trivially replaceable by `aphrody_web_bridge::fetch::fetch`), `crates/interop/ffi/src/web/text.rs` (hand-rolled tag scans), `crates/compat/n2b-core/src/llmstxt/crawl.rs` (external `siteone` crawler, replaceable by `aphrody_web_crawl`), `apps/cli` unused `scraper` dependency.
11. OPEN. TypeScript scraping that bypasses the layer: cheerio over rendered HTML in `iecode/packages/rg/cron` and `packages/rg/inagle` (not in repo); curl/regex in Shenron scripts; `undici` imports without a declaration; a client of the retired `aphrody-web-api` (`shenron:packages/pipeline/src/aphrody/web.ts`).
12. OPEN. Undeclared dependencies: `@aphrody/x` imported by `packages/fut/fut` (resolved through tsconfig paths) and by scripts without a manifest; `iecode/scripts/rg/qa/agent-browser-rg.sh` expects the upstream native `agent-browser` CLI that `@aphrody/agent-browser` does not provide.
13. OPEN. Stale paths to a retired sibling layout: `scripts/audit/live`, `config/live-audit.json`, `config/service-catalog.json` (`aphrody-web-api:3007`, retired), `config/host/nginx/routes.json`, `config/mcp-google-web.json` (`bxc-mcp`), `config/host/systemd/aphrody/aphrody-web-api.service.example`, `scripts/build/build-aphrody-stack-release.sh`, `packages/infra/workspace/src/ecosystem-deps.ts`, `plugins/aphrody/hooks` (`apps/bxc`).
14. OPEN. Docs: `docs/products/web/README.md` and several plans name crates that no longer exist (`crates/aphrody-web-*`, `aphrody-browser`, `aphrody-site`, `apps/bxc`); `docs/guides/web/web/NATIVE-INSTALL.md` documents `aphrody web install`, which the CLI does not have; four broken relative links in `docs/products/web`.
15. OPEN. Tauri IPC shims and tools that call commands with no Rust handler (`m3/packages/m3-next-migrate/src/shims/tauri-ipc.ts` maps to `action_<name>`; `shenron:packages/pipeline/src/bridge/ipc.ts`; `crates/ui/app/src/desktop.rs` carries ten `#[tauri::command]` functions that are not in `generate_handler!`).
16. OPEN. Network-dependent tests are not separated by a gate in every crate; the web gates in `web:verify` run only loopback fixtures.

## Verification state

See the dated section of [`PLAN.md`](../../../PLAN.md) for the numbers measured on
2026-10-01 and the checks that were not run.
