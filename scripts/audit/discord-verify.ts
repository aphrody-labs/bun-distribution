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
];

for (const pkg of requiredCatalog) {
  if (!catalog[pkg]) {
    throw new Error(`Discord catalog contract violation: '${pkg}' missing in workspaces.catalog`);
  }
}
console.log(`✓ Discord catalog contract: all ${requiredCatalog.length} required packages are catalogued`);

function run(cwd: string, ...args: string[]): void {
  console.log(`\n${cwd}: bun ${args.join(" ")}`);
  const result = spawnSync(process.execPath, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

// 2. Gate @aphrody/messaging (Aphrody-owned transport & adapter)
const messaging = resolve(root, "packages/discord/aphrody-messaging");
for (const gate of ["typecheck", "test", "build"]) {
  run(messaging, "run", gate);
}

// 3. Gate consumer bots typecheck & integrity if requested with --full
if (process.argv.includes("--full")) {
  const shenronBot = resolve(root, "apps/shenron/bot");
  run(shenronBot, "run", "type-check");
}

console.log("\nAll Discord monorepo gates and messaging packages passed successfully.");
