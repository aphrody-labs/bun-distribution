// SPDX-License-Identifier: Apache-2.0
// Development server: builds the app (development React, no minification) into a fresh directory
// on every change, swaps the handler and tells the browsers to refresh the RSC payload over
// WebSocket, which keeps the state of the client components whose chunks did not change.
import type { BunPlugin } from "bun";
import { watch, type FSWatcher } from "node:fs";
import { rmSync } from "node:fs";
import { join, relative } from "node:path";
import { buildApp } from "./build";
import { loadApp, type AppHandler } from "./host";
import { HMR_PATH } from "./runtime/shared";

export interface DevAppOptions {
  root: string;
  appDir?: string;
  port?: number;
  hostname?: string;
  clientPlugins?: BunPlugin[];
  serverPlugins?: BunPlugin[];
  /** Called after each rebuild (tests, logs). */
  onRebuild?: (result: { ok: boolean; error?: unknown; ms: number }) => void;
}

export interface DevApp {
  server: Bun.Server<undefined>;
  url: URL;
  /** Rebuild now (also triggered by file changes). */
  rebuild(): Promise<void>;
  stop(): Promise<void>;
}

const IGNORED = /(^|[\\/])(node_modules|\.git|\.m3|dist|\.next|\.turbo)([\\/]|$)/;

export async function devApp(options: DevAppOptions): Promise<DevApp> {
  const root = options.root;
  const base = join(root, ".m3", "dev");
  rmSync(base, { recursive: true, force: true });
  let generation = 0;
  let app: AppHandler | undefined;
  let lastError: unknown;

  const build = async () => {
    const started = performance.now();
    const outDir = join(base, String(++generation));
    try {
      await buildApp({
        root,
        appDir: options.appDir,
        outDir,
        dev: true,
        buildId: "dev",
        clientPlugins: options.clientPlugins,
        serverPlugins: options.serverPlugins,
      });
      const previous = app;
      app = await loadApp(outDir, { bootstrapScript: "self.__m3_dev=true" });
      lastError = undefined;
      if (previous) rmSync(previous.outDir, { recursive: true, force: true });
      options.onRebuild?.({ ok: true, ms: performance.now() - started });
    } catch (error) {
      lastError = error;
      console.error(error);
      options.onRebuild?.({ ok: false, error, ms: performance.now() - started });
    }
  };

  await build();

  const server: Bun.Server<undefined> = Bun.serve({
    port: options.port ?? Number(process.env.PORT ?? 3000),
    hostname: options.hostname,
    development: true,
    fetch(request, srv) {
      if (new URL(request.url).pathname === HMR_PATH && srv.upgrade(request, { data: undefined }))
        return undefined;
      if (!app || lastError) {
        const message =
          lastError instanceof Error
            ? (lastError.stack ?? lastError.message)
            : String(lastError ?? "building");
        return new Response(
          `<!DOCTYPE html><title>Build error</title><pre>${Bun.escapeHTML(message)}</pre><script>new WebSocket("ws://"+location.host+"${HMR_PATH}").onmessage=()=>location.reload()</script>`,
          { status: 500, headers: { "content-type": "text/html; charset=utf-8" } },
        );
      }
      return app.fetch(request);
    },
    websocket: {
      open(ws) {
        ws.subscribe("hmr");
      },
      message() {},
    },
  });

  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();
  const rebuild = () => {
    const failedBefore = !!lastError;
    running = running.then(build).then(() => {
      if (lastError) return;
      server.publish("hmr", JSON.stringify({ type: failedBefore ? "reload" : "refresh" }));
      return;
    });
    return running;
  };

  let watcher: FSWatcher | undefined;
  try {
    watcher = watch(root, { recursive: true }, (_event, file) => {
      if (!file || IGNORED.test(String(file))) return;
      if (relative(root, join(root, String(file))).startsWith("..")) return;
      clearTimeout(timer);
      timer = setTimeout(() => void rebuild(), 30);
    });
  } catch (error) {
    console.warn(
      `@aphrody/m3: file watching unavailable (${String(error)}); call rebuild() manually`,
    );
  }

  return {
    server,
    url: server.url,
    rebuild,
    async stop() {
      watcher?.close();
      clearTimeout(timer);
      await running;
      await server.stop(true);
      rmSync(base, { recursive: true, force: true });
    },
  };
}
