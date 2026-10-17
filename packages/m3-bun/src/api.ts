// SPDX-License-Identifier: Apache-2.0
// The API of an app, written once as Bun routes. `m3-bun` serves it natively next to the UI in one process;
// `routesToFetch` turns the same routes into one `fetch(Request)` handler for hosts that are not Bun
// (Cloudflare Workers, Vercel functions, tests).
//
//   export default defineM3Api({
//     "/api/hello/:name": (req) => Response.json({ hello: req.params.name }),
//     "/api/items": { GET: () => Response.json([]), POST: async (req) => Response.json(await req.json(), { status: 201 }) },
//   });

/** A route request: path params, and cookies (`request.cookies` of Bun routes, parsed from `Cookie` elsewhere). */
export type M3Request = Request & {
  params: Record<string, string>;
  cookies: Bun.CookieMap;
};
export type M3Handler = (request: M3Request) => Response | Promise<Response>;
export type M3Methods = Partial<Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS", M3Handler>>;
export type M3Route = M3Handler | M3Methods | Response;
export type M3Routes = Record<string, M3Route>;

/** An API module's default export: routes only, or routes plus a fallback `fetch` that may return undefined to pass. */
export type M3ApiModule =
  | M3Routes
  | {
      routes?: M3Routes;
      fetch?: (request: Request) => Response | undefined | Promise<Response | undefined>;
    };

/** Identity helper that types an API module. */
export function defineM3Api<T extends M3ApiModule>(api: T): T {
  return api;
}

type Fallback = (request: Request) => Response | undefined | Promise<Response | undefined>;

/** Split a module's default export into routes and the optional fallback (route keys always start with `/`). */
export function normalizeApi(api: M3ApiModule | undefined): {
  routes: M3Routes;
  fetch?: Fallback;
} {
  if (!api) return { routes: {} };
  if ("routes" in api || "fetch" in api) {
    const module = api as { routes?: M3Routes; fetch?: Fallback };
    return {
      routes: module.routes ?? {},
      ...(module.fetch ? { fetch: module.fetch } : {}),
    };
  }
  return { routes: api as M3Routes };
}

/** The request cookies: Bun routes carry `request.cookies`; other hosts get one parsed from the `Cookie` header. */
export function requestCookies(request: Request): Bun.CookieMap {
  const native = (request as Partial<M3Request>).cookies;
  return native instanceof Bun.CookieMap ? native : new Bun.CookieMap(request.headers.get("cookie") ?? "");
}

