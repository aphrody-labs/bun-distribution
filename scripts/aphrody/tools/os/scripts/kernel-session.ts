// SPDX-License-Identifier: Apache-2.0
/**
 * A private, hidden Aphrody OS kernel for one live harness run.
 *
 * `withKernel` starts `aphrody kernel --socket <private endpoint> serve --no-shell --no-browser`
 * without a window, connects the Bun kernel client (JSON-RPC over the pipe/socket: no child
 * process per call), runs the harness, then stops the kernel. Artifacts are written to
 * `<root>/<artifactRoot>/<stamp>` and mirrored into `<root>/<artifactRoot>/latest`.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { KernelClient } from "@aphrody/os";

export type Json =
  null | boolean | number | string | Json[] | { [key: string]: Json };

export const repoRoot = resolve(import.meta.dir, "../../../../../docs/aphrody");

/** The `aphrody` multi-call binary: `APHRODY_BIN`, PATH, the per-user install, then Cargo output. */
export function resolveAphrody(): string {
  const exe = process.platform === "win32" ? "aphrody.exe" : "aphrody";
  const candidates = [
    process.env.APHRODY_BIN,
    Bun.which("aphrody") ?? undefined,
    process.env.LOCALAPPDATA
      ? join(process.env.LOCALAPPDATA, "aphrody", "bin", exe)
      : undefined,
    process.env.CARGO_TARGET_DIR
      ? join(process.env.CARGO_TARGET_DIR, "debug", exe)
      : undefined,
    join(repoRoot, "target", "debug", exe),
  ];
  const found = candidates.find(
    (path): path is string => Boolean(path) && existsSync(path!),
  );
  if (!found) throw new Error("aphrody binary not found (set APHRODY_BIN)");
  return found;
}

/** UTC timestamp `yyyyMMddTHHmmssfffZ`. */
export function sessionStamp(now = new Date()): string {
  return now.toISOString().replace(/[-:]/g, "").replace(".", "");
}

/** A private endpoint name for one run. */
export function privateEndpoint(label: string, stamp: string): string {
  return process.platform === "win32"
    ? `\\\\.\\pipe\\aphrody-${label}-${stamp}`
    : join(tmpdir(), `aphrody-${label}-${stamp}.sock`);
}

export interface KernelSession {
  client: KernelClient;
  endpoint: string;
  aphrody: string;
  /** Raw MCP `tools/call` result; rejects when the tool reports an error. */
  call(tool: string, args?: Record<string, Json>): Promise<Json>;
  /** Raw MCP `tools/call` result, or `{ success: false, error }` when the call failed. */
  tryCall(tool: string, args?: Record<string, Json>): Promise<Json>;
  /**
   * A2A envelope through the kernel dispatcher, from `sourceAgent` to `target` (the subsystem that
   * owns `tool`, or `kernel` to let the kernel route it).
   */
  a2a(
    target: string,
    tool: string,
    args?: Record<string, Json>,
    sourceAgent?: string,
  ): Promise<Json>;
}

/** Run `body` against a private hidden kernel; the kernel stops when `body` settles. */
export async function withKernel<T>(
  label: string,
  stamp: string,
  body: (session: KernelSession) => Promise<T>,
): Promise<T> {
  const aphrody = resolveAphrody();
  const endpoint = privateEndpoint(label, stamp);
  const server = Bun.spawn(
    [
      aphrody,
      "kernel",
      "--socket",
      endpoint,
      "serve",
      "--no-shell",
      "--no-browser",
    ],
    { windowsHide: true, stdin: "ignore", stdout: "ignore", stderr: "ignore" },
  );
  let client: KernelClient | undefined;
  try {
    const deadline = Date.now() + 60_000;
    while (!client) {
      if (server.exitCode !== null)
        throw new Error(`kernel exited with ${server.exitCode}`);
      try {
        // oxlint-disable-next-line no-await-in-loop -- each connection probe depends on the previous attempt.
        client = await KernelClient.connect(endpoint, `live-${label}`, 2_000);
      } catch (error) {
        if (Date.now() > deadline)
          throw new Error(`kernel did not answer on ${endpoint}`, {
            cause: error,
          });
        // oxlint-disable-next-line no-await-in-loop -- bound retries against the same live server process.
        await Bun.sleep(250);
      }
    }
    const connected = client;
    const call = async (
      tool: string,
      args: Record<string, Json> = {},
    ): Promise<Json> => {
      const result = (await connected.request("tools/call", {
        name: tool,
        arguments: args,
      })) as {
        [key: string]: Json;
      };
      if (result?.isError === true) {
        const text = ((result.content as Array<{ text?: string }>) ?? [])
          .map((part) => part.text ?? "")
          .join("\n");
        throw new Error(`kernel call failed: ${tool}\n${text}`);
      }
      return result;
    };
    return await body({
      client: connected,
      endpoint,
      aphrody,
      call,
      tryCall: (tool, args) =>
        call(tool, args).catch((error: unknown) => ({
          success: false,
          error: error instanceof Error ? error.message : String(error),
        })),
      a2a: async (target, tool, args = {}, sourceAgent = `live-${label}`) =>
        (await connected.request("a2a/message/send", {
          target,
          sourceAgent,
          tool,
          arguments: args,
        })) as Json,
    });
  } finally {
    client?.close();
    server.kill();
    await server.exited;
  }
}

/** Session and `latest` directories under `<root>/<artifactRoot>`. */
export function artifactDirs(
  artifactRoot: string,
  stamp: string,
): { session: string; latest: string } {
  const common = resolve(repoRoot, artifactRoot);
  const session = join(common, stamp);
  const latest = join(common, "latest");
  mkdirSync(session, { recursive: true });
  mkdirSync(latest, { recursive: true });
  return { session, latest };
}

/** Write each JSON output into the session and mirror it (and binary files) into `latest`. */
export function writeArtifacts(
  dirs: { session: string; latest: string },
  outputs: Record<string, unknown>,
  binaries: string[] = [],
): void {
  for (const [name, value] of Object.entries(outputs)) {
    const json = `${JSON.stringify(value ?? null, null, 2)}\n`;
    writeFileSync(join(dirs.session, name), json);
    writeFileSync(join(dirs.latest, name), json);
  }
  for (const name of binaries) {
    const source = join(dirs.session, name);
    if (existsSync(source)) copyFileSync(source, join(dirs.latest, name));
  }
}

/** `--name value` options of a small CLI; `--help` and unknown flags are reported by the caller. */
export function parseOptions(
  argv: string[],
  known: string[],
): Map<string, string> {
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index] as string;
    if (flag === "--help" || flag === "-h") {
      options.set("help", "1");
      continue;
    }
    const name = flag.replace(/^--/, "");
    const value = argv[index + 1];
    if (!flag.startsWith("--") || !known.includes(name) || value === undefined)
      throw new Error(`unknown or incomplete option: ${flag}`);
    options.set(name, value);
    index += 1;
  }
  return options;
}
