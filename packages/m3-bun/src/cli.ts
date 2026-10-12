// SPDX-License-Identifier: Apache-2.0
// The m3-bun command line (`bin/m3-bun.ts`). Commands run in the app directory (the one with `m3.config.ts`).
//
//   m3-bun dev      [--port n] [--no-hmr]                       dev server, HMR, UI and API in one process
//   m3-bun build    [--minify none|basic|full] [--dev] [--outdir d] [--json]
//   m3-bun serve    [--port n] [--host h] [--build]            production server of the build directory
//   m3-bun compile  [--target t] [--outfile f] [--minify l] [--no-build]       one executable
//   m3-bun package  [--target t] [--format tar.gz|zip] [--out d] [--rootfs] [--deploy] [--executable f]
//   m3-bun deploy   <target..|all> [--out d] [--domain h] [--name n] [--port n] [--image r] ...      configs, never applied
//   m3-bun targets                                              the deploy targets
//   m3-bun smoke    [executable] [--port n]                     run it (yolo runtime when installed), GET /, /healthz, /api/m3/info
//   m3-bun workspace <build|typecheck|clean> [--only a,b] [--no-cache]          the repository pipeline (scripts/build.ts)
//   m3-bun pack     [package-dir] [--out d]                     build a workspace package and `bun pm pack` it
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { M3ApiModule } from "./api.ts";
import { buildApp, type MinifyLevel } from "./build.ts";
import { compileApp, defaultOutfile } from "./compile.ts";
import { COMPILE_TARGETS, findWorkspaceRoot, loadApp, type CompileTargetName, type M3App } from "./config.ts";
import { packageApp, type ArchiveFormat } from "./package.ts";
import { formatSmoke, smoke } from "./runtime.ts";
import { dirSource, startM3Server } from "./server.ts";
import { TARGETS, contextFor, generateTargets } from "./targets/index.ts";
import { kib } from "./util.ts";

export const COMMANDS = [
  "dev",
  "build",
  "serve",
  "compile",
  "package",
  "deploy",
  "targets",
  "smoke",
  "workspace",
  "pack",
  "help",
  "version",
] as const;
export type Command = (typeof COMMANDS)[number];

export interface Parsed {
  command: Command;
  positionals: string[];
  flags: Map<string, string | true>;
}

const BOOLEAN = new Set([
  "dev",
  "no-hmr",
  "no-build",
  "build",
  "json",
  "rootfs",
  "deploy",
  "help",
  "version",
  "no-cache",
]);

/** Parse `argv` (without the runtime and script paths). */
export function parseArgs(argv: readonly string[]): Parsed {
  const flags = new Map<string, string | true>();
  const positionals: string[] = [];
  let command: Command | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg.startsWith("--")) {
      const eq = arg.indexOf("=");
      const name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
      if (eq !== -1) flags.set(name, arg.slice(eq + 1));
      else if (BOOLEAN.has(name)) flags.set(name, true);
      else {
        const next = argv[i + 1];
        if (next === undefined || next.startsWith("--")) throw new Error(`--${name} needs a value`);
        flags.set(name, next);
        i++;
      }
      continue;
    }
    if (arg === "-h") flags.set("help", true);
    else if (arg === "-v") flags.set("version", true);
    else if (command === undefined && (COMMANDS as readonly string[]).includes(arg)) command = arg as Command;
    else positionals.push(arg);
  }
  if (flags.has("help")) command = "help";
  else if (flags.has("version") && command === undefined) command = "version";
  return { command: command ?? "help", positionals, flags };
}

export const USAGE = `m3-bun: build, serve, compile, package and deploy configs for M3 apps

Usage:
  m3-bun dev      [--port <n>] [--no-hmr]
  m3-bun build    [--minify none|basic|full] [--dev] [--outdir <dir>] [--json]
  m3-bun serve    [--port <n>] [--host <h>] [--build]
  m3-bun compile  [--target <t>] [--outfile <file>] [--minify <level>] [--no-build] [--no-bytecode]
  m3-bun package  [--target <t>] [--format tar.gz|zip] [--out <dir>] [--rootfs] [--deploy] [--executable <file>] [--no-bytecode] [--json]
  m3-bun deploy   <target..|all> [--out <dir>] [--domain <host>] [--name <n>] [--port <n>] [--image <ref>]
                  [--namespace <ns>] [--user <u>] [--region <r>] [--tls-cert <f> --tls-key <f>] [--http2 directive|listen] [--cli "<cmd>"]
  m3-bun targets
  m3-bun smoke    [executable] [--port <n>]
  m3-bun workspace <build|typecheck|clean> [--only a,b] [--no-cache]
  m3-bun pack     [package-dir] [--out <dir>]

Compile targets: ${COMPILE_TARGETS.join(", ")}
Deploy targets:  ${TARGETS.map(t => t.id).join(", ")} (generated, never applied)
Commands run in the directory of the app's m3.config.ts.`;

