#!/usr/bin/env bun
import { inspectCargoWorkspace, loadConfig, runNative } from "../packages/workspace/src/index.ts";

const [action = "metadata"] = Bun.argv.slice(2);
const config = await loadConfig();
if (action === "metadata") {
  console.log(JSON.stringify(await inspectCargoWorkspace(config), null, 2));
} else if (action === "fmt") {
  process.exitCode = await runNative(config, ["cargo", "fmt", "--all", "--", "--check"], { timeoutMs: 60_000 });
} else if (action === "check" || action === "test") {
  process.exitCode = await runNative(config, ["cargo", action, "--locked", "--workspace"], { timeoutMs: 1_800_000 });
} else {
  throw new Error("Usage: bun scripts/cargo.ts metadata|fmt|check|test");
}
