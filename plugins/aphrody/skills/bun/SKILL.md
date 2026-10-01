---
name: bun
description: "Bun runtime, bundler, package manager and test runner from version-matched docs (offline bun_docs tools, bun-types, bun.com). Use for Bun.serve/file/$, bun build/test/install, bun:sqlite/ffi, or porting Node code to Bun."
version: "1.1.0"
---

<!-- SPDX-License-Identifier: Apache-2.0 -->

# bun: docs first, then code

Answer Bun questions from documentation that matches the Bun version the project runs, not
from memory. Bun ships fast and APIs move between minors, so an answer from training data is
often subtly wrong.

## 1. Find the project's Bun version

- `bun --version`, `packageManager` / `engines.bun` in the root `package.json`, and the
  `@types/bun` / `bun-types` version in the lockfile (`bun.lock`, text format).
- Note workspaces (`workspaces.packages`) and `catalog:` versions in the root `package.json`;
  respect them when adding dependencies.

## 2. Sources, in order

1. **Offline Bun docs MCP tools, if the session exposes them** (names end in
   `bun_docs_search`, `bun_docs_read`, `bun_docs_list`, `bun_node_equivalent`, and the
   composite `skill_bun_docs_lookup`). They index a local upstream Bun docs tree.
   - `bun_docs_search {query, limit?, include_content?}`: ranked pages (slug, URL, snippet).
   - `bun_docs_read {slug | url, section?}`: one page, or one heading's section.
   - `bun_docs_list {prefix?}`: prefixes `runtime/`, `bundler/`, `pm/`, `test/`, `guides/`.
   - `bun_node_equivalent {query}`: Bun replacement for a `node:*` module, npm package or
     Node API, with `compat` = `full` | `partial` (see `missing_apis`) | `missing` (use the
     `bun` / `hint` fields).
   If they return `Unavailable`, the docs corpus is missing: point `APHRODY_BUN_DOCS` at an
   upstream `oven-sh/bun` `docs/` directory.
2. **Type definitions in the project**: `node_modules/bun-types/*.d.ts` (or
   `node_modules/@types/bun`). These are the exact signatures for the installed version.
3. **Upstream docs**: `https://bun.com/docs` (index for agents: `https://bun.com/docs/llms.txt`),
   or Context7 library `/oven-sh/bun`. If a feature only appears here and not in the local
   types, it is newer than the installed Bun; say so.

## 3. Workflow

1. Search with the API name plus the intent (`Bun.file stream`, `bun build --compile target`,
   `bun test mock module`).
2. Read only the relevant section and cite its URL.
3. For Node code, resolve each import (`bun_node_equivalent`, or the Node-compat page
   `https://bun.com/docs/runtime/nodejs-compat`). Keep fully supported imports; rewrite the rest.
4. Write the code, then run the package's own scripts (`bun run typecheck` or `bunx tsc
   --noEmit`, and `bun test <path>`).

## Rules

- In a Bun project use `bun` / `bunx`, not `npm`, `pnpm`, `yarn`, `npx` or `node`.
- Prefer Bun-native APIs:

  | Task | Bun API | Instead of |
  | --- | --- | --- |
  | Files | `Bun.file` / `Bun.write` | `fs` |
  | Processes | `Bun.spawn` / `Bun.$` | `child_process` |
  | HTTP and WebSocket servers | `Bun.serve` (with `routes`) | `http`, `express` |
  | Tests | `bun:test` | jest / vitest |
  | SQLite | `bun:sqlite` | `better-sqlite3` |
  | Postgres, S3, Redis | `Bun.sql`, `Bun.s3`, `Bun.redis` | client packages |
  | Hashing | `Bun.password` / `Bun.hash` | hashing packages |
  | `.env` files | loaded automatically | `dotenv` |

- Flag any API the docs mark experimental or unstable.
- Native code goes through `bun:ffi` or N-API; for Rust libraries use the `rust-bun` skill.

## In the Aphrody monorepo

Applies only when the repo root `package.json` is named `aphrody`:

- The `bun_docs` subsystem lives in crate `aphrody-bun-docs` (`crates/compat/bun-docs`); Node
  equivalents come from `aphrody-n2b-registry` (`crates/compat/n2b-registry`). Without MCP,
  call it directly: `aphrody-kernel call bun_docs_search '{"query":"..."}'`.
- The docs corpus resolves from `APHRODY_BUN_DOCS`, then installed data
  (`$XDG_DATA_HOME/aphrody/bun/docs`), then `docs/reference/upstream-bun` in the checkout.
- Workspace globs and `catalog:` versions are in the root `package.json`; `bun run bun:check`
  validates the Bun workspace contract.
