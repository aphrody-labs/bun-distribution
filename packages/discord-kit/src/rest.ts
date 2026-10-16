/**
 * Client REST Discord avec parsing des rate-limit headers et auto-retry sur 429.
 *
 * Deux modes :
 *  - "Bot"    : utilise DISCORD_TOKEN (côté bot, scopes complets)
 *  - "Bearer" : utilise un access_token OAuth user (scopes limités)
 *
 * Rate limit headers parsés : X-RateLimit-Bucket, Remaining, Reset-After, Scope.
 * Sur 429 : respect du `retry_after` JSON (plus précis que le header `Retry-After`).
 * Cap à 1 retry pour éviter de bloquer la requête HTTP du dashboard ; au-delà,
 * on remonte l'erreur au caller qui gérera (toast côté UI).
 */

const API = "https://discord.com/api/v10";

export type AuthMode = "Bot" | "Bearer";

interface RateLimitInfo {
  bucket: string | null;
  remaining: number | null;
  resetAfter: number | null; // secondes
  scope: "user" | "shared" | "global" | null;
}

export interface DiscordResponse<T> {
  data: T;
  rateLimit: RateLimitInfo;
}

export class DiscordRESTError extends Error {
  constructor(
    public status: number,
    public code: number | null,
    message: string,
    public retryAfter?: number,
  ) {
    super(message);
  }
}

function parseRateLimit(res: Response): RateLimitInfo {
  return {
    bucket: res.headers.get("X-RateLimit-Bucket"),
    remaining: numOrNull(res.headers.get("X-RateLimit-Remaining")),
    resetAfter: numOrNull(res.headers.get("X-RateLimit-Reset-After")),
    scope:
      (res.headers.get("X-RateLimit-Scope") as RateLimitInfo["scope"]) ?? null,
  };
}

function numOrNull(s: string | null): number | null {
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export async function discordFetch<T = unknown>(
  path: string,
  opts: {
    mode: AuthMode;
    token: string;
    method?: string;
    body?: unknown;
    fetch?: typeof fetch;
    onRateLimit?: (info: {
      path: string;
      retryAfter?: number;
      global?: boolean;
    }) => void;
  },
): Promise<DiscordResponse<T>> {
  if (!path.startsWith("/")) path = "/" + path;
  const url = `${API}${path}`;
  const headers: Record<string, string> = {};

  if (opts.mode === "Bot") {
    if (!opts.token)
      throw new DiscordRESTError(500, null, "DISCORD_TOKEN absent");
    headers["Authorization"] = `Bot ${opts.token}`;
  } else {
    if (!opts.token)
      throw new DiscordRESTError(401, null, "access_token requis");
    headers["Authorization"] = `Bearer ${opts.token}`;
  }
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";

  const body = opts.body !== undefined ? JSON.stringify(opts.body) : undefined;
  const request = () => {
    const signal = AbortSignal.timeout(10_000);
    return (opts.fetch ?? fetch)(url, {
      method: opts.method ?? "GET",
      headers,
      body,
      signal,
      redirect: "error",
    });
  };
  let res = await request();

  // 429 → un retry après `retry_after` (cap 5s pour ne pas bloquer la requête du dashboard)
  if (res.status === 429) {
    const limited = (await res.json().catch(() => ({}))) as {
      retry_after?: number;
      global?: boolean;
    };
    const delay = limited.retry_after;
    const wait =
      typeof delay === "number" && Number.isFinite(delay) && delay >= 0
        ? Math.min(5, delay)
        : 1;
    opts.onRateLimit?.({
      path,
      retryAfter: limited.retry_after,
      global: limited.global,
    });
    await new Promise((resolve) => setTimeout(resolve, wait * 1000));
    res = await request();
  }

  const rl = parseRateLimit(res);

  if (!res.ok) {
    const errBody = (await res.json().catch(() => ({}))) as {
      message?: string;
      code?: number;
      retry_after?: number;
    };
    throw new DiscordRESTError(
      res.status,
      errBody.code ?? null,
      errBody.message ?? `HTTP ${res.status}`,
      errBody.retry_after,
    );
  }

  // 204 No Content
  if (res.status === 204) return { data: undefined as T, rateLimit: rl };
  return { data: (await res.json()) as T, rateLimit: rl };
}
