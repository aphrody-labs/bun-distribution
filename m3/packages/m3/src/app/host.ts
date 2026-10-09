// SPDX-License-Identifier: Apache-2.0
// Request handler and Bun.serve host of a built app: client assets under /_m3/, `public/` files,
// prerendered pages, then the rsc layer (middleware, routes, actions) and HTML through the ssr layer.
import { join, normalize, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { AppManifest } from "./build";
import type { HandleOptions, HandleResult } from "./runtime/rsc";
import { aliases, loaders, modules } from "./runtime/registry";
import { ACTION_HEADER, ASSET_PREFIX, RSC_CONTENT_TYPE, RSC_HEADER } from "./runtime/shared";

interface RscModule {
  handle(request: Request, options?: HandleOptions): Promise<HandleResult>;
  setStylesheets(urls: string[]): void;
  prerenderPaths(): Promise<string[]>;
}

interface SsrModule {
  renderHtml(
    rsc: ReadableStream<Uint8Array>,
    options: {
      bootstrap: string;
      bootstrapScriptContent?: string;
      formState?: unknown;
      nonce?: string;
      onError?: (error: unknown) => void;
    },
  ): Promise<ReadableStream<Uint8Array>>;
  setClientBundles(bundles: Record<string, string[]>): void;
}

export interface AppHandler {
  manifest: AppManifest;
  outDir: string;
  fetch(request: Request): Promise<Response>;
  /** Render one request without the HTTP layer details (used by prerendering). */
  render(
    request: Request,
    options?: HandleOptions,
  ): Promise<{ response: Response; dynamic: boolean; rsc?: Uint8Array }>;
  /** URL paths that can be prerendered. */
  prerenderPaths(): Promise<string[]>;
}

export interface LoadAppOptions {
  /** Inline script run before the browser runtime (development flags). */
  bootstrapScript?: string;
}

const g = globalThis as typeof globalThis & { __m3_client_bundles?: (id: string) => string[] };

function safeJoin(base: string, path: string): string | undefined {
  const target = normalize(join(base, path));
  return target.startsWith(base + sep) || target === base ? target : undefined;
}

const decodePath = (pathname: string) => {
  try {
    return decodeURIComponent(pathname);
  } catch {
    return undefined;
  }
};

/** Load a build from `outDir` (the result of `buildApp`). */
export async function loadApp(outDir: string, options: LoadAppOptions = {}): Promise<AppHandler> {
  const manifest = (await Bun.file(join(outDir, "manifest.json")).json()) as AppManifest;
  const clientDir = join(outDir, "client");
  // A new build replaces the previous one in this process (development rebuilds).
  modules.clear();
  loaders.clear();
  aliases.clear();
  g.__m3_client_bundles = id => manifest.clientModules[id] ?? [];
  const ssr = (await import(pathToFileURL(join(outDir, manifest.ssrEntry)).href)) as SsrModule;
  ssr.setClientBundles(manifest.clientModules);
  const rsc = (await import(pathToFileURL(join(outDir, manifest.rscEntry)).href)) as RscModule;
  rsc.setStylesheets(manifest.css.map(file => ASSET_PREFIX + file));
  const bootstrap = ASSET_PREFIX + manifest.bootstrap;
  const prerendered = new Map<string, { html: string; rsc: string }>();
  const prerenderIndex = Bun.file(join(outDir, "prerender", "index.json"));
  if (!manifest.middleware && (await prerenderIndex.exists()))
    for (const [path, files] of Object.entries(
      (await prerenderIndex.json()) as Record<string, { html: string; rsc: string }>,
    ))
      prerendered.set(path, files);

  const html = async (result: Extract<HandleResult, { kind: "rsc" }>, method: string): Promise<Response> => {
    const [watch, forHtml] = result.stream.tee();
    const finished = watch.pipeTo(new WritableStream()).catch(() => {});
    await Promise.race([result.store.shell.promise, finished]);
    const headers = new Headers(result.headers);
    if (result.store.redirect) {
      void forHtml.cancel();
      headers.set("location", result.store.redirect.url);
      return new Response(null, { status: result.store.redirect.status, headers });
    }
    headers.set("content-type", "text/html; charset=utf-8");
    let body: ReadableStream<Uint8Array>;
    try {
      body = await ssr.renderHtml(forHtml, {
        bootstrap,
        bootstrapScriptContent: options.bootstrapScript,
        formState: result.formState,
      });
    } catch (error) {
      // The shell failed (an error outside every Suspense boundary).
      console.error(error);
      const message = options.bootstrapScript && error instanceof Error ? (error.stack ?? error.message) : "";
      return new Response(`<!DOCTYPE html><title>500</title><h1>Internal Server Error</h1><pre>${Bun.escapeHTML(message)}</pre>`, {
        status: 500,
        headers,
      });
    }
    return new Response(method === "HEAD" ? null : body, { status: result.store.status ?? 200, headers });
  };

  const render: AppHandler["render"] = async (request, handleOptions) => {
    const result = await rsc.handle(request, handleOptions);
    if (result.kind === "response") return { response: result.response, dynamic: true };
    const [forRsc, forHtml] = result.stream.tee();
    const rscBytes = new Uint8Array(await new Response(forRsc).arrayBuffer());
    const response = await html({ ...result, stream: forHtml }, request.method);
    return { response, dynamic: result.store.dynamic, rsc: rscBytes };
  };

  const fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    const pathname = decodePath(url.pathname);
    if (pathname === undefined) return new Response("Bad Request", { status: 400 });

    if (pathname.startsWith(ASSET_PREFIX)) {
      const path = safeJoin(clientDir, pathname.slice(ASSET_PREFIX.length));
      const file = path && Bun.file(path);
      if (file && (await file.exists()))
        return new Response(file, { headers: { "cache-control": "public, max-age=31536000, immutable" } });
      return new Response("Not Found", { status: 404 });
    }
    const staticPath = manifest.static[pathname];
    if (staticPath && (request.method === "GET" || request.method === "HEAD"))
      return new Response(Bun.file(join(outDir, staticPath)));

    const isRsc = request.headers.get(RSC_HEADER) === "1" || request.headers.has(ACTION_HEADER);
    const page = request.method === "GET" || request.method === "HEAD" ? prerendered.get(pathname) : undefined;
    if (page) {
      const file = Bun.file(join(outDir, "prerender", isRsc ? page.rsc : page.html));
      return new Response(request.method === "HEAD" ? null : file, {
        headers: { "content-type": isRsc ? RSC_CONTENT_TYPE : "text/html; charset=utf-8", vary: RSC_HEADER },
      });
    }

    const result = await rsc.handle(request);
    if (result.kind === "response") {
      if (request.method === "HEAD") return new Response(null, result.response);
      return result.response;
    }
    if (isRsc) {
      const headers = new Headers(result.headers);
      headers.set("content-type", RSC_CONTENT_TYPE);
      headers.set("vary", RSC_HEADER);
      return new Response(result.stream, { status: result.store.status ?? 200, headers });
    }
    return html(result, request.method);
  };

  return { manifest, outDir, fetch, render, prerenderPaths: () => rsc.prerenderPaths() };
}

export interface ServeAppOptions extends LoadAppOptions {
  outDir: string;
  port?: number;
  hostname?: string;
}

/** Serve a build with Bun.serve. */
export async function serveApp(options: ServeAppOptions): Promise<Bun.Server<undefined>> {
  const app = await loadApp(options.outDir, options);
  return Bun.serve({
    port: options.port ?? Number(process.env.PORT ?? 3000),
    hostname: options.hostname ?? process.env.HOSTNAME,
    fetch: request => app.fetch(request),
    error(error) {
      console.error(error);
      return new Response("Internal Server Error", { status: 500 });
    },
  });
}
