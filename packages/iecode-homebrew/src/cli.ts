#!/usr/bin/env bun
import { existsSync } from "node:fs";

const repoRoot = new URL("../../../", import.meta.url).pathname;
const manifestPath = `${repoRoot}crates/aphrody-homebrew/Cargo.toml`;
const args = Bun.argv.slice(2);

if (args.length === 0 || args[0] === "help" || args[0] === "--help") {
  console.log("Usage: bun run iecode-homebrew <targets|doctor|build nds|build 3ds>");
  process.exit(0);
}

const binary = process.env.IECODE_HOMEBREW_BINARY || Bun.which("aphrody-homebrew");
if (!binary && !existsSync(manifestPath)) {
  console.error("Install aphrody-homebrew on PATH or set IECODE_HOMEBREW_BINARY.");
  process.exit(1);
}
const proc = Bun.spawn(
  binary
    ? [binary, ...args]
    : ["cargo", "run", "--quiet", "--manifest-path", manifestPath, "--", ...args],
  { cwd: repoRoot, stdin: "inherit", stdout: "inherit", stderr: "inherit" },
);
process.exit(await proc.exited);
