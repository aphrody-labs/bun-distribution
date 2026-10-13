// SPDX-License-Identifier: Apache-2.0
// Serve the built M3 app and forward its JSON-RPC/SSE transport to the native app-server.
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { parseArgs } from "node:util";
import { serveM3 } from "@aphrody/m3/server";
import { appServerProxy, isLoopbackHost } from "@aphrody/app-ui/backend";

const UI_DIST = resolve(import.meta.dir, "../../../crates/ui/app/ui-dist");

function within(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return suffix !== ".." && !suffix.startsWith(".." + sep) && !suffix.startsWith(sep);
}

export interface DesktopUiServerOptions {
  port?: number;
  host?: string;
  backendUrl?: string;
  uiDist?: string;
}

export async function startDesktopUiServer(options: DesktopUiServerOptions = {}) {
  const { port = 1421, host = "127.0.0.1", backendUrl, uiDist = UI_DIST } = options;
  if (!isLoopbackHost(host)) throw new Error("The desktop UI must bind to a loopback address.");
  const root = await realpath(uiDist);
  const index = resolve(root, "index.html");
  if (!existsSync(index)) throw new Error("Build @aphrody/app-ui before serving its UI.");

  return serveM3({
    hostname: host,
    port,
    hmr: false,
    idleTimeout: 0,
    proxy: appServerProxy(backendUrl),
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/") || url.pathname === "/ws") {
        return Response.json(
          { error: "This endpoint is not provided by the web app." },
          { status: 404 },
        );
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", { status: 405, headers: { Allow: "GET, HEAD" } });
      }
      let pathname: string;
      try {
        pathname = decodeURIComponent(url.pathname);
      } catch {
        return new Response("Bad Request", { status: 400 });
      }
      const candidate = resolve(root, "." + pathname);
      if (!within(root, candidate)) return new Response("Forbidden", { status: 403 });
      const file = Bun.file(candidate);
      if (await file.exists()) {
        if (!within(root, await realpath(candidate)))
          return new Response("Forbidden", { status: 403 });
        return new Response(request.method === "HEAD" ? null : file, {
          headers: { "Content-Type": file.type, "Cache-Control": "no-cache" },
        });
      }
      if (extname(pathname) || pathname.startsWith("/fonts/"))
        return new Response("Not Found", { status: 404 });
      return new Response(request.method === "HEAD" ? null : Bun.file(index), {
        headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" },
      });
    },
  });
}

if (import.meta.main) {
  const { values } = parseArgs({
    options: {
      port: { type: "string", short: "p", default: process.env.PORT ?? "1421" },
      host: { type: "string", short: "h", default: process.env.HOST ?? "127.0.0.1" },
      backend: { type: "string" },
      help: { type: "boolean" },
    },
  });
  if (values.help) {
    console.log(
      "Serve the built M3 app: --port 1421 --host 127.0.0.1 --backend http://127.0.0.1:8765",
    );
  } else {
    const server = await startDesktopUiServer({
      port: Number(values.port),
      host: values.host,
      backendUrl: values.backend,
    });
    console.log(`Aphrody UI: ${server.url} (native app-server RPC/SSE)`);
  }
}
