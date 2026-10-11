// SPDX-License-Identifier: Apache-2.0
// Server runtime of the rsc layer (bundled with the `react-server` condition): middleware, metadata
// routes, route handlers, server actions and the React Server Components render of pages.
import { Fragment, Suspense, type ComponentType, type ReactNode } from "react";
import {
  createTemporaryReferenceSet,
  decodeAction,
  decodeFormState,
  decodeReply,
  loadServerAction,
  registerServerActions,
  renderToReadableStream,
} from "react-server-dom-parcel/server.node";
import { ErrorBoundary, NotFoundBoundary, type ErrorProps } from "../boundaries";
import type { AppRoute, MetadataRoute, Params, Segment } from "../scan";
import { fillPattern, findRoute } from "../scan";
import {
  MIDDLEWARE_NEXT,
  MIDDLEWARE_REQUEST_HEADER,
  MIDDLEWARE_REWRITE,
  NextRequest,
} from "../server";
import { matcherToRegExp } from "./matcher";
import { renderMetadata, resolveMetadata } from "./metadata";
import { installParcelRequire, loaders, modules } from "./registry";
import { ACTION_HEADER, isNotFoundError, redirectInfo, type RscPayload } from "./shared";
import { createStore, DynamicUsageError, requestStorage, type RequestStore } from "./store";

type Namespace = Record<string, unknown>;

/** What the generated rsc entry hands to the runtime. */
export interface AppDefinition {
  buildId: string;
  routes: AppRoute[];
  metadata: MetadataRoute[];
  rootSegment: Segment;
  middleware?: string;
  /** Lazy loaders of every route, segment, metadata and middleware module, by module id. */
  loaders: Record<string, () => Promise<Namespace>>;
  /** Ids of the `"use server"` modules. */
  actions: string[];
}

let app: AppDefinition | undefined;
/** Public URLs of the stylesheets linked on every page. */
let stylesheets: string[] = [];

export function setApp(definition: AppDefinition): void {
  app = definition;
  installParcelRequire("/_m3/");
  for (const id of definition.actions)
    loaders.set(id, async () => {
      const ns = (await definition.loaders[id]!()) as Record<string, unknown>;
      modules.set(id, ns);
      return ns;
    });
  // Each action module is its own bundle (its id) loaded on demand by `loadServerAction`.
  registerServerActions(Object.fromEntries(definition.actions.map((id) => [id, [id]])));
}

/** Stylesheets linked by every page (set by the host from the client manifest). */
export function setStylesheets(urls: string[]): void {
  stylesheets = urls;
}

const definition = (): AppDefinition => {
  if (!app) throw new Error("@aphrody/m3: the rsc bundle was loaded without its app definition");
  return app;
};

async function load(id: string): Promise<Namespace> {
  const cached = modules.get(id);
  if (cached) return cached;
  const loader = definition().loaders[id];
  if (!loader) throw new Error(`@aphrody/m3: no module ${id}`);
  const ns = await loader();
  modules.set(id, ns);
  return ns;
}

export interface HandleOptions {
  /** Build-time render: dynamic APIs throw and mark the route dynamic. */
  prerender?: boolean;
  /** Skip the middleware (already run, or prerendering). */
  skipMiddleware?: boolean;
}

export type HandleResult =
  | { kind: "response"; response: Response }
  | {
      kind: "rsc";
      stream: ReadableStream<Uint8Array>;
      store: RequestStore;
      /** Headers to add to the HTML or RSC response. */
      headers: Headers;
      formState?: unknown;
      /** The route can be prerendered (no dynamic API used). */
      route?: AppRoute;
    };

function searchParamsObject(search: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const [key, value] of search) {
    const prev = out[key];
    out[key] = prev === undefined ? value : Array.isArray(prev) ? [...prev, value] : [prev, value];
  }
  return out;
}

function withStoreHeaders(response: Response, store: RequestStore): Response {
  const cookies = store.cookies.toSetCookieHeaders();
  if (!cookies.length && ![...store.responseHeaders].length) return response;
  const out = new Response(response.body, response);
  for (const [key, value] of store.responseHeaders) out.headers.set(key, value);
  for (const cookie of cookies) out.headers.append("set-cookie", cookie);
  return out;
}

function middlewareMatches(config: unknown, pathname: string): boolean {
  const matcher = (config as { matcher?: string | string[] } | undefined)?.matcher;
  if (!matcher) return !pathname.startsWith("/_m3/");
  return (Array.isArray(matcher) ? matcher : [matcher]).some((m) =>
    matcherToRegExp(m).test(pathname),
  );
}

