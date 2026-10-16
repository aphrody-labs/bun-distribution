// Source: packages/shenron/auth/test/guards.test.ts at 8172f535ce (preserved Git history).
import { describe, expect, test } from "bun:test";
import { ACTING_USER_TEST_VECTOR as V, signActingUser } from "../src/acting-user";
import { generateAgentToken } from "../src/agent-keys";
import {
  actingUserStrategy,
  adminCookieStrategy,
  agentKeyStrategy,
  assertSameOrigin,
  authorize,
  legacySessionStrategy,
  readCookie,
  requireScope,
  sessionStrategy,
  staticBearerStrategy,
  type Strategy,
} from "../src/guards";
import type { AgentKeyRecord, AgentKeyStore } from "../src/ports";
import { createStaffPolicy } from "../src/staff";
import { createAdminCookieCodec } from "../src/tokens";

const STAFF_ID = "200000000000000001";
const OTHER_ID = "200000000000000002";
const ADMIN_TOKEN = "bot-admin-token-0123456789";
const staff = createStaffPolicy({ ownerIds: [STAFF_ID] });

interface World {
  adminToken?: string;
  baUser?: string;
  discordOf?: Record<string, string>;
  legacy?: { source: "token" | "discord"; userId?: string };
}

/** The bot `checkAdmin` expressed as strategies (docs/STACK.md §3.3). */
function botAdmin(world: World): Strategy[] {
  return [
    staticBearerStrategy({
      tokens: () => [world.adminToken],
      as: { kind: "admin-token", via: "bearer" },
      wrongBearerIsFinal: true,
      unsetIs503: true,
      caseSensitive: true,
    }),
    sessionStrategy({
      getSession: async () => (world.baUser ? { user: { id: world.baUser } } : null),
      accounts: { discordIdForUser: async id => world.discordOf?.[id] ?? null },
      staff,
      requireStaff: true,
    }),
    legacySessionStrategy({ verify: async () => world.legacy ?? null, staff }),
  ];
}

const req = (headers: Record<string, string> = {}) => new Request("https://api.example.test/api/admin", { headers });

