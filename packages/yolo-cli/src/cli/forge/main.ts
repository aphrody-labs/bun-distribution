#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
//! Builds the aphrody-labs/bun fork on a fresh Linux machine. Run it as `yolo forge <command>`; the yolo CLI
//! loads this module in-process and calls `runForge`.
//!
//!   yolo forge doctor                      what the machine has and lacks
//!   yolo forge bootstrap                   install the toolchain (apt with sudo; LLVM, cmake, rustup into the cache)
//!   yolo forge build [--rev <sha>]         build one commit (default: head of the branch) in a temporary scratch space
//!   yolo forge watch [--once] [--latest]   build every new commit of the branch, oldest first
//!   yolo forge status | unit               last builds | systemd unit running `watch`
//!
//! Options: --repository <url> --branch <name> --profile <p> --lto on|off --jobs <n>
//!          --scratch auto|loop|tmpfs|dir --scratch-size <96G> --interval <s> --home <dir> --artifacts <dir>
//!          --keep (leave the scratch space) --tests (run test/js/first_party with the new binary) --dry-run
//!          --yolo-root <monorepo> --yolo-asset <lib> (compile the yolo CLI onto the new engine: one `yolo` file, aliases `bun` and `vu` by argv0)
//! Environment: BUN_FORGE_HOME, BUN_FORGE_ARTIFACTS, BUN_FORGE_REPOSITORY, BUN_FORGE_BRANCH, BUN_FORGE_YOLO_ROOT, BUN_FORGE_YOLO_ASSET.
//! A compiled host (yolo or the standalone executable) embeds Bun; the build's `bun` is that executable (BUN_BE_BUN=1).

import { ForgeError, parseArgs } from "./plan.ts";
import { bootstrap, build, doctor, status, unit, watch } from "./run.ts";

const VERSION = "0.1.1";
const HELP =
  "yolo forge — builds the aphrody-labs/bun fork on a fresh Linux machine.\n\n  yolo forge doctor                      what the machine has and lacks\n  yolo forge bootstrap                   install the toolchain (apt with sudo; LLVM, cmake, rustup into the cache)\n  yolo forge build [--rev <sha>]         build one commit (default: head of the branch) in a temporary scratch space\n  yolo forge watch [--once] [--latest]   build every new commit of the branch, oldest first\n  yolo forge status | unit               last builds | systemd unit running `watch`\n\nOptions: --repository <url> --branch <name> --profile <p> --lto on|off --jobs <n>\n         --scratch auto|loop|tmpfs|dir --scratch-size <96G> --interval <s> --home <dir> --artifacts <dir>\n         --keep (leave the scratch space) --tests (run test/js/first_party with the new binary) --dry-run\n         --yolo-root <monorepo> --yolo-asset <lib> (compile the yolo CLI onto the new engine: one `yolo` file, aliases `bun` and `vu` selected by argv0)\nEnvironment: BUN_FORGE_HOME, BUN_FORGE_ARTIFACTS, BUN_FORGE_REPOSITORY, BUN_FORGE_BRANCH, BUN_FORGE_YOLO_ROOT, BUN_FORGE_YOLO_ASSET.\nA compiled host (yolo or the standalone executable) embeds Bun; the build's `bun` is that executable (BUN_BE_BUN=1).";

/** The command systemd runs to reach this forge: the standalone program, or `yolo forge` when yolo hosts it. */
function selfCommand(): string {
  const compiled = Bun.main.startsWith("/$bunfs/") || Bun.main.startsWith("B:/~BUN/");
  const program = compiled ? process.execPath : `${Bun.which("bun") ?? "bun"} ${Bun.main}`;
  return import.meta.main ? program : `${program} forge`;
}

async function main(argv: string[], invocationCommand?: string): Promise<number> {
  const options = parseArgs(argv, process.env);
  switch (options.command) {
    case "help":
      console.log(HELP);
      return 0;
    case "version":
      console.log(`yolo forge ${VERSION} (Bun ${Bun.version})`);
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
      unit(options, invocationCommand ?? selfCommand());
      return 0;
  }
}

/** `yolo forge <argv>`: the exit status; refused input and system errors are reported and end with status 2. */
export async function runForge(argv: string[], invocationCommand?: string): Promise<number> {
  try {
    return await main(argv, invocationCommand);
  } catch (e) {
    const system = e instanceof Error && typeof (e as NodeJS.ErrnoException).code === "string";
    if (!(e instanceof ForgeError) && !system) throw e;
    console.error(`yolo forge: ${(e as Error).message}`);
    return 2;
  }
}

if (import.meta.main) {
  void runForge(Bun.argv.slice(2)).then(
    code => {
      process.exitCode = code;
      return code;
    },
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
      return 1;
    },
  );
}
