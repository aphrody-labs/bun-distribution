#!/usr/bin/env bun

const checks = ["doctor", "typecheck", "lint", "format:check"];
for (const check of checks) {
  const controller = new AbortController();
  const child = Bun.spawn([process.execPath, "run", "--bun", check], {
    cwd: Bun.fileURLToPath(new URL("../", import.meta.url)),
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
