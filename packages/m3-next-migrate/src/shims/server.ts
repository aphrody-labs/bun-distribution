// SPDX-License-Identifier: Apache-2.0
// Next.js 16 Server API shims powered by Bun Web Standards & Bun.serve

export class NextRequest extends Request {
  private _nextUrl?: URL;

  constructor(input: RequestInfo | URL, init?: RequestInit) {
    super(input, init);
  }

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
      cookieHeader.split(";").forEach((c) => {
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
        const methodFn = handler[method];
        if (typeof methodFn === "function") {
          try {
            return await methodFn(nextReq);
          } catch (err: any) {
            return NextResponse.json({ error: err?.message || "Internal Server Error" }, { status: 500 });
          }
        }
        return new Response(`Method ${req.method} Not Allowed`, { status: 405 });
      }

      // Serve static assets from staticDir using Bun.file
      const filePath = `${staticDir}${url.pathname === "/" ? "/index.html" : url.pathname}`;
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }

      // SPA fallback to index.html
      const indexFile = Bun.file(`${staticDir}/index.html`);
      if (await indexFile.exists()) {
        return new Response(indexFile);
      }

      return new Response("Not Found", { status: 404 });
    },
  });
}
