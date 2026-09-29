// SPDX-License-Identifier: Apache-2.0
// The `m3` command line (package bin `m3`, `bin/m3.ts`):
//
//   m3 dev    [--port <n>] [--no-hmr] [--config <file>]
//   m3 build  [--tauri [<dir>]] [--outdir <dir>] [--dev] [--config <file>]
//   m3 tokens [--sheet tokens|tailwind|spaceui|scheme] [--seed <hex>] [--variant <name>]
//             [--dark] [--contrast <n>] [--out <file>] | --bundle <dir> [--root <dir>]
//   m3 check
//   m3 new <dir>
//
// `dev` and `build` read `m3.config.ts` from the working directory (see `./config.ts`).
import { existsSync, readFileSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { buildM3 } from "./build.js";
import { loadM3Config } from "./config.js";
import type { M3Sheet } from "./native.js";
import { createM3Project } from "./new.js";
import { serveM3 } from "./server.js";
import { m3Tokens, SHEETS, writeTokenBundle } from "./tokens.js";

export const COMMANDS = ["dev", "build", "tokens", "check", "new", "help", "version"] as const;
export type M3Command = (typeof COMMANDS)[number];

export type FlagValue = string | boolean;

export interface ParsedArgs {
  command: M3Command;
  flags: Record<string, FlagValue>;
  positionals: string[];
}

/** Flags that never take a value. */
const BOOLEAN_FLAGS = new Set(["dark", "dev", "hmr", "help", "version"]);
/** Flags whose value is optional (`--tauri` alone uses `tauri.uiDist` of the config). */
const OPTIONAL_VALUE_FLAGS = new Set(["tauri"]);
const SHORT: Record<string, string> = { h: "help", v: "version", p: "port", o: "out" };

export const USAGE = `m3 — the @aphrody Material Design 3 framework CLI

Usage:
  m3 dev    [--port <n>] [--no-hmr] [--config <file>]
  m3 build  [--tauri [<dir>]] [--outdir <dir>] [--dev] [--config <file>]
  m3 tokens [--sheet ${SHEETS.join("|")}] [--seed <hex>] [--variant <name>] [--dark]
            [--contrast <n>] [--out <file>]
  m3 tokens --bundle <dir> [--seed <hex>] [--variant <name>] [--contrast <n>] [--root <dir>]
  m3 check
  m3 new <dir>

dev and build read m3.config.ts from the working directory.`;

/** Parse `argv` (without the runtime and script paths). */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const flags: Record<string, FlagValue> = {};
  const positionals: string[] = [];
  let command: M3Command | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("-") && arg !== "-") {
      const long = arg.startsWith("--");
      let name = long ? arg.slice(2) : (SHORT[arg.slice(1)] ?? arg.slice(1));
      let value: FlagValue | undefined;
      const eq = name.indexOf("=");
      if (eq !== -1) {
        value = name.slice(eq + 1);
        name = name.slice(0, eq);
      } else if (long && name.startsWith("no-")) {
        name = name.slice(3);
        value = false;
      } else if (BOOLEAN_FLAGS.has(name)) {
        value = true;
      } else {
        const next = argv[i + 1];
        if (next !== undefined && !next.startsWith("--")) {
          value = next;
          i++;
        } else if (OPTIONAL_VALUE_FLAGS.has(name)) {
          value = true;
        } else {
          throw new Error(`--${name} needs a value`);
        }
      }
      flags[name] = value;
      continue;
    }
    if (command === undefined) {
      if (!(COMMANDS as readonly string[]).includes(arg)) throw new Error(`unknown command ${arg}\n\n${USAGE}`);
      command = arg as M3Command;
    } else {
      positionals.push(arg);
    }
  }
  if (flags.help === true) command = "help";
  else if (flags.version === true && command === undefined) command = "version";
  return { command: command ?? "help", flags, positionals };
}

function stringFlag(flags: Record<string, FlagValue>, name: string): string | undefined {
  const value = flags[name];
  if (value === undefined || value === false) return undefined;
  if (value === true) throw new Error(`--${name} needs a value`);
  return value;
}

