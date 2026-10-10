#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Bun owns the process; the canonical FFI owns MCP, OS and bridge lifetimes.
if (import.meta.main) {
  const worker = new Worker(new URL("./pc-agent-worker.ts", import.meta.url).href);
  worker.addEventListener("message", (event: MessageEvent<{ code: number }>) => {
    // A persistent server returning is an unexpected stop, including exit 0.
    console.error(`Aphrody PC agent stopped (${event.data.code})`);
    process.exit(event.data.code || 1);
  });
  worker.addEventListener("error", (event) => {
    console.error(`Aphrody PC agent failed: ${event.message}`);
    process.exit(1);
  });
  worker.addEventListener("close", () => process.exit(1));
  // Workers share process memory, not Window origins.
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  worker.postMessage(["mcp-server", "http", ...Bun.argv.slice(2)]);
  // Do not terminate or unload a worker while native runtime threads are alive.
  // systemd stops the whole process with SIGTERM; its socket is recreated on start.
}
