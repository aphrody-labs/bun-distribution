import { readdir } from "node:fs/promises";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "packages");
const names = (await readdir(root, { withFileTypes: true }))
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

for (const name of names) console.log(`packages/${name}`);
