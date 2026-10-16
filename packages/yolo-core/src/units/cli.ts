#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// units render [--out DIR] [name.service ...]   write rendered units (default: print one, or list)
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { renderAll } from "./index.ts";

const args = process.argv.slice(2);
const cmd = args.shift();
const outAt = args.indexOf("--out");
const out = outAt >= 0 ? args.splice(outAt, 2)[1] : undefined;
const units = renderAll().filter(
  (u) => !args.length || args.some((a) => u.file === a || u.file.startsWith(`${a}/`)),
);

if (cmd === "list") for (const u of units) console.log(u.file);
else if (cmd === "render" && out) {
  for (const u of units) {
    const path = join(out, u.file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, u.text);
  }
  console.log(`rendered ${units.length} unit files to ${out}`);
} else if (cmd === "render" && units.length === 1) process.stdout.write(units[0]!.text);
else {
  console.error("usage: units list | units render --out DIR [unit...] | units render <unit>");
  process.exit(2);
}
