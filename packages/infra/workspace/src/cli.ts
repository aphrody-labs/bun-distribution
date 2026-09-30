#!/usr/bin/env bun
import { runInfra } from "./runtime.ts";

const result = await runInfra({
  args: process.argv.slice(2),
  stdout: "inherit",
  stderr: "inherit",
});
process.exit(result.exitCode);
