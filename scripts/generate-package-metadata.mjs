import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { lockedVersion } from "./lib/bun-lock.mjs";
import { ensureGeneratedFile } from "./lib/generated-file.mjs";

const arguments_ = new Set(process.argv.slice(2));
for (const argument of arguments_)
  if (argument !== "--check")
    throw new Error(`Unknown package metadata option: ${argument}`);

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(
  await readFile(join(root, "package.json"), "utf8"),
);
const skill = await readFile(
  join(root, ".agents/skills/reverse-engineer-anything/SKILL.md"),
  "utf8",
);
const skillVersion = /^\s{2}version:\s*"([^"]+)"\s*$/mu.exec(skill)?.[1];
if (skillVersion === undefined)
  throw new Error("Missing reverse-engineer-anything skill metadata version");
const source = `/** Generated from package.json and bun.lock; do not edit. */
export const PACKAGE_METADATA = {
  name: ${JSON.stringify(packageJson.name)},
  version: ${JSON.stringify(packageJson.version)}, // x-release-please-version
  serverSdkVersion: ${JSON.stringify(await lockedVersion(root, "@modelcontextprotocol/server"))},
  clientSdkVersion: ${JSON.stringify(await lockedVersion(root, "@modelcontextprotocol/client"))},
  coreSdkVersion: ${JSON.stringify(await lockedVersion(root, "@modelcontextprotocol/core"))},
  skillVersion: ${JSON.stringify(skillVersion)},
} as const;
`;
const outputPath = join(root, "src/generatedPackageMetadata.ts");
await ensureGeneratedFile({
  path: outputPath,
  source,
  check: arguments_.has("--check"),
  generateCommand: "bun run metadata:generate",
});
