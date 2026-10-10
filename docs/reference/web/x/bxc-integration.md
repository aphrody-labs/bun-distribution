<!-- SPDX-License-Identifier: Apache-2.0 -->
# bxc + `@aphrody-code/x` integration

**Naming:** `docs/x/` (not in repo) documents **Twitter/X** (x.com). **xAI Grok** is documented under [`aphrody-ai/docs/grok/README.md`](../../../products/ai/grok/README.md).

## Repos and packages

| Piece | Path in `aphrody-web` | Role |
| --- | --- | --- |
| **bxc** workspace | `apps/bxc` (not in repo) | Zero-spawn browser engine, REST `:3000`, **bxc-mcp** (40 tools) |
| **`@aphrody/x`** | `packages/web/x` | TypeScript X.com client (GraphQL + REST, cookie auth) |
| **x FFI** (Rust) | `crates/aphrody-web-ffi` (not in repo), `crates/interop/ffi` | FFI for `bxc_x_*` |
| **aphrody-x** | `crates/web/x` | Standalone Rust CLI (`aphrody-x`, 47 subcommands) |

## CLI surfaces

```bash
# bxc wrapper (JSON default)
bxc x whoami
bxc x profile <handle>
bxc x search "<query>" -n 20
bxc x news

# MCP tool (same backend, action enum)
# bxc_x_client: profile | tweets | search | news | whoami
```

## Auth (Twitter cookies — not xAI)

| Variable | Required |
| --- | --- |
| `X_AUTH_TOKEN` + `X_CT0` | Yes (pair) |
| Session file | `~/.aphrody/x-session.json` or package default |

See [env-and-auth.md](./env-and-auth.md), [bxc-cookies.md](./bxc-cookies.md) (jar format + `grok` shortcut), and the parent [README.md](../../../products/web/x/README.md).

**grok.com (xAI web):** cookie jar `~/.bxc/cookies/grok.json` — not the same as Twitter `auth_token`/`ct0`. Scan notes: [grok-com-scan.md](./grok-com-scan.md).

## MCP wiring

| Host | Command |
| --- | --- |
| Grok / Claude (example) | `~/.local/bin/bxc-mcp` |
| Build | `cd ~/bxc && bun run build:mcp` |

Env: `BXC_MEMORY_DB` (SQLite agent memory, optional).

## bxc engine (systemd)

VPS unit: `/etc/systemd/system/bxc.service` — `bxc serve --cdp-port 9222 --auto-profile`.

| Surface | Endpoint |
| --- | --- |
| CDP (default on VPS) | `http://127.0.0.1:9222` |
| Optional HTTP API | `bxc api` (not enabled in the default unit) |

Do not assume `:3000/health` — another process may bind port 3000 on the host.

## When to use what

| Goal | Tool |
| --- | --- |
| Agent browser/scrape/crawl | **bxc-mcp** |
| Scripted X account ops | **aphrody-x** or `bxc x` |
| xAI chat / Grok models | **Grok CLI** or **xAI API** — [`aphrody-ai/docs/grok/`](../../../products/ai/grok/README.md) |
