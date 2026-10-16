// Source: packages/shenron/auth/src/index.test.ts at 8172f535ce (preserved Git history).
import { describe, expect, test } from "bun:test";
import { getSessionSafe, handleAuthRequest, normalizeBaseUrl, resolveBetterAuthSecret, type AuthLike } from "./index";

const fakeAuth: AuthLike = {
  handler: async () => new Response("ok"),
  api: {
    getSession: async () => {
      throw new Error("db down");
    },
  },
};

describe("@shenron/auth", () => {
  test("normalizeBaseUrl strips whitespace and slashes", () => {
    expect(normalizeBaseUrl(" https://x.fr//\n")).toBe("https://x.fr");
    expect(normalizeBaseUrl(undefined)).toBe("https://dragonballfr.com");
  });
  test("secret resolution fails closed in production", () => {
    expect(() => resolveBetterAuthSecret({ NODE_ENV: "production" })).toThrow();
    expect(() => resolveBetterAuthSecret({ BETTER_AUTH_SECRET: "short" })).toThrow();
    expect(resolveBetterAuthSecret({ SESSION_SECRET: "s".repeat(32) }).origin).toBe("env");
    expect(resolveBetterAuthSecret({}, () => "r").secret).toBe("r");
  });
  test("handleAuthRequest only matches the base path", async () => {
    expect(await handleAuthRequest(fakeAuth, new Request("http://h/api/other"))).toBeNull();
    expect(await handleAuthRequest(fakeAuth, new Request("http://h/api/authx"))).toBeNull();
    const res = await handleAuthRequest(fakeAuth, new Request("http://h/api/auth/get-session"));
    expect(await res?.text()).toBe("ok");
  });
  test("getSessionSafe swallows errors", async () => {
    expect(await getSessionSafe(fakeAuth, new Headers())).toBeNull();
  });
});
