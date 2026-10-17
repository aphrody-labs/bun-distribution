// SPDX-License-Identifier: Apache-2.0
/** Everything the kit does to the machine goes through `System`, so flows are testable without one. */
import { statfsSync } from "node:fs";
import { connect } from "node:net";

export type Env = Record<string, string | undefined>;

export interface RunOptions {
  timeoutMs?: number;
  /** Written to stdin, then stdin is closed. */
  input?: string;
  /** Added to the process environment. */
  env?: Record<string, string>;
  cwd?: string;
  /** Hand the terminal to the child (progress bars, sign-in windows): output is not captured. */
  inherit?: boolean;
}

export interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface HttpResult {
  status: number;
  body: string;
}

export interface System {
  platform: NodeJS.Platform;
  env: Env;
  run(argv: string[], options?: RunOptions): Promise<RunResult>;
  /** Absolute path of an executable found on PATH. */
  which(name: string): string | undefined;
  tcpOpen(host: string, port: number, timeoutMs: number): Promise<boolean>;
  httpGet(url: string, timeoutMs: number): Promise<HttpResult | undefined>;
  freeBytes(path: string): Promise<number | undefined>;
  sleep(ms: number): Promise<void>;
  now(): Date;
}

const readStream = async (stream: unknown): Promise<string> =>
  stream && typeof stream === "object" && "getReader" in stream
    ? await new Response(stream as ReadableStream).text()
    : "";

export function realSystem(env: Env = process.env): System {
  return {
    platform: process.platform,
    env,
    async run(argv, options = {}) {
      const [command, ...args] = argv;
      if (!command)
        return {
          code: 127,
          stdout: "",
          stderr: "commande vide",
          timedOut: false,
        };
      let proc: ReturnType<typeof Bun.spawn>;
      try {
        proc = Bun.spawn([command, ...args], {
          windowsHide: true,
          cwd: options.cwd,
          env: { ...process.env, ...env, ...options.env },
          stdin: options.input === undefined ? (options.inherit ? "inherit" : "ignore") : "pipe",
          stdout: options.inherit ? "inherit" : "pipe",
          stderr: options.inherit ? "inherit" : "pipe",
        });
      } catch (error) {
        return {
          code: 127,
          stdout: "",
          stderr: (error as Error).message,
          timedOut: false,
        };
      }
      if (options.input !== undefined && proc.stdin && typeof proc.stdin !== "number") {
        proc.stdin.write(options.input);
        await proc.stdin.end();
      }
      let timedOut = false;
      const timer = options.timeoutMs
        ? setTimeout(() => {
            timedOut = true;
            proc.kill();
          }, options.timeoutMs)
        : undefined;
      const [stdout, stderr, code] = await Promise.all([readStream(proc.stdout), readStream(proc.stderr), proc.exited]);
      if (timer) clearTimeout(timer);
      return { code: timedOut ? 124 : code, stdout, stderr, timedOut };
    },
    which: name => Bun.which(name) ?? undefined,
    tcpOpen: (host, port, timeoutMs) =>
      new Promise(resolve => {
        const socket = connect({ host, port });
        const done = (ok: boolean) => {
          socket.destroy();
          resolve(ok);
        };
        socket.setTimeout(timeoutMs, () => done(false));
        socket.once("connect", () => done(true));
        socket.once("error", () => done(false));
      }),
    async httpGet(url, timeoutMs) {
      try {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(timeoutMs),
        });
        return { status: res.status, body: (await res.text()).slice(0, 4096) };
      } catch {
        return undefined;
      }
    },
    async freeBytes(path) {
      try {
        const stats = statfsSync(path);
        return Number(stats.bavail) * Number(stats.bsize);
      } catch {
        return undefined;
      }
    },
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    now: () => new Date(),
  };
}

/** Scripted System for tests: `handlers` answer `run` by the joined command line (first matching prefix wins). */
export interface FakeSystem extends System {
  calls: { argv: string[]; options: RunOptions }[];
  tools: Record<string, string>;
  open: Set<string>;
  http: Record<string, HttpResult>;
  free: number | undefined;
  handlers: {
    match: string | RegExp;
    result: Partial<RunResult> | ((argv: string[], options: RunOptions) => Partial<RunResult>);
  }[];
}

export function fakeSystem(init: Partial<Pick<FakeSystem, "platform" | "env" | "tools" | "free">> = {}): FakeSystem {
  const fake: FakeSystem = {
    platform: init.platform ?? "win32",
    env: init.env ?? {},
    calls: [],
    tools: init.tools ?? {},
    open: new Set(),
    http: {},
    free: init.free ?? 100 * 1024 ** 3,
    handlers: [],
    async run(argv, options = {}) {
      fake.calls.push({ argv, options });
      const line = argv.join(" ");
      for (const handler of fake.handlers) {
        const hit = typeof handler.match === "string" ? line.startsWith(handler.match) : handler.match.test(line);
        if (!hit) continue;
        const partial = typeof handler.result === "function" ? handler.result(argv, options) : handler.result;
        return { code: 0, stdout: "", stderr: "", timedOut: false, ...partial };
      }
      return {
        code: 127,
        stdout: "",
        stderr: `non prévu : ${line}`,
        timedOut: false,
      };
    },
    which: name => fake.tools[name],
    tcpOpen: async (host, port) => fake.open.has(`${host}:${port}`),
    httpGet: async url => fake.http[url],
    freeBytes: async () => fake.free,
    sleep: async () => {},
    now: () => new Date("2026-10-06T12:00:00Z"),
  };
  return fake;
}
