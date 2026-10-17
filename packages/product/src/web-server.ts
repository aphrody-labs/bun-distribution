// SPDX-License-Identifier: Apache-2.0
// Serve the built M3 app and forward its JSON-RPC/SSE transport to the native app-server.
import { existsSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { findWorkspaceRoot } from "@aphrody/paths";
import { createProxy, serveM3 } from "@aphrody/m3/server";
import { appServerProxy, isLoopbackHost } from "@aphrody/app-ui/backend";

function within(root: string, path: string): boolean {
  const suffix = relative(root, path);
  return suffix !== ".." && !suffix.startsWith(".." + sep) && !suffix.startsWith(sep);
}

export interface ProductUiServerOptions {
  port?: number;
  host?: string;
  backendUrl?: string;
  uiDist?: string;
}

export async function startProductUiServer(options: ProductUiServerOptions = {}) {
  const {
    port = 3000,
    host = "127.0.0.1",
    backendUrl,
    uiDist = resolve(findWorkspaceRoot(), "crates/ui/app/ui-dist"),
  } = options;
  if (!isLoopbackHost(host)) throw new Error("The private product UI must bind to a loopback address.");
  const root = await realpath(uiDist);
  const index = resolve(root, "index.html");
  if (!existsSync(index)) throw new Error("Build @aphrody/app-ui before serving its UI.");

  return serveM3({
    hostname: host,
    port,
    hmr: false,
    idleTimeout: 0,
    routes: Object.fromEntries(
      Object.entries(appServerProxy(backendUrl)).map(([path, target]) => {
        const forward = createProxy(target);
        return [
          path,
          async (request: Request) => {
            const url = new URL(request.url);
            if (!isLoopbackHost(url.hostname) || request.headers.get("sec-fetch-site") === "cross-site")
              return new Response("Forbidden", { status: 403 });
            const origin = request.headers.get("origin");
            if (!origin) return forward(request);
            // Validate the browser boundary before adapting its origin to the private backend.
            if (origin !== url.origin) return new Response("Forbidden", { status: 403 });
            const headers = new Headers(request.headers);
            headers.set("origin", target);
            return forward(new Request(request, { headers }));
          },
        ];
      }),
    ),
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/") || url.pathname === "/ws") {
        return Response.json({ error: "This endpoint is not provided by the web app." }, { status: 404 });
      }
      if (request.method !== "GET" && request.method !== "HEAD") {
        return new Response("Method Not Allowed", {
          status: 405,
          headers: { Allow: "GET, HEAD" },
        });
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
        if (!within(root, await realpath(candidate))) return new Response("Forbidden", { status: 403 });
        return new Response(request.method === "HEAD" ? null : file, {
          headers: { "Content-Type": file.type, "Cache-Control": "no-cache" },
        });
      }
      if (extname(pathname) || pathname.startsWith("/fonts/")) return new Response("Not Found", { status: 404 });
      return new Response(request.method === "HEAD" ? null : Bun.file(index), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-cache",
        },
      });
    },
  });
}
