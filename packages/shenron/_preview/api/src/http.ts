// SPDX-License-Identifier: Apache-2.0
/**
 * `@shenron/api/http` — pure HTTP helpers of the public API: memory rate
 * limiter, public JSON cache (TTL, LRU, FNV ETag, 304), cache and CORS headers,
 * invalidation port. Runtime class: `pure` (no hono, no node:, no bun:).
 *
 * Semantics copied from `apps/bot/src/api/server.ts` (`publicCachedJson`,
 * `publicRateLimit`, `publicCorsHeaders`, `etagOf`).
 */

export interface RateLimitPort {
	hit(
		key: string,
		o: { limit: number; windowMs: number }
	): Promise<{ allowed: boolean; retryAfterSeconds: number }>;
}

export interface PublicCacheEntry {
	body: string;
	etag: string;
	storedAt: number;
}

export interface PublicCachePort {
	get(key: string): PublicCacheEntry | null;
	set(key: string, body: string, ttlMs: number): { etag: string };
}

export interface InvalidationPort {
	paths(p: readonly string[]): Promise<void>;
	tags(t: readonly string[]): Promise<void>;
}

/** Public limit of the bot: 60 requests per minute and per IP. */
export const PUBLIC_RATE_LIMIT = { limit: 60, windowMs: 60_000 } as const;
export const PUBLIC_CACHE_MAX_ENTRIES = 256;

/**
 * Fixed-window counter, same semantics as the bot's `publicRateLimit`: the
 * first hit opens a window, hits beyond `limit` inside it are refused.
 * `retryAfterSeconds` is the window length (the bot answers `Retry-After: 60`).
 */
export function createMemoryRateLimiter(o: { now?: () => number } = {}): RateLimitPort {
	const now = o.now ?? Date.now;
	const buckets = new Map<string, { count: number; resetAt: number }>();
	return {
		async hit(key, { limit, windowMs }) {
			const t = now();
			const retryAfterSeconds = Math.max(1, Math.ceil(windowMs / 1000));
			if (buckets.size > 10_000) {
				for (const [k, b] of buckets) if (b.resetAt < t) buckets.delete(k);
			}
			const bucket = buckets.get(key);
			if (!bucket || bucket.resetAt < t) {
				buckets.set(key, { count: 1, resetAt: t + windowMs });
				return { allowed: limit >= 1, retryAfterSeconds };
			}
			bucket.count += 1;
			return { allowed: bucket.count <= limit, retryAfterSeconds };
		},
	};
}

const encoder = new TextEncoder();

/**
 * FNV-1a 32-bit over the UTF-8 bytes, sampled on at most ~4096 positions,
 * suffixed with the byte length in hex — byte-identical to `etagOf` in
 * `apps/bot/src/api/server.ts`.
 */
export function fnvEtag(body: string): string {
	const bytes = encoder.encode(body);
	let h = 0x811c9dc5;
	const len = bytes.length;
	const step = Math.max(1, Math.floor(len / 4096));
	for (let i = 0; i < len; i += step) {
		h ^= bytes[i] ?? 0;
		h = Math.imul(h, 0x01000193);
	}
	return `"${(h >>> 0).toString(16).padStart(8, "0")}-${len.toString(16)}"`;
}

/** LRU memory cache (default 256 entries) with a per-entry TTL. */
export function createPublicCache(
	o: { maxEntries?: number; now?: () => number } = {}
): PublicCachePort {
	const maxEntries = Math.max(1, o.maxEntries ?? PUBLIC_CACHE_MAX_ENTRIES);
	const now = o.now ?? Date.now;
	const entries = new Map<string, PublicCacheEntry & { expiresAt: number }>();
	return {
		get(key) {
			const entry = entries.get(key);
			if (!entry) return null;
			if (entry.expiresAt < now()) {
				entries.delete(key);
				return null;
			}
			entries.delete(key);
			entries.set(key, entry);
			return { body: entry.body, etag: entry.etag, storedAt: entry.storedAt };
		},
		set(key, body, ttlMs) {
			const etag = fnvEtag(body);
			const t = now();
			entries.delete(key);
			while (entries.size >= maxEntries) {
				const oldest = entries.keys().next().value;
				if (oldest === undefined) break;
				entries.delete(oldest);
			}
			entries.set(key, { body, etag, storedAt: t, expiresAt: t + ttlMs });
			return { etag };
		},
	};
}

/** Cache key: pathname + query sorted by name (bot `publicCacheKey`). */
export function publicCacheKey(url: URL): string {
	const params = [...url.searchParams.entries()].toSorted(([a], [b]) => a.localeCompare(b));
	return url.pathname + (params.length ? `?${new URLSearchParams(params).toString()}` : "");
}

/** `public, max-age=N, s-maxage=2N, stale-while-revalidate=4N` (N ≥ 1). */
export function publicCacheHeaders(ttlSeconds: number): Record<string, string> {
	const s = Math.max(1, Math.floor(ttlSeconds));
	return {
		"Cache-Control": `public, max-age=${s}, s-maxage=${s * 2}, stale-while-revalidate=${s * 4}`,
	};
}

/**
 * CORS allowlist headers: the request origin when allowed, otherwise the first
 * allowed origin (the bot falls back to `https://dragonballfr.com`).
 */
export function corsHeaders(
	origin: string | null,
	allowlist: readonly string[],
	methods: readonly string[]
): Record<string, string> {
	const allow = origin && allowlist.includes(origin) ? origin : (allowlist[0] ?? "null");
	return {
		"Access-Control-Allow-Origin": allow,
		"Access-Control-Allow-Methods": methods.join(", "),
		"Access-Control-Allow-Headers": "Content-Type",
		"Access-Control-Max-Age": "600",
		Vary: "Origin",
	};
}

export const noopInvalidation: InvalidationPort = {
	async paths() {},
	async tags() {},
};