/** `response` plus one `Set-Cookie` header per change made to `cookies` (what `Bun.serve` does for its routes). */
export function withCookies(response: Response, cookies: Bun.CookieMap): Response {
  const set = cookies.toSetCookieHeaders();
  if (set.length === 0) return response;
  const headers = new Headers(response.headers);
  for (const cookie of set) headers.append("Set-Cookie", cookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function respond(handler: M3Handler, request: M3Request, cookies?: Bun.CookieMap): Promise<Response> {
  let response = await handler(request);
  if (cookies) response = withCookies(response, cookies);
  if (request.method !== "HEAD") return response;
  await response.body?.cancel();
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
}

interface Compiled {
  segments: string[];
  wildcard: boolean;
  route: M3Route;
}

const compile = (pattern: string, route: M3Route): Compiled => {
  const wildcard = pattern.endsWith("/*");
  const base = wildcard ? pattern.slice(0, -2) : pattern;
  return { segments: base.split("/").filter(Boolean), wildcard, route };
};

/** Match `path` against a compiled pattern; returns the params or undefined. Static segments outrank params. */
function match(path: string, route: Compiled): Record<string, string> | undefined {
  const parts = path.split("/").filter(Boolean);
  if (route.wildcard ? parts.length < route.segments.length : parts.length !== route.segments.length) return undefined;
  const params: Record<string, string> = {};
  for (let i = 0; i < route.segments.length; i++) {
    const segment = route.segments[i]!;
    if (segment.startsWith(":")) params[segment.slice(1)] = decodeURIComponent(parts[i]!);
    else if (segment !== parts[i]) return undefined;
  }
  return params;
}

function compareRoutes(a: Compiled, b: Compiled): number {
  for (let i = 0; i < Math.min(a.segments.length, b.segments.length); i++) {
    const difference = Number(a.segments[i]!.startsWith(":")) - Number(b.segments[i]!.startsWith(":"));
    if (difference) return difference;
  }
  return b.segments.length - a.segments.length || Number(a.wildcard) - Number(b.wildcard);
}

/**
 * One `fetch` handler for Bun-style routes: `:param` segments, trailing `/*`, per-method objects and static
 * `Response` values. Unmatched requests resolve to `undefined` so a host can fall through to its assets.
 */
export function routesToFetch(routes: M3Routes): (request: Request) => Promise<Response | undefined> {
  const compiled = Object.entries(routes)
    .map(([pattern, route]) => compile(pattern, route))
    .toSorted(compareRoutes);
  return async request => {
    const { pathname } = new URL(request.url);
    for (const entry of compiled) {
      let params: Record<string, string> | undefined;
      try {
        params = match(pathname, entry);
      } catch {
        return new Response("Bad Request", { status: 400 });
      }
      if (!params) continue;
      const route = entry.route;
      const handler =
        route instanceof Response
          ? () => route.clone()
          : typeof route === "function"
            ? route
            : route[request.method as keyof M3Methods];
      if (!handler) {
        const allow = typeof route === "object" && !(route instanceof Response) ? Object.keys(route).join(", ") : "";
        return new Response("Method Not Allowed", {
          status: 405,
          headers: allow ? { Allow: allow } : {},
        });
      }
      // Outside Bun routes, `request.cookies` is emulated and its changes applied to the response, as Bun does.
      const cookies =
        (request as Partial<M3Request>).cookies instanceof Bun.CookieMap ? undefined : requestCookies(request);
      const withParams = Object.assign(request, cookies ? { params, cookies } : { params });
      return respond(handler, withParams as M3Request, cookies);
    }
    return undefined;
  };
}

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export interface M3CsrfOptions {
  /** Signing secret (see `m3Secret` for one kept in the OS credential store). */
  secret: string;
  /** Request header carrying the token (default `x-csrf-token`). */
  header?: string;
  /** Token lifetime in milliseconds (default Bun's, 24 hours). */
  maxAge?: number;
  /** Principal the tokens are bound to (a session id): a token only verifies for the session it was issued to. */
  sessionOf?: (request: M3Request) => string | undefined | Promise<string | undefined>;
}

export interface M3Csrf {
  /** A new token (`Bun.CSRF.generate`), bound to `sessionId` when given. */
  token(sessionId?: string): string;
  /** Whether the request carries a valid token for its session (`Bun.CSRF.verify`). */
  verify(request: M3Request): Promise<boolean>;
  /** The route with its POST, PUT, PATCH and DELETE handlers refused (403) without a valid token. */
  protect(route: M3Route): M3Route;
}

/** CSRF tokens for an API, on `Bun.CSRF`. */
export function m3Csrf(options: M3CsrfOptions): M3Csrf {
  const header = options.header ?? "x-csrf-token";
  const verify = async (request: M3Request): Promise<boolean> => {
    const token = request.headers.get(header);
    if (!token) return false;
    const sessionId = await options.sessionOf?.(request);
    return Bun.CSRF.verify(token, {
      secret: options.secret,
      ...(options.maxAge !== undefined ? { maxAge: options.maxAge } : {}),
      ...(sessionId ? { sessionId } : {}),
    });
  };
  const guard =
    (handler: M3Handler): M3Handler =>
    async request =>
      !UNSAFE.has(request.method) || (await verify(request))
        ? handler(request)
        : Response.json({ error: "invalid CSRF token" }, { status: 403 });
  return {
    token: sessionId =>
      Bun.CSRF.generate(options.secret, {
        ...(options.maxAge !== undefined ? { expiresIn: options.maxAge } : {}),
        ...(sessionId ? { sessionId } : {}),
      }),
    verify,
    protect(route) {
      if (route instanceof Response) return route;
      if (typeof route === "function") return guard(route);
      const guarded: M3Methods = {};
      for (const [method, handler] of Object.entries(route) as [keyof M3Methods, M3Handler][])
        guarded[method] = guard(handler);
      return guarded;
    },
  };
}

const YAML_TYPE = /^(?:application|text)\/(?:x-)?yaml\b/;
const JSONL_TYPE = /^application\/(?:jsonl|x-ndjson|jsonlines)\b/;

/** Wanted body format of a request (`Accept`): JSON unless YAML or JSON Lines is asked for. */
function wanted(accept: string | null): "json" | "yaml" | "jsonl" {
  for (const part of (accept ?? "").toLowerCase().split(",")) {
    const type = part.trim();
    if (YAML_TYPE.test(type)) return "yaml";
    if (JSONL_TYPE.test(type)) return "jsonl";
    if (type.startsWith("application/json")) return "json";
  }
  return "json";
}

/** JSON Lines of `items`, streamed as they come (`application/jsonl`). */
export function jsonl(items: Iterable<unknown> | AsyncIterable<unknown>, init: ResponseInit = {}): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      for await (const item of items) controller.enqueue(encoder.encode(`${JSON.stringify(item)}\n`));
      controller.close();
    },
  });
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/jsonl; charset=utf-8");
  return new Response(body, { ...init, headers });
}

