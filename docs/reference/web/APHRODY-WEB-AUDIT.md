# aphrody-web audit (2026-10-02, read-only)

Method: shell inventory (grep/awk/ls/sqlite3) against the checkout at HEAD plus uncommitted state. Counts are
approximate (awk counts dependency lines in `[dependencies]`, `[dev-dependencies]`, `[build-dependencies]`).
"unverified" marks what was not checked. No cargo was run.

## 1. Inventory

Workspace: root `Cargo.toml:4` members include `crates/web/*`; `crates/web/drive-server` (not in repo) is excluded (`Cargo.toml:8`).
Workspace deps pin each crate (`Cargo.toml:156-165, 219-226, 505`).

| Crate (package) | Kind | deps | test files | todo!/unimpl! | wasm/windows cfg |
|---|---|---|---|---|---|
| web-engine (aphrody-web-engine) | bin `aphrody-web` + `aphrody-web-worker` (`Cargo.toml:12-18`) | 16 | 2 | 0 | 0 |
| web-bridge (aphrody-web-bridge) | lib, fetch/profiles/FFI glue | 11 | 9 | 0 | 0 |
| web-crawl | lib, crawl runner/scoring/blocking | 12 | 10 | 0 | 0 |
| web-detect | lib | 7 | 4 | 0 | 0 |
| web-extract | lib, html_to_markdown (`src/lib.rs:92`) | 9 | 12 | 0 | 0 |
| web-frames | lib | 8 | 6 | 0 | 0 |
| web-index | lib (sqlite index) | 5 | 8 | 0 | 0 |
| web-service | lib, `WebSession` | 6 | 1 | 0 | 0 |
| web-chromium | lib | 4 | 1 | 0 | 2 |
| x (aphrody-x) | lib, X/Twitter | 15 | 14 | 0 | 0 |
| obscura | bin/lib | 9 | 4 | 0 | 0 |
| obscura-browser / -cdp / -dom / -js / -mcp / -net / -render | libs | 11/18/4/25/10/19/15 | 2/19/4/6/2/6/9 | 0 | 0 |
| taffy | vendored layout (MIT, `Cargo.toml:45`) | 19 | 13 | 0 | 0 |
| drive-server (package `sd-server`) | excluded from workspace | 23 | 0 | 0 | 0 |
| web-bridge `web-*` dirs without Cargo.toml | none | | | | |

Only web-chromium has wasm/windows cfg gates; the rest have none (unverified for non-`cfg(` forms such as `#[cfg_attr]`).
No `todo!`/`unimplemented!` in any web crate. Stub-like "not implemented" strings were not searched (unverified).

Bun packages (`packages/web/*`; there is no `apps/web*`, `ls` failed):
- `@aphrody/agent-browser` (`packages/web/agent-browser/package.json`): CDP client, engine lifecycle, service client, config, tauri; command line `yolo browser` (no bin). Has `test/`.
- `aphrody-web-test` (`packages/web/aphrody-web-test`): Playwright-like runner (cdp, locator, expect, page). Has `test/`.
- `x` (`packages/web/x`): X client, tools, db; tests at package root.

Installed binaries (`~/.local/bin`):
- `aphrody-web` and `aphrody-web-worker` are symlinks to `~/.local/lib/aphrody/installed-20261001/` (link time Oct 1 01:24).
- `obscura` and `obscura-worker` (Sep 29 08:45), `lightpanda` (Sep 29 08:43).
- Lightpanda wiring in repo: only `packages/web/x/examples/*.ts` mention it (3 files). No Rust/config code references lightpanda (grep over crates, apps, config).

## 2. Surfaces

CLI: `crates/infra/aphrody-command/src/pillars_cmd/web.rs` `WebAction` (enum at line 8) with Status, Capabilities, Fetch, Search, Recon, Scrape, Extract, Detect, Gemini, X, Media, Browser, Crawl, Mediawiki, Mirror, WikiSearch, WikiPage, Frames (lines 11-299); sub-enums for index/X/frames/resolve (305-420); dispatcher `handle_web` at 426. CLI uses `obscura_net::ObscuraHttpClient` directly (852, 886, 927, 1066) and `obscura::Browser` (1121).

