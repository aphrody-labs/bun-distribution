// SPDX-License-Identifier: Apache-2.0
// Next.js 16 Server API shims powered by Bun Web Standards & Bun.serve
import { realpath, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const inside = (base: string, path: string) => path === base || path.startsWith(`${base}${sep}`);

export class NextRequest extends Request {
  private _nextUrl?: URL;

  get nextUrl(): URL {
    if (!this._nextUrl) {
      this._nextUrl = new URL(this.url);
    }
    return this._nextUrl;
  }

  get ip(): string | undefined {
    return this.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "127.0.0.1";
  }

  get geo(): { city?: string; country?: string; region?: string } {
    return {
      country: this.headers.get("x-vercel-ip-country") || undefined,
      region: this.headers.get("x-vercel-ip-country-region") || undefined,
      city: this.headers.get("x-vercel-ip-city") || undefined,
    };
  }

  get cookies(): Map<string, string> {
    const map = new Map<string, string>();
    const cookieHeader = this.headers.get("cookie");
    if (cookieHeader) {
      cookieHeader.split(";").forEach(c => {
        const [k, ...v] = c.trim().split("=");
        if (k) map.set(k, v.join("="));
      });
    }
    return map;
  }
}

export class NextResponse extends Response {
  static json(data: any, init?: ResponseInit): NextResponse {
    const body = JSON.stringify(data);
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    return new NextResponse(body, {
      ...init,
      headers,
    });
  }

  static redirect(url: string | URL, status: number = 307): NextResponse {
    const dest = typeof url === "string" ? url : url.toString();
    return new NextResponse(null, {
      status,
      headers: { Location: dest },
    });
  }

  static rewrite(url: string | URL, init?: ResponseInit): NextResponse {
    const dest = typeof url === "string" ? url : url.toString();
    const headers = new Headers(init?.headers);
    headers.set("x-middleware-rewrite", dest);
    return new NextResponse(null, {
      ...init,
      headers,
    });
  }

  static next(init?: ResponseInit): NextResponse {
    const headers = new Headers(init?.headers);
    headers.set("x-middleware-next", "1");
    return new NextResponse(null, {
      ...init,
      headers,
    });
  }
}

export interface BunServerOptions {
  port?: number;
  hostname?: string;
  staticDir?: string;
  routes?: Record<
    string,
    {
      GET?: (req: NextRequest) => Promise<Response> | Response;
      POST?: (req: NextRequest) => Promise<Response> | Response;
      PUT?: (req: NextRequest) => Promise<Response> | Response;
      DELETE?: (req: NextRequest) => Promise<Response> | Response;
      PATCH?: (req: NextRequest) => Promise<Response> | Response;
      HEAD?: (req: NextRequest) => Promise<Response> | Response;
      OPTIONS?: (req: NextRequest) => Promise<Response> | Response;
    }
  >;
}

/**
 * Creates a native Bun.serve HTTP server that mounts Next.js 16 Route Handlers (app/api/.../route.ts)
 * and serves desktop static frontend assets with Bun.file.
 */
export function createNextBunServer(options: BunServerOptions = {}) {
  const { port = 1420, hostname = "127.0.0.1", staticDir = "./dist", routes = {} } = options;

  if (typeof Bun === "undefined") {
    throw new Error("createNextBunServer requires the Bun runtime (Bun.serve).");
  }

  const root = resolve(staticDir);
  async function staticResponse(pathname: string, head: boolean): Promise<Response | null> {
    const path = resolve(root, `.${pathname}`);
    if (!inside(root, path)) return new Response("Forbidden", { status: 403 });
    try {
      const [canonicalRoot, canonicalPath] = await Promise.all([realpath(root), realpath(path)]);
      if (!inside(canonicalRoot, canonicalPath)) return new Response("Forbidden", { status: 403 });
      const metadata = await stat(canonicalPath);
      if (!metadata.isFile()) return null;
      const file = Bun.file(canonicalPath);
      return new Response(head ? null : file, {
        headers: {
          "content-type": file.type,
          "content-length": String(metadata.size),
        },
      });
    } catch {
      return null;
    }
  }

  return Bun.serve({
    port,
    hostname,
    async fetch(req: Request) {
      const url = new URL(req.url);
      const nextReq = new NextRequest(req);

      // Check route handlers
      const handler = routes[url.pathname];
      if (handler) {
        const method = req.method.toUpperCase() as keyof typeof handler;
        const allowed = Object.keys(handler).filter(
          name => typeof handler[name as keyof typeof handler] === "function",
        );
        if (handler.GET && !handler.HEAD) allowed.push("HEAD");
        if (!handler.OPTIONS) allowed.push("OPTIONS");
        const allow = allowed.join(", ");
        if (method === "OPTIONS" && !handler.OPTIONS) {
          return new Response(null, { status: 204, headers: { Allow: allow } });
        }
        const methodFn = handler[method] ?? (method === "HEAD" ? handler.GET : undefined);
        if (typeof methodFn === "function") {
          try {
            const response = await methodFn(nextReq);
            return method === "HEAD" ? new Response(null, response) : response;
          } catch {
            return NextResponse.json({ error: "Internal Server Error" }, { status: 500 });
          }
        }
        return new Response(`Method ${req.method} Not Allowed`, {
          status: 405,
          headers: { Allow: allow },
        });
      }

      if (req.method !== "GET" && req.method !== "HEAD") {
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
      if (pathname.includes("\0") || pathname.includes("\\") || pathname.split("/").includes("..")) {
        return new Response("Forbidden", { status: 403 });
      }
      const head = req.method === "HEAD";
      const asset = await staticResponse(pathname === "/" ? "/index.html" : pathname, head);
      if (asset) return asset;
      // App routes receive the SPA shell; a missing asset must keep its 404 status.
      if (extname(pathname) === "") {
        const shell = await staticResponse("/index.html", head);
        if (shell) return shell;
      }

      return new Response("Not Found", { status: 404 });
    },
  });
}
