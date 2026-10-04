// SPDX-License-Identifier: Apache-2.0
// The API of an app, written once as Bun routes. `m3-bun` serves it natively next to the UI in one process;
// `routesToFetch` turns the same routes into one `fetch(Request)` handler for hosts that are not Bun
// (Cloudflare Workers, Vercel functions, tests).
//
//   export default defineM3Api({
//     "/api/hello/:name": (req) => Response.json({ hello: req.params.name }),
//     "/api/items": { GET: () => Response.json([]), POST: async (req) => Response.json(await req.json(), { status: 201 }) },
//   });

export type M3Request = Request & { params: Record<string, string> };
export type M3Handler = (request: M3Request) => Response | Promise<Response>;
export type M3Methods = Partial<
  Record<"GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS", M3Handler>
>;
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
export function normalizeApi(api: M3ApiModule | undefined): { routes: M3Routes; fetch?: Fallback } {
  if (!api) return { routes: {} };
  if ("routes" in api || "fetch" in api) {
    const module = api as { routes?: M3Routes; fetch?: Fallback };
    return { routes: module.routes ?? {}, ...(module.fetch ? { fetch: module.fetch } : {}) };
  }
  return { routes: api as M3Routes };
}

async function respond(handler: M3Handler, request: M3Request): Promise<Response> {
  const response = await handler(request);
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
  if (
    route.wildcard ? parts.length < route.segments.length : parts.length !== route.segments.length
  )
    return undefined;
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
    const difference =
      Number(a.segments[i]!.startsWith(":")) - Number(b.segments[i]!.startsWith(":"));
    if (difference) return difference;
  }
  return b.segments.length - a.segments.length || Number(a.wildcard) - Number(b.wildcard);
}

/**
 * One `fetch` handler for Bun-style routes: `:param` segments, trailing `/*`, per-method objects and static
 * `Response` values. Unmatched requests resolve to `undefined` so a host can fall through to its assets.
 */
export function routesToFetch(
  routes: M3Routes,
): (request: Request) => Promise<Response | undefined> {
  const compiled = Object.entries(routes)
    .map(([pattern, route]) => compile(pattern, route))
    .toSorted(compareRoutes);
  return async (request) => {
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
        const allow =
          typeof route === "object" && !(route instanceof Response)
            ? Object.keys(route).join(", ")
            : "";
        return new Response("Method Not Allowed", {
          status: 405,
          headers: allow ? { Allow: allow } : {},
        });
      }
      const withParams = Object.assign(request, { params }) as M3Request;
      return respond(handler, withParams);
    }
    return undefined;
  };
}
