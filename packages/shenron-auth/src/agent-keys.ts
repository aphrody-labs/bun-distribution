// Source: packages/shenron/auth/src/agent-keys.ts at 8172f535ce (preserved Git history).
/**
 * Agent API keys: format, hashing, scopes and write quota (runtime class `server`).
 *
 * Same format as `apps/shenron/site/src/lib/agent-keys.ts`: `dbfr_agent_` + 32 random
 * bytes in base64url; only the SHA-256 hex of the full token is stored; the
 * display prefix is the first `prefix + 6` characters.
 */
import { randomTokenBase64Url, sha256Hex } from "./crypto";

export const AGENT_TOKEN_PREFIX = "dbfr_agent_";

/** Shortest token worth a database lookup (`prefix + 20`, as the site guard). */
export const AGENT_TOKEN_MIN_LENGTH = AGENT_TOKEN_PREFIX.length + 20;

/** Default writes per hour when a key does not set its own limit. */
export const DEFAULT_AGENT_RATE_LIMIT = 120;

/** SHA-256 hex of the full token (the only form ever stored). */
export function hashAgentToken(token: string): string {
  return sha256Hex(token);
}

/** A fresh token; `token` is the only clear copy that will ever exist. */
export function generateAgentToken(): { token: string; hash: string; displayPrefix: string } {
  const token = `${AGENT_TOKEN_PREFIX}${randomTokenBase64Url(32)}`;
  return {
    token,
    hash: hashAgentToken(token),
    displayPrefix: token.slice(0, AGENT_TOKEN_PREFIX.length + 6),
  };
}

/** `true` when `token` has the agent format and is long enough to be looked up. */
export function looksLikeAgentToken(token: string): boolean {
  return token.startsWith(AGENT_TOKEN_PREFIX) && token.length >= AGENT_TOKEN_MIN_LENGTH;
}

/**
 * Normalises a scope list against the injected vocabulary (`AGENT_SCOPES`).
 * Not an array → `null`; otherwise the known scopes, deduplicated, in order.
 */
export function parseScopes<S extends string>(vocabulary: readonly S[], raw: unknown): S[] | null {
  if (!Array.isArray(raw)) return null;
  const known = new Set<string>(vocabulary);
  const out: S[] = [];
  for (const value of raw) {
    if (typeof value === "string" && known.has(value) && !out.includes(value as S)) {
      out.push(value as S);
    }
  }
  return out;
}

export function hasScope(scopes: readonly string[], needed: string): boolean {
  return scopes.includes(needed);
}

/**
 * Write quota: reads (`GET`, `HEAD`) are never counted nor limited; a write is
 * refused once `writesLastHour >= limit`.
 */
export function decideWriteQuota(input: { method: string; writesLastHour: number; limit: number }): {
  allowed: boolean;
  retryAfterSeconds?: number;
} {
  const method = input.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return { allowed: true };
  if (input.writesLastHour >= input.limit) return { allowed: false, retryAfterSeconds: 3600 };
  return { allowed: true };
}
