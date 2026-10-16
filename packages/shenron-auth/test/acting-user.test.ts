// Source: packages/shenron/auth/test/acting-user.test.ts at 8172f535ce (preserved Git history).
import { describe, expect, test } from "bun:test";
import { createHmac } from "node:crypto";
import {
  ACTING_USER_HEADERS,
  ACTING_USER_TEST_VECTOR as V,
  signActingUser,
  verifyActingUser,
} from "../src/acting-user";

// ── Inline copy of the current site signer (app/api/bot-user/[...path]/route.ts) ──
function siteSignActing(secret: string, discordId: string, now: number) {
  const ts = String(now);
  const sig = createHmac("sha256", secret).update(`${discordId}:${ts}`).digest("hex");
  return { ts, sig };
}

// ── Inline copy of the current bot verifier (apps/shenron/bot/src/api/user-auth.ts) ──
const SKEW_MS = 5 * 60 * 1000;
function botHmacHex(secret: string, msg: string): string {
  const hasher = new Bun.CryptoHasher("sha256", secret);
  hasher.update(msg);
  return hasher.digest("hex");
}
function botConstantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function botVerify(secret: string, req: Request, now: number): string | null {
  if (!secret) return null;
  const userId = req.headers.get("x-acting-user");
  const tsRaw = req.headers.get("x-acting-ts");
  const sig = req.headers.get("x-acting-sig");
  if (!userId || !tsRaw || !sig) return null;
  if (!/^\d{17,20}$/.test(userId)) return null;
  const ts = Number(tsRaw);
  if (!Number.isFinite(ts)) return null;
  if (Math.abs(now - ts) > SKEW_MS) return null;
  const expected = botHmacHex(secret, `${userId}:${ts}`);
  if (!botConstantTimeEqual(expected, sig.toLowerCase())) return null;
  return userId;
}

const NOW = Number(V.ts);
const vectorHeaders = () =>
  new Headers({
    [ACTING_USER_HEADERS.user]: V.discordId,
    [ACTING_USER_HEADERS.ts]: V.ts,
    [ACTING_USER_HEADERS.sig]: V.sig,
  });

describe("acting-user protocol", () => {
  test("header names", () => {
    expect(ACTING_USER_HEADERS).toEqual({
      user: "x-acting-user",
      ts: "x-acting-ts",
      sig: "x-acting-sig",
    });
  });

  test("the vector is what the current site signer produces", () => {
    expect(siteSignActing(V.secret, V.discordId, NOW)).toEqual({ ts: V.ts, sig: V.sig });
    expect(signActingUser({ secret: V.secret, discordId: V.discordId, nowMs: NOW })).toEqual(
      Object.fromEntries(vectorHeaders()),
    );
  });

  test("the vector round-trips and the current bot verifier accepts it", () => {
    expect(verifyActingUser(vectorHeaders(), { secret: V.secret, nowMs: NOW })).toEqual({
      ok: true,
      discordId: V.discordId,
    });
    const req = new Request("http://bot/api/me", { headers: vectorHeaders() });
    expect(botVerify(V.secret, req, NOW)).toBe(V.discordId);
    const upper = vectorHeaders();
    upper.set(ACTING_USER_HEADERS.sig, V.sig.toUpperCase());
    expect(verifyActingUser(upper, { secret: V.secret, nowMs: NOW }).ok).toBe(true);
  });

  test("skew is ±5 minutes inclusive", () => {
    const ok = (now: number) => verifyActingUser(vectorHeaders(), { secret: V.secret, nowMs: now });
    expect(ok(NOW + SKEW_MS).ok).toBe(true);
    expect(ok(NOW - SKEW_MS).ok).toBe(true);
    expect(ok(NOW + SKEW_MS + 1)).toEqual({ ok: false, code: "skew" });
    expect(ok(NOW - SKEW_MS - 1)).toEqual({ ok: false, code: "skew" });
    const req = new Request("http://bot/", { headers: vectorHeaders() });
    expect(botVerify(V.secret, req, NOW + SKEW_MS + 1)).toBeNull();
  });

  test("failure codes", () => {
    const verify = (headers: Headers, secret: string | null = V.secret) =>
      verifyActingUser(headers, { secret, nowMs: NOW });
    expect(verify(vectorHeaders(), null)).toEqual({ ok: false, code: "not_configured" });
    expect(verify(vectorHeaders(), "")).toEqual({ ok: false, code: "not_configured" });
    const missing = vectorHeaders();
    missing.delete(ACTING_USER_HEADERS.sig);
    expect(verify(missing)).toEqual({ ok: false, code: "missing" });
    for (const badId of ["1234", "12345678901234567a", "123456789012345678901"]) {
      const headers = vectorHeaders();
      headers.set(ACTING_USER_HEADERS.user, badId);
      expect(verify(headers)).toEqual({ ok: false, code: "bad_id" });
      expect(botVerify(V.secret, new Request("http://b/", { headers }), NOW)).toBeNull();
    }
    const nan = vectorHeaders();
    nan.set(ACTING_USER_HEADERS.ts, "soon");
    expect(verify(nan)).toEqual({ ok: false, code: "skew" });
    expect(verify(vectorHeaders(), "another-secret")).toEqual({ ok: false, code: "bad_sig" });
    const otherUser = vectorHeaders();
    otherUser.set(ACTING_USER_HEADERS.user, "876543210987654321");
    expect(verify(otherUser)).toEqual({ ok: false, code: "bad_sig" });
  });
});
