// SPDX-License-Identifier: Apache-2.0
// The one Bun file server of an M3 app: the UI files and the API are served by the same process, from the
// same `Bun.serve`. `createM3App` is the pure part (a `fetch` handler, testable without a socket);
// `startM3Server` binds it. The UI comes from a build directory, from files embedded in a compiled
// executable, or (development) from an HTML import that Bun bundles with HMR.
//
//   const server = startM3Server({ files: dirSource("dist"), api, port: 3000 });
import type { HTMLBundle, Server } from "bun";
import { Glob } from "bun";
import { statSync } from "node:fs";
import { extname, join } from "node:path";
import { brotliCompressSync, constants as zlib } from "node:zlib";
import {
  normalizeApi,
  requestCookies,
  routesToFetch,
  type M3ApiModule,
  type M3Routes,
} from "./api.ts";
import { crawlRoutes, type M3CrawlOptions } from "./server-crawl.ts";
import {
  createNonce,
  cspWithNonce,
  injectHtml,
  resolveTheme,
  type M3ResolvedTheme,
  type M3ThemeOptions,
} from "./server-html.ts";
import { renderMarkdown, type M3MarkdownOptions } from "./server-markdown.ts";
import {
  realtimeHandlers,
  type M3RealtimeOptions,
  type M3SocketData,
} from "./server-realtime.ts";

/** A set of files addressed by URL path (`/index.html`). */
export interface FileSource {
  has(path: string): boolean;
  file(path: string): Bun.BunFile;
  /** Weak validator for `path`. */
  etag(path: string): string;
  paths(): string[];
}

/** Files of a build directory, listed once at start. Only listed files are ever served. */
export function dirSource(dir: string): FileSource {
  const entries = new Map<string, { file: Bun.BunFile; etag: string }>();
  for (const rel of new Glob("**/*").scanSync({ cwd: dir, onlyFiles: true })) {
    if (rel.endsWith(".map")) continue;
    const abs = join(dir, rel);
    const stat = statSync(abs);
    entries.set(`/${rel.replaceAll("\\", "/")}`, {
      file: Bun.file(abs),
      etag: `W/"${stat.size.toString(16)}-${Math.trunc(stat.mtimeMs).toString(16)}"`,
    });
  }
  return sourceOf(entries);
}

/** Files embedded in a compiled executable: URL path -> the path `import x from "..." with { type: "file" }` returned. */
export function embeddedSource(
  files: Readonly<Record<string, string>>,
  buildId = "0",
): FileSource {
  const entries = new Map<string, { file: Bun.BunFile; etag: string }>();
  for (const [path, embedded] of Object.entries(files)) {
    const file = Bun.file(embedded);
    entries.set(path, {
      file,
      etag: `W/"${file.size.toString(16)}-${buildId}"`,
    });
  }
  return sourceOf(entries);
}

function sourceOf(
  entries: Map<string, { file: Bun.BunFile; etag: string }>,
): FileSource {
  return {
    has: (path) => entries.has(path),
    file: (path) => entries.get(path)!.file,
    etag: (path) => entries.get(path)!.etag,
    paths: () => [...entries.keys()].toSorted(),
  };
}

