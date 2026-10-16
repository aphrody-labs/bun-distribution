#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Materialise the Material Symbols catalogue from the forked repo (vendor/material-design-icons).
// The fork holds ~2.1M SVG variants, so a plain checkout is not viable. This script lists the git
// tree, batch-fetches only the wanted blobs and applies an exact-path (non-cone) sparse checkout.
// Default set: every symbol x {outlined, rounded, sharp} x {regular, fill1} at 24px, weight 400, grade 0.
// Usage: bun sync-catalogue.ts [--weights 300,500] [--sizes 20,40,48] [--grades 200,-25] [--check]
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const FORK = join(import.meta.dir, "../../../vendor/material-design-icons");
const args = process.argv.slice(2);
const list = (name: string) =>
  (args[args.indexOf(`--${name}`) + 1] ?? "").split(",").filter(Boolean);
const has = (name: string) => args.includes(`--${name}`);

const weights = list("weights"); // extra weights besides 400
const sizes = ["24", ...list("sizes")];
const grades = list("grades"); // extra grades besides 0 (200, -25 appear as grad200 / gradN25)

const git = (...a: string[]) => {
  const r = Bun.spawnSync(["git", "-C", FORK, ...a], {
    windowsHide: true,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr.toString().trim()}`);
  return r.stdout.toString();
};

if (!existsSync(join(FORK, ".git")) && !existsSync(join(FORK, "..", "..", ".git"))) {
  console.error(
    "vendor/material-design-icons is not vendored: clone aphrody-labs/material-design-icons (--no-checkout --filter=blob:none) there first",
  );
  process.exit(1);
}

const gradeTag = (g: string) => `grad${g.startsWith("-") ? `N${g.slice(1)}` : g}`;
const wanted = new Set<string>();
const variants: string[] = [];
for (const size of sizes) {
  for (const fill of ["", "_fill1"]) {
    variants.push(`${fill}_${size}px`);
    for (const g of grades) variants.push(`_${gradeTag(g)}${fill}_${size}px`);
    for (const w of weights) {
      variants.push(`_wght${w}${fill}_${size}px`);
      for (const g of grades) variants.push(`_wght${w}_${gradeTag(g)}${fill}_${size}px`);
    }
  }
}
const suffixes = new Set(variants);

const rows = git("ls-tree", "-r", "HEAD", "symbols/web").trimEnd().split("\n");
const oids: string[] = [];
const patterns: string[] = [];
const symbols = new Set<string>();
for (const row of rows) {
  const tab = row.indexOf("\t");
  const path = row.slice(tab + 1);
  const [, , name, styleDir, file] = path.split("/");
  if (!file || !styleDir?.startsWith("materialsymbols")) continue;
  if (!file.startsWith(name) || !file.endsWith(".svg")) continue;
  if (!suffixes.has(file.slice(name.length, -".svg".length))) continue;
  wanted.add(path);
  oids.push(row.slice(0, tab).split(" ")[2]!);
  patterns.push(`/${path}`);
  symbols.add(name);
}

const have = existsSync(join(FORK, "symbols/web"))
  ? readdirSync(join(FORK, "symbols/web")).length
  : 0;
console.log(
  `catalogue: ${symbols.size} symbols, ${wanted.size} svg files wanted, ${have} symbol dirs present`,
);
if (has("check")) process.exit(have >= symbols.size ? 0 : 1);

// Batch-fetch the blobs (one promisor request per chunk), then apply the exact-path sparse set.
const CHUNK = 5000;
for (let i = 0; i < oids.length; i += CHUNK) {
  const body = oids.slice(i, i + CHUNK).join("\n") + "\n";
  const r = Bun.spawnSync(
    [
      "git",
      "-C",
      FORK,
      "-c",
      "fetch.negotiationAlgorithm=noop",
      "fetch",
      "origin",
      "--no-tags",
      "--no-write-fetch-head",
      "--recurse-submodules=no",
      "--filter=blob:none",
      "--stdin",
    ],
    { windowsHide: true, stdin: new TextEncoder().encode(body), stdout: "pipe", stderr: "pipe" },
  );
  if (r.exitCode !== 0) throw new Error(`fetch chunk ${i / CHUNK}: ${r.stderr.toString().trim()}`);
}
git("config", "core.sparseCheckoutCone", "false");
const set = Bun.spawnSync(["git", "-C", FORK, "sparse-checkout", "set", "--no-cone", "--stdin"], {
  windowsHide: true,
  stdin: new TextEncoder().encode(patterns.join("\n") + "\n"),
  stdout: "pipe",
  stderr: "pipe",
});
if (set.exitCode !== 0) throw new Error(`sparse-checkout: ${set.stderr.toString().trim()}`);
// `sparse-checkout set` leaves entries that were already in the index without writing them; write the gaps.
const missing = [...wanted].filter((p) => !existsSync(join(FORK, p)));
if (missing.length > 0) {
  const w = Bun.spawnSync(["git", "-C", FORK, "checkout-index", "-f", "-q", "--stdin"], {
    windowsHide: true,
    stdin: new TextEncoder().encode(missing.join("\n") + "\n"),
    stdout: "pipe",
    stderr: "pipe",
  });
  if (w.exitCode !== 0) throw new Error(`checkout-index: ${w.stderr.toString().trim()}`);
}
console.log(`materialised ${wanted.size} svg files for ${symbols.size} symbols in ${FORK}`);
