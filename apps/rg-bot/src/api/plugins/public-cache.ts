import { Elysia } from "elysia";

/**
 * CDN caching of the public, anonymous GET reads of the unified API.
 *
 * On Vercel Hobby every request that reaches the function is an invocation and
 * Active CPU, and every miss wakes Supabase or Neon. These reads are the same
 * for every visitor, so the Vercel CDN (and Cloudflare in front of it) serves
 * them for `max-age` seconds and keeps a stale copy while one background
 * request refreshes it. `Vary: Origin` set by the CORS plugin keeps one entry
 * per first-party origin.
 *
 * Only the prefixes below are cached: they never read the session cookie.
 * Anything carrying `Authorization`, any error, and any response whose handler
 * already chose its own `Cache-Control` is left untouched.
 * See docs/aphrody/reference/infra/rg-free-tier-allocation.md.
 */
const POLICIES: ReadonlyArray<{ prefix: string; maxAge: number; stale: number }> = [
  // Game mirror (Neon inagle): changes only when the mirror is republished.
  { prefix: "/v1/wiki/", maxAge: 3600, stale: 86_400 },
  { prefix: "/v1/inagle/", maxAge: 3600, stale: 86_400 },
  { prefix: "/v1/community/", maxAge: 3600, stale: 86_400 },
  // Editorial content: a publication shows up within five minutes.
  { prefix: "/v1/content/", maxAge: 300, stale: 3600 },
  // Public e-sport standings: move by the minute.
  { prefix: "/v1/achillea/leaderboard", maxAge: 60, stale: 300 },
  { prefix: "/v1/achillea/leagues", maxAge: 300, stale: 3600 },
  { prefix: "/v1/achillea/tournaments/circuit/", maxAge: 60, stale: 300 },
];

function policyFor(path: string) {
  if (path.endsWith("/health")) return undefined;
  return POLICIES.find(policy => path.startsWith(policy.prefix));
}

export const publicCache = new Elysia({ name: "rg-public-cache" }).onAfterHandle(
  { as: "global" },
  ({ request, set, path, responseValue }) => {
    if (request.method !== "GET" || request.headers.has("authorization")) return;
    const policy = policyFor(path);
    if (!policy) return;
    if (typeof set.status === "number" && set.status >= 400) return;
    const code = (responseValue as { code?: unknown } | null | undefined)?.code;
    if (typeof code === "number" && code >= 400) return;
    if (responseValue instanceof Response) return;
    if (set.headers["cache-control"]) return;

    set.headers["cache-control"] = "public, max-age=60";
    set.headers["cdn-cache-control"] = `public, max-age=${policy.maxAge}, stale-while-revalidate=${policy.stale}`;
  },
);
