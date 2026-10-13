#!/usr/bin/env bun
import { resolve } from "node:path";
import { runProcess } from "../packages/workspace/src/process.ts";

const root = resolve(import.meta.dir, "..");
const checks = ["typecheck", "lint", "format:check"];
for (const check of checks) {
  const result = await runProcess([process.execPath, "run", "--bun", check], root, {
    timeoutMs: 300_000,
    maxOutputBytes: 64 * 1024 * 1024,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.code !== 0) process.exit(result.code);
}