/** `data` as YAML (`Bun.YAML.stringify`). */
export function yaml(data: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/yaml; charset=utf-8");
  return new Response(Bun.YAML.stringify(data, null, 2), { ...init, headers });
}

/** `data` in the format the request accepts: YAML, JSON Lines (arrays and iterables), else JSON. */
export function reply(data: unknown, request: Request, init: ResponseInit = {}): Response {
  const format = wanted(request.headers.get("accept"));
  const iterable =
    data !== null && typeof data === "object" && (Symbol.iterator in data || Symbol.asyncIterator in data);
  const response =
    format === "yaml"
      ? yaml(data, init)
      : format === "jsonl" && iterable
        ? jsonl(data as Iterable<unknown> | AsyncIterable<unknown>, init)
        : Response.json(data, init);
  response.headers.append("Vary", "Accept");
  return response;
}

/** Each value of a JSON Lines request body as it arrives (`Bun.JSONL.parseChunk`); a malformed line throws. */
export async function* readJsonl(request: Request): AsyncGenerator<unknown> {
  if (!request.body) return;
  const decoder = new TextDecoder();
  let pending = "";
  for await (const chunk of request.body) {
    pending += decoder.decode(chunk, { stream: true });
    const { values, read, error } = Bun.JSONL.parseChunk(pending);
    if (error) throw error;
    yield* values;
    pending = pending.slice(read);
  }
  pending += decoder.decode();
  if (pending.trim() !== "") yield* Bun.JSONL.parse(pending);
}

/** The request body by `Content-Type`: YAML (`Bun.YAML.parse`), JSON Lines (an array), form fields, else JSON. */
export async function readBody(request: Request): Promise<unknown> {
  const type = (request.headers.get("content-type") ?? "").toLowerCase();
  if (YAML_TYPE.test(type)) return Bun.YAML.parse(await request.text());
  if (JSONL_TYPE.test(type)) return Array.fromAsync(readJsonl(request));
  if (type.startsWith("multipart/form-data") || type.startsWith("application/x-www-form-urlencoded"))
    return Object.fromEntries(await request.formData());
  return request.json();
}