MCP (`crates/ai/mcp`):
- `universal_web_fetch`: `src/main.rs:885` (shared fetch helper ~770-815 via `aphrody_web_bridge::fetch`). Listed in a gating list at `src/protocol.rs:132`.
- `aphrody_web_extract_html`: `main.rs:894` (-> `aphrody_web_extract::extract_main_json`).
- `aphrody_web_call` generic dispatcher: `main.rs:2089`, resolves via `bxc_tools::internal_name` / `call_raw` (`bxc_tools.rs`; `aphrody_web_crawl` -> `DirectTool::Crawl` at `bxc_tools.rs:252`).
- `browser_*` (public prefix `aphrody_browser_*`): `src/browser_tools.rs:62,75` in-process through `aphrody_web_service::WebSession`.
- Native crawl tools: `src/native_crawl_tools.rs:9`.
- Standalone obscura-mcp server: 40+ `browser_*` tools declared `crates/web/obscura-mcp/src/lib.rs:331-721`, dispatched 755-784+. This overlaps with browser_tools.rs (same catalogue via WebSession; test asserts equal length, `browser_tools.rs:148`).
- `scrape`: only appears as a CLI subcommand (`web.rs:468` context); no MCP tool literally named `scrape` found. Public/MCP-level `scrape` mapping unverified.
- Also `x_tools.rs`, `search_tools.rs`, `public_web_tools.rs` (not read).

FFI (`crates/interop/ffi/src/web`, `no_mangle` counts per file): cookies 1, dom 13, embed 4, extract 9, index 36, jobs 5, media 4, mod 46, native_http 5, net 15, net_aliases 30, text 6 (total about 174). Grep pattern also matches `extern "C"`, so counts are upper bounds.

Bun APIs: `@aphrody/agent-browser` exports `./client ./types ./cdp ./config ./engine ./service ./test-preload ./tauri` (`package.json`); `tools/config/web.json:4` names owner as `crates/web (aphrody-web-engine)` and agent-browser.

## 3. Duplication

- HTML to markdown: `web-extract/src/lib.rs:92` (canonical), `web-bridge/src/ffi.rs:74` wrapper, obscura-mcp `browser_markdown`, plus FFI `web/extract.rs`/`text.rs`. Overlap in 3 surfaces; need a single owner.
- URL normalization: `crates/ai/rag-core/src/eval.rs:92` and `crates/infra/sql/src/pg.rs:343` (different purpose); web-crawl has its own (grep found only `extract_links` at `web-crawl/src/runner.rs:401`). Skip-list: no shared normalizer found (unverified how crawl dedups).
- Link extraction: `web-crawl/src/runner.rs:401` vs obscura-mcp `browser_links` vs FFI `web/dom.rs`.
- Cookies: obscura-cdp (`cookie_params.rs`, domains/network/storage), obscura-net `CookieJar`, obscura-mcp get/set/clear, `web-chromium`, `x/src/session.rs`, FFI `web/cookies.rs`, web-index sqlite table `cookie_jars`. Six implementations.
- Fetch clients: reqwest in obscura-js, obscura-net, web-bridge, web-detect, web-frames, x (workspace dep); wreq (stealth) only in obscura-net, pinned `=6.0.0-rc.31` and `wreq-util =3.0.0-rc.14` (`obscura-net/Cargo.toml:37-57`). The 8 `wreq` hits above are in obscura-net/obscura-js only. Two TLS stacks (reqwest rustls and wreq/boring).
- CDP clients: server in obscura-cdp; clients in `packages/web/agent-browser/src/cdp.ts` and `packages/web/aphrody-web-test/src/cdp.ts` (two TS clients), plus web-chromium.
- Crawl frontiers: `web-crawl` runner/frontier, `web-engine/src/crawl.rs`, `crates/os/kernel/comps/task-runner`, `native_crawl_tools.rs`, FFI dom.rs; Bun `shenron:packages/pipeline/scripts/aphrody-web-corpus-crawl.ts`. Runtime store `frontier.sqlite` exists.
- Lightpanda/obscura/aphrody-web: three browser engines with no shared trait found.

