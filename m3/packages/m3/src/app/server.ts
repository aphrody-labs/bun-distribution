// SPDX-License-Identifier: Apache-2.0
// `next/server`: NextRequest / NextResponse for middleware (`proxy.ts`) and route handlers.
import { RequestCookies } from "./headers";
import { markDynamic } from "./runtime/store";

/** Header of a middleware response meaning "continue with the route". */
export const MIDDLEWARE_NEXT = "x-middleware-next";
/** Header of a middleware response carrying the rewritten URL. */
export const MIDDLEWARE_REWRITE = "x-middleware-rewrite";
/** Prefix of the request headers overridden by `NextResponse.next({ request: { headers } })`. */
export const MIDDLEWARE_REQUEST_HEADER = "x-middleware-request-";

export class NextRequest extends Request {
  readonly nextUrl: URL;
  readonly cookies: RequestCookies;

  constructor(input: Request | string | URL, init?: RequestInit) {
    super(input, init);
    this.nextUrl = new URL(this.url);
    this.cookies = new RequestCookies(new Bun.CookieMap(this.headers.get("cookie") ?? ""));
  }
}

interface MiddlewareInit extends ResponseInit {
  request?: { headers?: HeadersInit };
}

export class NextResponse<Body = unknown> extends Response {
  readonly cookies: RequestCookies;
  private readonly cookieMap: Bun.CookieMap;
  declare readonly __body?: Body;

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    super(body, init);
    this.cookieMap = new Bun.CookieMap();
    this.cookies = new RequestCookies(this.cookieMap);
  }

  /** `Set-Cookie` values written through `response.cookies`. */
  setCookieHeaders(): string[] {
    return this.cookieMap.toSetCookieHeaders();
  }

  static override json<T>(body: T, init?: ResponseInit): NextResponse<T> {
    const headers = new Headers(init?.headers);
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
    return new NextResponse<T>(JSON.stringify(body), { ...init, headers });
  }

  static override redirect(url: string | URL, init?: number | ResponseInit): NextResponse {
    const status = typeof init === "number" ? init : (init?.status ?? 307);
    const headers = new Headers(typeof init === "object" ? init.headers : undefined);
    headers.set("location", String(url));
    return new NextResponse(null, { status, headers });
  }

  static rewrite(url: string | URL, init?: MiddlewareInit): NextResponse {
    const headers = middlewareHeaders(init);
    headers.set(MIDDLEWARE_REWRITE, String(url));
    return new NextResponse(null, { ...init, headers });
  }

  static next(init?: MiddlewareInit): NextResponse {
    const headers = middlewareHeaders(init);
    headers.set(MIDDLEWARE_NEXT, "1");
    return new NextResponse(null, { ...init, headers });
  }
}

function middlewareHeaders(init?: MiddlewareInit): Headers {
  const headers = new Headers(init?.headers);
  for (const [key, value] of new Headers(init?.request?.headers)) headers.set(MIDDLEWARE_REQUEST_HEADER + key, value);
  return headers;
}

/** Defer work until the response is sent (Bun keeps the process alive until it settles). */
export function after(task: Promise<unknown> | (() => unknown)): void {
  queueMicrotask(() => void Promise.resolve(typeof task === "function" ? task() : task).catch(console.error));
}

/** Opt the current render into dynamic rendering. */
export async function connection(): Promise<void> {
  markDynamic("connection()");
}

export interface MiddlewareConfig {
  matcher?: string | string[];
}
