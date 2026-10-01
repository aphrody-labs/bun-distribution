import { describe, expect, test } from "bun:test";

import {
  ACHILLEA_AUTH_ISSUER,
  ACHILLEA_SESSION_AUDIENCE,
  ACHILLEA_REALTIME_AUDIENCE,
  verifyAchilleaRealtimeToken,
  verifyAchilleaSessionToken,
} from "@rosegriffon/achillea-core/auth";

const secret = "test-session-secret";

function base64url(value: string | ArrayBuffer): string {
  const bytes = typeof value === "string" ? new TextEncoder().encode(value) : new Uint8Array(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

async function token(exp = 2_000, tokenUse = "session", overrides: Record<string, unknown> = {}) {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload = base64url(
    JSON.stringify({
      id: "user-1",
      sub: "user-1",
      tokenUse,
      iss: ACHILLEA_AUTH_ISSUER,
      aud: tokenUse === "realtime" ? ACHILLEA_REALTIME_AUDIENCE : ACHILLEA_SESSION_AUDIENCE,
      ACHILLEA_REALTIME_AUDIENCE,
      verifyAchilleaRealtimeToken,
      exp,
      ...overrides,
    }),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(`${header}.${payload}`),
  );
  return `${header}.${payload}.${base64url(signature)}`;
}

describe("purpose-bound Achillea session verifier", () => {
  test("accepts a valid signed session", async () => {
    const result = await verifyAchilleaSessionToken(await token(), secret, 1_000);
    expect(result).toMatchObject({ id: "user-1", expiresAt: 2_000 });
  });

  test("rejects tampering, expiry and missing purpose claims", async () => {
    const valid = await token();
    expect(await verifyAchilleaSessionToken(`${valid.slice(0, -1)}x`, secret, 1_000)).toBeNull();
    expect(await verifyAchilleaSessionToken(await token(999), secret, 1_000)).toBeNull();
    const legacy = await token(2_000, "legacy");
    expect(await verifyAchilleaSessionToken(legacy, secret, 1_000)).toBeNull();
  });
});

describe("purpose-bound realtime verification", () => {
  test("accepts realtime tokens and rejects cross-purpose use", async () => {
    const realtime = await token(2_000, "realtime");
    const session = await token();
    expect(await verifyAchilleaRealtimeToken(realtime, secret, 1_000)).toMatchObject({
      id: "user-1",
      expiresAt: 2_000,
    });
    expect(await verifyAchilleaRealtimeToken(session, secret, 1_000)).toBeNull();
    expect(await verifyAchilleaSessionToken(realtime, secret, 1_000)).toBeNull();
  });

  test.each([
    { iss: "another-issuer" },
    { aud: ACHILLEA_SESSION_AUDIENCE },
    { id: "another-user" },
    { sub: null },
    { exp: "2000" },
    { exp: null },
  ])("rejects invalid realtime claims %j", async (claims) => {
    expect(
      await verifyAchilleaRealtimeToken(await token(2_000, "realtime", claims), secret, 1_000),
    ).toBeNull();
  });

  test("requires valid signature, secret and unexpired token", async () => {
    const valid = await token(2_000, "realtime");
    expect(await verifyAchilleaRealtimeToken(valid, "wrong-secret", 1_000)).toBeNull();
    expect(await verifyAchilleaRealtimeToken(valid, "", 1_000)).toBeNull();
    expect(await verifyAchilleaRealtimeToken(valid, secret, 2_000)).toBeNull();
    const invalidResults = await Promise.all(
      ["", "a.b", "a.b.c", `${valid}.extra`].map((malformed) =>
        verifyAchilleaRealtimeToken(malformed, secret, 1_000),
      ),
    );
    expect(invalidResults).toEqual([null, null, null, null]);
  });
});