## 4. Runtime state

- `aphrody-web --version`: `aphrody-web 1.0.0`; target `installed-20261001/aphrody-web`, size 664 MB (debug-sized), mtime 2026-10-01 11:34:52 +0200.
- Latest source change under `crates/web`: commit `df8bc7604` 2026-10-02 07:36 (`git log -1 -- crates/web crates/infra/aphrody/src`). Per-crate last commit dates: bridge, crawl, engine 2026-10-02; others 2026-10-01. Installed binary is older than bridge/crawl/engine changes, so STALE. Uncommitted working-tree edits not assessed.
- `obscura --version`: 0.2.3 (source crates are 0.1.x manifests, `Cargo.toml:219-226`; the binary is not built from this tree, or version mapping unverified). `lightpanda version`: 1.0.0-nightly.9909+f086b75d5.
- Processes: no obscura/lightpanda/aphrody-web/chrom process. No listener on 9222 (`ss -ltn`). Other listeners belong to agy.
- `~/.aphrody/web-browser` (Oct 2 09:41):
  - `frontier.sqlite`: `requests` 3 rows, `sqlite_sequence` 1. Plus `frontier.sqlite.seen` 4 MB (Sep 26) bloom/seen file.
  - `index.sqlite`: scrapes 0, cookie_jars 0, chunks 0, scrapes_fts* 0 (data/config 2), chunks_fts_* tables 0; `chunks_fts` query errors `no such column: T.heading` (schema/FTS mismatch, index likely created by a different schema version).

## 5. Risks

Security:
- TLS: only `danger_accept_invalid_certs(false)` (`obscura-net/src/client.rs:1161`); no insecure-cert override found in crates/apps.
- Stealth/evasion: `stealth` feature and wreq browser emulation (`obscura-net/Cargo.toml:13`), stealth flag in obscura-cdp/js/mcp/web-service. Does it honour robots.txt? Unverified (web-crawl has `blocking.rs`).
- CDP server: `control_refusal` checks in `obscura-cdp/src/server.rs` (~2061) for host/origin; default bind appears to be 127.0.0.1:9222 in tests. Auth for non-local bind unverified.
- Cookies: `cookie_jars` table in index.sqlite and Gemini cookie file path (`web.rs:1095`) store session credentials; file permissions of sqlite files are 0755 (`ls -la`), executable and world-readable. Confirm 0600.
- `APHRODY_WEB_BIN` is read from env (web-bridge resolve.rs/error.rs, agent-browser config.ts); a poisoned env can redirect execution.
- Secrets in config: not scanned (unverified); `tools/config/web.json` not read.
Licences: obscura* Apache-2.0 manifests; taffy MIT with local patches (`docs/reference/web/VENDOR.md`). Upstream licences of wreq, obscura upstream not verified. `sd-server` (drive-server) is Spacedrive-derived (AGPL upstream; unverified), excluded from the workspace.
Stale docs: `docs/reference/web/VENDOR.md` still points at `crates/aphrody-obscura/vendor/taffy` (not in repo) and `crates/aphrody-obscura/crates/obscura-render` (not in repo), and "latest published taffy 0.12.2" (dated 2026-09-25); current path is `crates/web/taffy` (not in repo). Also `docs/reference/web/_source` (not in repo), `apps`, `chromium` subdirs not reviewed.
Dead code:
- `aphrody-web-engine`: zero Cargo consumers, but it is the binary package (fine).
- `drive-server` (sd-server): excluded, zero consumers, no tests.
- `web-chromium`, `web-frames`, `web-index`, `obscura-mcp`: one consumer each (not dead).
- `obscura` crate consumed? 4 consumers counted for obscura-browser; obscura itself unverified.

## 6. Recommendations (priority order)

1. Rebuild and reinstall `aphrody-web` (stale versus bridge/crawl/engine commits); then re-test. Lead runs serially:
   `scripts/build/rust/cargo-serial.sh check -p aphrody-web-engine` then
   `scripts/build/rust/cargo-serial.sh test -p aphrody-web-bridge -p aphrody-web-crawl -p aphrody-web-extract`.
