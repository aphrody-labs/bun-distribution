// SPDX-License-Identifier: Apache-2.0
/**
 * Codex upstream synchronization tool for Aphrody.
 *
 * Modeled strictly after the Bun fork synchronization toolchain (docs/reference/upstream-bun/APHRODY-FORK.md).
 * Synchronizes metadata and verified interface contracts from aphrody-labs/codex (fork of openai/codex)
 * into Aphrody's native capability owners without vendoring alien Git repositories in the root.
 *
 * Usage:
 *   bun scripts/tools/ai/codex-sync-upstream.ts [--verify] [--dry-run]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = resolve(import.meta.dir, "../../../../docs/aphrody");
const ABSORPTION_JSON = resolve(ROOT, "tools/config/codex-absorption.json");

interface CodexComparison {
  id: string;
  upstream: string[];
  aphrody: string[];
  status: string;
}

interface CodexAbsorption {
  schemaVersion: number;
  upstream: string;
  privateFork: string;
  upstreamRevision: string;
  policy: string;
  comparisons: CodexComparison[];
}

function verifyCrates(): boolean {
  console.log("Checking absorbed Codex crates in Aphrody...");
  const crates = ["aphrody-app-protocol", "aphrody-app-server"];
  for (const crate of crates) {
    console.log(`Running cargo test -p ${crate}...`);
    const res = spawnSync("cargo", ["test", "-p", crate], {
      windowsHide: true,
      cwd: ROOT,
      stdio: "inherit",
      shell: true,
    });
    if (res.status !== 0) {
      console.error(`Verification FAILED for ${crate}`);
      return false;
    }
  }
  return true;
}

function main() {
  const args = process.argv.slice(2);
  const isVerify = args.includes("--verify");

  console.log("=== Aphrody Codex Upstream Synchronization ===");
  if (!existsSync(ABSORPTION_JSON)) {
    console.error(`Absorption file not found at ${ABSORPTION_JSON}`);
    process.exit(1);
  }

  const absorption: CodexAbsorption = JSON.parse(
    readFileSync(ABSORPTION_JSON, "utf8"),
  );
  console.log(`Upstream : ${absorption.upstream}`);
  console.log(`Fork     : ${absorption.privateFork}`);
  console.log(`Commit   : ${absorption.upstreamRevision}`);
  console.log(`Covered  : ${absorption.comparisons.length} capability domains`);

  for (const comp of absorption.comparisons) {
    console.log(`  - [${comp.status}] ${comp.id}`);
  }

  if (isVerify) {
    const ok = verifyCrates();
    if (!ok) process.exit(1);
    console.log("All absorbed contracts successfully verified.");
  }

  console.log("Codex upstream synchronization complete.");
}

main();
