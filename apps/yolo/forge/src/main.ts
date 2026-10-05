#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
//! bun-forge — one executable that builds the aphrody-labs/bun fork on a fresh Linux machine.
//!
//!   bun-forge doctor                      what the machine has and lacks
//!   bun-forge bootstrap                   install the toolchain (apt with sudo; LLVM, cmake, rustup into the cache)
//!   bun-forge build [--rev <sha>]         build one commit (default: head of the branch) in a temporary scratch space
//!   bun-forge watch [--once] [--latest]   build every new commit of the branch, oldest first
//!   bun-forge status | unit               last builds | systemd unit running `watch`
//!
//! Options: --repository <url> --branch <name> --profile <p> --lto on|off --jobs <n>
//!          --scratch auto|loop|tmpfs|dir --scratch-size <96G> --interval <s> --home <dir> --artifacts <dir>
//!          --keep (leave the scratch space) --tests (run test/js/first_party with the new binary) --dry-run
//! Environment: BUN_FORGE_HOME, BUN_FORGE_ARTIFACTS, BUN_FORGE_REPOSITORY, BUN_FORGE_BRANCH.
//! The compiled executable embeds Bun and config/bun-forge.json; the build's `bun` is this executable (BUN_BE_BUN=1).

import { ForgeError, parseArgs } from "./plan.ts";
import { bootstrap, build, doctor, status, unit, watch } from "./run.ts";

const VERSION = "0.1.0";
const HELP =
  "bun-forge — one executable that builds the aphrody-labs/bun fork on a fresh Linux machine.\n\n  bun-forge doctor                      what the machine has and lacks\n  bun-forge bootstrap                   install the toolchain (apt with sudo; LLVM, cmake, rustup into the cache)\n  bun-forge build [--rev <sha>]         build one commit (default: head of the branch) in a temporary scratch space\n  bun-forge watch [--once] [--latest]   build every new commit of the branch, oldest first\n  bun-forge status | unit               last builds | systemd unit running `watch`\n\nOptions: --repository <url> --branch <name> --profile <p> --lto on|off --jobs <n>\n         --scratch auto|loop|tmpfs|dir --scratch-size <96G> --interval <s> --home <dir> --artifacts <dir>\n         --keep (leave the scratch space) --tests (run test/js/first_party with the new binary) --dry-run\nEnvironment: BUN_FORGE_HOME, BUN_FORGE_ARTIFACTS, BUN_FORGE_REPOSITORY, BUN_FORGE_BRANCH.\nThe compiled executable embeds Bun and config/bun-forge.json; the build's `bun` is this executable (BUN_BE_BUN=1).";

async function main(argv: string[]): Promise<number> {
  const options = parseArgs(argv, process.env);
  switch (options.command) {
    case "help":
      console.log(HELP);
      return 0;
    case "version":
      console.log(`bun-forge ${VERSION} (Bun ${Bun.version})`);
      return 0;
    case "doctor":
      return doctor(options) ? 0 : 1;
    case "bootstrap":
      await bootstrap(options);
      return doctor(options) ? 0 : 1;
    case "build":
      return (await build(options)) ? 0 : 1;
    case "watch":
      await watch(options);
      return 0;
    case "status":
      status(options);
      return 0;
    case "unit":
      unit(options);
      return 0;
  }
}

if (import.meta.main) {
  try {
    process.exitCode = await main(Bun.argv.slice(2));
  } catch (e) {
    const system = e instanceof Error && typeof (e as NodeJS.ErrnoException).code === "string";
    if (!(e instanceof ForgeError) && !system) throw e;
    console.error(`bun-forge: ${(e as Error).message}`);
    process.exitCode = 2;
  }
}
