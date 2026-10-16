// Source: packages/shenron/auth/src/tokens.ts at 8172f535ce (preserved Git history).
/**
 * Static Bearer tokens and the `dbfr_admin` cookie codec (runtime class `server`).
 *
 * The cookie format is byte-for-byte the one of `apps/shenron/site/src/lib/admin-token.ts`:
 * `${exp}.${hex(HMAC-SHA256(secret, "admin:" + exp + ":" + sha256Hex(token).slice(0, 16)))}`
 * with a 7-day TTL. The signature is bound to the fingerprint of the current
 * master token: rotating the token revokes every cookie already issued.
 */
import { hmacSha256Hex, parseBearer, sha256Hex, timingSafeEqualString } from "./crypto";

/** Minimum length of an accepted static token (same floor as `api-token.ts`). */
export const STATIC_BEARER_MIN_LENGTH = 16;

export type StaticBearerResult = "absent" | "valid" | "invalid" | "not_configured";

export interface VerifyStaticBearerOptions {
  /** Tokens shorter than this (after trim) are ignored. Default 16. */
  minLength?: number;
  /** See `parseBearer`: `true` keeps the bot's exact `Bearer ` prefix. */
  caseSensitive?: boolean;
}

/** Configured tokens, trimmed, blanks and too-short values dropped. */
export function acceptedStaticTokens(
  accepted: readonly (string | null | undefined)[],
  minLength = STATIC_BEARER_MIN_LENGTH,
): string[] {
  const out: string[] = [];
  for (const raw of accepted) {
    const value = raw?.trim();
    if (value && value.length >= minLength) out.push(value);
  }
  return out;
}

/**
 * Checks the request Bearer against the configured tokens.
 *
 * - no usable configured token → `not_configured` (writes closed, never open);
 * - no Bearer presented → `absent`;
 * - Bearer equal (constant time) to one configured token → `valid`;
 * - otherwise → `invalid`.
 */
export function verifyStaticBearer(
  headers: Headers,
  accepted: readonly (string | null | undefined)[],
  options: VerifyStaticBearerOptions = {},
): StaticBearerResult {
  const tokens = acceptedStaticTokens(accepted, options.minLength ?? STATIC_BEARER_MIN_LENGTH);
  if (tokens.length === 0) return "not_configured";
  const presented = parseBearer(headers, { caseSensitive: options.caseSensitive });
  if (presented === null) return "absent";
  let match = false;
  // Every configured token is compared: the loop never exits early.
  for (const token of tokens) {
    if (timingSafeEqualString(presented, token)) match = true;
  }
  return match ? "valid" : "invalid";
}

/** Name of the admin cookie set by `/admin-access`. */
export const ADMIN_COOKIE = "dbfr_admin";

/** Current TTL of the admin cookie: 7 days. */
export const ADMIN_COOKIE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Minimum length of the HMAC secret (same floor as the Better Auth secret). */
export const ADMIN_COOKIE_MIN_SECRET_LENGTH = 32;

export interface AdminCookieCodec {
  /** `Max-Age` of the cookie, in seconds. */
  readonly maxAgeSeconds: number;
  /** New cookie value expiring `ttlMs` after `nowMs`. Throws when no master token. */
  sign(nowMs?: number): string;
  /** `true` for an unexpired value whose signature matches the current token. */
  verify(value: string | null | undefined, nowMs?: number): boolean;
}

export interface AdminCookieCodecOptions {
  /** HMAC key (the Better Auth secret on the site). */
  secret: string;
  /** Current `SHENRON_ADMIN_TOKEN`; blank disables the codec (verify always false). */
  masterToken: string;
  /** Lifetime in milliseconds. Default {@link ADMIN_COOKIE_TTL_MS}. */
  ttlMs?: number;
}

export function createAdminCookieCodec(options: AdminCookieCodecOptions): AdminCookieCodec {
  // An empty or short HMAC key makes the signature forgeable: refuse it.
  if (typeof options.secret !== "string" || options.secret.trim().length < ADMIN_COOKIE_MIN_SECRET_LENGTH) {
    throw new Error(`Admin cookie codec: secret must be at least ${ADMIN_COOKIE_MIN_SECRET_LENGTH} characters long.`);
  }
  const ttlMs = options.ttlMs ?? ADMIN_COOKIE_TTL_MS;
  const enabled = options.masterToken.length > 0;
  const fingerprint = sha256Hex(options.masterToken).slice(0, 16);
  const signature = (exp: number) => hmacSha256Hex(options.secret, `admin:${exp}:${fingerprint}`);

  return {
    maxAgeSeconds: Math.floor(ttlMs / 1000),
    sign(nowMs = Date.now()) {
      if (!enabled) throw new Error("Admin cookie codec: no master token configured.");
      const exp = nowMs + ttlMs;
      return `${exp}.${signature(exp)}`;
    },
    verify(value, nowMs = Date.now()) {
      if (!value || !enabled) return false;
      const dot = value.indexOf(".");
      if (dot < 1) return false;
      const exp = Number(value.slice(0, dot));
      const sig = value.slice(dot + 1);
      if (!Number.isFinite(exp) || exp < nowMs) return false;
      return timingSafeEqualString(sig, signature(exp));
    },
  };
}