const str = (flags: Map<string, string | true>, name: string): string | undefined => {
  const value = flags.get(name);
  if (value === undefined) return undefined;
  if (value === true) throw new Error(`--${name} needs a value`);
  return value;
};

const num = (flags: Map<string, string | true>, name: string): number | undefined => {
  const value = str(flags, name);
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0)
    throw new Error(`--${name} must be a non-negative integer, got ${value}`);
  return parsed;
};

const level = (flags: Map<string, string | true>): MinifyLevel | undefined => {
  const value = str(flags, "minify");
  if (value === undefined) return undefined;
  if (value !== "none" && value !== "basic" && value !== "full")
    throw new Error(`--minify must be none, basic or full, got ${value}`);
  return value;
};

const target = (flags: Map<string, string | true>): CompileTargetName | undefined => {
  const value = str(flags, "target");
  if (value === undefined) return undefined;
  if (!(COMPILE_TARGETS as readonly string[]).includes(value))
    throw new Error(`--target must be one of ${COMPILE_TARGETS.join(", ")}, got ${value}`);
  return value as CompileTargetName;
};

async function importApi(app: M3App): Promise<M3ApiModule | undefined> {
  if (!app.api) return undefined;
  return ((await import(pathToFileURL(app.api).href)) as { default?: M3ApiModule }).default;
}

/** The m3 plugins Bun may bundle an app's HTML entry with. */
const knownPluginFiles = (): string[] => {
  const files = [join(import.meta.dir, "plugin.ts")];
  try {
    files.push(Bun.resolveSync("@aphrody/m3/plugin", import.meta.dir));
  } catch {
    // @aphrody/m3 is a dependency; a failure here only narrows the match.
  }
  return files;
};

/** `bunfig.toml` must list the plugin (`[serve.static] plugins`) for `Bun.serve`'s HTML bundling to apply it. */
export function bunfigHasPlugin(dir: string): boolean {
  const file = join(dir, "bunfig.toml");
  if (!existsSync(file)) return false;
  const parsed = Bun.TOML.parse(readFileSync(file, "utf8")) as { serve?: { static?: { plugins?: unknown } } };
  const plugins = parsed.serve?.static?.plugins;
  if (!Array.isArray(plugins)) return false;
  const known = knownPluginFiles();
  return plugins.some(specifier => {
    if (typeof specifier !== "string") return false;
    try {
      return known.includes(Bun.resolveSync(specifier, dir));
    } catch {
      return false;
    }
  });
}

async function run(cmd: string[], cwd: string): Promise<number> {
  console.log(`$ ${cmd.join(" ")}  (${cwd})`);
  const proc = Bun.spawn(cmd, { cwd, stdio: ["inherit", "inherit", "inherit"] });
  return proc.exited;
}

