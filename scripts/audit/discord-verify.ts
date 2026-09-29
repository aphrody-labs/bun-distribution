// SPDX-License-Identifier: Apache-2.0
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { resolve } from "node:path";

interface ExtractedFile {
  target: string;
  target_sha256: string;
}

interface ExtractionRecord {
  tracked_files: number;
  files: ExtractedFile[];
}

const root = resolve(import.meta.dir, "../..");
const source = resolve(root, "packages/discord/source/repository");
const record = JSON.parse(
  readFileSync(resolve(root, "docs/migration/discord-complete-source-extraction.json"), "utf8"),
) as ExtractionRecord;

if (record.files.length !== record.tracked_files) {
  throw new Error(
    `Discord extraction record contains ${record.files.length} files, expected ${record.tracked_files}`,
  );
}

for (const file of record.files) {
  const path = resolve(root, file.target);
  if (!path.startsWith(`${source}/`))
    throw new Error(`Discord extraction path escapes source snapshot: ${file.target}`);
  const digest = createHash("sha256").update(readFileSync(path)).digest("hex");
  if (digest !== file.target_sha256)
    throw new Error(`Discord extraction differs from recorded source: ${file.target}`);
}
console.log(`Discord source integrity: ${record.files.length} files match recorded SHA-256 values`);

if (!process.argv.includes("--full")) process.exit(0);

function run(cwd: string, ...args: string[]): void {
  console.log(`\n${cwd}: bun ${args.join(" ")}`);
  const result = spawnSync(process.execPath, args, { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run(source, "install", "--frozen-lockfile");
// unplugin-dts resolves its TypeScript 6 JS API from the workspace root, while
// Bun installs the declared dependency under packages/ui. Expose that locked
// copy without changing the immutable source snapshot or its lockfile.
const typescript6 = resolve(source, "node_modules/@typescript/typescript6");
const declaredTypescript6 = resolve(source, "packages/ui/node_modules/@typescript/typescript6");
if (!existsSync(declaredTypescript6))
  throw new Error("Discord UI TypeScript 6 dependency is missing");
if (!existsSync(typescript6)) {
  mkdirSync(resolve(source, "node_modules/@typescript"), { recursive: true });
  symlinkSync(declaredTypescript6, typescript6, "dir");
} else if (realpathSync(typescript6) !== realpathSync(declaredTypescript6)) {
  throw new Error(
    "Discord root TypeScript 6 resolves to a different version than the UI dependency",
  );
}
for (const gate of ["format", "check", "build", "typecheck", "test", "verify:messaging-pack"]) {
  run(source, "run", gate);
}

const messaging = resolve(root, "packages/discord/aphrody-messaging");
for (const gate of ["typecheck", "test", "build"]) run(messaging, "run", gate);
console.log("\nDiscord source and root messaging gates passed");
