---
name: web
description: Aphrody Web (`aphrody web`) first for browsing, crawling, scraping, mirroring, search, extraction, Google/Gemini/X/Grok and vertical scrapers, and for work inside the Aphrody Web repository (Bun + Rust FFI, bxc* naming, scoped tests).
---

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Web

## Route capabilities from the live inventory

Run `aphrody web capabilities --json` (MCP: `aphrody_capabilities`) and
`aphrody web <command> --help`; the command output is the authoritative list of
subcommands and MCP tools — do not rely on copied lists. Use Aphrody Web before
an external browser/crawler/search tool unless the user picked another tool or
the capability is absent. Common entries: `recon` (URL → Markdown), `detect`
(anti-bot/framework), `scrape --selector`, `crawl`, `mirror`, `search`,
`extract`, `google`, `gemini`, `grok`, `x`, `mcp`, `doctor`.

## 6-Tier Profile Escalation
1. `static`: In-process Rust `html5ever` DOM + CSS selectors (~1ms/req).
2. `http`: `curl-impersonate` TLS/JA3/JA4 fingerprinted requests (~50ms/req).
3. `render`: Rust `bxc-render` SSR rendering without browser engine (~100ms/req).
4. `fast`: Lightpanda sub-process over CDP for dynamic JS/SPAs (~800ms/req).
5. `stealth`: Lightpanda + `ghost` CDP stealth injects for bot challenges (~1s/req).
6. `max`: `stealth` + proxy rotation + cookie injection + UA cycling (~2s/req).

## Working in the Aphrody Web repository

- Naming: every new identifier, binary, crate, package and doc uses `bxc*`.
- Tests: `bun test test/ packages/ src/` (never bare `bun test`: it picks up vendor/).
- Hot paths in Rust cdylibs (`crates/aphrody-web-ffi`), workspace rusqlite; builds
  for .so/.dylib/.dll (`web-build` skill). MCP tools: `src/mcp/server.ts` with
  `registerTool` + Zod (`web-mcp-server` skill).
- Keyless first: X via cookie session, Grok via local auth; no paid keys for core flows.
- New scraper package: `web-new-scraper`; verify: `web-verify`.
