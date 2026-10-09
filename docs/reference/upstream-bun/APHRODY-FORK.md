# Bun in Aphrody: the aphrody-labs/bun fork

Canonical Aphrody page about Bun. Every other page that discusses the Bun runtime, its sources, its patches or
its updates links here. This file is kept by `bun run docs:bun:update`; every other file of this directory is a
byte copy of `docs/` of the fork (see `SOURCE.json`) and is the only copy of the Bun documentation in Aphrody.
Verified against the fork checkout and `aphrody-v1.4.3-aphrody.2` release on 2026-10-09.

## Rules

- The Bun of Aphrody is the fork [aphrody-labs/bun](https://github.com/aphrody-labs/bun) (local checkout
  `APHRODY_BUN_CHECKOUT`, else `C:\bun` on Windows). Any change to Bun itself (runtime, built-in modules,
  `bun:*` APIs, bundler, package manager, types, build scripts) lands in the fork as a commit on `main`, with a
  test under `test/js/first_party/` or `test/internal/`. Its own [APHRODY.md](https://github.com/aphrody-labs/bun/blob/main/APHRODY.md)
  lists what Aphrody consumes from it.
- Aphrody keeps no Bun patch queue, no vendored Bun tree, no Rust copy of Bun crates and no second copy of the
  Bun docs. Bun API questions are answered from this directory or the MCP tools `bun_docs_search`,
  `bun_docs_read` and `bun_docs_list`.
- `oven-sh/bun` is reached only through the fork's `upstream` remote; it is not a direct source of Aphrody.

## Repository

- Remotes: `origin` = `aphrody-labs/bun`, `upstream` = `oven-sh/bun`. One working branch, `main` (also the
  default branch) = upstream `main` plus the Aphrody commits; the other remote branches are inherited from
  upstream and feed nothing. On 2026-10-08 `main` was 0 behind and 46 commits ahead of `upstream/main`
  (145 files, +8362/-316).
- Upstream arrives by merge only, never by rebase or force push. There is no `bun:aphrody` module; the Aphrody
  native libraries are not linked into this Bun.

## Fork patches (kept when merging upstream)

- Built-in replacements of npm packages in `src/js/thirdparty/`: `dotenv.ts` (+ `dotenv/config.ts`, logic in
  `src/js/internal/dotenv.ts`), `picocolors.ts`, `tiny-invariant.ts`, `uuid.ts`, registered in
  `src/resolve_builtins/HardcodedModule.rs`. Tests: `test/js/first_party/{dotenv,picocolors,tiny-invariant,uuid}/`.
- `bun:ffi` `dlopen(path, symbols, { global })` (RTLD_NOW | RTLD_GLOBAL): `src/js/bun/ffi.ts`,
  `src/runtime/ffi/{FFIObject.rs,ffi_body.rs}`, `src/sys/lib.rs`, `packages/bun-types/ffi.d.ts`; test
  `test/js/first_party/runtime/dlopen-global.test.ts`.
- argv0 aliasing: a `--compile` executable renamed `bun`, `bunx` or `node` acts as the engine itself
  (`src/runtime/cli/mod.rs`; test `test/js/first_party/runtime/argv0-bun-alias.test.ts`). The Yolo runtime
  relies on it ([yolo and the fork](../../plans/yolo-fork-unified/PLAN.md)).
- Rust native link propagation for the Linux linker: `scripts/build/rust/native-link.ts`,
  `scripts/build/{rust,bun,ninja,timings}.ts`; test `test/internal/build-rust-native-link.test.ts`.
- Windows: `scripts/vs-shell.ps1` finds a Build Tools-only Visual Studio installation.
- Types and packages: `packages/bun-types/tauri.d.ts`; publishable npm packages renamed to the `@aphrody`
  scope, whose single source of truth is `scripts/aphrody/scope.ts` (`--check` lists remaining upstream
  names, `--write` rewrites them).
- Agent tooling: `.claude/settings.json` unrestricted; SessionStart hooks `scripts/dev/cloud-ssh.sh` and
  `scripts/dev/session-start.ts`; PostToolUse `.claude/hooks/post-edit-format.js`.

## Upstream synchronization

`bun scripts/aphrody/sync-upstream.ts [--push] [--dry-run] [--keep-conflicts] [--root <dir>] [--no-fetch]`, in
the fork, merges `upstream/main` into `main`, retries conflicts as a rename-aware three-way merge through
`scope.ts`, re-applies the `@aphrody` scope and stops (exit 2, merge aborted) on any real conflict. The
workflow `.github/workflows/aphrody-upstream-sync.yml` runs it every 6 hours. After a merge, refresh the docs
mirror here with `bun run docs:bun:update` and check it with `bun run docs:bun:check`.

## Distribution

| Artifact | Producer in the fork | Published as |
| --- | --- | --- |
| Runtime binary | `.github/workflows/aphrody-release.yml` (tag `aphrody-v*` or dispatch) | GitHub release `aphrody-v<version>` (`bun-<os>-<arch>[-<libc>][-<profile>].zip`, `SHA256SUMS.txt`); first: `aphrody-v1.4.3-aphrody.1` |
| Runtime on npm | `scripts/aphrody/publish-runtime.ts` | `@aphrody/bun-runtime` + `@aphrody/bun-runtime-<os>-<arch>` |
| npm packages | `scripts/aphrody/publish-npm.ts`, `.github/workflows/aphrody-publish-npm.yml` | `@aphrody/bun-types`, `@aphrody/bun-inspector-protocol`, `@aphrody/bun-debug-adapter-protocol`, `@aphrody/bun-plugin-svelte`, `@aphrody/bun-plugin-yaml` |
| Rust crates | `scripts/aphrody/publish-crates.ts`, `.github/workflows/aphrody-publish-crates.yml` | crates.io `aphrody-bun-native-plugin`, `aphrody-bun-macro` |

Versions are `<base>-aphrody.<n>`; the binary reports `bun --version` = the upstream base (1.4.3) and
`bun --revision` = `<base>+<fork sha>`. Release `aphrody-v1.4.3-aphrody.2` includes linux-x64 and
linux-aarch64 builds for glibc and musl, x64 baseline builds, darwin-x64/aarch64 and windows-x64/aarch64.
The Alpine Aphrody OS image consumes the musl archives and verifies them with `SHA256SUMS.txt`. The npm name
`@aphrody/bun` is not the fork runtime; never publish or install the runtime under it.

## Contributing

The fork's `CLAUDE.md` (also `AGENTS.md`), `src/CLAUDE.md`, `test/CLAUDE.md`, `REVIEW.md`,
`.claude/docs/landing-prs.md` and the skills in `.claude/skills/` (`verify`, `implementing-jsc-classes-rust`,
`implementing-jsc-classes-cpp`, `javascriptcore-garbage-collector`, `rust-system-calls`,
`writing-bundler-tests`, `writing-dev-server-tests`, `slowest-tests`) are authoritative. `bun bd` builds the
debug binary; `bun bd test <file>` runs a test with it; a new test must fail with
`USE_SYSTEM_BUN=1 bun test <file>` and pass with `bun bd test <file>`; platform-gated Rust needs
`bun run rust:check-all`.