describe("bot checkAdmin table", () => {
  const configured: World = { adminToken: ADMIN_TOKEN };

  test("unset token → 503 even with a staff session", async () => {
    const d = await authorize(req(), botAdmin({ baUser: "u", discordOf: { u: STAFF_ID } }));
    expect(d).toEqual({ ok: false, status: 503, code: "not_configured" });
  });

  test("right Bearer → admin-token", async () => {
    const d = await authorize(req({ authorization: `Bearer ${ADMIN_TOKEN}` }), botAdmin(configured));
    expect(d).toEqual({ ok: true, principal: { kind: "admin-token", via: "bearer" } });
  });

  test("wrong exact-case Bearer → 401 final even with a valid staff session", async () => {
    const world = { ...configured, baUser: "u", discordOf: { u: STAFF_ID } };
    const d = await authorize(req({ authorization: "Bearer wrong" }), botAdmin(world));
    expect(d).toEqual({ ok: false, status: 401, code: "invalid_token" });
    // "Bearer " is normalised to "Bearer" by Headers: no prefix, the session decides (bot identical).
    const empty = await authorize(req({ authorization: "Bearer " }), botAdmin(world));
    expect(empty.ok).toBe(true);
  });

  test("lower-case scheme is not a Bearer for the bot: falls through to the session", async () => {
    const world = { ...configured, baUser: "u", discordOf: { u: STAFF_ID } };
    const d = await authorize(req({ authorization: `bearer ${ADMIN_TOKEN}` }), botAdmin(world));
    expect(d.ok && d.principal.kind).toBe("user");
  });

  test("staff Better Auth session → ok", async () => {
    const d = await authorize(req(), botAdmin({ ...configured, baUser: "u", discordOf: { u: STAFF_ID } }));
    expect(d).toEqual({
      ok: true,
      principal: {
        kind: "user",
        userId: "u",
        discordId: STAFF_ID,
        staff: true,
        via: "better-auth",
      },
    });
  });

  test("non-staff Better Auth session → 403, no Discord account → 403", async () => {
    const other = await authorize(req(), botAdmin({ ...configured, baUser: "u", discordOf: { u: OTHER_ID } }));
    expect(other).toEqual({ ok: false, status: 403, code: "forbidden" });
    const none = await authorize(req(), botAdmin({ ...configured, baUser: "u" }));
    expect(none).toEqual({ ok: false, status: 403, code: "forbidden" });
  });

  test("account lookup failure fails closed (403)", async () => {
    const strategies: Strategy[] = [
      sessionStrategy({
        getSession: async () => ({ user: { id: "u" } }),
        accounts: {
          discordIdForUser: async () => {
            throw new Error("db down");
          },
        },
        staff,
        requireStaff: true,
      }),
    ];
    expect(await authorize(req(), strategies)).toEqual({
      ok: false,
      status: 403,
      code: "forbidden",
    });
  });

  test("legacy token session → ok", async () => {
    const d = await authorize(req(), botAdmin({ ...configured, legacy: { source: "token" } }));
    expect(d).toEqual({ ok: true, principal: { kind: "admin-token", via: "legacy-session" } });
  });

  test("legacy discord session: staff → ok, non-staff → 403", async () => {
    const ok = await authorize(req(), botAdmin({ ...configured, legacy: { source: "discord", userId: STAFF_ID } }));
    expect(ok.ok).toBe(true);
    const ko = await authorize(req(), botAdmin({ ...configured, legacy: { source: "discord", userId: OTHER_ID } }));
    expect(ko).toEqual({ ok: false, status: 403, code: "forbidden" });
    const anon = await authorize(req(), botAdmin({ ...configured, legacy: { source: "discord" } }));
    expect(anon).toEqual({ ok: false, status: 403, code: "forbidden" });
  });

  test("nothing → 401", async () => {
    expect(await authorize(req(), botAdmin(configured))).toEqual({
      ok: false,
      status: 401,
      code: "unauthenticated",
    });
  });
});

