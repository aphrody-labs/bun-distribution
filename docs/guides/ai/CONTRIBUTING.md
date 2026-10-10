<!-- SPDX-License-Identifier: Apache-2.0 -->
# Contributing to aphrody-ai

Open an issue first if the change is non-trivial; otherwise send a pull
request against `main`.

## Pre-flight

The Cargo workspace needs the sibling category repositories next to this one
(see [README.md](../../products/ai/README.md#sibling-repositories)):

```bash
for r in ai os web contracts compat shell ui native infra; do
  git clone https://github.com/aphrody-code/aphrody-$r.git
done
cd aphrody-ai
export RUSTC_WRAPPER=
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo deny check
bun install --frozen-lockfile && bun run typecheck && bun run test
```

If any of these fails on `main` before you have touched a file, open an issue
rather than working around it.

## What gets merged

Pull requests that move [`docs/PLAN.md` (not in repo)](../../plans/ai/PLAN.md) forward are the
easiest review: pick a pending row, do it end to end (code, test, plan line
updated in the same commit). Other changes are welcome with the reason stated
in the description.

## Hard rules

- The gates in the [README](../../products/ai/README.md#build-and-test) are green on the pull
  request, run locally (GitHub Actions is disabled on the org).
- Dependency direction stays one-way: nothing in a sibling repository may
  depend on `aphrody-ai` through Cargo, and sibling code is not copied here.
- Every dependency goes through the root `[workspace.dependencies]`; crates
  use `workspace = true` and `[lints] workspace = true`.
- Apache-2.0 SPDX header on every new source file
  (`// SPDX-License-Identifier: Apache-2.0`).
- Conventional Commits (`feat:`, `fix:`, `build:`, `ci:`, `docs:`, `chore:`,
  `refactor:`, `test:`); subject under 70 characters.
- No emoji in source or commit messages.
- No mock data: real implementations only. Code that cannot work on a platform
  returns a typed error behind `cfg`, never `todo!()`.
- Do not write personal usernames or hard-coded hosts, IPs, ports or absolute
  paths into tracked files; infrastructure values come from `aphrody-infra`.
- User-visible changes add a line to the `[Unreleased]` section of
  [`CHANGELOG.md`](../../reference/ai/CHANGELOG.md).

## Cross-platform priority

1. **Linux** — if it does not build and test on Linux, it does not merge.
2. **Windows 11** — full feature parity; Windows-only code sits behind
   `#[cfg(target_os = "windows")]`.
3. **WebAssembly** — crates that can compile to `wasm32-unknown-unknown`
   should keep doing so.

macOS is best-effort and never blocks a merge.

## Getting help

- Bug? Use the **Bug report** issue template.
- Question? Use the **Question** template.
- Security? See [`SECURITY.md`](../../research/ai/SECURITY.md) — do not open public issues for
  vulnerabilities.

## License

By submitting a pull request you agree that your contribution is licensed
under Apache-2.0 (the project license). No CLA, no copyright assignment.
