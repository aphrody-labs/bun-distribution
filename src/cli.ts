#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// bunos: the single command line of Bun OS. Commands live in src/cli/commands.ts (one registry);
// `bunos` lists them, `bunos commands --check` verifies every route.
import { main } from "./cli/main.ts";

try {
  process.exitCode = await main(Bun.argv.slice(2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