describe("other strategies", () => {
  test("site-style static bearer falls through when wrong or unset", async () => {
    const s = staticBearerStrategy({
      tokens: () => [ADMIN_TOKEN],
      as: { kind: "service", name: "ingest" },
      wrongBearerIsFinal: false,
      unsetIs503: false,
    });
    expect(await s(req({ authorization: "bearer nope" }))).toBeNull();
    expect(await s(req({ authorization: `bearer ${ADMIN_TOKEN}` }))).toEqual({
      ok: true,
      principal: { kind: "service", name: "ingest" },
    });
    const unset = staticBearerStrategy({
      tokens: () => [undefined],
      as: { kind: "service", name: "x" },
      wrongBearerIsFinal: false,
      unsetIs503: false,
    });
    expect(await unset(req({ authorization: `Bearer ${ADMIN_TOKEN}` }))).toBeNull();
  });

  test("admin cookie", async () => {
    const now = 1767225600000;
    const codec = createAdminCookieCodec({ secret: "s".repeat(32), masterToken: ADMIN_TOKEN });
    const s = adminCookieStrategy({ codec: () => codec, now: () => now });
    const value = codec.sign(now);
    expect(readCookie(new Headers({ cookie: `a=1; dbfr_admin=${value}` }), "dbfr_admin")).toBe(value);
    expect(await s(req({ cookie: `a=1; dbfr_admin=${value}` }))).toEqual({
      ok: true,
      principal: { kind: "admin-token", via: "admin-cookie" },
    });
    expect(await s(req({ cookie: "dbfr_admin=1.bad" }))).toBeNull();
    expect(await s(req())).toBeNull();
    expect(await adminCookieStrategy({ codec: () => null })(req({ cookie: `dbfr_admin=${value}` }))).toBeNull();
  });

  test("session without requireStaff returns the user with its staff flag", async () => {
    const s = sessionStrategy({
      getSession: async () => ({ user: { id: "u" } }),
      accounts: { discordIdForUser: async () => OTHER_ID },
      staff,
      requireStaff: false,
    });
    expect(await s(req())).toEqual({
      ok: true,
      principal: {
        kind: "user",
        userId: "u",
        discordId: OTHER_ID,
        staff: false,
        via: "better-auth",
      },
    });
    const throwing = sessionStrategy({
      getSession: async () => {
        throw new Error("expired");
      },
      accounts: { discordIdForUser: async () => null },
      staff,
      requireStaff: true,
    });
    expect(await throwing(req())).toBeNull();
  });

  test("acting user", async () => {
    const now = Number(V.ts);
    const s = actingUserStrategy({ secret: () => V.secret, now: () => now });
    const headers = signActingUser({ secret: V.secret, discordId: V.discordId, nowMs: now });
    expect(await s(req(headers))).toEqual({
      ok: true,
      principal: { kind: "acting-user", discordId: V.discordId },
    });
    expect(await s(req())).toBeNull();
    expect(await actingUserStrategy({ secret: () => undefined })(req(headers))).toBeNull();
    expect(await s(req({ ...headers, "x-acting-sig": "00" }))).toEqual({
      ok: false,
      status: 401,
      code: "invalid_token",
    });
  });

  test("agent keys, scopes and touch", async () => {
    const { token, hash } = generateAgentToken();
    const touched: string[] = [];
    const record: AgentKeyRecord = {
      id: "k1",
      name: "ingest",
      scopes: ["read"],
      revokedAt: null,
      rateLimit: 120,
    };
    const store: AgentKeyStore = {
      findActiveByHash: async h => (h === hash ? record : null),
      touch: async id => {
        touched.push(id);
      },
      countWritesSince: async () => 0,
      recordCall: async () => {},
    };
    const s = agentKeyStrategy({ store });
    const d = await s(req({ authorization: `Bearer ${token}` }));
    expect(d).toEqual({
      ok: true,
      principal: { kind: "agent", keyId: "k1", name: "ingest", scopes: ["read"], rateLimit: 120 },
    });
    expect(touched).toEqual(["k1"]);
    expect(requireScope(d!, "read")).toBe(d!);
    expect(requireScope(d!, "moderate")).toEqual({ ok: false, status: 403, code: "scope_missing" });
    expect(await s(req({ authorization: "Bearer something-else" }))).toBeNull();
    expect(await s(req({ authorization: "Bearer dbfr_agent_short" }))).toEqual({
      ok: false,
      status: 401,
      code: "invalid_token",
    });
    expect(await s(req({ authorization: `Bearer ${token}x` }))).toEqual({
      ok: false,
      status: 401,
      code: "invalid_token",
    });
    record.revokedAt = new Date();
    expect((await s(req({ authorization: `Bearer ${token}` })))?.ok).toBe(false);

    const failingTouch = agentKeyStrategy({
      store: {
        ...store,
        findActiveByHash: async () => ({ ...record, revokedAt: null }),
        touch: async () => {
          throw new Error("write failed");
        },
      },
    });
    expect((await failingTouch(req({ authorization: `Bearer ${token}` })))?.ok).toBe(true);
    const admin = {
      ok: true as const,
      principal: { kind: "admin-token" as const, via: "bearer" as const },
    };
    expect(requireScope(admin, "moderate")).toBe(admin);
  });

  test("assertSameOrigin", () => {
    const allowed = ["https://dragonballfr.com"];
    const r = (origin?: string) =>
      new Request("https://www.dragonballfr.com/api/x", {
        method: "POST",
        headers: origin ? { origin } : {},
      });
    expect(assertSameOrigin(r(), allowed)).toBeNull();
    expect(assertSameOrigin(r("https://www.dragonballfr.com"), allowed)).toBeNull();
    expect(assertSameOrigin(r("https://dragonballfr.com"), allowed)).toBeNull();
    expect(assertSameOrigin(r("https://evil.example"), allowed)).toEqual({
      ok: false,
      status: 403,
      code: "cross_origin",
    });
  });
});