export interface M3AppOptions {
  name?: string;
  version?: string;
  /** Identifies this build in ETags of embedded files. */
  buildId?: string;
  /** The UI files. Without them only the API and the health routes answer. */
  files?: FileSource;
  /** The API: Bun routes, or `{ routes, fetch }`. */
  api?: M3ApiModule;
  /** Content-Security-Policy value, or `false` to omit it. The default allows only the app's own origin. */
  csp?: string | false;
  /** Answer unknown extension-less GET requests that accept HTML with `index.html` (default true). */
  spa?: boolean;
  /** Health route (default `/healthz`), or `false`. */
  health?: string | false;
  /** Extra fields of the `/api/m3/info` document. */
  info?: Record<string, unknown>;
  /** A fresh CSP nonce per HTML response, set on its `<script>` elements and allowed in `script-src`. */
  nonce?: boolean;
  /** The request's M3 theme (cookie, class, `color-scheme`, `theme-color`) written into served HTML (`@aphrody/m3-next`). */
  theme?: boolean | M3ThemeOptions;
  /** Serve `.md` files as HTML pages to browsers (`Bun.markdown`), raw to other clients; `/a` finds `/a.md`. */
  markdown?: boolean | M3MarkdownOptions;
  /** `/sitemap.xml`, `/robots.txt` and `/llms.txt` from the served files (`@aphrody/m3-next`). */
  crawl?: M3CrawlOptions;
}

export const DEFAULT_CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'self'";

const COMPRESSIBLE =
  /^(?:text\/|application\/(?:javascript|json|xml|manifest\+json|wasm)|image\/svg\+xml)/;
const HASHED = /[-.][a-z0-9]{8}\.[a-z0-9]+$/i;

const securityHeaders = (csp: string | false): Record<string, string> => ({
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  ...(csp ? { "Content-Security-Policy": csp } : {}),
});

/** `no-cache` for HTML, immutable for content-hashed names, an hour for the rest. */
export function cacheControl(path: string, type: string): string {
  if (type.startsWith("text/html")) return "no-cache";
  return HASHED.test(path)
    ? "public, max-age=31536000, immutable"
    : "public, max-age=3600";
}

/** Best encoding the client accepts for a compressible response. */
export function pickEncoding(
  acceptEncoding: string | null,
): "br" | "gzip" | undefined {
  const qualities = new Map<string, number>();
  for (const part of (acceptEncoding ?? "").toLowerCase().split(",")) {
    const [encoding, ...parameters] = part.trim().split(";");
    if (!encoding) continue;
    const quality = parameters.find((parameter) =>
      parameter.trim().startsWith("q="),
    );
    const value = quality === undefined ? 1 : Number(quality.trim().slice(2));
    qualities.set(
      encoding,
      Number.isFinite(value) && value >= 0 && value <= 1 ? value : 0,
    );
  }
  const br = qualities.get("br") ?? qualities.get("*") ?? 0;
  const gzip = qualities.get("gzip") ?? qualities.get("*") ?? 0;
  return br > 0 && br >= gzip ? "br" : gzip > 0 ? "gzip" : undefined;
}

export interface M3App {
  fetch(request: Request): Promise<Response>;
  /** The API routes, for `Bun.serve({ routes })`. */
  routes: M3Routes;
}

