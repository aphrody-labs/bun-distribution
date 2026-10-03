# Aphrody Web Documentation Index

Welcome to the Aphrody Web core documentation. Aphrody Web is a high-performance, Bun-native browser and web extraction engine with native Rust acceleration and Google-grade API contracts.

## Architecture & Core Philosophy

- [Aphrody Web Browser ecosystem](./WEB-BROWSER-ECOSYSTEM.md) - Kernel, Bun, Rust, Python, actors, crawl frontier, mirror and RAG contracts.
- [Architecture Overview & Ecosystem](../../../products/web/apps/bxc/README.md#runtime-profiles) - High-level overview of Aphrody Web runtime profiles, CLI commands, and native layers.
- [Google Ecosystem Atlas](./GOOGLE-ATLAS.md) - Mapping and intelligent routing across 5000+ Google domains and infrastructures (Wiz, Angular, Lit, GFE).
- [Google Module & Chrome DevTools MCP](./bxc-google-module-chrome-mcp.md) - Deep architectural analysis of Google services integration and DevTools protocols.
- [Chromium & Rust Bridge](./CHROMIUM-RUST.md) - Rust FFI architecture connecting Bun with native DOM, V8, and networking crates.
- [Native Obscura Engine](./obscura-headless-browser.md) - Headless browser engine integration spec and runtime capabilities.
- [Obscura Integration Specification](./obscura-integration-spec.md) - Detailed feature inventory, JSON schemas, and command mapping.

## Deployment & Distribution

- Deployment: owned by `aphrody-infra` (release plane and service catalog); this repository keeps no deploy guide.
- Unified public backend: `aphrody-site` exposes Aphrody Web at `/api/v1/web/*` (plus `/api/v1/bxc/rankings`) and the shared MCP endpoint at `/mcp`; Aphrody Web has no dedicated public site.
- [URL, slug & SEO conventions](../URL-SLUG-SEO.md) - Shared URL/slug shape, canonical/OG/JSON-LD/sitemap/robots pattern and retired-link policy across `aphrody-web`, `nie`, `rg` and `shenron`'s public sites.
- [Package Manager Contract](./PACKAGE-MANAGER.md) - Stable distribution contract for external package managers and standalone Bun binaries.
- [Native Installation & Setup](../../../guides/web/web/NATIVE-INSTALL.md) - Installing and resolving native dependencies (Rust cdylib, Lightpanda, curl-impersonate).
- [Windows Build Guide](./BUILD-WINDOWS.md) - Compiling and validating Aphrody Web on native Windows and MSVC targets.

## Extraction, APIs & Verticals

- [Scrapers & Specialized Verticals](./SCRAPERS.md) - Dedicated extractors and verticals.
- [Google Translate Engine](./GOOGLE-TRANSLATE.md) - Rich pronunciation, dictionary definitions, and translation APIs.
- [Gemini Web Protocol & CDP](../../../apis/web/web/gemini-web-protocol.md) - Reverse-engineered Gemini web interface, token rotation, and batch requests.
- [Gemini Web Application Analysis](./gemini-web-app-analysis.md) - Deep dive into Boq envelopes, XSSI stripping, and stream parsing.
- [Serverless Handler](./SERVERLESS.md) - Sub-second serverless integration for Vercel, AWS Lambda, and Cloudflare Containers.
- [Crawler & Auto-Upgrade](./scrapy-crawler-and-auto-upgrade.md) - Scrapy-like crawler pipeline and auto-upgrade strategies.
- [Massive Crawler & Site-to-API Engine](../../../apis/web/web/MASSIVE-CRAWL-AND-SITE-TO-API.md) - High-throughput 24/7 web crawler and OpenAPI 3.1 site-to-API synthesis.
- [Dragon Ball Canonical Shenron Dossier](./DRAGONBALL-SHENRON-CANON.md) - Verified canonical data, rules, lineage, and manga citations for Shenron (ID 1090).

## Workspaces & Packages

- [Koharu capability map](./KOHARU.md) - Source-pinned comparison of Koharu translation, image import and Web transport/browser capabilities; documents possible reuse without implying integration.
- [Repository layout](../../../products/web/README.md) - Crates, Bun workspace packages and sibling dependencies of `aphrody-web`.
- [`@aphrody/x`](../../../../packages/web/x/README.md) - Headless X/Twitter client, `x-algorithm` ranking implementation and X function tools (`XTools`) for model tool calling.
- xAI / Grok: bxc calls the xAI REST API through its own client (`apps/bxc/src/integrations/xai.ts` (not in repo)). The full `@aphrody/xai` SDK is AI-layer code in the sibling `aphrody-ai` repository, which consumes `@aphrody/x` from here; this repository never depends on it.
- [`@aphrody/bxc-test`](../../../products/web/packages/bxc-test/README.md) - Playwright-compatible test runner, Next.js instant navigation (`@aphrody/bxc-test/next`), and canonical site presets (`@aphrody/bxc-test/sites`).

## Governance & Agent Guidelines

- [Instructions Agents (`AGENTS.md`)](../apps/bxc/AGENTS.md) - Strict repository rules, naming contracts, and language guidelines.
- [Claude Code Guide (`CLAUDE.md`)](../apps/bxc/CLAUDE.md) - Primary operating manual for AI agents working in this repository.
- [Gemini CLI Pointer (`GEMINI.md`)](../apps/bxc/GEMINI.md) - Thin pointer synchronizing Gemini CLI instructions with CLAUDE.md.
- [Skills Matrix (`SKILLS.md`)](../apps/bxc/SKILLS.md) - Inventory of active MCP and agent skills in Aphrody Web.
