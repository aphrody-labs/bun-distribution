#!/usr/bin/env bun
/**
 * Compile le CLI `azalee` en **binaire autonome** (`bun build --compile`).
 *
 * Le binaire embarque le runtime Bun : il tourne sans `node_modules`, ce qui en
 * fait aussi le sidecar idéal d'une application Tauri (on l'ajoute à
 * `tauri.conf.json > bundle.externalBin`, et la webview parle à
 * `azalee serve` en HTTP local).
 *
 *     bun packages/azalee/scripts/build-standalone.ts            # -> dist/azalee
 *     bun packages/azalee/scripts/build-standalone.ts --install  # + copie dans ~/.local/bin
 */

import { $ } from "bun";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  args: process.argv.slice(2),
  strict: true,
  options: {
    install: { type: "boolean", default: false },
    target: { type: "string" },
    "compile-executable-path": { type: "string" },
  },
});

const pkgRoot = path.resolve(import.meta.dir, "..");
const entry = path.join(pkgRoot, "src/cli.ts");
const outDir = path.join(pkgRoot, "dist");
const outFile = path.join(outDir, "azalee");

await mkdir(outDir, { recursive: true });

const started = Date.now();
const compile = Bun.spawn(
  [
    process.execPath,
    "build",
    "--compile",
    "--minify",
    "--sourcemap",
    "--bytecode",
    "--format",
    "esm",
    ...(values.target ? [`--target=${values.target}`] : []),
    ...(values["compile-executable-path"] ? [`--compile-executable-path=${values["compile-executable-path"]}`] : []),
    entry,
    "--outfile",
    outFile,
  ],
  { cwd: pkgRoot, stdout: "inherit", stderr: "inherit" },
);
if ((await compile.exited) !== 0) throw new Error("Azalee standalone compilation failed");

// Bun appends `.exe` to Windows executables.
const windows = values.target ? values.target.includes("windows") : process.platform === "win32";
const builtFile = windows ? `${outFile}.exe` : outFile;
const size = Bun.file(builtFile).size;
console.log(`built=${builtFile} size=${(size / 1024 / 1024).toFixed(1)}Mo ms=${Date.now() - started}`);

if (values.install) {
  const target = path.join(process.env.HOME || homedir(), ".local/bin/azalee");
  await $`install -m 755 ${builtFile} ${target}`;
  console.log(`installed=${target}`);
}
