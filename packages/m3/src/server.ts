// SPDX-License-Identifier: Apache-2.0
// `serveM3`: the one dev / preview server of an @aphrody/m3 application, over `Bun.serve`.
//
//   import index from "./index.html";
//   serveM3({ index, proxy: { "/rpc": "http://localhost:8080" }, port: 3000 });
//
// - `development: { hmr, console }`: Bun bundles the HTML entry on the fly (plugins come from
//   `bunfig.toml` `[serve.static]`, usually `["@aphrody/m3/plugin"]`), with hot reloading.
// - SPA fallback: the entry answers `/*`, so client-side routes survive a reload.
// - Proxy prefixes (ported from `drive/apps/web/src/server.ts`): `"/rpc"` forwards `/rpc` and
//   everything below it to the target, keeping method, headers, body and query.
import type { HTMLBundle, Server } from "bun";
import { existsSync, statSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ComponentType } from "react";

/** A route value accepted by `Bun.serve`. */
export type M3RouteValue = Bun.Serve.Routes<undefined, string>[string];

/** Props supplied to a React page rendered from `pagesDir`. */
export interface M3PageProps {
  request: Request;
  params: Record<string, string>;
}

export interface ServeM3Options {
  /** SPA entry answering `/*`: an HTML import, or the path of an `.html` file. */
  index?: HTMLBundle | string;
  /** Extra routes; a string value is the path of an `.html` page. */
  routes?: Record<string, M3RouteValue | string>;
  /** Directory of React `.tsx`/`.jsx` pages. `index.tsx` maps to `/`, `[id].tsx` to `/:id`. */
  pagesDir?: string;
  /** Proxy prefixes: `"/rpc" -> "http://localhost:8080"`. */
  proxy?: Record<string, string>;
  /** Port (0 picks a free one). Default: `PORT`, then 3000. */
  port?: number;
  /** Interface to bind (default: Bun's). */
  hostname?: string;
  /** Hot module reloading and browser console streaming (default true). */
  hmr?: boolean;
  /** Inactivity timeout in seconds before closing idle connection (default 30). */
  idleTimeout?: number;
  /** Maximum request body size in bytes (default 128MB). */
  maxRequestBodySize?: number;
  /** Handler for requests no route matched (default: 404). */
  fetch?: (
    req: Request,
    server: Server<undefined>,
  ) => Response | Promise<Response>;
  /** Base directory for relative `.html` paths (default: working directory). */
  cwd?: string;
}

/** Forward a request to `target`, keeping the path below the origin, the query, method, headers and body. */
export function createProxy(
  target: string,
  label = "m3",
): (req: Request) => Promise<Response> {
  const upstream = new URL(target);
  if (upstream.protocol !== "http:" && upstream.protocol !== "https:") {
    throw new Error(`proxy target must use HTTP or HTTPS: ${target}`);
  }
  return async (req) => {
    const url = new URL(req.url);
    const base = upstream.pathname.replace(/\/$/, "");
    // Assign the path rather than resolving a URL: a path starting with // must
    // never select a different upstream host.
    const destination = new URL(upstream.href);
    destination.pathname = base + url.pathname;
    destination.search = url.search;
    destination.hash = "";
    const headers = new Headers(req.headers);
    for (const name of (headers.get("connection") ?? "").split(",")) {
      if (name.trim()) headers.delete(name.trim());
    }
    for (const name of [
      "connection",
      "keep-alive",
      "proxy-authenticate",
      "proxy-authorization",
      "te",
      "trailer",
      "transfer-encoding",
      "upgrade",
    ]) {
      headers.delete(name);
    }
    headers.delete("host");
    try {
      return await fetch(destination, {
        method: req.method,
        headers,
        body:
          req.method === "GET" || req.method === "HEAD"
            ? undefined
            : await req.arrayBuffer(),
        redirect: "manual",
        signal: req.signal,
      });
    } catch (error) {
      return new Response(
        `${label}: upstream unreachable at ${upstream.origin}: ${String(error)}`,
        { status: 502 },
      );
    }
  };
}

/** `Bun.serve` routes for the proxy prefixes: each prefix answers itself and `prefix/*`. */
export function proxyRoutes(
  proxy: Record<string, string>,
): Record<string, M3RouteValue> {
  const routes: Record<string, M3RouteValue> = {};
  for (const [prefix, target] of Object.entries(proxy)) {
    if (!prefix.startsWith("/"))
      throw new Error(`proxy prefix ${prefix} must start with "/"`);
    const handler = createProxy(target);
    const clean = prefix.replace(/\/+$/, "");
    routes[clean || "/"] = handler;
    routes[`${clean}/*`] = handler;
  }
  return routes;
}

