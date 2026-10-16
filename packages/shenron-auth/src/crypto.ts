// Source: packages/shenron/auth/src/crypto.ts at 8172f535ce (preserved Git history).
/**
 * Synchronous crypto primitives shared by every guard (runtime class `server`).
 *
 * Replaces the hand-rolled constant-time comparisons and Bearer parsers of the
 * site (`admin-token.ts`, `api-token.ts`, `agent-keys.ts`) and the bot
 * (`api/auth.ts`, `api/user-auth.ts`). `node:crypto` only: no `Bun.*` global.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Constant-time string equality. Both sides are SHA-256 hashed first, so the
 * comparison never short-circuits on length and never leaks a prefix.
 */
export function timingSafeEqualString(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  // The hash comparison is constant time; the final equality check guards the
  // (astronomically unlikely) collision case without adding a timing channel.
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export interface ParseBearerOptions {
  /**
   * `true` reproduces the bot exactly: the header must start with the literal
   * `Bearer ` (capital B, one space) and the rest is trimmed — possibly to an
   * empty string, which still counts as a presented (wrong) credential.
   * Default `false`: scheme case-insensitive, any blank run, empty → `null`.
   */
  caseSensitive?: boolean;
}

/** Bearer credential of `headers`, or `null` when no Bearer is presented. */
export function parseBearer(headers: Headers, options: ParseBearerOptions = {}): string | null {
  const header = headers.get("authorization");
  if (header === null) return null;
  if (options.caseSensitive) {
    return header.startsWith("Bearer ") ? header.slice(7).trim() : null;
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  const value = match?.[1]?.trim();
  return value ? value : null;
}

/** Lower-case hex SHA-256 of a UTF-8 string. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Lower-case hex HMAC-SHA-256 of a UTF-8 message. */
export function hmacSha256Hex(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message, "utf8").digest("hex");
}

/** `bytes` random bytes (default 32) encoded as base64url without padding. */
export function randomTokenBase64Url(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}