/** The app as a pure `fetch` handler: API, health, info, static files, SPA fallback. */
export function createM3App(options: M3AppOptions = {}): M3App {
  const {
    name = "m3-app",
    version = "0.0.0",
    buildId = "0",
    files,
    spa = true,
    health = "/healthz",
  } = options;
  const csp = options.csp === undefined ? DEFAULT_CSP : options.csp;
  const base = securityHeaders(csp);
  const api = normalizeApi(options.api);
  const apiFetch = routesToFetch(api.routes);
  const started = Date.now();
  const cache = new Map<string, Uint8Array>();
  const theme = options.theme === true ? {} : options.theme || undefined;
  const markdown =
    options.markdown === true ? {} : options.markdown || undefined;
  const dynamicHtml = Boolean(options.nonce || theme);
  const crawl =
    options.crawl && files
      ? routesToFetch(crawlRoutes(files.paths(), { name, ...options.crawl }))
      : undefined;

  /** An HTML response written for this request: its own CSP nonce and its theme. */
  async function page(
    body: BodyInit,
    request: Request,
    status = 200,
  ): Promise<Response> {
    const nonce = options.nonce ? createNonce() : undefined;
    let resolved: M3ResolvedTheme | undefined;
    if (theme) resolved = await resolveTheme(requestCookies(request), theme);
    const headers = new Headers({
      ...securityHeaders(csp && nonce ? cspWithNonce(csp, nonce) : csp),
      "Content-Type": "text/html;charset=utf-8",
      "Cache-Control": "no-cache",
      ...(resolved ? { Vary: "Cookie" } : {}),
    });
    if (resolved?.setCookie) headers.append("Set-Cookie", resolved.setCookie);
    if (request.method === "HEAD")
      return new Response(null, { status, headers });
    const response = new Response(body, { status, headers });
    return dynamicHtml
      ? injectHtml(response, {
          ...(nonce ? { nonce } : {}),
          ...(resolved ? { theme: resolved } : {}),
        })
      : response;
  }

  const json = (body: unknown, status = 200): Response =>
    Response.json(body, {
      status,
      headers: { ...base, "Cache-Control": "no-store" },
    });

  async function serveFile(
    path: string,
    request: Request,
    status = 200,
  ): Promise<Response> {
    const source = files!;
    const file = source.file(path);
    const type = file.type || "application/octet-stream";
    if (dynamicHtml && type.startsWith("text/html"))
      return page(file, request, status);
    const etag = source.etag(path);
    const headers: Record<string, string> = {
      ...base,
      "Content-Type": type,
      ETag: etag,
      "Cache-Control": cacheControl(path, type),
      Vary: "Accept-Encoding",
    };
    if (status === 200 && request.headers.get("if-none-match") === etag)
      return new Response(null, { status: 304, headers });
    const encoding =
      COMPRESSIBLE.test(type) && file.size >= 1024
        ? pickEncoding(request.headers.get("accept-encoding"))
        : undefined;
    if (encoding) {
      const key = `${path}|${encoding}|${etag}`;
      let bytes = cache.get(key);
      if (!bytes) {
        const raw = new Uint8Array(await file.arrayBuffer());
        bytes =
          encoding === "br"
            ? brotliCompressSync(raw, {
                params: { [zlib.BROTLI_PARAM_QUALITY]: 5 },
              })
            : Bun.gzipSync(raw);
        cache.set(key, bytes);
      }
      headers["Content-Encoding"] = encoding;
      headers["Content-Length"] = String(bytes.length);
      return new Response(
        request.method === "HEAD" ? null : (bytes as unknown as BodyInit),
        {
          status,
          headers,
        },
      );
    }
    headers["Content-Length"] = String(file.size);
    return new Response(request.method === "HEAD" ? null : file, {
      status,
      headers,
    });
  }

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let pathname: string;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      return new Response("Bad Request", { status: 400, headers: base });
    }
    if (pathname.includes("\0") || pathname.split("/").includes(".."))
      return new Response("Bad Request", { status: 400, headers: base });

    if (health && pathname === health)
      return json({
        ok: true,
        name,
        version,
        uptimeSeconds: Math.round((Date.now() - started) / 1000),
      });
    if (pathname === "/api/m3/info") {
      return json({
        name,
        version,
        buildId,
        bun: Bun.version,
        files: files?.paths().length ?? 0,
        api: Object.keys(api.routes),
        ...options.info,
      });
    }

    const fromApi = await apiFetch(request);
    if (fromApi) return fromApi;
    if (api.fetch) {
      const fallback = await api.fetch(request);
      if (fallback) return fallback;
    }

    const readOnly = request.method === "GET" || request.method === "HEAD";
    if (!files || !readOnly)
      return new Response("Not Found", { status: 404, headers: base });
    if (crawl) {
      const crawled = await crawl(request);
      if (crawled) return crawled;
    }
    const path = pathname.endsWith("/") ? `${pathname}index.html` : pathname;
    const wantsHtml = (request.headers.get("accept") ?? "").includes(
      "text/html",
    );
    if (markdown) {
      const doc = path.endsWith(".md") ? path : `${path}.md`;
      if (files.has(doc) && (wantsHtml || doc !== path))
        return page(
          renderMarkdown(await files.file(doc).text(), markdown).html,
          request,
        );
    }
    if (files.has(path)) return serveFile(path, request);
    if (files.has(`${path}/index.html`))
      return serveFile(`${path}/index.html`, request);
    if (spa && wantsHtml && extname(path) === "" && files.has("/index.html"))
      return serveFile("/index.html", request);
    return new Response("Not Found", { status: 404, headers: base });
  }

  return { fetch: handle, routes: api.routes };
}

