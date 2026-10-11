<!-- SPDX-License-Identifier: Apache-2.0 -->
# Native Google product integration, 2026-10-09

The Google capability owner now provides a local public route/guidance catalog through `aphrody google routes --json` and the read-only `aphrody_google_routes` MCP tool. Search request validation, vertical execution and safe result projection are shared by MCP and app-server instead of copied into the UI.

The app-server extension `aphrody/google/search` requires initialized, negotiated Aphrody capabilities and anonymous search. Browser/desktop calls cannot use host Google account cookies. It rejects invalid or unknown arguments before network access and times out after 30 seconds. Google Studio uses this actual extension, validates result URLs and displays native failures without fabricated results. The shared router exposes `/os` using the existing file explorer; this adds no privileged browser access or new WASM runtime.

Native Windows scoped checks and strict Clippy pass for Google, MCP, command, app-server and OVH. Google/MCP/app-server library tests pass; live provider tests remain explicitly ignored. Twenty focused Bun tests (98 assertions) pass for the shared search facade and downloads/SEO behavior. UI TypeScript and scoped formatting/lint pass. Source qualification does not establish installed CLI activation, public backend availability, desktop packaging or browser frame rate.

Three public guidance pages were fetched by the native crawler into the isolated Aphrody reference store, respecting robots with depth zero and a three-request limit: the [Google SEO starter guide](https://developers.google.com/search/docs/fundamentals/seo-starter-guide), [Web Vitals](https://web.dev/articles/vitals) and [accessible forms](https://web.dev/learn/forms/accessibility). Google's robots rules prohibit crawling search-result routes; explicit native search queries remain a separate capability. No account cookie enters the corpus, source repository or memory.

The exact internal Google infrastructure and universal browser execution of every native Rust crate are not established by these changes. Backend allocation, authenticated public transports, WASM target support and comparable performance measurements each require their own evidence.
