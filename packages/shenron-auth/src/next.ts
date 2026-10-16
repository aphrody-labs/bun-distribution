// Source: packages/shenron/auth/src/next.ts at 8172f535ce (preserved Git history).
/**
 * Next.js adapter (runtime class `next`). `next/headers` is imported lazily
 * inside each function so that importing this module never requires a Next
 * request scope (tests, scripts, route modules evaluated at build time).
 */
import { authorize, type AuthDecision, type Strategy } from "./guards";

/** Request headers of the current Next request scope (copied, mutable). */
export async function requestHeaders(): Promise<Headers> {
  const { headers } = await import("next/headers");
  return new Headers(await headers());
}

/**
 * Synthetic `Request` for the current scope, for server components and server
 * actions that have no `Request` object. The URL is `url` when given, else
 * built from the forwarded host, else `http://localhost/`.
 */
export async function currentRequest(url?: string): Promise<Request> {
  const headers = await requestHeaders();
  if (url) return new Request(url, { headers });
  const host = headers.get("x-forwarded-host") ?? headers.get("host");
  const proto = headers.get("x-forwarded-proto") ?? "https";
  return new Request(host ? `${proto}://${host}/` : "http://localhost/", { headers });
}

export async function authorizeNext(strategies: readonly Strategy[], url?: string): Promise<AuthDecision> {
  return authorize(await currentRequest(url), strategies);
}