function numberFlag(flags: Record<string, FlagValue>, name: string): number | undefined {
  const value = stringFlag(flags, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number, got ${value}`);
  return parsed;
}

/** `--sheet`, validated. */
export function sheetFlag(flags: Record<string, FlagValue>): M3Sheet {
  const sheet = stringFlag(flags, "sheet") ?? "tokens";
  if (!(SHEETS as readonly string[]).includes(sheet)) throw new Error(`--sheet must be one of ${SHEETS.join(", ")}`);
  return sheet as M3Sheet;
}

/** The package version. */
export async function version(): Promise<string> {
  const manifest = JSON.parse(await readFile(join(import.meta.dir, "..", "package.json"), "utf8")) as { version: string };
  return manifest.version;
}

/** True when `dir/bunfig.toml` registers the m3 plugin for `Bun.serve`. */
export async function bunfigHasPlugin(dir: string): Promise<boolean> {
  const file = join(dir, "bunfig.toml");
  if (!existsSync(file)) return false;
  return (await readFile(file, "utf8")).includes("@aphrody/m3/plugin");
}

/** Nearest directory at or above `start` whose package.json declares a `bun:check` script. */
export function findWorkspaceRoot(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    const manifest = join(dir, "package.json");
    if (existsSync(manifest)) {
      const scripts = (JSON.parse(readFileSync(manifest, "utf8")) as { scripts?: Record<string, string> }).scripts;
      if (scripts?.["bun:check"]) return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}

async function run(cmd: string[], cwd: string): Promise<number> {
  console.log(`$ ${cmd.join(" ")}  (${cwd})`);
  const proc = Bun.spawn(cmd, { cwd, stdio: ["inherit", "inherit", "inherit"] });
  return proc.exited;
}

/** Run the CLI; resolves to the process exit code (long-running `dev` resolves once listening). */
export async function runCli(argv: readonly string[], cwd: string = process.cwd()): Promise<number> {
  const { command, flags, positionals } = parseArgs(argv);
  switch (command) {
    case "help":
      console.log(USAGE);
      return 0;
    case "version":
      console.log(await version());
      return 0;
    case "dev": {
      const config = await loadM3Config(cwd, stringFlag(flags, "config"));
      if (!(await bunfigHasPlugin(config.dir))) {
        console.warn(`m3 dev: ${join(config.dir, "bunfig.toml")} does not list "@aphrody/m3/plugin" in [serve.static] plugins; Tailwind and m3:* modules are not applied`);
      }
      const server = await serveM3({
        index: config.entry,
        routes: config.routes,
        pagesDir: config.pagesDir,
        proxy: config.proxy,
        port: numberFlag(flags, "port") ?? (Bun.env.PORT ? undefined : config.port),
        hmr: flags.hmr === false ? false : (config.hmr ?? true),
        cwd: config.dir,
      });
      const proxied = Object.entries(config.proxy).map(([prefix, target]) => `${prefix} -> ${target}`);
      console.log(`m3 dev: ${server.url}${proxied.length ? ` (proxy ${proxied.join(", ")})` : ""}`);
      return 0;
    }
    case "build": {
      const config = await loadM3Config(cwd, stringFlag(flags, "config"));
      const tauriFlag = flags.tauri;
      let tauri: { uiDist: string } | undefined;
      if (typeof tauriFlag === "string") tauri = { uiDist: resolve(cwd, tauriFlag) };
      else if (tauriFlag === true) {
        if (!config.tauri) throw new Error("m3 build --tauri: give a directory or set `tauri.uiDist` in m3.config.ts");
        tauri = config.tauri;
      }
      const outdir = stringFlag(flags, "outdir");
      const started = performance.now();
      const result = await buildM3({
        entry: config.entry,
        outdir: outdir ? resolve(cwd, outdir) : config.outdir,
        production: flags.dev !== true,
        define: config.define,
        drop: config.drop,
        minify: config.minify,
        optimizeImports: config.optimizeImports,
        tauri,
        plugin: { theme: config.theme, root: config.root, configDir: config.dir },
        cwd: config.dir,
      });
      const bytes = result.outputs.reduce((sum, o) => sum + o.bytes, 0);
      for (const output of result.outputs) console.log(`  ${output.path}  ${output.bytes} B`);
      console.log(`m3 build: ${result.outputs.length} files, ${bytes} B into ${result.outdir} in ${Math.round(performance.now() - started)} ms`);
      return 0;
    }
    case "tokens": {
      const theme = {
        seed: stringFlag(flags, "seed"),
        variant: stringFlag(flags, "variant"),
        contrast: numberFlag(flags, "contrast"),
      };
      const bundle = stringFlag(flags, "bundle");
      if (bundle) {
        const dir = resolve(cwd, bundle);
        const files = await writeTokenBundle(dir, { ...theme, root: stringFlag(flags, "root") });
        console.log(`m3 tokens: ${files.length} files into ${dir}`);
        return 0;
      }
      const css = await m3Tokens({ ...theme, sheet: sheetFlag(flags), dark: flags.dark === true ? true : undefined });
      const out = stringFlag(flags, "out");
      if (out) {
        const file = resolve(cwd, out);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, css);
        console.log(`m3 tokens: ${css.length} B into ${file}`);
      } else {
        process.stdout.write(css);
      }
      return 0;
    }
    case "check": {
      const root = findWorkspaceRoot(cwd);
      if (!root) throw new Error("m3 check: no package.json with a bun:check script above the working directory");
      const contract = await run(["bun", "run", "bun:check"], root);
      const tests = await run(["bun", "test"], cwd);
      return contract !== 0 ? contract : tests;
    }
    case "new": {
      if (positionals.length !== 1) throw new Error("m3 new: expected one project directory");
      const target = await createM3Project(resolve(cwd, positionals[0]!));
      console.log(`m3 new: created ${target}`);
      return 0;
    }
  }
}
