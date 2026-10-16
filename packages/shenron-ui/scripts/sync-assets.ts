/** Copy the portable UI artwork into a host application's public directory. */
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { uiAssetPaths } from "../src/assets";

const source = resolve(import.meta.dir, "../assets");
const toIndex = Bun.argv.indexOf("--to");
const destination = toIndex >= 0 ? Bun.argv[toIndex + 1] : undefined;
const check = Bun.argv.includes("--check");

if (!destination) {
  throw new Error(
    "Usage: bun sync-assets.ts --to <public-directory> [--check]",
  );
}

const target = resolve(destination);
let count = 0;
let mismatches = 0;

for (const name of uiAssetPaths) {
  const input = Bun.file(join(source, name));
  if (!(await input.exists()))
    throw new Error(`missing packaged UI asset: ${name}`);
  const outputPath = join(target, name);
  const output = Bun.file(outputPath);
  const expected = new Uint8Array(await input.arrayBuffer());
  const actual = (await output.exists())
    ? new Uint8Array(await output.arrayBuffer())
    : null;
  const matches =
    actual !== null &&
    expected.length === actual.length &&
    expected.every((value, index) => value === actual[index]);
  if (!matches) {
    mismatches++;
    if (!check) {
      await mkdir(dirname(outputPath), { recursive: true });
      await Bun.write(outputPath, expected);
    } else {
      console.error(`asset differs: ${name}`);
    }
  }
  count++;
}

console.log(
  `UI assets: ${count} files, ${mismatches} ${check ? "differences" : "copied"}`,
);
if (check && mismatches > 0) process.exitCode = 1;
