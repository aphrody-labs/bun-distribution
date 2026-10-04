// SPDX-License-Identifier: Apache-2.0
// Running a compiled app under supervision. Where the YOLO runtime is installed, `@aphrody/runtime-sdk` (yolo's
// `packages/runtime`, loaded from `$YOLO_ROOT`, over the precompiled library's versioned C ABI) spawns the
// process, waits for its HTTP port and stops it with a grace period. Without it, `Bun.spawn` does the same.
// `launch` says which one it used.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { yoloRoot } from "./util.ts";

export interface LaunchOptions {
  args?: readonly string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
  /** HTTP port to wait for. */
  port: number;
  /** Path to wait on (default `/healthz`). */
  path?: string;
  timeoutMs?: number;
}

export interface Launched {
  /** `yolo-runtime` (the SDK over the native library) or `bun-spawn`. */
  via: "yolo-runtime" | "bun-spawn";
  pid: number;
  /** Status of the wait: the HTTP status the path answered. */
  readyStatus: number;
  /** Stop the process (graceful, then forced) and release it. */
  stop(): Promise<{ exitCode: number | null }>;
}

interface Sdk {
  Runtime: { load(): Disposable & { spawn(options: unknown): ManagedLike } };
}
interface ManagedLike extends Disposable {
  status(): { running: boolean; pid: number; exitCode: number };
  waitForHttp(options: { port: number; path?: string; timeoutMs?: number }): Promise<number>;
  stopAsync(graceMs?: number): Promise<{ exitCode: number }>;
}

/** The SDK entry under `$YOLO_ROOT`, or undefined when yolo is not checked out. */
export function runtimeSdkPath(root: string = yoloRoot()): string | undefined {
  const file = join(root, "packages/runtime/src/index.ts");
  return existsSync(file) ? file : undefined;
}

async function loadSdk(): Promise<Sdk | undefined> {
  const path = runtimeSdkPath();
  if (!path) return undefined;
  try {
    return (await import(path)) as Sdk;
  } catch {
    return undefined;
  }
}

/** Start `program`, wait until `port` answers, and hand back a handle. */
export async function launch(program: string, options: LaunchOptions): Promise<Launched> {
  const path = options.path ?? "/healthz";
  const timeoutMs = options.timeoutMs ?? 15_000;
  const sdk = await loadSdk();
  if (sdk) {
    let runtime: (Disposable & { spawn(options: unknown): ManagedLike }) | undefined;
    try {
      runtime = sdk.Runtime.load();
    } catch {
      runtime = undefined;
    }
    if (runtime) {
      const loaded = runtime;
      const child = loaded.spawn({ program, args: options.args ?? [], env: options.env ?? {}, cwd: options.cwd, stdio: "capture" });
      try {
        const readyStatus = await child.waitForHttp({ port: options.port, path, timeoutMs });
        const pid = child.status().pid;
        return {
          via: "yolo-runtime",
          pid,
          readyStatus,
          async stop() {
            const status = await child.stopAsync(2000);
            child[Symbol.dispose]();
            loaded[Symbol.dispose]();
            return { exitCode: status.exitCode };
          },
        };
      } catch (error) {
        await child.stopAsync(0).catch(() => undefined);
        child[Symbol.dispose]();
        loaded[Symbol.dispose]();
        throw error;
      }
    }
  }
  const proc = Bun.spawn([program, ...(options.args ?? [])], {
    cwd: options.cwd,
    env: { ...process.env, ...options.env } as Record<string, string>,
    stdout: "ignore",
    stderr: "ignore",
  });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${options.port}${path}`, { signal: AbortSignal.timeout(1000) });
      return {
        via: "bun-spawn",
        pid: proc.pid,
        readyStatus: response.status,
        async stop() {
          proc.kill("SIGTERM");
          const exited = await Promise.race([proc.exited, Bun.sleep(2000).then(() => undefined)]);
          if (exited === undefined) {
            proc.kill("SIGKILL");
            await proc.exited;
          }
          return { exitCode: proc.exitCode };
        },
      };
    } catch {
      if (Date.now() > deadline || proc.exitCode !== null) {
        proc.kill("SIGKILL");
        throw new Error(`m3-bun: ${program} did not answer http://127.0.0.1:${options.port}${path} within ${timeoutMs} ms`);
      }
      await Bun.sleep(50);
    }
  }
}

export interface SmokeCheck {
  path: string;
  status: number;
  contentType: string;
  ok: boolean;
}

export interface SmokeReport {
  via: Launched["via"];
  pid: number;
  port: number;
  checks: SmokeCheck[];
  ok: boolean;
  exitCode: number | null;
}

/** Launch an executable on `port` and GET each of `paths`; stops it afterwards. `expect` maps a path to the wanted content type prefix. */
export async function smoke(program: string, port: number, paths: readonly string[] = ["/", "/healthz", "/api/m3/info"], expect: Record<string, string> = { "/": "text/html", "/healthz": "application/json", "/api/m3/info": "application/json" }): Promise<SmokeReport> {
  const child = await launch(program, { port, env: { PORT: String(port) } });
  const checks: SmokeCheck[] = [];
  let exitCode: number | null = null;
  try {
    for (const path of paths) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { accept: "text/html,application/json" } });
      await response.arrayBuffer();
      const contentType = response.headers.get("content-type") ?? "";
      checks.push({ path, status: response.status, contentType, ok: response.status === 200 && contentType.startsWith(expect[path] ?? "") });
    }
  } finally {
    exitCode = (await child.stop()).exitCode;
  }
  return { via: child.via, pid: child.pid, port, checks, ok: checks.length > 0 && checks.every((c) => c.ok), exitCode };
}

/** One line per check, then the verdict. */
export function formatSmoke(report: SmokeReport): string {
  const lines = report.checks.map((c) => `  ${c.ok ? "ok  " : "FAIL"} GET ${c.path} -> ${c.status} ${c.contentType}`);
  return [`m3-bun smoke: pid ${report.pid} on :${report.port} via ${report.via}`, ...lines, `${report.ok ? "ok" : "failed"}; stopped with exit code ${String(report.exitCode)}`].join("\n");
}
