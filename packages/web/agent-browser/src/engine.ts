// SPDX-License-Identifier: Apache-2.0
/**
 * Lifecycle of a local `aphrody-web` CDP engine: start on an ephemeral port, wait until it
 * answers, stop it deterministically.
 *
 * Every started engine is tracked so that `stopAllEngines()` (test preload, signal handlers)
 * can reap it. `process.on("exit")` is not run by `bun test`, so callers that need a guarantee
 * must use `stop()` or the preload helper rather than rely on process exit.
 */
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
  /** Extra environment for the child. */
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

async function reservePort(host: string): Promise<number> {
  const listener = Bun.listen({ hostname: host, port: 0, socket: { data() {} } });
  const port = listener.port;
  listener.stop(true);
  return port;
}

async function waitForHttp(url: string, deadline: number, isAlive: () => boolean): Promise<void> {
  let lastError = "no response";
  while (Date.now() < deadline) {
    // Polling is sequential by design: each probe waits for the previous one.
    /* oxlint-disable no-await-in-loop */
    if (!isAlive()) throw new Error("engine exited before it started listening");
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await Bun.sleep(50);
    /* oxlint-enable no-await-in-loop */
  }
  throw new Error(`engine did not answer ${url} in time (${lastError})`);
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

  const env: Record<string, string | undefined> = { ...process.env, ...options.env };
  if (allowPrivate) env.OBSCURA_ALLOW_PRIVATE_NETWORK = "1";

  const child = Bun.spawn([binary, ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env,
  });

  let tail = "";
  const drainStderr = (async () => {
    const decoder = new TextDecoder();
    for await (const chunk of child.stderr) {
      tail = (tail + decoder.decode(chunk, { stream: true })).slice(-STDERR_TAIL_BYTES);
    }
  })();
  drainStderr.catch(() => {});

  const stdoutReader = child.stdout.getReader();
  let alive = true;
  void child.exited.then(() => {
    alive = false;
    return undefined;
  });
  const fail = async (reason: string): Promise<never> => {
    child.kill("SIGKILL");
    await child.exited;
    throw new Error(`${reason}${tail ? `\n--- engine stderr ---\n${tail}` : ""}`);
  };

  const deadline = Date.now() + startupTimeoutMs;
  let endpoint = "";
  try {
    const first = await Promise.race([
      stdoutReader.read(),
      Bun.sleep(startupTimeoutMs).then(() => "timeout" as const),
    ]);
    if (first === "timeout" || first.done) {
      return await fail("engine did not print its CDP endpoint");
    }
    endpoint = new TextDecoder().decode(first.value).split("\n")[0]?.trim() ?? "";
    const expected = `ws://${host}:${port}/devtools/browser`;
    if (endpoint !== expected)
      return await fail(
        `unexpected CDP endpoint ${JSON.stringify(endpoint)}, expected ${expected}`,
      );
    // Keep draining stdout so the pipe can never fill up.
    void (async () => {
      try {
        let done = false;
        while (!done) {
          // oxlint-disable-next-line no-await-in-loop
          done = (await stdoutReader.read()).done;
        }
      } catch {
        // pipe closed with the process
      }
    })();
    await waitForHttp(`http://${host}:${port}/json/version`, deadline, () => alive);
  } catch (error) {
    if (alive) child.kill("SIGKILL");
    await child.exited;
    throw error;
  }

  let stopping: Promise<number> | undefined;
  const engine: Engine = {
    endpoint,
    httpUrl: `http://${host}:${port}`,
    host,
    port,
    pid: child.pid,
    stderrTail: () => tail,
    exited: child.exited,
    stop() {
      stopping ??= (async () => {
        running.delete(engine);
        if (child.exitCode === null) {
          child.kill("SIGTERM");
          const code = await Promise.race([
            child.exited,
            Bun.sleep(shutdownGraceMs).then(() => null),
          ]);
          if (code === null) {
            child.kill("SIGKILL");
            return await child.exited;
          }
        }
        return await child.exited;
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
        process.kill(engine.pid, "SIGKILL");
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