export interface M3ServerOptions extends M3AppOptions {
  port?: number;
  hostname?: string;
  /** Development: Bun bundles this HTML import on the fly with hot module reloading (plugins from `bunfig.toml`). */
  index?: HTMLBundle;
  hmr?: boolean;
  /** Seconds before an idle connection is closed (default 30). */
  idleTimeout?: number;
  /** Extra native routes, ahead of the API: HTML imports (bundled by Bun), `m3ServerRoutes` of `@aphrody/m3/server`. */
  routes?: Bun.Serve.Routes<M3SocketData, string>;
  /** WebSocket topics at `/api/m3/ws` (`server.publish`); see `server-realtime.ts`. */
  realtime?: boolean | M3RealtimeOptions;
}

/** `PORT`, then the option, then 3000. */
export function resolvePort(option?: number): number {
  const fromEnv = Number(Bun.env.PORT);
  if (
    Bun.env.PORT !== undefined &&
    Bun.env.PORT.trim() !== "" &&
    Number.isInteger(fromEnv) &&
    fromEnv >= 0 &&
    fromEnv <= 65535
  )
    return fromEnv;
  if (
    option !== undefined &&
    (!Number.isInteger(option) || option < 0 || option > 65535)
  )
    throw new RangeError(`m3-bun: invalid port ${option}`);
  return option ?? 3000;
}

/** Bind the app: API routes natively, the rest (files, health, info) through `createM3App().fetch`. */
export function startM3Server(
  options: M3ServerOptions = {},
): Server<M3SocketData> {
  const app = createM3App(options);
  const port = resolvePort(options.port);
  const realtime = options.realtime
    ? realtimeHandlers(options.realtime === true ? {} : options.realtime)
    : undefined;
  const common = {
    port,
    ...(options.hostname ? { hostname: options.hostname } : {}),
    idleTimeout: options.idleTimeout ?? 30,
    ...(realtime ? { websocket: realtime.websocket } : {}),
  };
  const routes: Bun.Serve.Routes<M3SocketData, string> = {
    ...options.routes,
    ...(app.routes as unknown as Bun.Serve.Routes<M3SocketData, string>),
    ...(realtime
      ? {
          [realtime.path]: async (
            request: Request,
            server: Server<M3SocketData>,
          ) => (await realtime.upgrade(request, server)) as Response,
        }
      : {}),
  };
  const fetch = (request: Request): Promise<Response> => app.fetch(request);
  if (options.index) {
    const hmr = options.hmr ?? true;
    const health =
      options.health === false ? undefined : (options.health ?? "/healthz");
    return Bun.serve<M3SocketData>({
      ...common,
      development: { hmr, console: hmr },
      routes: {
        ...routes,
        ...(health ? { [health]: fetch } : {}),
        "/api/m3/info": fetch,
        "/*": options.index,
      },
      fetch,
    });
  }
  // Serving a build: an uncaught handler error is logged and answers a plain 500, never the development page with
  // the sources.
  const csp = options.csp === undefined ? DEFAULT_CSP : options.csp;
  const error = (cause: Error): Response => {
    console.error(cause);
    return new Response("Internal Server Error", {
      status: 500,
      headers: securityHeaders(csp),
    });
  };
  return Bun.serve<M3SocketData>({
    ...common,
    development: false,
    routes,
    fetch,
    error,
  });
}