async function runMiddleware(
  request: Request,
  store: RequestStore,
): Promise<{ response?: Response; rewrite?: URL; request: Request }> {
  const mod = await load(definition().middleware!);
  if (!middlewareMatches(mod.config, store.url.pathname)) return { request };
  const fn = (mod.default ?? mod.middleware ?? mod.proxy) as
    | ((req: NextRequest, event: unknown) => Response | undefined | Promise<Response | undefined>)
    | undefined;
  if (typeof fn !== "function")
    throw new Error("@aphrody/m3: middleware must export a default function");
  const result = await fn(new NextRequest(request), {
    waitUntil: (p: Promise<unknown>) => void p.catch(console.error),
  });
  if (!result) return { request };
  const rewrite = result.headers.get(MIDDLEWARE_REWRITE);
  const next = result.headers.get(MIDDLEWARE_NEXT);
  if (!rewrite && !next) return { response: result, request };
  let headers: Headers | undefined;
  for (const [key, value] of result.headers) {
    if (key === MIDDLEWARE_REWRITE || key === MIDDLEWARE_NEXT) continue;
    if (key.startsWith(MIDDLEWARE_REQUEST_HEADER)) {
      headers ??= new Headers(request.headers);
      headers.set(key.slice(MIDDLEWARE_REQUEST_HEADER.length), value);
    } else if (key === "set-cookie") store.responseHeaders.append(key, value);
    else store.responseHeaders.set(key, value);
  }
  const target = rewrite ? new URL(rewrite, request.url) : undefined;
  const nextRequest =
    headers || target
      ? new Request(target ?? request.url, {
          method: request.method,
          headers: headers ?? request.headers,
          body: request.body,
        })
      : request;
  return { rewrite: target, request: nextRequest };
}

function robotsTxt(value: Record<string, unknown>): string {
  const lines: string[] = [];
  for (const rule of [value.rules ?? []].flat() as Record<string, unknown>[]) {
    for (const agent of [rule.userAgent ?? "*"].flat()) lines.push(`User-Agent: ${agent}`);
    for (const allow of [rule.allow ?? []].flat()) lines.push(`Allow: ${allow}`);
    for (const disallow of [rule.disallow ?? []].flat()) lines.push(`Disallow: ${disallow}`);
    if (rule.crawlDelay !== undefined) lines.push(`Crawl-delay: ${rule.crawlDelay}`);
    lines.push("");
  }
  if (value.host) lines.push(`Host: ${value.host}`);
  for (const sitemap of [value.sitemap ?? []].flat()) lines.push(`Sitemap: ${sitemap}`);
  return `${lines.join("\n").trim()}\n`;
}

const xmlEscape = (s: string) => s.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);

