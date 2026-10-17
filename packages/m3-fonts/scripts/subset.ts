// SPDX-License-Identifier: Apache-2.0
// Subsets the variable TrueType sources into WOFF2 (fonts/web) with fontTools through uv
// (scripts/subset.py, pinned in its inline metadata), records the produced faces in
// src/subsets.json, then regenerates the stylesheets.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { SUBSET_JOBS } from "../src/index";

const root = join(import.meta.dir, "..");
await rm(join(root, "fonts", "web"), { recursive: true, force: true });
const proc = Bun.spawn(["uv", "run", "--quiet", "--script", join(import.meta.dir, "subset.py"), root], {
  windowsHide: true,
  stdin: new TextEncoder().encode(JSON.stringify(SUBSET_JOBS)),
  stdout: "pipe",
  stderr: "inherit",
});
const out = await new Response(proc.stdout).text();
if ((await proc.exited) !== 0) throw new Error("scripts/subset.py failed");
const faces = JSON.parse(out) as { file: string; bytes: number }[];
await Bun.write(join(root, "src", "subsets.json"), `${JSON.stringify(faces, null, 2)}\n`);
const total = faces.reduce((n, f) => n + f.bytes, 0);
console.log(`${faces.length} faces, ${(total / 1024 / 1024).toFixed(2)} MiB`);
// A fresh process: this one already loaded the manifest with the previous subsets.json.
const gen = Bun.spawn(["bun", join(import.meta.dir, "generate.ts")], {
  windowsHide: true,
  stdout: "inherit",
  stderr: "inherit",
});
if ((await gen.exited) !== 0) throw new Error("scripts/generate.ts failed");
