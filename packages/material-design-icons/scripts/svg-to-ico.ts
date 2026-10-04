#!/usr/bin/env bun
// Sync an SVG (Material Symbol or any square SVG) to Tauri desktop icons
// (icon.ico, icon.icns, PNG set) through `tauri icon`.
// Usage: bun svg-to-ico.ts <name|file.svg> [--out src-tauri/icons] [--style outlined] [--fill "#fff"]
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { symbolSvgPath, type SymbolStyle } from "../src/index.ts";

const args = process.argv.slice(2);
const flag = (n: string, d?: string) => {
  const i = args.indexOf(`--${n}`);
  return i >= 0 ? args[i + 1] : d;
};
const input = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
if (!input) {
  console.error("usage: svg-to-ico <symbol-name|file.svg> [--out dir] [--style outlined|rounded|sharp] [--fill color]");
  process.exit(2);
}
const out = resolve(flag("out", "src-tauri/icons")!);
let svg = input.endsWith(".svg") ? resolve(input) : symbolSvgPath(input, (flag("style", "outlined") as SymbolStyle));
if (!existsSync(svg)) {
  console.error(`svg not found: ${svg}`);
  process.exit(1);
}
const fill = flag("fill");
if (fill) {
  const tmp = join(mkdtempSync(join(tmpdir(), "m3-icon-")), "icon.svg");
  writeFileSync(tmp, readFileSync(svg, "utf8").replace(/<svg /, `<svg fill="${fill}" `));
  svg = tmp;
}
const run = Bun.spawnSync(["bunx", "tauri", "icon", svg, "-o", out], { stdout: "inherit", stderr: "inherit" });
process.exit(run.exitCode ?? 1);
