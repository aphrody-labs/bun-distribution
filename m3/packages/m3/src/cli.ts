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
import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { buildM3 } from "./build.js";
import { loadM3Config } from "./config.js";
import type { M3Sheet } from "./native.js";
import { createM3Project } from "./new.js";
import { serveM3 } from "./server.js";
import { m3Tokens, SHEETS, writeTokenBundle } from "./tokens.js";

export const COMMANDS = [
  "dev",
  "build",
  "tokens",
  "check",
  "new",
  "compile",
  "desktop",
  "help",
  "version",
] as const;
export type M3Command = (typeof COMMANDS)[number];

export type FlagValue = string | boolean;

export interface ParsedArgs {
  command: M3Command;
  flags: Record<string, FlagValue>;
  positionals: string[];
}

/** Flags that never take a value. */
const BOOLEAN_FLAGS = new Set(["dark", "dev", "hmr", "help", "version", "build"]);
/** Flags whose value is optional (`--tauri` alone uses `tauri.uiDist` of the config). */
const OPTIONAL_VALUE_FLAGS = new Set(["tauri"]);
const SHORT: Record<string, string> = { h: "help", v: "version", p: "port", o: "out" };

export const USAGE = `m3 — the @aphrody Material Design 3 framework CLI

Usage:
  m3 dev      [--port <n>] [--no-hmr] [--config <file>]
  m3 build    [--tauri [<dir>]] [--outdir <dir>] [--dev] [--config <file>]
  m3 compile  [--target <t>] [--outfile <file>] [--dev] [--config <file>]
  m3 desktop  [--dev|--build] [--config <file>]
  m3 tokens   [--sheet ${SHEETS.join("|")}] [--seed <hex>] [--variant <name>] [--dark]
              [--contrast <n>] [--out <file>]
  m3 tokens --bundle <dir> [--seed <hex>] [--variant <name>] [--contrast <n>] [--root <dir>]
  m3 check
  m3 new <dir>

new requires the Aphrody/M3 private source owner workspace; use an apps/* member (for example m3 new apps/my-app).
dev, build, compile and desktop read m3.config.ts from the working directory.
compile builds the UI and links it with the Bun runtime into one executable that serves it (and the app's API):
it runs @aphrody/m3-bun, which must be installed next to this package.`;

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
      if (!(COMMANDS as readonly string[]).includes(arg))
        throw new Error(`unknown command ${arg}\n\n${USAGE}`);
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
  if (!(SHEETS as readonly string[]).includes(sheet))
    throw new Error(`--sheet must be one of ${SHEETS.join(", ")}`);
  return sheet as M3Sheet;
}

/** The package version. */
export async function version(): Promise<string> {
  const manifest = JSON.parse(
    await Bun.file(join(import.meta.dir, "..", "package.json")).text(),
  ) as { version: string };
  return manifest.version;
}

/** True when `dir/bunfig.toml` registers the m3 plugin for `Bun.serve`. */
export async function bunfigHasPlugin(dir: string): Promise<boolean> {
  const file = join(dir, "bunfig.toml");
  if (!existsSync(file)) return false;
  return (await Bun.file(file).text()).includes("@aphrody/m3/plugin");
}

/** The local M3 contract, or the legacy host workspace contract. An application's `check` is not a workspace contract. */
function workspaceCheckScript(dir: string): "check" | "bun:check" | undefined {
  const manifest = join(dir, "package.json");
  if (!existsSync(manifest)) return undefined;
  const { name, scripts } = JSON.parse(readFileSync(manifest, "utf8")) as {
    name?: string;
    scripts?: Record<string, string>;
  };
  if (name === "aphrody-m3" && scripts?.check) return "check";
  if (scripts?.["bun:check"]) return "bun:check";
  return undefined;
}

