import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { signAchilleaRealtimeToken, signAchilleaSessionToken } from "@rosegriffon/auth/achillea-session";
import { authFromAuthorization, authFromColyseus, authFromCookieHeader, getCookie, verifyToken } from "./auth";

const secret = "ranked-auth-fixture-secret";
const identity = { id: "42", username: "Fixture player" };
let previousSecret: string | undefined;

beforeEach(() => {
  previousSecret = process.env.JWT_SECRET_KEY;
  process.env.JWT_SECRET_KEY = secret;
});
afterEach(() => {
  if (previousSecret === undefined) delete process.env.JWT_SECRET_KEY;
  else process.env.JWT_SECRET_KEY = previousSecret;
});

function credentials() {
  return {
    session: signAchilleaSessionToken(identity, secret),
    realtime: signAchilleaRealtimeToken(identity, secret),
  };
}

describe("ranked transport adapters consume the shared auth contract", () => {
  test("accepts the server-signed session cookie and realtime bearer", async () => {
    const { session, realtime } = credentials();
    expect(await authFromCookieHeader(`theme=dark; token=${session}`)).toMatchObject(identity);
    expect(await authFromAuthorization(`bEaReR ${realtime}`)).toMatchObject(identity);
    expect(await verifyToken(realtime)).toMatchObject(identity);
  });

  test("never substitutes one token purpose for the other", async () => {
    const { session, realtime } = credentials();
    expect(await authFromCookieHeader(`token=${realtime}`)).toBeNull();
    expect(await authFromAuthorization(`Bearer ${session}`)).toBeNull();
    await expect(verifyToken(session)).rejects.toThrow("Invalid realtime token");
  });

  test("parses encoded cookies without confusing prefix names", () => {
    expect(getCookie("other_token=wrong; token=a%2Eb", "token")).toBe("a.b");
    expect(getCookie("other_token=wrong", "token")).toBeNull();
    expect(getCookie(null, "token")).toBeNull();
  });

  test("accepts Web Headers and plain transport headers", async () => {
    const { session, realtime } = credentials();
    expect(await authFromColyseus({}, { headers: new Headers({ cookie: `token=${session}` }) })).toMatchObject(
      identity,
    );
    expect(await authFromColyseus({}, { headers: { Authorization: `Bearer ${realtime}` } })).toMatchObject(identity);
  });

  test("preserves context, cookie, authorization and options precedence", async () => {
    const { session, realtime } = credentials();
    const contextToken = signAchilleaRealtimeToken({ id: "context-user" }, secret);
    expect(
      await authFromColyseus({ token: realtime }, { token: contextToken, headers: { cookie: `token=${session}` } }),
    ).toMatchObject({ id: "context-user" });
    expect(
      await authFromColyseus({ token: contextToken }, { token: "invalid", headers: { cookie: `token=${session}` } }),
    ).toMatchObject(identity);
    expect(
      await authFromColyseus(
        { token: realtime },
        { token: "invalid", headers: { cookie: "token=invalid", authorization: "Bearer invalid" } },
      ),
    ).toMatchObject(identity);
  });

  test("rejects expired credentials and malformed transports", async () => {
    const expired = signAchilleaRealtimeToken(identity, secret, 1);
    expect(await authFromAuthorization(`Bearer ${expired}`)).toBeNull();
    expect(await authFromAuthorization("Basic ignored")).toBeNull();
    expect(await authFromCookieHeader("token=invalid")).toBeNull();
    expect(await authFromColyseus(null, null)).toBeNull();
    expect(await authFromColyseus({ token: "invalid" }, { token: 42, headers: "invalid" })).toBeNull();
  });

  test("fails closed when the private signing secret is not configured", async () => {
    const { session, realtime } = credentials();
    delete process.env.JWT_SECRET_KEY;
    expect(await authFromCookieHeader(`token=${session}`)).toBeNull();
    expect(await authFromAuthorization(`Bearer ${realtime}`)).toBeNull();
    expect(await authFromColyseus({ token: realtime }, {})).toBeNull();
  });
});
