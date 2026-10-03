// SPDX-License-Identifier: Apache-2.0
/**
 * Lifecycle of a local `aphrody-web` CDP engine: start on an ephemeral port, wait until it
 * answers, stop it deterministically.
 *
 * Every started engine is tracked so that `stopAllEngines()` (test preload, signal handlers)
 * can reap it. `process.on("exit")` is not run by `bun test`, so callers that need a guarantee
 * must use `stop()` or the preload helper rather than rely on process exit.
 */
import { ProcessExitedError, Runtime, type ManagedProcess } from "@aphrody/runtime-sdk";
import { loadWebConfig, resolveEngineBinary, type WebConfig } from "./config.ts";

export interface EngineOptions {
  /** Absolute binary path; defaults to `resolveEngineBinary()`. */
  binary?: string;
  config?: WebConfig;
  host?: string;
  /** `0` (default) reserves an ephemeral port. */
  port?: number;
  /** Lets the engine reach loopback/private addresses (local fixtures). */
  allowPrivateNetwork?: boolean;
  allowFileAccess?: boolean;
  stealth?: boolean;
  startupTimeoutMs?: number;
  shutdownGraceMs?: number;
  /** Extra environment for the child; an `undefined` value removes the variable. */
  env?: Record<string, string | undefined>;
  /** Extra `launch` arguments. */
  args?: string[];
}

export interface Engine {
  /** `ws://host:port/devtools/browser`. */
  readonly endpoint: string;
  /** `http://host:port`, base of `/json/version` and `/json/list`. */
  readonly httpUrl: string;
  readonly host: string;
  readonly port: number;
  readonly pid: number;
  /** Last lines the engine wrote to stderr (diagnostics only; never contains page content). */
  stderrTail(): string;
  /** SIGTERM, then SIGKILL after the grace period; resolves with the exit code. */
  stop(): Promise<number>;
  readonly exited: Promise<number>;
}

const running = new Set<Engine>();
const STDERR_TAIL_BYTES = 8192;

/**
 * Supervision (spawn in its own process group, bounded stdout/stderr capture, HTTP readiness,
 * SIGTERM → SIGKILL stop, teardown with the runtime) is provided by the native YOLO runtime
 * (`runtime:process`); this module only decides what an engine is and how it is started.
 */
let runtime: Runtime | undefined;
function engineRuntime(): Runtime {
  runtime ??= Runtime.load({ maxOperations: 32 });
  return runtime;
}

async function reservePort(host: string): Promise<number> {
  const listener = Bun.listen({ hostname: host, port: 0, socket: { data() {} } });
  const port = listener.port;
  listener.stop(true);
  return port;
}

/** Bun's `exited` convention: the exit code, or 128 + signal when the engine was killed. */
function exitCode(status: { exitCode: number; signal: number }): number {
  return status.signal > 0 ? 128 + status.signal : status.exitCode;
}

