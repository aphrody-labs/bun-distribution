// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");
const rootPkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
const catalog = rootPkg.workspaces?.catalog ?? {};

// 1. Verify that canonical Discord packages are defined in the root catalog
const requiredCatalog = [
  "discordx",
  "@discordx/di",
  "@discordx/pagination",
  "@discordx/importer",
  "@discordx/utilities",
  "discord.js",
  "discord-api-types",
  "@discordjs/rest",
];

for (const pkg of requiredCatalog) {
  if (!catalog[pkg]) {
    throw new Error(`Discord catalog contract violation: '${pkg}' missing in workspaces.catalog`);
  }
}
console.log(
  `✓ Discord catalog contract: all ${requiredCatalog.length} required packages are catalogued`,
);

function run(cwd: string, ...args: string[]): void {
  console.log(`\n${cwd}: bun ${args.join(" ")}`);
  const result = spawnSync(process.execPath, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// 2. Gate @aphrody/discord-kit (Unified Discord bot core framework)
const discordKit = resolve(root, "packages/discord/kit");
for (const gate of ["typecheck", "test", "build"]) {
  run(discordKit, "run", gate);
}

// 3. Gate @aphrody/messaging (Aphrody-owned transport & adapter)
const messaging = resolve(root, "packages/discord/aphrody-messaging");
for (const gate of ["typecheck", "test", "build"]) {
  run(messaging, "run", gate);
}

// 4. Gate consumer bots typecheck & integrity if requested with --full
if (process.argv.includes("--full")) {
  const shenronBot = resolve(root, "apps/shenron/bot");
  run(shenronBot, "run", "type-check");
  run(shenronBot, "run", "test");
}

// 5. Gate native standalone compilation if requested with --compile
if (process.argv.includes("--compile")) {
  run(root, "run", "packages/infra/workspace/src/ops.ts", "discord", "compile", "all", "--smoke");
}

console.log(
  "\nAll Discord monorepo gates, shared packages, and bot integrations passed successfully.",
);
