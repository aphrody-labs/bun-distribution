#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
// Build, serve and check the Next 16 examples through the yolo CLI.
//
//   bun scripts/yolo-example.ts <build|serve|start|export|bench|check> [--example app|tauri] [--json]
//
// yolo's `web` verb runs `bun run build|dev` in `$YOLO_HOME/m3/packages/app-ui`. This script points YOLO_HOME at a directory
// whose `m3/packages/app-ui` is the example (a symlink under the temp dir; nothing is written into this repository) and runs
// `bun $YOLO_ROOT/packages/engine/yolo/src/index.ts web build|dev` (YOLO_ROOT: this Aphrody checkout by default). The example
// scripts run `yolo m3 next`, so Next, Turbopack workers included, runs on Bun; no Node is involved.
//
//   build    yolo web build            (cold: `.next` removed first)
//   serve    yolo web dev              (dev server, curl every route)
//   start    yolo web build, then `bun run start` (production server, curl every route)
//   export   yolo tauri build          (the tauri example: static export in out/)
//   bench    cold and warm yolo web build, three runs each
//   check    build, serve, start, export in turn
/* oxlint-disable eslint/no-await-in-loop -- polling and benchmark runs are sequential on purpose */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  unlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const PKG = resolve(import.meta.dir, "..");
export const YOLO_ROOT = process.env["YOLO_ROOT"] ?? resolve(PKG, "../../..");
export const YOLO_CLI = join(YOLO_ROOT, "packages/engine/yolo/src/index.ts");

export type Example = "app" | "tauri";
export const exampleDir = (name: Example): string => join(PKG, "examples", name);

/** Routes that must answer, with the status each returns. */
export const ROUTES: Record<Example, [string, number][]> = {
  app: [
    ["/", 200],
    ["/components", 200],
    ["/theme", 200],
    ["/api/health", 200],
    ["/missing", 404],
  ],
  tauri: [
    ["/", 200],
    ["/about/", 200],
  ],
};

/** A YOLO_HOME whose `m3/packages/app-ui` (the `yolo web` app directory) is the example; created under the temp dir, repaired when it points elsewhere. */
export function yoloHome(
  example: Example,
  root: string = join(tmpdir(), `m3-next-yolo-${process.getuid?.() ?? 0}`),
): string {
  const home = join(root, example);
  const web = join(home, "m3", "packages", "app-ui");
  mkdirSync(join(home, "m3", "packages"), { recursive: true });
  const target = exampleDir(example);
  try {
    if (lstatSync(web).isSymbolicLink() && readlinkSync(web) === target) return home;
    unlinkSync(web);
  } catch {
    // Absent: create it below.
  }
  symlinkSync(target, web);
  return home;
}

/** The yolo invocation: `bun <cli> <args>` with YOLO_HOME at the example. */
export function yoloCommand(
  example: Example,
  ...args: string[]
): { cmd: string[]; env: Record<string, string | undefined> } {
  return {
    cmd: ["bun", YOLO_CLI, ...args],
    env: { ...process.env, YOLO_HOME: yoloHome(example), NEXT_TELEMETRY_DISABLED: "1" },
  };
}

export interface Timed {
  exitCode: number;
  ms: number;
  output: string;
}

/** Run a command to completion, capturing stdout and stderr. */
async function run(
  cmd: string[],
  env: Record<string, string | undefined>,
  cwd?: string,
): Promise<Timed> {
  const start = performance.now();
  const proc = Bun.spawn(cmd, { windowsHide: true, env, cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { exitCode, ms: Math.round(performance.now() - start), output: out + err };
}

export async function yoloBuild(
  example: Example,
  verb: "web" | "tauri" = "web",
  cold = true,
): Promise<Timed> {
  const dir = exampleDir(example);
  if (cold)
    for (const out of [".next", "out"]) rmSync(join(dir, out), { recursive: true, force: true });
  const { cmd, env } = yoloCommand(example, verb, "build");
  return run(cmd, env);
}

/** Wait for the URL to answer, up to `timeoutMs`. */
async function waitFor(url: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url, { redirect: "manual" })).status > 0) return true;
    } catch {
      // Not up yet.
    }
    await Bun.sleep(250);
  }
  return false;
}

export interface RouteResult {
  route: string;
  expected: number;
  status: number;
  ok: boolean;
}

async function probe(base: string, routes: [string, number][]): Promise<RouteResult[]> {
  const out: RouteResult[] = [];
  for (const [route, expected] of routes) {
    const status =
      (await fetch(`${base}${route}`, { redirect: "manual" }).catch(() => undefined))?.status ?? 0;
    out.push({ route, expected, status, ok: status === expected });
  }
  return out;
}

/** Run a server in its own process group and make sure it is gone afterwards. */
async function withServer<T>(
  cmd: string[],
  env: Record<string, string | undefined>,
  cwd: string | undefined,
  url: string,
  body: () => Promise<T>,
): Promise<T> {
  // A leftover server on the port would answer for ours: refuse to start.
  if (
    await fetch(url, { redirect: "manual" }).then(
      () => true,
      () => false,
    )
  )
    throw new Error(`${url} is already served`);
  const proc = Bun.spawn(cmd, {
    windowsHide: true,
    env,
    cwd,
    stdout: "ignore",
    stderr: "ignore",
    detached: true,
  });
  try {
    if (!(await waitFor(url, 90_000))) throw new Error(`${url} did not come up`);
    return await body();
  } finally {
    try {
      process.kill(-proc.pid, "SIGTERM");
    } catch {
      proc.kill();
    }
    await Promise.race([proc.exited, Bun.sleep(5000)]);
    try {
      process.kill(-proc.pid, "SIGKILL");
    } catch {
      // Already gone.
    }
  }
}

