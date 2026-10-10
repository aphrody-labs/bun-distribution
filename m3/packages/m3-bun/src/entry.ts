// SPDX-License-Identifier: Apache-2.0
// The runtime of a compiled M3 app: `m3-bun compile` generates a tiny module that calls `runApp` with the
// embedded files and the API, and `bun build --compile` turns it into one executable.
//
//   ./app                 serve on $PORT (default 3000), $HOST
//   ./app --port 8080     choose the port
//   ./app --healthcheck   GET /healthz of the running instance, exit 0 or 1 (a container HEALTHCHECK with no shell)
//   ./app --version
import type { M3ApiModule } from "./api.ts";
import { embeddedSource, startM3Server, type M3AppOptions } from "./server.ts";

export interface RunAppOptions extends Omit<M3AppOptions, "files"> {
  name: string;
  version: string;
  buildId: string;
  port: number;
  /** URL path -> embedded file path. */
  files: Readonly<Record<string, string>>;
  api?: M3ApiModule;
}

/** The value after `--name` or `--name=value`. */
export function flagValue(argv: readonly string[], name: string): string | undefined {
  const i = argv.findIndex((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (i === -1) return undefined;
  const arg = argv[i]!;
  return arg.includes("=") ? arg.slice(arg.indexOf("=") + 1) : argv[i + 1];
}

/** Run the app: the command line first, then the server. Resolves when the process should exit, never while serving. */
export async function runApp(options: RunAppOptions, argv: readonly string[] = Bun.argv.slice(2)): Promise<void> {
  if (argv.includes("--version")) {
    console.log(`${options.name} ${options.version} (${options.buildId})`);
    return;
  }
  const portFlag = flagValue(argv, "port");
  const port = Bun.env.PORT ? Number(Bun.env.PORT) : portFlag ? Number(portFlag) : options.port;
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(`${options.name}: invalid port ${String(port)}`);

  if (argv.includes("--healthcheck")) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}${options.health === false ? "/" : (options.health ?? "/healthz")}`, { signal: AbortSignal.timeout(3000) });
      process.exitCode = response.ok ? 0 : 1;
    } catch {
      process.exitCode = 1;
    }
    return;
  }

  const { files, ...rest } = options;
  const hostname = Bun.env.HOST;
  const server = startM3Server({ ...rest, files: embeddedSource(files, options.buildId), port, ...(hostname ? { hostname } : {}) });
  console.log(`${options.name} ${options.version} listening on ${server.url}`);
  const stop = () => {
    void server.stop(true).then(() => process.exit(0));
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  // Keep the process alive: Bun.serve holds the event loop; a never-resolving promise documents it.
  await new Promise<void>(() => undefined);
}
