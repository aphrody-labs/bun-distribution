// SPDX-License-Identifier: Apache-2.0
// A Next.js app behind an m3-bun server: `@aphrody/next-bun/run` starts the app's own `next dev|start` on Bun (no
// Node.js, Turbopack workers included) on a free port, and `@aphrody/m3/server`'s `createProxy` forwards the requests
// the m3-bun routes do not answer (pass `next.fetch` as the server's fallback, or mount it under a prefix).
import type { Subprocess } from "bun";
import { loadOptional } from "./server-optional.ts";

type NextRun = typeof import("@aphrody/next-bun/run");
type M3Server = typeof import("@aphrody/m3/server");

export interface M3NextOptions {
  /** Directory of the Next app (it must depend on `next`). */
  dir: string;
  /** `dev` (default) or `start` (after `next build`). */
  mode?: "dev" | "start";
  /** Interface Next binds (default 127.0.0.1). */
  hostname?: string;
  /** Extra arguments of the Next command. */
  args?: string[];
  /** Milliseconds to wait for Next to announce its URL (default 120000). */
  timeout?: number;
}

export interface M3NextApp {
  /** Origin of the Next server, `http://127.0.0.1:<port>`. */
  readonly url: string;
  /** Forwards a request to Next (keeps path, query, method, headers and body). */
  fetch(request: Request): Promise<Response>;
  stop(): Promise<void>;
}

const LOCAL = /-\s+Local:\s+(https?:\/\/\S+)/;

async function announcedUrl(child: Subprocess<"ignore", "pipe", "pipe">, timeout: number): Promise<string> {
  const decoder = new TextDecoder();
  let seen = "";
  const reader = child.stdout.getReader();
  const timer = setTimeout(() => {
    child.kill();
    void reader.cancel();
  }, timeout);
  try {
    for (;;) {
      // oxlint-disable-next-line no-await-in-loop -- Output is scanned as it arrives, chunk after chunk.
      const { value, done } = await reader.read();
      if (done) break;
      seen += decoder.decode(value, { stream: true });
      const match = LOCAL.exec(seen);
      if (match) {
        reader.releaseLock();
        void child.stdout.pipeTo(new WritableStream()).catch(() => {});
        return match[1]!.replace("://localhost", "://127.0.0.1");
      }
    }
  } finally {
    clearTimeout(timer);
  }
  const stderr = await new Response(child.stderr).text().catch(() => "");
  throw new Error(`m3-bun next: next exited or timed out before serving: ${(stderr || seen).trim().slice(-2000)}`);
}

/** Start the Next app of `options.dir` and return its URL and proxy. */
export async function startNextApp(options: M3NextOptions): Promise<M3NextApp> {
  const [run, server] = await Promise.all([
    loadOptional<NextRun>("@aphrody/next-bun/run", "Next.js app"),
    loadOptional<M3Server>("@aphrody/m3/server", "Next.js app"),
  ]);
  const args = [options.mode ?? "dev", "-p", "0", "-H", options.hostname ?? "127.0.0.1", ...(options.args ?? [])];
  let command: ReturnType<NextRun["nextCommand"]>;
  try {
    command = run.nextCommand(args, options.dir);
  } catch (error) {
    throw new Error(`m3-bun next: ${options.dir} has no next dependency`, {
      cause: error,
    });
  }
  const child = Bun.spawn(command.cmd, {
    windowsHide: true,
    cwd: options.dir,
    env: command.env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  let url: string;
  try {
    url = await announcedUrl(child, options.timeout ?? 120_000);
  } catch (error) {
    child.kill();
    throw error;
  }
  void child.stderr.pipeTo(new WritableStream()).catch(() => {});
  const proxy = server.createProxy(url, "next");
  return {
    url,
    fetch: proxy,
    async stop() {
      child.kill();
      await child.exited;
    },
  };
}
