// Source: packages/shenron/auth/test/tokens.test.ts at 8172f535ce (preserved Git history).
import { describe, expect, test } from "bun:test";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { ADMIN_COOKIE, ADMIN_COOKIE_TTL_MS, createAdminCookieCodec, verifyStaticBearer } from "../src/tokens";

/**
 * Golden inputs. The expected cookie was generated once by running the
 * algorithm of `apps/shenron/site/src/lib/admin-token.ts` (copied below verbatim,
 * with `env`/`Date.now()` replaced by these fixed inputs).
 */
const SECRET = "golden-better-auth-secret-0123456789abcdef";
const TOKEN = "golden-admin-token-0123456789";
const NOW = 1767225600000;
const GOLDEN_COOKIE = "1767830400000.eb90ac9376e1c948167c1f62dcd30f4b21c8c45d6eb3a4008b84e0484441f44e";

// ── Inline copy of the current site algorithm (admin-token.ts) ──────────────
const SITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function siteFingerprint(token: string): string {
  return createHash("sha256").update(token).digest("hex").slice(0, 16);
}
function siteSign(secret: string, token: string, expiry: number): string {
  return createHmac("sha256", secret)
    .update(`admin:${expiry}:${siteFingerprint(token)}`)
    .digest("hex");
}
function siteBuild(secret: string, token: string, now: number): string {
  const exp = now + SITE_TTL_MS;
  return `${exp}.${siteSign(secret, token, exp)}`;
}
function siteVerify(secret: string, token: string, value: string, now: number): boolean {
  if (!value || !token) return false;
  const dot = value.indexOf(".");
  if (dot < 1) return false;
  const exp = Number(value.slice(0, dot));
  const sig = value.slice(dot + 1);
  if (!Number.isFinite(exp) || exp < now) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(siteSign(secret, token, exp));
  return a.length === b.length && timingSafeEqual(a, b);
}

// ── Inline copy of the current site Bearer check (api-token.ts) ─────────────
function siteHasValidApiToken(req: Request, configured: string | undefined): boolean {
  const attendu = (configured ?? "").trim();
  if (attendu.length < 16) return false;
  const m = /^Bearer\s+(.+)$/i.exec((req.headers.get("authorization") ?? "").trim());
  if (!m) return false;
  const a = Buffer.from(m[1]!.trim());
  const b = Buffer.from(attendu);
  return a.length === b.length && timingSafeEqual(a, b);
}

describe("admin cookie codec", () => {
  const codec = createAdminCookieCodec({ secret: SECRET, masterToken: TOKEN });

  test("name, TTL and max-age are unchanged", () => {
    expect(ADMIN_COOKIE).toBe("dbfr_admin");
    expect(ADMIN_COOKIE_TTL_MS).toBe(SITE_TTL_MS);
    expect(codec.maxAgeSeconds).toBe(604800);
  });

  test("golden vector: the site algorithm and the codec agree byte for byte", () => {
    expect(siteBuild(SECRET, TOKEN, NOW)).toBe(GOLDEN_COOKIE);
    expect(codec.sign(NOW)).toBe(GOLDEN_COOKIE);
  });

  test("cross-verification both ways", () => {
    expect(codec.verify(GOLDEN_COOKIE, NOW)).toBe(true);
    expect(siteVerify(SECRET, TOKEN, codec.sign(NOW + 1234), NOW)).toBe(true);
    expect(codec.verify(siteBuild(SECRET, TOKEN, NOW + 99), NOW)).toBe(true);
  });

  test("rejects tampered, expired, rotated-token and malformed values", () => {
    const exp = GOLDEN_COOKIE.slice(0, GOLDEN_COOKIE.indexOf("."));
    const sig = GOLDEN_COOKIE.slice(GOLDEN_COOKIE.indexOf(".") + 1);
    const flipped = `${exp}.${sig.slice(0, -1)}${sig.endsWith("0") ? "1" : "0"}`;
    expect(codec.verify(flipped, NOW)).toBe(false);
    expect(codec.verify(`${Number(exp) + 1}.${sig}`, NOW)).toBe(false);
    expect(codec.verify(GOLDEN_COOKIE, Number(exp) + 1)).toBe(false);
    expect(codec.verify(GOLDEN_COOKIE, Number(exp))).toBe(true);
    const rotated = createAdminCookieCodec({ secret: SECRET, masterToken: `${TOKEN}-rotated` });
    expect(rotated.verify(GOLDEN_COOKIE, NOW)).toBe(false);
    for (const bad of ["", null, undefined, ".abc", "abc", "x.y", `${exp}.`]) {
      expect(codec.verify(bad, NOW)).toBe(false);
    }
  });

  test("refuses an empty or short HMAC secret", () => {
    for (const secret of ["", "   ", "s".repeat(31), ` ${"s".repeat(30)} `]) {
      expect(() => createAdminCookieCodec({ secret, masterToken: TOKEN })).toThrow(/at least 32/);
    }
    expect(() => createAdminCookieCodec({ secret: "s".repeat(32), masterToken: TOKEN })).not.toThrow();
  });

  test("disabled without a master token", () => {
    const off = createAdminCookieCodec({ secret: SECRET, masterToken: "" });
    expect(off.verify(GOLDEN_COOKIE, NOW)).toBe(false);
    expect(() => off.sign(NOW)).toThrow();
  });
});

describe("verifyStaticBearer", () => {
  const good = "a-static-token-0123456789";
  const req = (auth?: string) =>
    new Request("http://x/", auth === undefined ? {} : { headers: { authorization: auth } });

  test("results", () => {
    expect(verifyStaticBearer(req(`Bearer ${good}`).headers, [undefined, "  ", "short"])).toBe("not_configured");
    expect(verifyStaticBearer(req().headers, [good])).toBe("absent");
    expect(verifyStaticBearer(req(`bearer ${good}`).headers, [null, good])).toBe("valid");
    expect(verifyStaticBearer(req(`Bearer ${good}x`).headers, [good])).toBe("invalid");
    expect(verifyStaticBearer(req(`bearer ${good}`).headers, [good], { caseSensitive: true })).toBe("absent");
    expect(verifyStaticBearer(req("Bearer abc").headers, ["abc"], { minLength: 1 })).toBe("valid");
  });

  test("agrees with the current site api-token check", () => {
    const cases = [`Bearer ${good}`, `bearer   ${good}  `, `Bearer ${good}!`, "Basic abc", "", `Bearer`];
    for (const auth of cases) {
      for (const configured of [good, ` ${good} `, "tooshort", undefined]) {
        const expected = siteHasValidApiToken(req(auth), configured);
        expect(verifyStaticBearer(req(auth).headers, [configured]) === "valid").toBe(expected);
      }
    }
  });
});
