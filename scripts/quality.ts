#!/usr/bin/env bun
import { runProcess } from "@aphrody/bun-workspace/process";

const checks = ["typecheck", "lint:all", "fmt:check"];
for (const check of checks) {
  const result = await runProcess([process.execPath, "run", "--bun", check], process.cwd(), {
    timeoutMs: 300_000,
    maxOutputBytes: 64 * 1024 * 1024,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  if (result.code !== 0) process.exit(result.code);
}
