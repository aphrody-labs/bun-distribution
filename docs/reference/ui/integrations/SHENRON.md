<!-- SPDX-License-Identifier: Apache-2.0 -->
# Shenron desktop integration

## Decision

The Aphrody desktop remains an independent UI-layer process. Do not link
`aphrody-ffi` into `aphrody-app`: `aphrody-ui/AGENTS.md`, the workspace manifest,
and `docs/reference/ui/tauri/aphrody-integration.md` require the desktop to keep the AI layer
out of its dependency graph. The FFI crate itself depends on the full `aphrody`
CLI/library and is not a narrow Shenron SDK.

The app can call Shenron through an allow-listed native Tauri command. Keep
PostgreSQL and editorial writes on Shenron's backend. A future local database
must be a disposable, versioned cache populated from an explicit read API; it
must never become editorial authority.

## Verified current contracts

- Shenron's site exposes `GET /api/chat?q=...` on the site's public origin.
  The handler rate-limits to 20 requests/minute/IP, caps `q` at 600 characters,
  and forwards to the configured Shenron RAG/chat backend with a 30-second
  timeout. Its result contains `answer`, `hits`, and `mode`.
- Shenron's bot has a separate public RAG runtime API. Admin routes require
  server-side authorization and must not be called with a token embedded in a
  desktop binary.
- The site login boundary is Better Auth owned by the RG auth plane. The
  desktop has no Shenron/RG browser-session bridge and must not claim that it
  is logged into `/admin`. Separately, the existing app-server and Chat can
  surface configured MCP tool calls; `aphrody-mcp` provides the protected
  `dragonball.admin_*` tools. That MCP path keeps credentials in the MCP
  process environment and fails closed when they are missing. Verify the
  configured server and its runtime tools before claiming the desktop admin
  workflow is available.
- `aphrody-ffi` currently exports Shenron operations by wrapping CLI commands.
  RAG search reaches the local Bun-backed Shenron checkout/database and is not
  a packaged, checkout-independent data API. Its `shenron_auth_status()` calls
  the CLI JSON status path; that path currently returns the local admin
  credentials JSON. Do not expose this symbol to the WebView until the owning
  FFI/CLI contract is changed to return a strictly sanitized summary.
- `tauri-plugin-libsql` is not selected. It does not solve access to Shenron's
  PostgreSQL authority, and its embedded-replica encryption limitation makes it
  unsuitable for credentials or an authoritative local copy. The existing app
  policy keeps HTTP and SQL behind typed Rust commands, not WebView plugins.

## Required implementation sequence

1. Add a Shenron module in `aphrody-app` with typed, allow-listed read commands
   for the public site/API. Pin the accepted HTTPS origin, bound all inputs and
   responses, set a timeout, and return typed errors. Never accept an arbitrary
   URL from the WebView.
2. Add the Shenron assistant to the existing Chat surface and render grounded
   hits as links with their supplied titles/URLs. Do not persist private prompts
   or introduce a second navigation shell.
3. For personalized features, implement RG Better Auth in a system-browser
   OAuth/deep-link flow and store only revocable session material in the OS
   credential vault. Until this exists, expose public read-only functionality
   only.
4. Keep database reads and every write on Shenron's backend. Add a local cache
   only after a concrete schema, invalidation/version contract, and a measured
   offline requirement exist. Do not add Turso/libSQL or Drizzle pre-emptively.
5. If the FFI is still needed by another native host, split a narrow Shenron
   client crate from the CLI dependency graph and repair/sanitize the auth-status
   contract in `aphrody-ai` before any app integration.

## Current status

The desktop exposes `aphrody_shenron_chat` as a typed Tauri command and the
existing Chat surface accepts `/shenron <question>` for the public, read-only
site endpoint. It does not establish a Better Auth session. Administrative
operations belong to the configured `dragonball.admin_*` MCP tools surfaced
through the existing app-server Chat path, not to this public Shenron chat
command. CLI discovery/calls and a read-only admin catalogue call were verified
on 2026-09-27; desktop MCP configuration and end-user admin interactions were
not independently verified in this review. The desktop does not link the FFI
crate and receives no admin token.
