// Source: packages/shenron/auth/test/hono.test.ts at 8172f535ce (preserved Git history).
import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { requireScope, staticBearerStrategy, type Strategy } from "../src/guards";
import { authMiddleware, type AuthVariables, mountBetterAuth } from "../src/hono";

const TOKEN = "hono-admin-token-0123456789";
const SERVICE_TOKEN = "hono-service-token-0123456789";

const strategies: Strategy[] = [
  staticBearerStrategy({
    tokens: () => [TOKEN],
    as: { kind: "admin-token", via: "bearer" },
    wrongBearerIsFinal: false,
    unsetIs503: false,
  }),
  staticBearerStrategy({
    tokens: () => [SERVICE_TOKEN],
    as: { kind: "agent", keyId: "svc", scopes: ["read"] },
    wrongBearerIsFinal: true,
    unsetIs503: false,
  }),
];

function app() {
  const a = new Hono<{ Variables: AuthVariables }>();
  a.use("/admin/*", authMiddleware(strategies));
  a.get("/admin/me", c => c.json(c.get("principal")));
  a.use("/write/*", authMiddleware(strategies, { require: d => requireScope(d, "moderate") }));
  a.post("/write/x", c => c.text("done"));
  a.use(
    "/custom/*",
    authMiddleware(strategies, {
      deny: d => new Response(`nope:${d.code}`, { status: d.status }),
    }),
  );
  a.get("/custom/x", c => c.text("ok"));
  return a;
}

describe("hono adapter", () => {
  test("401 without credentials", async () => {
    const res = await app().request("/admin/me");
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthenticated" });
  });

  test("200 with the principal in c.var", async () => {
    const res = await app().request("/admin/me", { headers: { authorization: `Bearer ${TOKEN}` } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ kind: "admin-token", via: "bearer" });
  });

  test("403 when the required scope is missing", async () => {
    const res = await app().request("/write/x", {
      method: "POST",
      headers: { authorization: `Bearer ${SERVICE_TOKEN}` },
    });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "scope_missing" });
    const admin = await app().request("/write/x", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    expect(admin.status).toBe(200);
  });

  test("custom deny", async () => {
    const res = await app().request("/custom/x", {
      headers: { authorization: "Bearer wrong-but-long-enough" },
    });
    expect(res.status).toBe(401);
    expect(await res.text()).toBe("nope:invalid_token");
  });

  test("mountBetterAuth routes GET and POST under the base path to auth.handler", async () => {
    const seen: string[] = [];
    const a = new Hono();
    mountBetterAuth(a, {
      handler: async r => {
        seen.push(`${r.method} ${new URL(r.url).pathname}`);
        return new Response("auth");
      },
      api: { getSession: async () => null },
    });
    expect(await (await a.request("/api/auth/get-session")).text()).toBe("auth");
    expect((await a.request("/api/auth/sign-in/social", { method: "POST" })).status).toBe(200);
    expect((await a.request("/api/other")).status).toBe(404);
    expect((await a.request("/api/auth/x", { method: "DELETE" })).status).toBe(404);
    expect(seen).toEqual(["GET /api/auth/get-session", "POST /api/auth/sign-in/social"]);
  });
});