2. Fix `chunks_fts` schema mismatch: inspect `web-index` schema (`heading` column) and migrate or recreate `index.sqlite`; gate:
   `scripts/build/rust/cargo-serial.sh test -p aphrody-web-index`.
3. chmod 0600 on `~/.aphrody/web-browser/*.sqlite*`; verify cookie file perms.
4. Dedup: one markdown/link/url-normalize owner in `web-extract`/`web-crawl`, make obscura-mcp and FFI wrap it; one cookie jar type; remove one of the two TS CDP clients (agent-browser vs aphrody-web-test); make obscura-mcp reuse `web-service` tool catalogue instead of re-declaring 40 tools.
5. Update `docs/reference/web/VENDOR.md` paths; record a decision on drive-server (move out or delete).
6. Gates after dedup: `scripts/build/rust/cargo-serial.sh check -p obscura-mcp -p obscura-net -p aphrody-web-service`, `... test -p obscura-cdp`, and `... check -p aphrody-ffi` (package name unverified; check `crates/interop/ffi/Cargo.toml`). FFI is under active edit by others, so wait.
7. Add wasm/windows gates (only web-chromium has any), document that wreq pre-release pins need a bump plan.

## 7. Dedup pass applied (2026-10-02)

- Links: canonical `aphrody_web_crawl::extract_links_opts(html, base, skip_nofollow)` (`web-crawl/src/runner.rs`);
  the crawler uses it with nofollow skipped, `web-engine/src/crawl.rs::page_links` now calls it (nofollow kept, same cap).
- Markdown: canonical `aphrody_web_extract::html_to_markdown`; `obscura-mcp` `browser_markdown` now calls it over the live DOM
  instead of the JS converter (`obscura-mcp` gained an `aphrody-web-extract` dependency). `web-engine` already used it.
- Cookies: no further code to merge. `obscura_net::CookieJar` is already the single jar (obscura, obscura-cdp, obscura-browser,
  obscura-mcp, web-engine use it). `web-chromium` reads browser profile cookies via rookie (different purpose) and `x::XSession`
  only formats two header values; neither is a jar. The FFI and the `cookie_jars` sqlite table are out of this file family.
- TS CDP: already a single client, `@aphrody/agent-browser/cdp`; `aphrody-web-test/src/cdp.ts` is a 1-line re-export.
- obscura-mcp `browser_*`: not a duplicate catalogue. `web-service` and `crates/ai/mcp` consume `obscura_mcp::aphrody::tools()/call()`,
  so the 40 tools are declared once. Nothing removed, no aliases needed.
- drive-server: retired 2026-10-02. Zero consumers (excluded crate, no member/dep lines, no tests); the 9 tracked files were
  removed from `crates/web/drive-server` (not in repo), dropped from root `Cargo.toml` `exclude` and from the owner-duplicate roots in
  `docs-consolidation.ts`; (removed import receipt) keeps the record marked `retired` (recoverable from git).
- `web-engine` `dump_links` now calls `aphrody_web_crawl::extract_links_opts` (same `url\ttext` lines; now de-duplicated,
  http(s)-only and fragment-normalised like every other extractor; a page with no URL yields no links).
- FFI `web/cookies.rs` is not a jar: it reads Chromium profile cookies through `aphrody-web-chromium` (like `web-chromium`), so
  there is no parsing to merge; the C ABI is untouched.
- `cookie_jars`: no such table exists in any Rust or TS source (only this audit and DATABASES.md mention it; the live DB has 0 rows
  and a different schema), so there is no persistence code to route through `CookieJar`.
- obscura-cdp `child_frame_tree` flake: `build_document_frames` gives the event loop a fixed 8x50 ms wall-clock budget and stops
  at the first round with no frame work, so under heavy parallel load the child documents may not have landed when the test read
  the tree. The tests now pump the page until the nested frames (and the detach events) are observed, with a 30 s deadline.
- `VENDOR.md` paths fixed to `crates/web/taffy` (not in repo) and `crates/web/obscura-render`.