/** Nearest M3 repository with `check`, or host workspace with `bun:check`, at or above `start`. */
export function findWorkspaceRoot(start: string): string | undefined {
  let dir = resolve(start);
  for (;;) {
    if (workspaceCheckScript(dir)) return dir;
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

/** What `m3 compile` needs from `@aphrody/m3-bun`. */
interface M3BunCompiler {
  compileApp(options: {
    dir: string;
    configFile?: string;
    target?: string;
    outfile?: string;
    minify?: "none" | "basic" | "full";
  }): Promise<{
    outfile: string;
    bytes: number;
    target: string;
    files: number;
    ms: number;
    warnings: string[];
  }>;
}

/**
 * `@aphrody/m3-bun`, imported on demand. It depends on this package, so it is an optional peer here and never a
 * static import: the specifier sits in a variable to keep bundlers and the type checker from following it.
 */
async function loadM3Bun(): Promise<M3BunCompiler> {
  const specifier = "@aphrody/m3-bun";
  try {
    return (await import(specifier)) as M3BunCompiler;
  } catch (cause) {
    throw new Error(
      "m3 compile: @aphrody/m3-bun is not installed; it compiles the app into one executable (bun add -d @aphrody/m3-bun)",
      { cause },
    );
  }
}

/** Run the CLI; resolves to the process exit code (long-running `dev` resolves once listening). */
export async function runCli(
  argv: readonly string[],
  cwd: string = process.cwd(),
): Promise<number> {
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
        console.warn(
          `m3 dev: ${join(config.dir, "bunfig.toml")} does not list "@aphrody/m3/plugin" in [serve.static] plugins; Tailwind and m3:* modules are not applied`,
        );
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
      const proxied = Object.entries(config.proxy).map(
        ([prefix, target]) => `${prefix} -> ${target}`,
      );
      console.log(`m3 dev: ${server.url}${proxied.length ? ` (proxy ${proxied.join(", ")})` : ""}`);
      return 0;
    }
    case "build": {
      const config = await loadM3Config(cwd, stringFlag(flags, "config"));
      const tauriFlag = flags.tauri;
      let tauri: { uiDist: string } | undefined;
      if (typeof tauriFlag === "string") tauri = { uiDist: resolve(cwd, tauriFlag) };
      else if (tauriFlag === true) {
        if (!config.tauri)
          throw new Error(
            "m3 build --tauri: give a directory or set `tauri.uiDist` in m3.config.ts",
          );
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
      console.log(
        `m3 build: ${result.outputs.length} files, ${bytes} B into ${result.outdir} in ${Math.round(performance.now() - started)} ms`,
      );
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
      const css = await m3Tokens({
        ...theme,
        sheet: sheetFlag(flags),
        dark: flags.dark === true ? true : undefined,
      });
      const out = stringFlag(flags, "out");
      if (out) {
        const file = resolve(cwd, out);
        await mkdir(dirname(file), { recursive: true });
        await Bun.write(file, css);
        console.log(`m3 tokens: ${css.length} B into ${file}`);
      } else {
        process.stdout.write(css);
      }
      return 0;
    }
    case "check": {
      const root = findWorkspaceRoot(cwd);
      const script = root && workspaceCheckScript(root);
      if (!root || !script)
        throw new Error(
          "m3 check: no aphrody-m3 check or host bun:check script above the working directory",
        );
      const contract = await run(["bun", "run", script], root);
      const tests = await run(
        script === "check" && resolve(cwd) === root ? ["bun", "run", "test"] : ["bun", "test"],
        cwd,
      );
      return contract !== 0 ? contract : tests;
    }
    case "new": {
      if (positionals.length !== 1) throw new Error("m3 new: expected one project directory");
      const target = await createM3Project(resolve(cwd, positionals[0]!));
      console.log(`m3 new: created ${target}`);
      return 0;
    }
    case "compile": {
      // The executable path is @aphrody/m3-bun: it embeds the built UI in a generated server and compiles that. Compiling
      // the HTML entry directly (what this command used to do) yields a standalone HTML file, not an executable.
      const m3Bun = await loadM3Bun();
      const configFile = stringFlag(flags, "config");
      const target = stringFlag(flags, "target");
      const outfile = stringFlag(flags, "outfile");
      const report = await m3Bun.compileApp({
        dir: cwd,
        ...(configFile ? { configFile } : {}),
        ...(target ? { target } : {}),
        ...(outfile ? { outfile: resolve(cwd, outfile) } : {}),
        ...(flags.dev === true ? { minify: "none" } : {}),
      });
      console.log(
        `m3 compile: ${report.outfile} (${report.bytes} B, ${report.files} embedded files, target ${report.target}) in ${report.ms} ms`,
      );
      for (const warning of report.warnings) console.warn(`m3 compile: ${warning}`);
      return 0;
    }
    case "desktop": {
      const config = await loadM3Config(cwd, stringFlag(flags, "config"));
      if (!config.tauri) {
        throw new Error("m3 desktop: set `tauri.uiDist` in m3.config.ts");
      }
      const isDev = flags.dev === true;
      if (isDev) {
        console.log(`m3 desktop: dev mode for Tauri desktop host`);
        const server = await serveM3({
          index: config.entry,
          routes: config.routes,
          proxy: config.proxy,
          port: numberFlag(flags, "port") ?? 1421,
          cwd: config.dir,
        });
        console.log(`m3 desktop: webview listening at ${server.url}`);
        return 0;
      }
      const started = performance.now();
      const tauri = config.tauri;
      const result = await buildM3({
        entry: config.entry,
        outdir: config.outdir,
        production: true,
        tauri,
        plugin: { theme: config.theme, root: config.root, configDir: config.dir },
        cwd: config.dir,
      });
      console.log(
        `m3 desktop: built webview to ${tauri.uiDist} (${result.outputs.length} files) in ${Math.round(performance.now() - started)} ms`,
      );
      return 0;
    }
  }
}