const PORT_DEV = "3217";
const PORT_START = "3218";

/** `yolo web dev` serves the example; curl each route. */
export async function yoloServe(example: Example = "app"): Promise<RouteResult[]> {
  const { cmd, env } = yoloCommand(example, "web", "dev");
  const base = `http://localhost:${PORT_DEV}`;
  return withServer(cmd, { ...env, PORT: PORT_DEV }, undefined, `${base}/`, () =>
    probe(base, ROUTES[example]),
  );
}

/** `yolo web build` then the production server (`bun run start`); curl each route. */
export async function yoloStart(
  example: Example = "app",
): Promise<{ build: Timed; routes: RouteResult[] }> {
  const build = await yoloBuild(example);
  if (build.exitCode !== 0) return { build, routes: [] };
  const base = `http://localhost:${PORT_START}`;
  const { env } = yoloCommand(example, "web", "build");
  const routes = await withServer(
    ["bun", "run", "start"],
    { ...env, PORT: PORT_START },
    exampleDir(example),
    `${base}/`,
    () => probe(base, ROUTES[example]),
  );
  return { build, routes };
}

/** Median of the runs. */
const median = (values: number[]): number =>
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a copy; ES2022 has no toSorted
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;

/** Cold (`.next` removed) and warm (`.next` kept) `yolo web build` times, `runs` each. */
export async function yoloBench(
  example: Example = "app",
  runs = 3,
): Promise<{ cold: number[]; warm: number[]; coldMedian: number; warmMedian: number }> {
  const cold: number[] = [];
  const warm: number[] = [];
  for (let i = 0; i < runs; i += 1) {
    const result = await yoloBuild(example, "web", true);
    if (result.exitCode !== 0) throw new Error(result.output.slice(-2000));
    cold.push(result.ms);
  }
  for (let i = 0; i < runs; i += 1) {
    const result = await yoloBuild(example, "web", false);
    if (result.exitCode !== 0) throw new Error(result.output.slice(-2000));
    warm.push(result.ms);
  }
  return { cold, warm, coldMedian: median(cold), warmMedian: median(warm) };
}

function report(label: string, results: RouteResult[]): boolean {
  for (const r of results)
    console.log(
      `  ${r.ok ? "ok  " : "FAIL"} ${r.route.padEnd(14)} ${r.status} (expected ${r.expected})`,
    );
  const ok = results.length > 0 && results.every((r) => r.ok);
  console.log(`${ok ? "pass" : "FAIL"} ${label}`);
  return ok;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const [task = "check"] = args;
  const flag = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const example = (flag("--example") ?? "app") as Example;
  const json = args.includes("--json");
  if (!existsSync(YOLO_CLI)) {
    console.error(`yolo CLI not found at ${YOLO_CLI}; set YOLO_ROOT`);
    process.exit(2);
  }
  let ok = true;
  const doBuild = async (name: Example, verb: "web" | "tauri") => {
    const result = await yoloBuild(name, verb);
    console.log(
      `${result.exitCode === 0 ? "pass" : "FAIL"} yolo ${verb} build (${name}) ${result.ms} ms`,
    );
    if (result.exitCode !== 0) console.log(result.output.slice(-1500));
    return result.exitCode === 0;
  };
  const doExport = async () => {
    if (!(await doBuild("tauri", "tauri"))) return false;
    const out = join(exampleDir("tauri"), "out");
    const html = existsSync(join(out, "index.html"))
      ? readFileSync(join(out, "index.html"), "utf8")
      : "";
    const good =
      html.includes('id="m3-scheme"') &&
      html.includes("document.cookie.match") &&
      existsSync(join(out, "about", "index.html"));
    console.log(
      `${good ? "pass" : "FAIL"} static export: out/index.html, out/about/index.html, inline scheme and pre-paint script`,
    );
    return good;
  };
  switch (task) {
    case "build":
      ok = await doBuild(example, "web");
      break;
    case "serve":
      ok = report(`yolo web dev (${example})`, await yoloServe(example));
      break;
    case "start": {
      const { build, routes } = await yoloStart(example);
      console.log(`yolo web build (${example}) ${build.ms} ms, exit ${build.exitCode}`);
      ok = report(`next start (${example})`, routes);
      break;
    }
    case "export":
      ok = await doExport();
      break;
    case "bench": {
      const bench = await yoloBench(example);
      console.log(
        json
          ? JSON.stringify(bench)
          : `cold ${bench.cold.join(", ")} ms (median ${bench.coldMedian}); warm ${bench.warm.join(", ")} ms (median ${bench.warmMedian})`,
      );
      break;
    }
    case "check":
      ok = (await doBuild("app", "web")) && report("yolo web dev (app)", await yoloServe("app"));
      if (ok) {
        const { routes } = await yoloStart("app");
        ok = report("next start (app)", routes);
      }
      ok = (await doExport()) && ok;
      break;
    default:
      console.error(`unknown task "${task}"`);
      process.exit(2);
  }
  process.exit(ok ? 0 : 1);
}