function sitemapXml(entries: Record<string, unknown>[]): string {
  const urls = entries.map((entry) => {
    const parts = [`<loc>${xmlEscape(String(entry.url))}</loc>`];
    if (entry.lastModified)
      parts.push(
        `<lastmod>${new Date(entry.lastModified as string | Date).toISOString()}</lastmod>`,
      );
    if (entry.changeFrequency) parts.push(`<changefreq>${entry.changeFrequency}</changefreq>`);
    if (entry.priority !== undefined) parts.push(`<priority>${entry.priority}</priority>`);
    return `<url>\n${parts.join("\n")}\n</url>`;
  });
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`;
}

async function metadataRoute(route: MetadataRoute): Promise<Response> {
  const mod = await load(route.file);
  const value = await (mod.default as () => unknown)();
  if (route.kind === "robots")
    return new Response(robotsTxt(value as Record<string, unknown>), {
      headers: { "content-type": "text/plain" },
    });
  if (route.kind === "sitemap")
    return new Response(sitemapXml(value as Record<string, unknown>[]), {
      headers: { "content-type": "application/xml" },
    });
  return Response.json(value, { headers: { "content-type": "application/manifest+json" } });
}

const METHODS = ["GET", "HEAD", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"];

async function routeHandler(
  request: Request,
  route: AppRoute,
  params: Params,
  store: RequestStore,
): Promise<Response> {
  const mod = await load(route.file);
  const method = request.method.toUpperCase();
  const fn = (mod[method] ?? (method === "HEAD" ? mod.GET : undefined)) as
    | ((req: Request, ctx: { params: Promise<Params> }) => Response | Promise<Response>)
    | undefined;
  const allow = METHODS.filter(
    (m) => typeof mod[m] === "function" || (m === "HEAD" && typeof mod.GET === "function"),
  );
  if (!fn) {
    if (method === "OPTIONS")
      return new Response(null, {
        status: 204,
        headers: { allow: [...allow, "OPTIONS"].join(", ") },
      });
    return new Response(null, { status: 405, headers: { allow: allow.join(", ") } });
  }
  store.dynamic = true;
  const response = await fn(new NextRequest(request), { params: Promise.resolve(params) });
  const extra = (response as { setCookieHeaders?: () => string[] }).setCookieHeaders?.() ?? [];
  for (const cookie of extra) store.responseHeaders.append("set-cookie", cookie);
  return withStoreHeaders(response, store);
}

function DefaultNotFound(): ReactNode {
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", textAlign: "center", marginTop: "20vh" }}>
      <h1>404</h1>
      <p>This page could not be found.</p>
    </main>
  );
}

interface LoadedSegment {
  segment: Segment;
  layout?: Namespace;
  template?: Namespace;
  loading?: Namespace;
  error?: Namespace;
  notFound?: Namespace;
}

async function loadSegment(segment: Segment): Promise<LoadedSegment> {
  const out: LoadedSegment = { segment };
  const { files } = segment;
  await Promise.all([
    files.layout && load(files.layout).then((m) => (out.layout = m)),
    files.template && load(files.template).then((m) => (out.template = m)),
    files.loading && load(files.loading).then((m) => (out.loading = m)),
    files.error && load(files.error).then((m) => (out.error = m)),
    files["not-found"] && load(files["not-found"]).then((m) => (out.notFound = m)),
  ]);
  return out;
}

type AnyComponent = ComponentType<Record<string, unknown>>;
const isServerFunction = (value: unknown): value is (props: Record<string, unknown>) => unknown =>
  typeof value === "function" && !(value as { $$typeof?: unknown }).$$typeof;

/**
 * Renders a layout or page, turning `notFound()` into the nearest not-found UI with a 404 status and
 * recording `redirect()` for the response; `gate` settles the shell once the page has run.
 */
async function Run({
  component,
  props,
  fallback,
  gate,
}: {
  component: unknown;
  props: Record<string, unknown>;
  fallback: ReactNode;
  gate: boolean;
}): Promise<ReactNode> {
  const store = requestStorage.getStore();
  try {
    const result = isServerFunction(component)
      ? await component(props)
      : (() => {
          const C = component as AnyComponent;
          return <C {...props} />;
        })();
    if (gate) store?.shell.resolve();
    return result as ReactNode;
  } catch (error) {
    if (isNotFoundError(error)) {
      if (store) store.status = 404;
      store?.shell.resolve();
      return fallback;
    }
    const redirect = redirectInfo(error);
    if (redirect && store) store.redirect = { url: redirect.url, status: redirect.status };
    store?.shell.resolve();
    throw error;
  }
}

function notFoundElement(segments: readonly LoadedSegment[], upTo: number): ReactNode {
  for (let i = upTo; i >= 0; i--) {
    const C = segments[i]?.notFound?.default as AnyComponent | undefined;
    if (C) return <C />;
  }
  return <DefaultNotFound />;
}

function buildTree(
  segments: readonly LoadedSegment[],
  leaf: (fallback: ReactNode) => ReactNode,
  params: Params,
  pathname: string,
  head: ReactNode,
): ReactNode {
  const paramsPromise = Promise.resolve(params);
  let node: ReactNode = (
    <Fragment>
      {head}
      {leaf(notFoundElement(segments, segments.length - 1))}
    </Fragment>
  );
  for (let i = segments.length - 1; i >= 0; i--) {
    const s = segments[i]!;
    if (s.notFound?.default)
      node = <NotFoundBoundary fallback={notFoundElement(segments, i)}>{node}</NotFoundBoundary>;
    if (s.loading?.default) {
      const Loading = s.loading.default as AnyComponent;
      node = <Suspense fallback={<Loading />}>{node}</Suspense>;
    }
    if (s.error?.default)
      node = (
        <ErrorBoundary fallback={s.error.default as ComponentType<ErrorProps>}>
          {node}
        </ErrorBoundary>
      );
    if (s.template?.default) {
      const Template = s.template.default as AnyComponent;
      node = <Template key={pathname}>{node}</Template>;
    }
    if (s.layout?.default)
      node = (
        <Run
          component={s.layout.default}
          props={{ params: paramsPromise, children: node }}
          fallback={notFoundElement(segments, i - 1)}
          gate={false}
        />
      );
  }
  return node;
}

function stylesheetLinks(): ReactNode {
  return stylesheets.map((href) => (
    <link key={href} rel="stylesheet" href={href} precedence="m3" />
  ));
}

async function renderRoute(
  store: RequestStore,
  url: URL,
  match: { route: AppRoute; params: Params } | undefined,
  extra: Partial<RscPayload>,
  temporaryReferences?: unknown,
): Promise<ReadableStream<Uint8Array>> {
  const def = definition();
  const searchParams = searchParamsObject(url.searchParams);
  let root: ReactNode;
  if (!match) {
    store.status = 404;
    const segment = await loadSegment(def.rootSegment);
    const meta = await resolveMetadata(segment.layout ? [segment.layout] : [], {
      params: Promise.resolve({}),
    });
    root = buildTree(
      [{ segment: segment.segment, layout: segment.layout }],
      () => notFoundElement([segment], 0),
      {},
      url.pathname,
      [...renderMetadata(meta), stylesheetLinks()],
    );
    store.shell.resolve();
  } else {
    const { route, params } = match;
    const props = {
      params: Promise.resolve(params),
      searchParams: searchParamsPromise(store, searchParams),
    };
    const [segments, page] = await Promise.all([
      Promise.all(route.segments.map(loadSegment)),
      load(route.file),
    ]);
    if (page.dynamic === "force-dynamic") store.dynamic = true;
    let head: ReactNode[];
    try {
      const meta = await resolveMetadata(
        [...segments.flatMap((s) => (s.layout ? [s.layout] : [])), page],
        props,
      );
      head = [...renderMetadata(meta), stylesheetLinks()];
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
      store.status = 404;
      head = [stylesheetLinks()];
      root = buildTree(segments, (fallback) => fallback, params, url.pathname, head);
      store.shell.resolve();
      return renderToReadableStream(payload(root, url, params, extra), {
        onError,
        temporaryReferences: temporaryReferences as never,
      });
    }
    // Under a loading boundary the page streams: the response starts before it renders.
    if (segments.some((s) => s.loading?.default)) store.shell.resolve();
    root = buildTree(
      segments,
      (fallback) => <Run component={page.default} props={props} fallback={fallback} gate />,
      params,
      url.pathname,
      head,
    );
  }
  return renderToReadableStream(payload(root, url, match?.params ?? {}, extra), {
    onError,
    temporaryReferences: temporaryReferences as never,
  });
}

/** `searchParams` prop: reading it while prerendering makes the page dynamic. */
function searchParamsPromise(
  store: RequestStore,
  value: Record<string, string | string[]>,
): Promise<Record<string, string | string[]>> {
  if (!store.prerender) return Promise.resolve(value);
  let promise: Promise<Record<string, string | string[]>> | undefined;
  const settle = () => {
    store.dynamic = true;
    return (promise ??= Promise.reject(new DynamicUsageError("searchParams")));
  };
  // A lazy promise: only awaiting `searchParams` marks the page dynamic.
  return {
    // oxlint-disable-next-line unicorn/no-thenable
    then: (ok, fail) => settle().then(ok, fail),
    catch: (fail) => settle().catch(fail),
    finally: (done) => settle().finally(done),
    [Symbol.toStringTag]: "Promise",
  } as Promise<Record<string, string | string[]>>;
}

function payload(
  root: ReactNode,
  url: URL,
  params: Params,
  extra: Partial<RscPayload>,
): RscPayload {
  return {
    root,
    pathname: url.pathname,
    search: url.search,
    params,
    buildId: definition().buildId,
    ...extra,
  };
}

function onError(error: unknown): string | undefined {
  const digest = (error as { digest?: unknown } | null)?.digest;
  if (typeof digest === "string") return digest;
  if (!(error instanceof DynamicUsageError)) console.error(error);
  return undefined;
}

/** Handle one request in the rsc layer. */
export async function handle(request: Request, options: HandleOptions = {}): Promise<HandleResult> {
  const def = definition();
  const store = createStore(request, options.prerender);
  return requestStorage.run(store, async (): Promise<HandleResult> => {
    let url = store.url;
    if (def.middleware && !options.skipMiddleware && !options.prerender) {
      const result = await runMiddleware(request, store);
      if (result.response)
        return { kind: "response", response: withStoreHeaders(result.response, store) };
      if (result.rewrite) url = result.rewrite;
      request = result.request;
      store.request = request;
    }
    const metadataRoute_ = def.metadata.find(
      (m) => m.kind !== "static" && m.pathname === url.pathname,
    );
    if (metadataRoute_) return { kind: "response", response: await metadataRoute(metadataRoute_) };

    if (url.pathname.length > 1 && url.pathname.endsWith("/")) {
      const target = new URL(url);
      target.pathname = url.pathname.replace(/\/+$/, "");
      return {
        kind: "response",
        response: new Response(null, {
          status: 308,
          headers: { location: target.pathname + target.search },
        }),
      };
    }

    const match = findRoute(def.routes, url.pathname);
    if (match?.route.kind === "route")
      return {
        kind: "response",
        response: await routeHandler(request, match.route, match.params, store),
      };
    const pageMatch = match?.route.kind === "page" ? match : undefined;

    const extra: Partial<RscPayload> = {};
    let temporaryReferences: unknown;
    if (request.method === "POST") {
      const actionId = request.headers.get(ACTION_HEADER);
      const contentType = request.headers.get("content-type") ?? "";
      if (actionId) {
        store.dynamic = true;
        temporaryReferences = createTemporaryReferenceSet();
        const body = contentType.startsWith("multipart/form-data")
          ? await request.formData()
          : await request.text();
        const args = (await decodeReply(body, { temporaryReferences } as never)) as unknown[];
        const action = (await loadServerAction(actionId)) as (...a: unknown[]) => unknown;
        try {
          extra.returnValue = { ok: true, data: await action(...args) };
        } catch (error) {
          const redirect = redirectInfo(error);
          if (!redirect) extra.returnValue = { ok: false, data: error };
          else extra.redirect = redirect.url;
        }
        if (extra.redirect) {
          const stream = renderToReadableStream(payload(null, url, {}, extra), {
            onError,
            temporaryReferences,
          } as never);
          store.shell.resolve();
          return { kind: "rsc", stream, store, headers: storeHeaders(store) };
        }
      } else if (
        contentType.startsWith("multipart/form-data") ||
        contentType.startsWith("application/x-www-form-urlencoded")
      ) {
        // A form posted before hydration (progressive enhancement).
        store.dynamic = true;
        const form = await request.formData();
        const action = (await decodeAction(form)) as (() => unknown) | null;
        if (action) {
          try {
            const result = await action();
            extra.formState = await decodeFormState(result, form);
          } catch (error) {
            const redirect = redirectInfo(error);
            if (!redirect) throw error;
            return {
              kind: "response",
              response: withStoreHeaders(
                new Response(null, { status: 303, headers: { location: redirect.url } }),
                store,
              ),
            };
          }
        }
      }
    }

    const stream = await renderRoute(store, url, pageMatch, extra, temporaryReferences);
    return {
      kind: "rsc",
      stream,
      store,
      headers: storeHeaders(store),
      formState: extra.formState,
      route: pageMatch?.route,
    };
  });
}

function storeHeaders(store: RequestStore): Headers {
  const headers = new Headers(store.responseHeaders);
  for (const cookie of store.cookies.toSetCookieHeaders()) headers.append("set-cookie", cookie);
  return headers;
}

/** `generateStaticParams` of a page route, walking the dynamic segments' layouts and the page. */
export async function staticParams(route: AppRoute): Promise<Params[] | undefined> {
  const page = await load(route.file);
  if (page.dynamic === "force-dynamic") return undefined;
  const dynamicParts = route.parts.filter((p) => p.kind !== "static");
  if (!dynamicParts.length) return [{}];
  const generate = page.generateStaticParams as
    | ((ctx: { params: Params }) => Promise<Params[]> | Params[])
    | undefined;
  if (typeof generate !== "function") return undefined;
  return await generate({ params: {} });
}

/** URL paths to prerender: static pages and the `generateStaticParams` of dynamic ones. */
export async function prerenderPaths(): Promise<string[]> {
  const paths: string[] = [];
  for (const route of definition().routes) {
    if (route.kind !== "page") continue;
    // oxlint-disable-next-line no-await-in-loop -- user generateStaticParams run one route at a time, in route order, so data sources are not hit concurrently and the first failure stops the prerender
    const params = await staticParams(route);
    for (const p of params ?? []) paths.push(fillPattern(route, p));
  }
  return paths;
}
