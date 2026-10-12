#!/usr/bin/env bun
// Sync an SVG (Material Symbol or any square SVG) to Tauri desktop icons
// (icon.ico, icon.icns, PNG set) through `tauri icon`.
// Usage: m3-svg-to-ico <name|file.svg> [--out src-tauri/icons] [--style outlined] [--fill "#fff"]
// In the Aphrody checkout: `yolo m3 svg-to-ico ...` (runSvgToIco, in-process).
import { existsSync, readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { symbolSvgPath, type SymbolStyle } from "../src/index.ts";

/** The Tauri CLI: the nearest `node_modules/.bin/tauri` above `cwd`, else `tauri` on PATH. */
export function tauriCli(cwd: string = process.cwd()): string | null {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const local = join(
      dir,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "tauri.exe" : "tauri",
    );
    if (existsSync(local)) return local;
    if (dirname(dir) === dir) return Bun.which("tauri");
  }
}

/** `m3-svg-to-ico <argv>` (`yolo m3 svg-to-ico <argv>`): returns the exit status. */
export function runSvgToIco(args: string[]): number {
  const flag = (n: string, d?: string) => {
    const i = args.indexOf(`--${n}`);
    return i >= 0 ? args[i + 1] : d;
  };
  const input = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
  if (!input) {
    console.error(
      "usage: svg-to-ico <symbol-name|file.svg> [--out dir] [--style outlined|rounded|sharp] [--fill color]",
    );
    return 2;
  }
  const out = resolve(flag("out", "src-tauri/icons")!);
  let svg = input.endsWith(".svg")
    ? resolve(input)
    : symbolSvgPath(input, flag("style", "outlined") as SymbolStyle);
  if (!existsSync(svg)) {
    console.error(`svg not found: ${svg}`);
    return 1;
  }
  const fill = flag("fill");
  if (fill) {
    const tmp = join(mkdtempSync(join(tmpdir(), "m3-icon-")), "icon.svg");
    writeFileSync(tmp, readFileSync(svg, "utf8").replace(/<svg /, `<svg fill="${fill}" `));
    svg = tmp;
  }
  const tauri = tauriCli();
  if (!tauri) {
    console.error(
      "svg-to-ico: no Tauri CLI (install @tauri-apps/cli in the app, or put `tauri` on PATH)",
    );
    return 127;
  }
  const run = Bun.spawnSync([tauri, "icon", svg, "-o", out], {
    windowsHide: true,
    stdout: "inherit",
    stderr: "inherit",
  });
  return run.exitCode ?? 1;
}

if (import.meta.main) process.exit(runSvgToIco(process.argv.slice(2)));
