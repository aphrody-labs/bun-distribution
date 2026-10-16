// SPDX-License-Identifier: Apache-2.0
/** Copy the shared Rose Griffon assets listed in website-public.json into a public directory. */
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const manifest = (await Bun.file(join(root, "website-public.json")).json()) as { paths: string[] };
const toIndex = Bun.argv.indexOf("--to");
const destination = toIndex >= 0 ? Bun.argv[toIndex + 1] : undefined;
const check = Bun.argv.includes("--check");
if (!destination) throw new Error("Usage: bun sync-website-public.ts --to <public-directory> [--check]");

const target = resolve(destination);
let changed = 0;
for (const name of manifest.paths) {
  const input = Bun.file(join(root, "public", name));
  if (!(await input.exists())) throw new Error(`missing shared asset: ${name}`);
  const outputPath = join(target, name);
  const output = Bun.file(outputPath);
  const expected = new Uint8Array(await input.arrayBuffer());
  const actual = (await output.exists()) ? new Uint8Array(await output.arrayBuffer()) : null;
  if (actual && actual.length === expected.length && actual.every((byte, index) => byte === expected[index])) continue;
  changed++;
  if (check) console.error(`asset differs: ${name}`);
  else {
    await mkdir(dirname(outputPath), { recursive: true });
    await Bun.write(outputPath, expected);
  }
}
console.log(`RG shared assets: ${manifest.paths.length} files, ${changed} ${check ? "differences" : "copied"}`);
if (check && changed > 0) process.exitCode = 1;
