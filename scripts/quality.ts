#!/usr/bin/env bun
import { resolve } from "node:path";
import { runProcess } from "@aphrody/bun-workspace/process";

const root = resolve(import.meta.dir, "..");
for (const check of ["typecheck", "lint", "format:check"]) {
  const result = await runProcess([process.execPath, "run", "--bun", check], root, {
    timeoutMs: 300_000,
    maxOutputBytes: 64 * 1024 * 1024,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.code !== 0) process.exit(result.code);
}