/** Starts an engine and resolves once `/json/version` answers. */
export async function startEngine(options: EngineOptions = {}): Promise<Engine> {
  const config = options.config ?? loadWebConfig();
  const binary = options.binary ?? resolveEngineBinary(config);
  const host = options.host ?? config.engine.host;
  const port = options.port && options.port > 0 ? options.port : await reservePort(host);
  const startupTimeoutMs = options.startupTimeoutMs ?? config.engine.startupTimeoutMs;
  const shutdownGraceMs = options.shutdownGraceMs ?? config.engine.shutdownGraceMs;
  const allowPrivate = options.allowPrivateNetwork ?? config.engine.allowPrivateNetwork;

  const args = ["launch", "--host", host, "--port", String(port)];
  if (options.stealth ?? config.engine.stealth) args.push("--stealth");
  if (options.allowFileAccess ?? config.engine.allowFileAccess) args.push("--allow-file-access");
  args.push(...(options.args ?? []));

  const env: Record<string, string | undefined> = { ...options.env };
  if (allowPrivate) env["OBSCURA_ALLOW_PRIVATE_NETWORK"] = "1";

  const child: ManagedProcess = engineRuntime().spawn({
    program: binary,
    args,
    env,
    stdio: "capture",
  });
  let finalStatus: { exitCode: number; signal: number } | undefined;
  let tailSnapshot = "";
  let released = false;
  const tail = (): string => (released ? tailSnapshot : child.stderrTail(STDERR_TAIL_BYTES));
  const release = (): void => {
    if (released) return;
    tailSnapshot = child.stderrTail(STDERR_TAIL_BYTES);
    released = true;
    child.release();
  };
  const stopChild = async (graceMs: number): Promise<number> => {
    const status = await child.stopAsync(graceMs);
    finalStatus = status;
    release();
    return exitCode(status);
  };
  const fail = async (reason: string): Promise<never> => {
    const diagnostics = tail();
    await stopChild(0);
    throw new Error(`${reason}${diagnostics ? `\n--- engine stderr ---\n${diagnostics}` : ""}`);
  };

  const deadline = Date.now() + startupTimeoutMs;
  let endpoint = "";
  try {
    try {
      endpoint = await child.waitForStdoutLine({ timeoutMs: startupTimeoutMs });
    } catch {
      return await fail("engine did not print its CDP endpoint");
    }
    const expected = `ws://${host}:${port}/devtools/browser`;
    if (endpoint !== expected)
      return await fail(
        `unexpected CDP endpoint ${JSON.stringify(endpoint)}, expected ${expected}`,
      );
    const url = `http://${host}:${port}/json/version`;
    try {
      await child.waitForHttp({
        host,
        port,
        path: "/json/version",
        timeoutMs: Math.max(1, deadline - Date.now()),
        accept: (status) => status >= 200 && status < 300,
      });
    } catch (error) {
      if (error instanceof ProcessExitedError) {
        return await fail("engine exited before it started listening");
      }
      return await fail(`engine did not answer ${url} in time`);
    }
  } catch (error) {
    if (!released) await stopChild(0);
    throw error;
  }

  const exited = (async (): Promise<number> => {
    for (;;) {
      if (released) return finalStatus ? exitCode(finalStatus) : 143;
      let status;
      try {
        status = child.status();
      } catch {
        return finalStatus ? exitCode(finalStatus) : 143;
      }
      if (!status.running) return exitCode(status);
      // eslint-disable-next-line no-await-in-loop
      await Bun.sleep(25);
    }
  })();

  let stopping: Promise<number> | undefined;
  const engine: Engine = {
    endpoint,
    httpUrl: `http://${host}:${port}`,
    host,
    port,
    pid: child.pid,
    stderrTail: tail,
    exited,
    stop() {
      stopping ??= (async () => {
        running.delete(engine);
        return released ? finalStatus ? exitCode(finalStatus) : 143 : await stopChild(shutdownGraceMs);
      })();
      return stopping;
    },
  };
  running.add(engine);
  return engine;
}

/** Stops every engine started by this process; safe to call repeatedly. */
export async function stopAllEngines(): Promise<void> {
  await Promise.all([...running].map((engine) => engine.stop()));
}

function reap(signal: NodeJS.Signals): void {
  void stopAllEngines().finally(() => process.exit(128 + (signal === "SIGINT" ? 2 : 15)));
}

let signalsInstalled = false;
/** Reaps engines on SIGINT/SIGTERM and on a normal exit of the host process. */
export function installEngineCleanup(): void {
  if (signalsInstalled) return;
  signalsInstalled = true;
  process.once("SIGINT", () => reap("SIGINT"));
  process.once("SIGTERM", () => reap("SIGTERM"));
  process.once("exit", () => {
    for (const engine of running) {
      try {
        process.kill(-engine.pid, "SIGKILL"); // the engine runs in its own process group
      } catch {
        // already gone
      }
    }
  });
}

/** Runs `fn` against a fresh engine and always stops it. */
export async function withEngine<T>(
  fn: (engine: Engine) => Promise<T>,
  options: EngineOptions = {},
): Promise<T> {
  installEngineCleanup();
  const engine = await startEngine(options);
  try {
    return await fn(engine);
  } finally {
    await engine.stop();
  }
}

const TEST_ENDPOINT_KEYS = ["APHRODY_BROWSER_CDP_URL", "APHRODY_CDP_URL"] as const;

/**
 * Test harness entry: attaches to `APHRODY_WEB_TEST_CDP_URL` when set, reuses an engine this
 * process already started, otherwise starts one (private network allowed for local fixtures)
 * and exports its endpoint as `APHRODY_BROWSER_CDP_URL`. Idempotent.
 */
export async function ensureTestEngine(
  options: EngineOptions = {},
): Promise<{ endpoint: string; owned: boolean }> {
  const explicit = process.env.APHRODY_WEB_TEST_CDP_URL;
  if (explicit) {
    for (const key of TEST_ENDPOINT_KEYS) process.env[key] = explicit;
    return { endpoint: explicit, owned: false };
  }
  const existing = [...running][0];
  if (existing) return { endpoint: existing.endpoint, owned: true };
  installEngineCleanup();
  const engine = await startEngine({ allowPrivateNetwork: true, ...options });
  for (const key of TEST_ENDPOINT_KEYS) process.env[key] = engine.endpoint;
  return { endpoint: engine.endpoint, owned: true };
}
