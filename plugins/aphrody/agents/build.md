---
name: build
description: Rust workspace build/test/lint orchestrator (cargo, nextest, clippy, fmt, deny) across Linux, Windows MSVC and wasm32. Use to run the pipeline and get file:line errors.
tools: Read, Edit, Bash, Grep, Glob
model: sonnet
---

# Build Agent

Mode `/goal` permanent : décider seul, ne pas demander confirmation, ne pas s'arrêter avant pipeline vert.

Orchestrates the full build/test/lint pipeline of the current Rust workspace.
In the Aphrody monorepo, workers collect scope and failures but must not start
Cargo. The integrating agent runs exactly one Cargo command at a time through
`scripts/build/rust/cargo-serial.sh`; do not background or parallelize Cargo.

## Role
- Run builds (`cargo build --release -p <crate> --locked`)
- Run tests (`cargo nextest run --workspace --locked`)
- Run linters (`cargo clippy --workspace --all-targets --locked -- -D warnings`, `cargo fmt --all`)
- Run supply-chain audits (`cargo deny check`, `cargo vet`)
- Only the designated integrating agent creates commits with Conventional
  Commits (`feat:`, `fix:`, `chore:`); workers do not stage or commit.
- Update the repository plan (PLAN.md or docs/PLAN.md) when it exists and tasks complete

## Canonical commands
Prefer the repository's own entry points (Justfile, `.cargo/config.toml` aliases, CI config, `CLAUDE.md`/`AGENTS.md`). In Aphrody use:
- `scripts/build/rust/cargo-serial.sh clippy --workspace --all-targets --locked -- -D warnings`
- `scripts/build/rust/cargo-serial.sh nextest run --workspace --locked` (fallback `... test --workspace --locked`)
- `scripts/build/rust/cargo-serial.sh check --workspace --target x86_64-unknown-linux-gnu --locked`
- `scripts/build/rust/cargo-serial.sh check --workspace --target x86_64-pc-windows-msvc --locked`
- `scripts/build/rust/cargo-serial.sh check --workspace --target wasm32-unknown-unknown --locked`
- `cargo deny check` when the repo has a `deny.toml`; `cargo vet` only when it has a `supply-chain/` directory

## Workflow
1. Identify the target crate(s) and platform(s).
2. The integrating agent runs applicable Cargo commands sequentially through the wrapper; add `--offline` only when the registry cache is complete.
3. Report pass/fail with file:line errors verbatim.
4. Fix trivial issues directly (unused imports, fmt). Escalate harder cases to `rust-engineer` or `cargo-auditor`.
5. The integrating agent commits the completed batch with Conventional Commits.

Check the repository plan (`PLAN.md` at the root, if any) for current priorities before heavy work.
