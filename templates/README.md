# Aphrody stack

The complete stack of the unified native runtime plan ([PLAN.md](../PLAN.md)), built on the
Rust-based Bun of `vendor/bun`.

| File | Role |
| :--- | :--- |
| [`stack.toml`](stack.toml) | Layers (host, runtime, SDK, server, web, desktop, headless, tooling), their plan phase and status, pinned versions, templates and framework variants |
| [`base/`](base), [`web/`](web), [`react/`](react), [`desktop/`](desktop), [`hono/`](hono), [`elysia/`](elysia) | Versioned project templates used by `yolo create` (`web` or `react` for the frontend, `hono` or `elysia` for the HTTP variant) |
| [`AWESOME.md`](AWESOME.md) | awesome-bun curated for the Rust-based Bun (14 of 87 entries; audit of the former `aphrody-labs/awesome-bun@yolo`, recorded in `awesome-audit.json`) |
| [`awesome.curated.json`](awesome.curated.json) / [`awesome-audit.json`](awesome-audit.json) | Kept entries / the verdict and reason for every entry |

## Scaffold

```bash
just runtime-build                                     # once: the light runtime library
just create ../my-app --with web,desktop --framework hono
cd ../my-app && bun install && bun test && bun run dev
```

Verified on 2026-10-03 for a project with `web`, `desktop` and `hono`: `bun test` (6 tests: HTTP surface,
native benchmark and its cancellation on client disconnect, SSE, bundled page), `tsc`, `oxlint`, `oxfmt --check`,
a supervised `bun run dev` (readiness probe, orderly SIGTERM stop, no process left) and `cargo check` of the Tauri
crate against the `aphrody-*` crates. The `elysia` variant is scaffolded but was not installed or run.

## Rust-Bun curation

Bun was rewritten in Rust (commit `23427dbc12`, 2026-05-14). `yolo awesome curate` keeps a GitHub entry only if the
repository exists, is not archived and was pushed after that date, is not a Zig project and, when the link points inside
a repository, still answers; external pages are kept only for the official Bun site; undated articles and videos are
dropped. This is activity evidence, not proof of compatibility: an entry that is active may still need testing on
Bun 1.4. The same rules once rewrote the README of the fork `aphrody-labs/awesome-bun` (branch `yolo`, since
deleted); `AWESOME.md` is that curated list, and `yolo awesome` now reads the upstream `oven-sh/awesome-bun`.
