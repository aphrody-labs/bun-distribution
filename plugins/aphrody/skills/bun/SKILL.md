---
name: bun
description: "Bun runtime, bundler, package manager and test runner, using the offline Bun docs tools and the n2b Node-to-Bun registry."
version: "1.0.0"
---

<!-- SPDX-License-Identifier: Apache-2.0 -->

# bun — Bun docs first, then code

Answer Bun questions from the Bun docs vendored in the repo, not from training data. Those docs
are pinned to the Bun release the workspace runs. Use `n2b` when the task is a full Node
migration.

## Sources, in order

1. **Kernel MCP tools** (the `bun_docs` subsystem, `crates/aphrody-bun-docs`). They search the
   docs in `third_party/bun/docs`, the upstream `oven-sh/bun` submodule that
   `bun.com/docs` is built from. The version is in `third_party/runtime-sources.toml`.
   - `bun_docs_search {query, limit?, include_content?}`: ranked pages with slug, URL and
     snippet. Set `include_content: true` to get the best page's Markdown too.
   - `bun_docs_read {slug | url, section?}`: one page, or only the part under one heading.
   - `bun_docs_list {prefix?}`: lists pages. Prefixes: `runtime/`, `bundler/`, `pm/`,
     `test/`, `guides/`.
   - `bun_node_equivalent {query}`: the Bun replacement for a `node:*` module, an npm
     package or a Node API. It comes from the n2b registry (`crates/aphrody-n2b-registry`)
     and adds the matching docs pages.
   - Skill `bun_docs_lookup {query}`: runs a search and returns the top page in one call.
2. **Upstream source.** `third_party/bun/packages/bun-types/*.d.ts` holds the exact API
   signatures. `third_party/bun/test/` shows real usage.
3. **Context7** (`/oven-sh/bun`): only if the vendored tree lacks a page. That usually means
   the feature is newer than the pinned release, and you should say so.

If the MCP server cannot be reached, run the kernel directly:
`aphrody-kernel call bun_docs_search '{"query":"..."}'`. If the submodule is missing, the
tools return `Unavailable`. Fix it with `git submodule update --init third_party/bun`, or set
`APHRODY_BUN_DOCS=<docs dir>`.

## Workflow

1. Search: `bun_docs_search` using the API name plus what the user wants to do (for example
   `Bun.file stream`, `bun build --compile target`, `bun test mock module`).
2. Read the one relevant `section` of the page. Cite its `url` in the answer.
3. For Node code, call `bun_node_equivalent` on each import. Follow the `compat` value:
   - `full`: keep the import.
   - `partial`: check `missing_apis`.
   - `missing`: rewrite using the `bun` / `hint` fields.
4. Write the code, then check it with `bun run typecheck` and `bun test <scope>` in the
   package you changed.

## Rules

- Bun-native repos use `bun` and `bunx`. Never use `npm`, `pnpm`, `yarn`, `npx` or `node`.
  The lockfile is `bun.lock` (text). Workspaces come from the root `package.json`, and the
  build runs through Turborepo.
- Prefer these Bun-native APIs:

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

- If the docs call an API experimental or unstable, say so in the answer.
- Native code goes through `bun:ffi` or N-API. For a Rust cdylib, use the `ffi-architect`
  agent and the `web` skill.

## Aphrody OS context

- The Bun workspace covers `packages/*`, `packages/aphrody-spaceui/packages/*`, `examples/*`
  and Drive. Package names are `@aphrody/*`.
- The `bun_docs` subsystem is always registered in `aphrody-kernel`. Any MCP client connected
  to `aphrody-kernel mcp` gets these tools.
- When the vendored Bun submodule is updated (`third_party/README.md`), the tools pick up the
  new docs automatically. There is no index to regenerate.
- The layer map and the manifest contract are in `docs/BUN.md`. `bun run bun:check` enforces
  the contract (one `packageManager`, `engines.bun` matching the root, `catalog:` versions, no
  Node tooling in scripts, a `typecheck` script wherever there is a tsconfig). Run
  `bun run bun:fix` after adding a package or bumping Bun.
