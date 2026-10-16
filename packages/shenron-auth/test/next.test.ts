// Source: packages/shenron/auth/test/next.test.ts at 8172f535ce (preserved Git history).
import { describe, expect, mock, test } from "bun:test";

let incoming = new Headers();

mock.module("next/headers", () => ({
  headers: async () => incoming,
}));

const { authorizeNext, currentRequest, requestHeaders } = await import("../src/next");
const { staticBearerStrategy } = await import("../src/guards");

const TOKEN = "next-admin-token-0123456789";
const strategies = [
  staticBearerStrategy({
    tokens: () => [TOKEN],
    as: { kind: "admin-token", via: "bearer" },
    wrongBearerIsFinal: false,
    unsetIs503: false,
  }),
];

describe("next adapter", () => {
  test("requestHeaders copies the scope headers", async () => {
    incoming = new Headers({ "x-test": "1" });
    const h = await requestHeaders();
    expect(h.get("x-test")).toBe("1");
    h.set("x-test", "2");
    expect(incoming.get("x-test")).toBe("1");
  });

  test("currentRequest builds the URL from forwarded headers or the given url", async () => {
    incoming = new Headers({
      "x-forwarded-host": "dragonballfr.com",
      "x-forwarded-proto": "https",
    });
    expect((await currentRequest()).url).toBe("https://dragonballfr.com/");
    expect((await currentRequest("https://x.test/a")).url).toBe("https://x.test/a");
    incoming = new Headers();
    expect((await currentRequest()).url).toBe("http://localhost/");
  });

  test("authorizeNext", async () => {
    incoming = new Headers({ host: "localhost:5011", authorization: `Bearer ${TOKEN}` });
    expect(await authorizeNext(strategies)).toEqual({
      ok: true,
      principal: { kind: "admin-token", via: "bearer" },
    });
    incoming = new Headers({ host: "localhost:5011" });
    expect(await authorizeNext(strategies)).toEqual({
      ok: false,
      status: 401,
      code: "unauthenticated",
    });
  });
});
