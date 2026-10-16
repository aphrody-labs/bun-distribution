// SPDX-License-Identifier: Apache-2.0
// `m3-bun dev --inspect`: the dev server runs in a child Bun with its inspector on (`BUN_INSPECT`), the way the Bun
// debug adapter launches programs (`@aphrody/bun-debug-adapter-protocol`: free port, random path, TCP signal the child
// pings once its inspector listens). The parent attaches with `@aphrody/bun-inspector-protocol`'s `WebSocketInspector`
// and relays the child's console and uncaught exceptions; `serveInspectorFrontend` serves the WebKit Web Inspector
// of `@aphrody/web-inspector-bun`, connected to the same inspector through its `?ws=` parameter.
import type { Server, Subprocess } from "bun";
import { createM3App, dirSource } from "./server.ts";
import { loadOptional, packageDir } from "./server-optional.ts";

// The parts used of the two packages, typed here: they ship their TypeScript sources, which this package's strict
// compiler settings would otherwise check.
interface Dap {
  getAvailablePort(): Promise<number>;
  getRandomId(): string;
  TCPSocketSignal: new (port: number) => {
    readonly ready: Promise<void>;
    readonly url: string;
    once(event: "Signal.received", listener: () => void): unknown;
    close(): void;
  };
}
interface RemoteObject {
  type: string;
}
interface Inspector {
  start(): Promise<boolean>;
  send(method: string, params?: object): Promise<unknown>;
  on(
    event: "Console.messageAdded",
    listener: (event: {
      message: { level: string; text: string; parameters?: RemoteObject[] };
    }) => void,
  ): unknown;
  on(
    event: "LifecycleReporter.error",
    listener: (event: {
      name: string;
      message: string;
      urls: string[];
      lineColumns: number[];
    }) => void,
  ): unknown;
  close(): void;
}
interface Protocol {
  WebSocketInspector: new (url: string) => Inspector;
  remoteObjectToString(value: RemoteObject, topLevel?: boolean): string;
}

export type M3ConsoleLevel = "log" | "info" | "warning" | "error" | "debug";

export interface M3ConsoleEntry {
  level: M3ConsoleLevel;
  text: string;
}

export interface M3InspectedException {
  name: string;
  message: string;
  /** `url:line:column` frames, innermost first. */
  frames: string[];
}

export interface M3InspectOptions {
  /** The command, run by Bun (`[process.execPath, "server.ts"]`). */
  cmd: string[];
  cwd?: string;
  env?: Record<string, string | undefined>;
  /** Hold the program until the relay is attached, so no early output is lost (default true). */
  wait?: boolean;
  onConsole?(entry: M3ConsoleEntry): void;
  onException?(exception: M3InspectedException): void;
  /** Child output (default `inherit`). */
  stdio?: "inherit" | "pipe" | "ignore";
}

export interface M3Inspected {
  readonly child: Subprocess<
    "ignore",
    "inherit" | "pipe" | "ignore",
    "inherit" | "pipe" | "ignore"
  >;
  /** Inspector WebSocket of the child (`ws://127.0.0.1:<port>/<id>`). */
  readonly inspectorUrl: string;
  /** Resolves once the relay is attached. */
  readonly attached: Promise<void>;
  readonly inspector: Promise<Inspector>;
  stop(): Promise<void>;
}

const FEATURE = "dev --inspect";

const LEVELS: Record<string, M3ConsoleLevel> = {
  log: "log",
  info: "info",
  warning: "warning",
  error: "error",
  debug: "debug",
};

/** Run `options.cmd` under the inspector and relay its console and uncaught exceptions. */
export async function launchInspected(
  options: M3InspectOptions,
): Promise<M3Inspected> {
  const [dap, protocol] = await Promise.all([
    loadOptional<Dap>("@aphrody/bun-debug-adapter-protocol", FEATURE),
    loadOptional<Protocol>("@aphrody/bun-inspector-protocol", FEATURE),
  ]);
  const inspectorUrl = `ws://127.0.0.1:${await dap.getAvailablePort()}/${dap.getRandomId()}`;
  const signal = new dap.TCPSocketSignal(0);
  await signal.ready;
  const wait = options.wait ?? true;
  const stdio = options.stdio ?? "inherit";
  const received = Promise.withResolvers<void>();
  signal.once("Signal.received", () => received.resolve());
  const child = Bun.spawn(options.cmd, {
    windowsHide: true,
    cwd: options.cwd,
    env: {
      ...(options.env ?? process.env),
      BUN_INSPECT: wait ? `${inspectorUrl}?wait=1` : inspectorUrl,
      BUN_INSPECT_NOTIFY: signal.url,
    },
    stdin: "ignore",
    stdout: stdio,
    stderr: stdio,
  });
  void child.exited.then(() => {
    signal.close();
    return received.reject(
      new Error(
        `m3-bun ${FEATURE}: the program exited before its inspector listened`,
      ),
    );
  });

  const inspector = received.promise.then(async () => {
    const client = new protocol.WebSocketInspector(inspectorUrl);
    client.on("Console.messageAdded", ({ message }) => {
      const text = message.parameters?.length
        ? message.parameters
            .map((value) => protocol.remoteObjectToString(value, true))
            .join(" ")
        : message.text;
      options.onConsole?.({ level: LEVELS[message.level] ?? "log", text });
    });
    client.on(
      "LifecycleReporter.error",
      ({ name, message, urls, lineColumns }) => {
        const frames = urls.map(
          (url, i) =>
            `${url}:${lineColumns[i * 2] ?? 0}:${lineColumns[i * 2 + 1] ?? 0}`,
        );
        options.onException?.({ name, message, frames });
      },
    );
    if (!(await client.start()))
      throw new Error(`m3-bun ${FEATURE}: cannot attach to ${inspectorUrl}`);
    await Promise.all([
      client.send("Inspector.enable"),
      client.send("Runtime.enable"),
      client.send("Console.enable"),
      client.send("LifecycleReporter.enable"),
    ]);
    await client.send("Inspector.initialized");
    signal.close();
    return client;
  });
  inspector.catch(() => {});

  return {
    child,
    inspectorUrl,
    inspector,
    attached: inspector.then(() => undefined),
    async stop() {
      void inspector.then(
        (client) => client.close(),
        () => {},
      );
      child.kill();
      await child.exited;
      signal.close();
    },
  };
}

export interface M3InspectorFrontend {
  readonly server: Server<undefined>;
  /** The Web Inspector page connected to `ws`. */
  readonly url: string;
  stop(): Promise<void>;
}

/** Serve the WebKit Web Inspector of `@aphrody/web-inspector-bun`, connected to the inspector at `ws`. */
export function serveInspectorFrontend(options: {
  ws: string;
  port?: number;
  hostname?: string;
}): M3InspectorFrontend {
  const dir = packageDir("@aphrody/web-inspector-bun", FEATURE);
  // The frontend's own pages carry inline scripts; the default CSP would block them.
  const app = createM3App({
    name: "web-inspector",
    files: dirSource(dir),
    csp: false,
    spa: false,
    health: false,
  });
  const server = Bun.serve({
    port: options.port ?? 0,
    hostname: options.hostname ?? "127.0.0.1",
    routes: app.routes,
    fetch: app.fetch,
  });
  const page = new URL("/index.html", server.url);
  page.searchParams.set("ws", options.ws.replace(/^wss?:\/\//, ""));
  return {
    server,
    url: page.href,
    stop: () => server.stop(true),
  };
}