async function importHtml(path: string, cwd: string): Promise<HTMLBundle> {
  const file = isAbsolute(path) ? path : resolve(cwd, path);
  if (!file.endsWith(".html"))
    throw new Error(`serveM3: ${path} is not an .html file`);
  const mod = (await import(pathToFileURL(file).href)) as {
    default: HTMLBundle;
  };
  return mod.default;
}

/** Port from the options, then `PORT`, then 3000. */
export function resolvePort(port?: number): number {
  if (port !== undefined) {
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new RangeError(`serveM3: invalid port ${port}`);
    return port;
  }
  const fromEnv = Number(Bun.env.PORT);
  return Bun.env.PORT !== undefined &&
    Bun.env.PORT.trim() !== "" &&
    Number.isInteger(fromEnv) &&
    fromEnv >= 0 &&
    fromEnv <= 65535
    ? fromEnv
    : 3000;
}

/** Discover React pages and render each request as a streamed HTML response. */
export async function fileRoutes(
  pagesDir: string,
): Promise<Record<string, M3RouteValue>> {
  if (!existsSync(pagesDir) || !statSync(pagesDir).isDirectory()) {
    throw new Error(`serveM3: pagesDir is not a directory: ${pagesDir}`);
  }
  const routes: Record<string, M3RouteValue> = {};
  const files: string[] = [];
  for await (const file of new Bun.Glob("**/*.{tsx,jsx}").scan({
    cwd: pagesDir,
  }))
    files.push(file);
  for (const file of files.toSorted()) {
    const segments = file
      .replaceAll("\\", "/")
      .replace(/\.(tsx|jsx)$/, "")
      .split("/");
    if (segments.at(-1) === "index") segments.pop();
    const parts = segments.map((segment) => {
      const param = /^\[([A-Za-z_][A-Za-z0-9_]*)\]$/.exec(segment);
      if (param) return `:${param[1]}`;
      if (!/^[A-Za-z0-9_-]+$/.test(segment))
        throw new Error(`serveM3: invalid page path: ${file}`);
      return segment;
    });
    const route = `/${parts.join("/")}`;
    if (routes[route])
      throw new Error(`serveM3: duplicate page route: ${route}`);
    const url = pathToFileURL(resolve(pagesDir, file)).href;
    routes[route] = async (request) => {
      const [{ default: Page }, { createElement }, { renderToReadableStream }] =
        await Promise.all([
          import(url) as Promise<{ default: ComponentType<M3PageProps> }>,
          import("react"),
          import("react-dom/server"),
        ]);
      if (!Page)
        throw new Error(
          `serveM3: page has no default React component: ${file}`,
        );
      const params =
        (request as Request & { params?: Record<string, string> }).params ?? {};
      const stream = await renderToReadableStream(
        createElement(Page, { request, params }),
      );
      return new Response(stream, {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    };
  }
  return routes;
}

/** Assemble proxy and explicit routes, React pages, then the `/*` SPA fallback. */
export async function buildRoutes(
  options: ServeM3Options,
): Promise<Record<string, M3RouteValue>> {
  const cwd = options.cwd ?? process.cwd();
  const routes: Record<string, M3RouteValue> = {
    ...proxyRoutes(options.proxy ?? {}),
  };
  const extra = await Promise.all(
    Object.entries(options.routes ?? {}).map(
      async ([path, value]) =>
        [
          path,
          typeof value === "string" ? await importHtml(value, cwd) : value,
        ] as const,
    ),
  );
  for (const [path, value] of extra) routes[path] = value;
  if (options.pagesDir) {
    const pagesDir = isAbsolute(options.pagesDir)
      ? options.pagesDir
      : resolve(cwd, options.pagesDir);
    for (const [path, value] of Object.entries(await fileRoutes(pagesDir))) {
      const covered = Object.keys(routes).some(
        (existing) =>
          existing === path ||
          (existing.endsWith("/*") && path.startsWith(existing.slice(0, -1))),
      );
      if (!covered) routes[path] = value;
    }
  }
  if (options.index !== undefined) {
    routes["/*"] =
      typeof options.index === "string"
        ? await importHtml(options.index, cwd)
        : options.index;
  }
  return routes;
}

/** Start the server. */
export async function serveM3(
  options: ServeM3Options = {},
): Promise<Server<undefined>> {
  const hmr = options.hmr ?? true;
  const routes = await buildRoutes(options);
  const fallback =
    options.fetch ?? (() => new Response("Not Found", { status: 404 }));
  return Bun.serve({
    port: resolvePort(options.port),
    ...(options.hostname ? { hostname: options.hostname } : {}),
    development: { hmr, console: hmr },
    idleTimeout: options.idleTimeout ?? 30,
    ...(options.maxRequestBodySize !== undefined
      ? { maxRequestBodySize: options.maxRequestBodySize }
      : {}),
    routes,
    fetch: fallback,
  });
}
