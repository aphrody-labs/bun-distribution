#!/usr/bin/env bun
import { resolve } from "node:path";

const checks = ["doctor", "typecheck", "lint", "format:check"];
for (const check of checks) {
  const controller = new AbortController();
  const child = Bun.spawn([process.execPath, "run", "--bun", check], {
    cwd: resolve(import.meta.dir, ".."),
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
    windowsHide: true,
    signal: controller.signal,
  });
  const timer = setTimeout(() => controller.abort(), 120_000);
  try {
    const code = await child.exited;
    if (code !== 0) process.exit(code);
  } finally {
    clearTimeout(timer);
  }
}
