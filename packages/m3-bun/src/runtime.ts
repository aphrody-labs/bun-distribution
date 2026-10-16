// SPDX-License-Identifier: Apache-2.0
// The installed buv SDK supervises native processes; Bun.spawn handles hosts without its optional library.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export interface LaunchOptions {
  args?: readonly string[];
  env?: Record<string, string | undefined>;
  cwd?: string;
  /** HTTP port to wait for. */
  port: number;
  /** Path to wait on (default `/healthz`). */
  path?: string;
  timeoutMs?: number;
  /** Cancel startup; the spawned process is stopped before launch rejects. */
  signal?: AbortSignal;
}

export interface Launched {
  via: "buv-runtime" | "bun-spawn";
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
  waitForHttp(options: {
    port: number;
    path?: string;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<number>;
  stopAsync(graceMs?: number): Promise<{ exitCode: number }>;
}

export function runtimeSdkPath(root?: string): string | undefined {
  const checkout = root ?? process.env["APHRODY_BUN_CHECKOUT"];
  if (checkout) {
    const file = resolve(checkout, "packages/bun-runtime-sdk/src/index.ts");
    return existsSync(file) ? file : undefined;
  }
  try {
    const file = fileURLToPath(import.meta.resolve("@aphrody/buv/runtime-sdk"));
    return existsSync(file) ? file : undefined;
  } catch {
    return undefined;
  }
}

async function loadSdk(): Promise<Sdk | undefined> {
  const path = runtimeSdkPath();
  if (!path) return undefined;
  return (await import(path)) as Sdk;
}

/** Start `program`, wait until `port` answers, and hand back a handle. */
export async function launch(
  program: string,
  options: LaunchOptions,
): Promise<Launched> {
  const path = options.path ?? "/healthz";
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (
    !Number.isInteger(options.port) ||
    options.port < 1 ||
    options.port > 65535
  )
    throw new RangeError(`m3-bun: invalid readiness port ${options.port}`);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
    throw new RangeError("m3-bun: timeoutMs must be positive");
  if (!path.startsWith("/") || path.startsWith("//"))
    throw new Error(
      "m3-bun: readiness path must be an absolute path on the local server",
    );
  options.signal?.throwIfAborted();
  const sdk = await loadSdk();
  if (sdk) {
    let runtime:
      (Disposable & { spawn(options: unknown): ManagedLike }) | undefined;
    try {
      runtime = sdk.Runtime.load();
    } catch (error) {
      if (
        (error as { status?: number }).status === 2 ||
        process.env["BUV_RUNTIME_LIB"]
      )
        throw error;
      runtime = undefined;
    }
    if (runtime) {
      const loaded = runtime;
      let child: ManagedLike;
      try {
        child = loaded.spawn({
          program,
          args: options.args ?? [],
          env: options.env ?? {},
          cwd: options.cwd,
          stdio: "capture",
        });
      } catch (error) {
        loaded[Symbol.dispose]();
        throw error;
      }
      try {
        const readyStatus = await child.waitForHttp({
          port: options.port,
          path,
          timeoutMs,
          signal: options.signal,
        });
        const pid = child.status().pid;
        let stopping: Promise<{ exitCode: number | null }> | undefined;
        return {
          via: "buv-runtime",
          pid,
          readyStatus,
          stop() {
            return (stopping ??= (async () => {
              try {
                const status = await child.stopAsync(2000);
                return { exitCode: status.exitCode };
              } finally {
                try {
                  child[Symbol.dispose]();
                } finally {
                  loaded[Symbol.dispose]();
                }
              }
            })());
          },
        };
      } catch (error) {
        await child.stopAsync(0).catch(() => undefined);
        try {
          child[Symbol.dispose]();
        } finally {
          loaded[Symbol.dispose]();
        }
        throw error;
      }
    }
  }
  const proc = Bun.spawn([program, ...(options.args ?? [])], {
    windowsHide: true,
    cwd: options.cwd,
    env: { ...process.env, ...options.env } as Record<string, string>,
    stdout: "ignore",
    stderr: "ignore",
  });
  const deadline = Date.now() + timeoutMs;
  try {
    /* eslint-disable no-await-in-loop -- Readiness probes must finish before the next probe; their deadline and cancellation are shared. */
    for (;;) {
      options.signal?.throwIfAborted();
      if (proc.exitCode !== null || Date.now() >= deadline) {
        throw new Error(
          `m3-bun: ${program} did not answer http://127.0.0.1:${options.port}${path} within ${timeoutMs} ms`,
        );
      }
      let response: Response;
      try {
        const timeout = AbortSignal.timeout(
          Math.min(1000, Math.max(1, deadline - Date.now())),
        );
        response = await fetch(`http://127.0.0.1:${options.port}${path}`, {
          signal: options.signal
            ? AbortSignal.any([timeout, options.signal])
            : timeout,
        });
      } catch {
        options.signal?.throwIfAborted();
        await Bun.sleep(Math.min(50, Math.max(0, deadline - Date.now())));
        continue;
      }
      await response.body?.cancel();
      let stopping: Promise<{ exitCode: number | null }> | undefined;
      return {
        via: "bun-spawn",
        pid: proc.pid,
        readyStatus: response.status,
        stop() {
          return (stopping ??= (async () => {
            if (proc.exitCode === null) proc.kill("SIGTERM");
            const exited = await Promise.race([
              proc.exited,
              Bun.sleep(2000).then(() => undefined),
            ]);
            if (exited === undefined) {
              proc.kill("SIGKILL");
              await proc.exited;
            }
            return { exitCode: proc.exitCode };
          })());
        },
      };
    }
    /* eslint-enable no-await-in-loop */
  } catch (error) {
    if (proc.exitCode === null) proc.kill("SIGKILL");
    await proc.exited;
    throw error;
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
export async function smoke(
  program: string,
  port: number,
  paths: readonly string[] = ["/", "/healthz", "/api/m3/info"],
  expect: Record<string, string> = {
    "/": "text/html",
    "/healthz": "application/json",
    "/api/m3/info": "application/json",
  },
): Promise<SmokeReport> {
  const child = await launch(program, { port, env: { PORT: String(port) } });
  const checks: SmokeCheck[] = [];
  let exitCode: number | null = null;
  try {
    /* eslint-disable no-await-in-loop -- Smoke paths run in caller order against the one supervised process. */
    for (const path of paths) {
      const response = await fetch(`http://127.0.0.1:${port}${path}`, {
        headers: { accept: "text/html,application/json" },
        signal: AbortSignal.timeout(15_000),
      });
      await response.arrayBuffer();
      const contentType = response.headers.get("content-type") ?? "";
      checks.push({
        path,
        status: response.status,
        contentType,
        ok:
          response.status === 200 && contentType.startsWith(expect[path] ?? ""),
      });
    }
    /* eslint-enable no-await-in-loop */
  } finally {
    exitCode = (await child.stop()).exitCode;
  }
  return {
    via: child.via,
    pid: child.pid,
    port,
    checks,
    ok: checks.length > 0 && checks.every((c) => c.ok),
    exitCode,
  };
}

/** One line per check, then the verdict. */
export function formatSmoke(report: SmokeReport): string {
  const lines = report.checks.map(
    (c) =>
      `  ${c.ok ? "ok  " : "FAIL"} GET ${c.path} -> ${c.status} ${c.contentType}`,
  );
  return [
    `m3-bun smoke: pid ${report.pid} on :${report.port} via ${report.via}`,
    ...lines,
    `${report.ok ? "ok" : "failed"}; stopped with exit code ${String(report.exitCode)}`,
  ].join("\n");
}