/** Run the CLI; resolves to the exit code (`dev` and `serve` resolve once listening, the server keeps the process alive). */
export async function runCli(argv: readonly string[], cwd: string = process.cwd()): Promise<number> {
  const { command, positionals, flags } = parseArgs(argv);
  switch (command) {
    case "help":
      console.log(USAGE);
      return 0;
    case "version": {
      const manifest = JSON.parse(readFileSync(join(import.meta.dir, "..", "package.json"), "utf8")) as {
        version: string;
      };
      console.log(manifest.version);
      return 0;
    }
    case "targets": {
      for (const t of TARGETS) console.log(`${t.id.padEnd(12)} ${t.description}`);
      return 0;
    }
    case "dev": {
      const app = await loadApp(cwd);
      if (!bunfigHasPlugin(app.dir)) {
        console.error(
          `m3-bun dev: ${join(app.dir, "bunfig.toml")} must list the plugin so Bun can bundle the HTML entry:\n\n[serve.static]\nplugins = ["@aphrody/m3-bun/plugin"]`,
        );
        return 1;
      }
      const index = ((await import(pathToFileURL(app.m3.entry).href)) as { default: import("bun").HTMLBundle }).default;
      const api = await importApi(app);
      const port = num(flags, "port");
      const server = startM3Server({
        name: app.name,
        version: app.version,
        index,
        hmr: !flags.has("no-hmr"),
        ...(api ? { api } : {}),
        ...(app.bun.csp !== undefined ? { csp: app.bun.csp } : {}),
        port: port ?? app.port,
      });
      console.log(`m3-bun dev ${app.name}: listening on ${server.url}${app.api ? " (UI + API, one process)" : ""}`);
      return 0;
    }
    case "build": {
      const app = await loadApp(cwd);
      const minify = level(flags);
      const outdir = str(flags, "outdir");
      const report = await buildApp({
        app,
        ...(minify ? { minify } : {}),
        ...(outdir ? { outdir } : {}),
        dev: flags.has("dev"),
      });
      if (flags.has("json"))
        console.log(
          JSON.stringify(
            {
              outdir: report.outdir,
              ms: report.ms,
              totalBytes: report.totalBytes,
              totalGzipBytes: report.totalGzipBytes,
              manifest: report.manifest,
            },
            null,
            2,
          ),
        );
      else {
        for (const file of report.manifest.files)
          console.log(`  ${file.path.padEnd(34)} ${kib(file.bytes).padStart(11)}  gzip ${kib(file.gzipBytes)}`);
        console.log(
          `m3-bun build ${app.name}@${app.version}: ${report.manifest.files.length} files, ${kib(report.totalBytes)} (${kib(report.totalGzipBytes)} gzip), minify ${report.manifest.minify}, build ${report.manifest.buildId}, ${report.ms} ms -> ${report.outdir}`,
        );
      }
      return 0;
    }
    case "serve": {
      const app = await loadApp(cwd);
      if (flags.has("build") || !existsSync(join(app.outdir, "index.html"))) await buildApp({ app });
      const api = await importApi(app);
      const port = num(flags, "port");
      const host = str(flags, "host");
      const server = startM3Server({
        name: app.name,
        version: app.version,
        files: dirSource(app.outdir),
        ...(api ? { api } : {}),
        ...(app.bun.csp !== undefined ? { csp: app.bun.csp } : {}),
        port: port ?? app.port,
        ...(host ? { hostname: host } : {}),
      });
      console.log(`m3-bun serve ${app.name}: listening on ${server.url}${app.api ? " (UI + API, one process)" : ""}`);
      return 0;
    }
    case "compile": {
      const app = await loadApp(cwd);
      const t = target(flags);
      const outfile = str(flags, "outfile");
      const minify = level(flags);
      const report = await compileApp({
        app,
        ...(t ? { target: t } : {}),
        ...(outfile ? { outfile } : {}),
        ...(minify ? { minify } : {}),
        ...(flags.has("no-bytecode") ? { bytecode: false } : {}),
        build: !flags.has("no-build"),
      });
      console.log(
        `m3-bun compile ${app.name}: ${report.outfile} (${kib(report.bytes)}, ${report.files} embedded files, target ${report.target}, ${report.bytecode ? "bytecode" : "no bytecode"}) in ${report.ms} ms`,
      );
      for (const warning of report.warnings) console.warn(`warning: ${warning}`);
      return 0;
    }
    case "package": {
      const app = await loadApp(cwd);
      const t = target(flags);
      const out = str(flags, "out");
      const format = str(flags, "format") as ArchiveFormat | undefined;
      const minify = level(flags);
      if (format !== undefined && format !== "tar.gz" && format !== "zip")
        throw new Error(`--format must be tar.gz or zip, got ${format}`);
      const executable = str(flags, "executable");
      const report = await packageApp({
        app,
        ...(t ? { target: t } : {}),
        ...(out ? { out } : {}),
        ...(format ? { format } : {}),
        ...(executable ? { executable } : {}),
        ...(flags.has("no-bytecode") ? { bytecode: false } : {}),
        ...(minify ? { minify } : {}),
        rootfs: flags.has("rootfs"),
        deploy: flags.has("deploy"),
      });
      if (flags.has("json")) {
        console.log(
          JSON.stringify(
            {
              archive: report.archive,
              bytes: report.bytes,
              sha256: report.sha256,
              checksumFile: report.checksumFile,
              files: report.files,
              ...(report.compile
                ? {
                    compile: {
                      target: report.compile.target,
                      outfile: report.compile.outfile,
                      bytes: report.compile.bytes,
                      files: report.compile.files,
                      bytecode: report.compile.bytecode,
                      warnings: report.compile.warnings,
                    },
                  }
                : {}),
              ...(report.rootfs ? { rootfs: report.rootfs } : {}),
            },
            null,
            2,
          ),
        );
      } else {
        console.log(
          `m3-bun package: ${report.archive} (${kib(report.bytes)})\n  sha256 ${report.sha256}\n  files ${report.files.join(", ")}`,
        );
        if (report.rootfs)
          console.log(
            `  rootfs ${report.rootfs.dir}: ${kib(report.rootfs.bytes)}, ${report.rootfs.libraries.length} libraries (${report.rootfs.libraries.join(", ")})`,
          );
      }
      return 0;
    }
    case "deploy": {
      const app = await loadApp(cwd);
      const ids = positionals.length > 0 ? positionals : ["all"];
      const out = resolve(cwd, str(flags, "out") ?? app.bun.deploy?.out ?? "deploy");
      const cert = str(flags, "tls-cert");
      const key = str(flags, "tls-key");
      if ((cert === undefined) !== (key === undefined)) throw new Error("--tls-cert and --tls-key go together");
      const domain = str(flags, "domain");
      const image = str(flags, "image");
      const namespace = str(flags, "namespace");
      const user = str(flags, "user");
      const region = str(flags, "region");
      const cli = str(flags, "cli");
      const http2 = str(flags, "http2");
      if (http2 !== undefined && http2 !== "directive" && http2 !== "listen")
        throw new Error(`--http2 must be directive or listen, got ${http2}`);
      const name = str(flags, "name");
      const port = num(flags, "port");
      const context = contextFor(app, {
        ...(domain ? { domain } : {}),
        ...(image ? { image } : {}),
        ...(namespace ? { namespace } : {}),
        ...(user ? { user } : {}),
        ...(region ? { region } : {}),
        ...(cli ? { cli } : {}),
        ...(name ? { name, binary: name } : {}),
        ...(port !== undefined ? { port } : {}),
        ...(cert && key ? { tls: { cert, key } } : {}),
        ...(http2 ? { http2 } : {}),
      });
      const generated = await generateTargets(ids, context, out);
      for (const g of generated) console.log(`${g.id.padEnd(12)} ${g.files.length} files -> ${g.dir}`);
      console.log("generated only: nothing was applied, pushed or reloaded");
      return 0;
    }
    case "smoke": {
      const app = await loadApp(cwd);
      const executable = resolve(cwd, positionals[0] ?? defaultOutfile(app, undefined));
      if (!existsSync(executable)) throw new Error(`m3-bun smoke: ${executable} does not exist (m3-bun compile first)`);
      const port = num(flags, "port") ?? 38000 + Math.floor(Math.random() * 2000);
      const report = await smoke(executable, port);
      console.log(formatSmoke(report));
      return report.ok ? 0 : 1;
    }
    case "workspace": {
      const root = findWorkspaceRoot(cwd);
      const script = root ? join(root, "scripts", "build.ts") : undefined;
      if (!root || !script || !existsSync(script))
        throw new Error("m3-bun workspace: no scripts/build.ts above the working directory");
      const task = positionals[0] ?? "build";
      const only = str(flags, "only");
      return run(
        ["bun", script, task, ...(only ? ["--only", only] : []), ...(flags.has("no-cache") ? ["--no-cache"] : [])],
        root,
      );
    }
    case "pack": {
      const dir = resolve(cwd, positionals[0] ?? ".");
      const manifest = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as { name: string };
      const root = findWorkspaceRoot(dir);
      const script = root ? join(root, "scripts", "build.ts") : undefined;
      if (root && script && existsSync(script) && existsSync(join(dir, "build.config.ts"))) {
        const code = await run(["bun", script, "build", "--only", manifest.name, "--no-apps"], root);
        if (code !== 0) return code;
      }
      const out = resolve(cwd, str(flags, "out") ?? "release");
      return run(["bun", "pm", "pack", "--destination", out], dir);
    }
  }
}
