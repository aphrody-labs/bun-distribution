// Source: packages/shenron/auth/src/acting-user.ts at 8172f535ce (preserved Git history).
/**
 * `x-acting-*` protocol between the site proxy `/api/bot-user/*` and the bot
 * (runtime class `server`).
 *
 * Signer (site, `app/api/bot-user/[...path]/route.ts`): `ts = String(Date.now())`,
 * `sig = hex(HMAC-SHA256(secret, discordId + ":" + ts))`.
 * Verifier (bot, `api/user-auth.ts`): snowflake `/^\d{17,20}$/`, finite `ts`
 * within ±5 minutes, constant-time compare with the lower-cased signature.
 */
import { hmacSha256Hex, timingSafeEqualString } from "./crypto";

export const ACTING_USER_HEADERS = Object.freeze({
  user: "x-acting-user",
  ts: "x-acting-ts",
  sig: "x-acting-sig",
} as const);

/** Accepted clock skew between signer and verifier: ±5 minutes. */
export const ACTING_USER_SKEW_MS = 5 * 60 * 1000;

const SNOWFLAKE = /^\d{17,20}$/;

export interface SignActingUserOptions {
  secret: string;
  discordId: string;
  nowMs?: number;
}

/** Headers to forward to the bot for `discordId`. */
export function signActingUser(options: SignActingUserOptions): Record<string, string> {
  const ts = String(options.nowMs ?? Date.now());
  const sig = hmacSha256Hex(options.secret, `${options.discordId}:${ts}`);
  return {
    [ACTING_USER_HEADERS.user]: options.discordId,
    [ACTING_USER_HEADERS.ts]: ts,
    [ACTING_USER_HEADERS.sig]: sig,
  };
}

export type ActingUserErrorCode = "not_configured" | "missing" | "bad_id" | "skew" | "bad_sig";

export type ActingUserResult = { ok: true; discordId: string } | { ok: false; code: ActingUserErrorCode };

export interface VerifyActingUserOptions {
  /** Shared secret; blank → `not_configured`. */
  secret: string | null | undefined;
  nowMs?: number;
  skewMs?: number;
}

export function verifyActingUser(headers: Headers, options: VerifyActingUserOptions): ActingUserResult {
  const secret = options.secret;
  if (!secret) return { ok: false, code: "not_configured" };
  const discordId = headers.get(ACTING_USER_HEADERS.user);
  const tsRaw = headers.get(ACTING_USER_HEADERS.ts);
  const sig = headers.get(ACTING_USER_HEADERS.sig);
  if (!discordId || !tsRaw || !sig) return { ok: false, code: "missing" };
  if (!SNOWFLAKE.test(discordId)) return { ok: false, code: "bad_id" };
  const ts = Number(tsRaw);
  const now = options.nowMs ?? Date.now();
  if (!Number.isFinite(ts) || Math.abs(now - ts) > (options.skewMs ?? ACTING_USER_SKEW_MS)) {
    return { ok: false, code: "skew" };
  }
  // Same message as the bot: the timestamp goes through `Number` then back to a string.
  const expected = hmacSha256Hex(secret, `${discordId}:${ts}`);
  if (!timingSafeEqualString(expected, sig.toLowerCase())) return { ok: false, code: "bad_sig" };
  return { ok: true, discordId };
}

/**
 * Shared test vector: produced by the site signer and accepted by the bot
 * verifier at `nowMs = Number(ts)`. Never a production secret.
 */
export const ACTING_USER_TEST_VECTOR = Object.freeze({
  secret: "shenron-acting-user-test-vector-secret",
  discordId: "123456789012345678",
  ts: "1767225600000",
  sig: "b20f28b31e976481054b059cb61f1a00f660192f726354e963a7d6eb47228cc6",
} as const);
