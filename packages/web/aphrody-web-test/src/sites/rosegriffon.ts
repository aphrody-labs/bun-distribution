// SPDX-License-Identifier: Apache-2.0

/**
 * @module @aphrody/web-test/sites/rosegriffon
 *
 * Test presets and helpers for Rose Griffon (`rosegriffon.fr`):
 * - Canonical URL presets, origin registry, and slug normalizer (no trailing slashes, kebab-case).
 * - Authentication cookies (session, CSRF, tokens) and headers generation/injection.
 * - API health check probe with latency timing and timeout handling.
 */

import type { PwCookieParam, PlaywrightBrowserContext } from "../next/context.ts";

/** Canonical origins for Rose Griffon domains. */
export const ROSE_GRIFFON_ORIGINS = {
  site: "https://rosegriffon.fr",
  api: "https://api.rosegriffon.fr",
  cdn: "https://cdn.rosegriffon.fr",
  azalee: "https://azalee.rosegriffon.fr",
  achillea: "https://achillea.rosegriffon.fr",
  ranked: "https://ranked.rosegriffon.fr",
} as const;

/** Canonical routes on rosegriffon.fr (kebab-case, ASCII, no trailing slashes). */
export const ROSE_GRIFFON_ROUTES = {
  home: "/",
  news: "/news",
  about: "/a-propos",
  commitments: "/charte-engagements",
  legal: "/mentions-legales",
  privacy: "/politique-confidentialite",
  sitemap: "/sitemap.xml",
  robots: "/robots.txt",
} as const;

/** Full canonical URLs for Rose Griffon. */
export const ROSE_GRIFFON_URLS = {
  home: `${ROSE_GRIFFON_ORIGINS.site}/`,
  news: `${ROSE_GRIFFON_ORIGINS.site}/news`,
  about: `${ROSE_GRIFFON_ORIGINS.site}/a-propos`,
  commitments: `${ROSE_GRIFFON_ORIGINS.site}/charte-engagements`,
  legal: `${ROSE_GRIFFON_ORIGINS.site}/mentions-legales`,
  privacy: `${ROSE_GRIFFON_ORIGINS.site}/politique-confidentialite`,
  sitemap: `${ROSE_GRIFFON_ORIGINS.site}/sitemap.xml`,
  robots: `${ROSE_GRIFFON_ORIGINS.site}/robots.txt`,
} as const;

/** Canonical cookie names used by Rose Griffon auth systems. */
export const ROSE_GRIFFON_AUTH_COOKIES = {
  session: "rg_session",
  csrf: "rg_csrf",
  token: "rg_token",
  hostSession: "__Host-rg-session",
} as const;

/**
 * Builds a canonical Rose Griffon URL for `path`.
 * Enforces no trailing slashes on non-root paths according to the Aphrody SEO specification.
 */
export function roseGriffonUrl(path: string, origin: string = ROSE_GRIFFON_ORIGINS.site): string {
  const cleanOrigin = origin.replace(/\/+$/, "");
  let cleanPath = path.startsWith("/") ? path : `/${path}`;
  if (cleanPath.length > 1 && cleanPath.endsWith("/")) {
    cleanPath = cleanPath.replace(/\/+$/, "");
  }
  return `${cleanOrigin}${cleanPath}`;
}

export interface RoseGriffonAuthOptions {
  session?: string;
  csrf?: string;
  token?: string;
  domain?: string;
  path?: string;
}

/**
 * Creates Playwright-compatible cookie parameters for Rose Griffon authentication.
 */
export function createRoseGriffonAuthCookies(opts: RoseGriffonAuthOptions = {}): PwCookieParam[] {
  const domain = opts.domain ?? "rosegriffon.fr";
  const path = opts.path ?? "/";
  const cookies: PwCookieParam[] = [
    {
      name: ROSE_GRIFFON_AUTH_COOKIES.session,
      value: opts.session ?? "test-rg-session-tok",
      domain,
      path,
    },
    {
      name: ROSE_GRIFFON_AUTH_COOKIES.csrf,
      value: opts.csrf ?? "test-rg-csrf-tok",
      domain,
      path,
    },
  ];

  if (opts.token) {
    cookies.push({
      name: ROSE_GRIFFON_AUTH_COOKIES.token,
      value: opts.token,
      domain,
      path,
    });
  }

  return cookies;
}

/**
 * Generates HTTP request headers for authenticated Rose Griffon requests.
 */
export function roseGriffonAuthHeaders(
  tokenOrSession: string = "test-rg-session-tok",
  csrfToken: string = "test-rg-csrf-tok",
): Record<string, string> {
  return {
    Authorization: `Bearer ${tokenOrSession}`,
    "x-csrf-token": csrfToken,
    Cookie: `${ROSE_GRIFFON_AUTH_COOKIES.session}=${tokenOrSession}; ${ROSE_GRIFFON_AUTH_COOKIES.csrf}=${csrfToken}`,
  };
}

/**
 * Injects Rose Griffon authentication cookies into a test page or browser context.
 */
export async function injectRoseGriffonAuth(
  target: unknown,
  options: RoseGriffonAuthOptions = {},
): Promise<void> {
  const cookies = createRoseGriffonAuthCookies(options);
  if (
    typeof target === "object" &&
    target !== null &&
    "context" in target &&
    typeof (target as { context: unknown }).context === "function"
  ) {
    const ctx = (target as { context(): PlaywrightBrowserContext }).context();
    await ctx.addCookies(cookies);
    return;
  }
  if (
    typeof target === "object" &&
    target !== null &&
    "addCookies" in target &&
    typeof (target as { addCookies: unknown }).addCookies === "function"
  ) {
    await (target as PlaywrightBrowserContext).addCookies(cookies);
    return;
  }
  if (
    typeof target === "object" &&
    target !== null &&
    "_cdp" in target &&
    typeof (target as { _cdp: { _send: unknown } })._cdp?._send === "function"
  ) {
    const send = (target as { _cdp: { _send: (m: string, p: unknown) => Promise<unknown> } })._cdp;
    await send._send("Network.setCookies", { cookies });
    return;
  }
  throw new TypeError(
    "injectRoseGriffonAuth: target does not support cookie injection (expected TestPage, PlaywrightPage, or BrowserContext)",
  );
}

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface CheckRoseGriffonApiOptions {
  apiOrigin?: string;
  endpoint?: string;
  fetch?: FetchLike;
  timeoutMs?: number;
}

export interface RoseGriffonApiHealthResult {
  ok: boolean;
  status: number;
  latencyMs: number;
  endpoint: string;
  error?: string;
  data?: unknown;
}

/**
 * Checks Rose Griffon API health, measuring latency and parsing response.
 */
export async function checkRoseGriffonApiHealth(
  opts: CheckRoseGriffonApiOptions = {},
): Promise<RoseGriffonApiHealthResult> {
  const origin = (opts.apiOrigin ?? ROSE_GRIFFON_ORIGINS.api).replace(/\/+$/, "");
  const endpoint = opts.endpoint ?? "/health";
  const url = `${origin}${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
  const fetcher = opts.fetch ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs ?? 5000;

  const start = performance.now();
  try {
    const response = await fetcher(url, {
      headers: { Accept: "application/json, text/plain, */*" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const latencyMs = Math.round(performance.now() - start);
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      // Non-JSON response is fine as long as status is checked
    }

    return {
      ok: response.ok,
      status: response.status,
      latencyMs,
      endpoint: url,
      data,
    };
  } catch (err) {
    const latencyMs = Math.round(performance.now() - start);
    return {
      ok: false,
      status: 0,
      latencyMs,
      endpoint: url,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
