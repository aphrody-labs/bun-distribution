<!-- SPDX-License-Identifier: Apache-2.0 -->
# M3 at the product repository root

Owner decision: 2026-10-05. Aphrody mounts the private `aphrody-m3` Git
submodule at `m3/`. The old `design/aphrody-m3/` source path is retired.

| Path | Responsibility |
| --- | --- |
| `m3/packages/app-ui` | Product UI and native/backend client contracts |
| `m3/packages/*` | Shared framework, components, themes and product UI libraries |
| `m3/apps/*` | Framework examples and showcase |
| `m3/forks/*` | Pinned upstream forks, with their history and notices |
| `crates/ui/*` | Native Aphrody hosts, rendering and token contracts |
| `packages/infra/workspace` | Workspace and build orchestration |

The UI framework is product code, so it does not live under a design-document
category. M3 keeps its package names, exports, remote and history. The Git
submodule's historical internal name is metadata; its worktree path is `m3`.
Other repositories keep their independently pinned consumer checkouts.

Workspaces, imports, build paths and current documentation follow the new path.
Historical migration receipts retain the paths they actually measured. No
compatibility symlink or second copy of the product source is required.

## Product and backend boundaries

The owner refocused this batch on M3, Aphrody applications and Shenron on
2026-10-05. The earlier workers are stopped.

| Surface | Source owner | Actual boundary |
| --- | --- | --- |
| Aphrody App | `crates/ui/app` | Native Tauri host, windows and typed IPC |
| App UI | `m3/packages/app-ui` | Shared M3 presentation; IPC on desktop, RPC/SSE on web |
| App server | `crates/ai/app-server` | Sessions, turns, tool discovery and optional RAG RPC |
| Aphrody AI | `crates/ai/*` | Shared model, agent, inference and RAG libraries |
| Shenron Site | `apps/shenron/site` + `m3/packages/shenron-ui` | Product pages and `GET /api/chat` |
| Shenron backend | `apps/shenron/bot` + `packages/shenron/pipeline` | Domain sessions, grounded answers and Aphrody clients |
| Crawl | `crates/web/web-crawl` | Shared crawl implementation, consumed through Web owners |
| RAG | `crates/ai/rag` + `rag-core` | Retrieval and storage contracts; each domain retains its stores |

The desktop broker embeds the app-server through Tokio duplex streams. The
browser host uses the existing M3 server and forwards `/rpc`, `/events`,
`/notifications`, `/health` and `/healthz` to the native loopback backend.
Frontend code starts no backend subprocess and supplies no simulated backend.

Shenron Site keeps its session-aware backend route. With `RAG_BACKEND=aphrody`,
stateless chat uses the shared Aphrody compute client; requests with a session
keep the bot's conversation lifecycle. This source wiring does not establish
live crawl, model or database readiness. Native desktop Shenron access currently
retains its explicit availability gate in `crates/ui/app/src/shenron.rs`.

The installed CLI qualification acknowledged initialization and ten tools, with
no registered MCP servers in an isolated profile. Its Aphrody/RAG extension is
disabled. No model turn, crawl or protected index was executed. Backend health,
compiled features and usable domain data must remain distinct in the UI.
