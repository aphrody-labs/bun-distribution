---
name: rust-target-check
description: "Run cargo check on Linux x86_64, Windows MSVC and wasm32 in parallel to verify a change is cross-platform."
version: "1.0.0"
argument-hint: [crate-name | --workspace]
allowed-tools: Bash, Read
disable-model-invocation: false
---

# rust-target-check — 3-target parallel verifier

Mode `/goal` permanent : décider seul, ne pas s'arrêter avant verdict complet.

The workspace must compile on the **3 priority cross-platform targets**:

1. `x86_64-unknown-linux-gnu` (Linux Ubuntu 26.04, **target #1 blocking**)
2. `x86_64-pc-windows-msvc` (Windows 11 Insider Canary, target #2 blocking)
3. `wasm32-unknown-unknown` (WebAssembly, target #3 blocking)

This skill spawns the three `cargo check --offline` processes **in parallel**
and reports a consolidated verdict. Failing on the target is non-negotiable
per `docs/SOURCE_OF_TRUTH.md` rules.

## When to use

- The user types `/rust-target-check` or asks to validate cross-platform
- A workspace member was modified and the user wants confidence before pushing
- `Cargo.toml` was edited (deps, features, profile)
- After a major rust-engineer agent run

## When to skip

- Pure documentation edits (`.md`)
- TypeScript / Bun changes only (no `.rs` touched)
- Single-package scratchpad work where the user already knows it's
  non-portable (then they should use plain `cargo check -p X` directly)

## Workflow

1. Resolve scope:
   - If `argument-hint` is a crate name → `cargo check -p <name>` on each target
   - If `--workspace` or empty → `cargo check --workspace` on each target
2. Spawn the 3 cargo processes in parallel:

   **Linux / macOS (Bash) :**
   ```bash
   T="${TMPDIR:-/tmp}"
   cargo check --offline --locked --target x86_64-unknown-linux-gnu --message-format=short > "$T/xc-linux.log" 2>&1 & LINUX=$!
   cargo check --offline --locked --target x86_64-pc-windows-msvc   --message-format=short > "$T/xc-win.log"   2>&1 & WIN=$!
   cargo check --offline --locked --target wasm32-unknown-unknown   --message-format=short > "$T/xc-wasm.log"  2>&1 & WASM=$!
   wait $LINUX; LINUX_EC=$?; wait $WIN; WIN_EC=$?; wait $WASM; WASM_EC=$?
   ```

   **Windows (PowerShell) :**
   ```powershell
   $t = $env:TEMP
   $j1 = Start-Job { cargo check --offline --locked --target x86_64-pc-windows-msvc --message-format=short }
   $j2 = Start-Job { cargo check --offline --locked --target x86_64-unknown-linux-gnu --message-format=short }
   $j3 = Start-Job { cargo check --offline --locked --target wasm32-unknown-unknown --message-format=short }
   Wait-Job $j1, $j2, $j3 | Out-Null
   $r1 = Receive-Job $j1; $r2 = Receive-Job $j2; $r3 = Receive-Job $j3
   ```
3. Report verdict per target:
   | Target | Verdict | Exit code | Notes |
   |---|---|---|---|
   | Windows MSVC (`x86_64-pc-windows-msvc`) | ✅ / ❌ | … | Target native hôte Win11 |
   | Linux x86_64 (`x86_64-unknown-linux-gnu`) | ✅ / ❌ | … | Target #1 blocking VPS / WSL / Prod |
   | WASM (`wasm32-unknown-unknown` / `wasm32-wasip1`) | ✅ / ❌ | … | Target sandboxing / navigateur |

4. For each failed target, tail the log and surface the first error block
   (don't dump the whole log).
5. Exit semantics: skill returns success only if **all 3 pass**.

## Anti-stub clause

- Do **not** fabricate a "passing" report — always read the real exit code.
- If `cargo` is not installed: exit immediately with a clear setup error
  (no fake-pass).
- If cross-compile toolchain is missing for a target (e.g. on Windows host
  without `cargo zigbuild`), mark that target as **skipped (toolchain
  missing)** and **do not silently mark it green**.

## Pre-requisites

- `rustup target list --installed` should include the 3 targets
- For wasm32 / cross from Windows: `cargo install cargo-zigbuild` (optional
  for the wasm path, recommended for Linux-from-Windows)
