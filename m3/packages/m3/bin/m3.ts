#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// `m3` executable: see src/cli.ts for the commands.
import { runCli } from "../src/cli.ts";

try {
  const code = await runCli(Bun.argv.slice(2));
  // `m3 dev` keeps running through its server; every other command exits here.
  if (code !== 0) process.exit(code);
} catch (error) {
  console.error(`m3: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}
