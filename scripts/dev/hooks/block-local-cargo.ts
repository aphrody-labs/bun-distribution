#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * Claude Code PreToolUse hook (Bash): heavy Cargo never runs in WSL, it crashes it.
 * Reads the hook JSON on stdin; exits 2 (blocking) when a command would compile locally.
 * Remote routes stay allowed: scripts/build/rust/vps-cargo.ts, the build factory, ssh,
 * APHRODY_BUILD_HOST=vps. `cargo fmt` and `cargo metadata` are light and stay allowed.
 */

const HEAVY = "build|b|check|c|test|t|clippy|run|r|bench|nextest|doc|d|install|rustc|xwin|zigbuild";
const LOCAL_CARGO = new RegExp(String.raw`(^|[\s;&|(])cargo(\s+\+\S+)?\s+(${HEAVY})(\s|$)`);
const LOCAL_SERIAL = new RegExp(String.raw`cargo-serial\.sh(\s+\+\S+)?\s+(${HEAVY})(\s|$)`);
const REMOTE =
  /vps-cargo\.ts|build-factory|APHRODY_BUILD_HOST=vps|(^|[\s;&|])ssh\s|infra ssh|infra_exec/;

export function blocksLocalCargo(command: string): boolean {
  if (REMOTE.test(command)) return false;
  return LOCAL_CARGO.test(command) || LOCAL_SERIAL.test(command);
}

if (import.meta.main) {
  const input = (await Bun.stdin.json().catch(() => ({}))) as {
    tool_input?: { command?: unknown };
  };
  const command = typeof input.tool_input?.command === "string" ? input.tool_input.command : "";
  if (blocksLocalCargo(command)) {
    console.error(
      "Heavy Cargo is blocked in WSL (it crashes it). Run it on the VPS at the exact worktree state: " +
        "bun scripts/build/rust/vps-cargo.ts run -- <cargo arguments> " +
        "(cargo fmt and cargo metadata --offline stay local).",
    );
    process.exit(2);
  }
}
