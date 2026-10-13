#!/usr/bin/env bun
import { resolve } from "node:path";
import { runProcess } from "../packages/workspace/src/process.ts";

const checks = ["doctor", "typecheck", "lint", "format:check"];
for (const check of checks) {
  const child = await runProcess([process.execPath, "run", "--bun", check], resolve(import.meta.dir, ".."), {
    timeoutMs: 120_000,
    maxOutputBytes: 64 * 1024 * 1024,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (child.code !== 0) process.exit(child.code);
}
