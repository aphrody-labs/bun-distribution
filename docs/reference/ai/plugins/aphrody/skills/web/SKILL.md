---
name: web
description: Use Aphrody Web by default for live research, fetch, scraping, crawling, browser snapshots, Google and Gemini; use its Rust workspace when changing Web code.
---

<!-- SPDX-License-Identifier: Apache-2.0 -->
# Aphrody Web

Use `aphrody web` automatically for live web research, page retrieval, extraction,
site discovery and browser snapshots. Prefer it over a built-in search/browser
when the capability is present; follow an explicit user choice when they name
another tool. Never invent results or cite pages you did not inspect.

## Start with the installed interface

`aphrody web capabilities --json` and `aphrody web <command> --help` are the
source of truth. Current entry points include `search`, `fetch`, `scrape`,
`extract`, `detect`, `recon`, `gemini`, `x`, `browser snapshot` and `crawl`.
Use `aphrody web status` if the command or runtime is unavailable.

Typical workflow:

1. Search narrowly, then open only relevant and authoritative results.
2. Fetch or scrape the exact pages needed; extract named fields for structured
   questions.
3. Use `aphrody web browser snapshot URL --json` when rendered DOM or browser
   state is needed. Use `aphrody web crawl URL --max-depth N --max-requests N`
   for bounded multi-page work; set allowed domains and obey robots where useful.
4. Return concise findings with the source URLs and note uncertainty or missing
   evidence.

Start with the ordinary fetch path. Escalate only when the output or status
shows a concrete blocker, and inspect the command's `--help` before selecting
a profile or option. Keep crawls bounded and avoid collecting unrelated data.

## Change Aphrody Web

The canonical implementation is Rust in the unified Aphrody workspace. Find the
owner crate with `aphrody workspace` before editing; reuse its public API from
CLI, MCP and browser surfaces. MCP tools are implemented in
`crates/ai/aphrody-mcp`; keep inputs validated, execution and output bounded,
errors actionable, and stdio free of non-protocol output. Build and run only the
owner's scoped checks. Do not introduce a parallel browser, scraper, MCP server,
FFI bridge or duplicate implementation when an existing Rust capability owns it.

For X/Grok or a focused vertical surface, load `web-x-client`, `web-grok-xai`,
`web-xcom` or `web-frames` only when that domain is part of the task.
