#!/usr/bin/env bun
import {
  inspectCargoWorkspace,
  loadConfig,
  runNative,
} from "@aphrody/bun-workspace";

const [action = "metadata", ...args] = Bun.argv.slice(2);
const config = await loadConfig();
if (action === "metadata") {
  console.log(
    JSON.stringify(
      await inspectCargoWorkspace(config, { runtimePolicy: "development" }),
      null,
      2,
    ),
  );
} else if (action === "fmt") {
  process.exitCode = await runNative(
    config,
    ["cargo", "fmt", "--all", "--", "--check"],
    {
      timeoutMs: 60_000,
      runtimePolicy: "development",
    },
  );
} else if (action === "check" || action === "test") {
  process.exitCode = await runNative(
    config,
    ["cargo", action, "--locked", "--workspace"],
    {
      timeoutMs: 1_800_000,
      runtimePolicy: "development",
    },
  );
} else if (action === "exec") {
  if (args[0] !== "--" || args.length < 2)
    throw new Error("Usage: bun scripts/cargo.ts exec -- <cargo arguments>");
  process.exitCode = await runNative(config, ["cargo", ...args.slice(1)], {
    cwd: process.cwd(),
    timeoutMs: 1_800_000,
    runtimePolicy: "development",
  });
} else {
  throw new Error(
    "Usage: bun scripts/cargo.ts metadata|fmt|check|test|exec -- <cargo arguments>",
  );
}
