# Aphrody Bun fork

First-party note kept next to the mirrored Bun docs (`bun run docs:bun:update` preserves it; every other
file here is a copy of `docs/` of the fork, see `SOURCE.json`). Verified against the fork checkout on
2026-10-08.

## Repository

- `aphrody-labs/bun` is a public fork of [oven-sh/bun](https://github.com/oven-sh/bun). Remotes:
  `origin` = `aphrody-labs/bun`, `upstream` = `oven-sh/bun`.
- One working branch, `main` (also the default branch) = upstream `main` plus the Aphrody commits. The other
  remote branches are inherited from upstream and feed nothing. On 2026-10-08 `main` was 0 behind and 37 commits
  ahead of `upstream/main` (81 files, +2243/-314).
- Upstream arrives by merge only, never by rebase or force push. There is no `bun:aphrody` module and no
  `packages/aphrody-bun-runtime`; the Aphrody native libraries are not linked into this Bun.

## Fork patches (keep them when merging upstream)

- Built-in replacements of npm packages in `src/js/thirdparty/`: `dotenv.ts` (+ `dotenv/config.ts`, logic in
  `src/js/internal/dotenv.ts`), `picocolors.ts`, `tiny-invariant.ts`, `uuid.ts`, registered in
  `src/resolve_builtins/HardcodedModule.rs`. Tests: `test/js/first_party/{dotenv,picocolors,tiny-invariant,uuid}/`.
- `bun:ffi` `dlopen(path, symbols, { global })` (RTLD_NOW | RTLD_GLOBAL): `src/js/bun/ffi.ts`,
  `src/runtime/ffi/{FFIObject.rs,ffi_body.rs}`, `src/sys/lib.rs`, `packages/bun-types/ffi.d.ts`; test
  `test/js/first_party/runtime/dlopen-global.test.ts`.
- argv0 aliasing: a `--compile` executable renamed `bun`, `bunx` or `node` acts as the engine itself
  (`src/runtime/cli/mod.rs`; test `test/js/first_party/runtime/argv0-bun-alias.test.ts`).
- Rust native link propagation for the Linux linker: `scripts/build/rust/native-link.ts`,
  `scripts/build/{rust,bun,ninja,timings}.ts`; test `test/internal/build-rust-native-link.test.ts`.
- Windows: `scripts/vs-shell.ps1` finds a Build Tools-only Visual Studio installation.
- Types and packages: `packages/bun-types/tauri.d.ts`; publishable npm packages renamed to the `@aphrody`
  scope, whose single source of truth is `scripts/aphrody/scope.ts` (`--check` lists remaining upstream
  names, `--write` rewrites them).
- Agent tooling: `.claude/settings.json` unrestricted; SessionStart hooks `scripts/dev/cloud-ssh.sh` and
  `scripts/dev/session-start.ts`; PostToolUse `.claude/hooks/post-edit-format.js`.

## Upstream synchronization

The canonical tool is in the fork: `bun scripts/aphrody/sync-upstream.ts [--push] [--dry-run]
[--keep-conflicts] [--root <dir>] [--no-fetch]`. It merges `upstream/main` into `main`, retries conflicts as a
rename-aware three-way merge through `scope.ts`, re-applies the `@aphrody` scope and stops (exit 2, merge
aborted) on any real conflict. From the Aphrody monorepo, `bun scripts/tools/vendor/bun_upstream_sync.ts`
reports drift (`--dry-run`) and with `--apply` fetches, delegates the merge to that tool, checks the fork
markers and `scope.ts --check` (`--qualify` adds `bun bd test test/js/first_party/`) and pushes `origin main`.
The checkout is `--checkout <dir>`, else `APHRODY_BUN_CHECKOUT`, else `C:\bun` on Windows, else `vendor/bun`.

## Contributing

The fork's `CLAUDE.md` (also `AGENTS.md`), `src/CLAUDE.md`, `test/CLAUDE.md`, `REVIEW.md`,
`.claude/docs/landing-prs.md` and the skills in `.claude/skills/` (`verify`, `implementing-jsc-classes-rust`,
`implementing-jsc-classes-cpp`, `javascriptcore-garbage-collector`, `rust-system-calls`,
`writing-bundler-tests`, `writing-dev-server-tests`, `slowest-tests`) are authoritative. `bun bd` builds the
debug binary; `bun bd test <file>` runs a test with it; a new test must fail with
`USE_SYSTEM_BUN=1 bun test <file>` and pass with `bun bd test <file>`; platform-gated Rust needs
`bun run rust:check-all`. Fork-only tests live under `test/js/first_party/`.
