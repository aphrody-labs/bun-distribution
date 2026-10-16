import "./setup";
import { describe, expect, it } from "bun:test";
import { treaty } from "@elysia/eden";
import { signAchilleaSessionToken } from "@rosegriffon/auth/achillea-session";
import { app } from "../src/api/server";

const api = treaty(app);

// SQL-backed contract suite requires an explicitly seeded disposable fixture.
describe.skipIf(!process.env.RG_TEST_DATABASE_URL)("Rose Griffon Unified API (apps/api)", () => {
  it("GET /health returns 200 with status ok", async () => {
    const res = await api.health.get();
    expect(res.status).toBe(200);
    expect(res.data?.status).toBe("ok");
    expect(res.data?.service).toBe("rg-api");
  });

  it("Better Auth Elysia mount exposes session, agent, MCP and API-key routes", async () => {
    const session = await app.handle(
      new Request("http://localhost/v1/auth/get-session", {
        headers: { "x-forwarded-for": "127.0.0.1" },
      }),
    );
    expect(session.status).toBe(200);
    expect(await session.json()).toBeNull();

    const agent = await app.handle(new Request("http://localhost/v1/auth/agent-configuration"));
    expect(agent.status).toBe(200);
    expect((await agent.json()) as { provider_name: string }).toMatchObject({
      provider_name: "Rose Griffon",
    });

    const discovery = await app.handle(
      new Request("http://localhost/.well-known/agent-configuration"),
    );
    expect(discovery.status).toBe(200);
    expect((await discovery.json()) as { provider_name: string }).toMatchObject({
      provider_name: "Rose Griffon",
    });

    const capabilities = await app.handle(new Request("http://localhost/v1/auth/capability/list"));
    expect(capabilities.status).toBe(200);
    expect((await capabilities.json()) as { capabilities: unknown[] }).toMatchObject({
      capabilities: expect.any(Array),
    });

    const apiKeyCreate = await app.handle(
      new Request("http://localhost/v1/auth/api-key/create", {
        method: "POST",
        headers: { "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
        body: "{}",
      }),
    );
    expect(apiKeyCreate.status).toBe(401);
  });

  it("GET /v1/achillea/tournaments returns 200 with valid shape", async () => {
    const res = await api.v1.achillea.tournaments.get();
    expect(res.status).toBe(200);
    expect(res.data).toBeDefined();
    if (res.data) {
      expect(Array.isArray(res.data.data)).toBe(true);
      expect(typeof res.data.meta.total).toBe("number");
    }
  });

  it("GET /v1/achillea/tournaments applies public organization and state filters to data and total", async () => {
    const absent = await app.handle(
      new Request(
        "http://localhost/v1/achillea/tournaments?organization=2147483647&states=Finished&pageSize=1",
      ),
    );
    expect(absent.status).toBe(200);
    const empty = (await absent.json()) as { data: unknown[]; meta: { total: number } };
    expect(empty.data).toEqual([]);
    expect(empty.meta.total).toBe(0);
    const all = await api.v1.achillea.tournaments.get();
    const first = all.data?.data[0];
    if (!first) return;
    const detail = await api.v1.achillea.tournaments({ id: first.id }).get();
    const organization = detail.data?.[0]?.organization;
    const organizationId =
      organization && typeof organization === "object" && "id" in organization
        ? Number(organization.id)
        : null;
    if (organizationId === null) return;
    const response = await app.handle(
      new Request(
        `http://localhost/v1/achillea/tournaments?page=1&pagination=1&organization=${organizationId}&states=${encodeURIComponent(first.status ?? "Pending")}`,
      ),
    );
    expect(response.status).toBe(200);
    const filtered = (await response.json()) as {
      data: Array<{ status: string | null }>;
      meta: { total: number; limit: number };
    };
    expect(filtered.meta.limit).toBe(1);
    expect(filtered.meta.total).toBeGreaterThanOrEqual(1);
    expect(filtered.data).toHaveLength(1);
    expect(filtered.data[0]?.status).toBe(first.status);
  });

  it("GET /v1/achillea/tournaments/circuit/ranking returns the unified circuit projection", async () => {
    const res = await app.handle(
      new Request("http://localhost/v1/achillea/tournaments/circuit/ranking"),
    );
    expect(res.status).toBe(200);
    const data = (await res.json()) as {
      leaderboard?: unknown[];
      tournaments?: unknown[];
      clanRanking?: unknown[];
    };
    expect(Array.isArray(data.leaderboard)).toBe(true);
    expect(Array.isArray(data.tournaments)).toBe(true);
    expect(Array.isArray(data.clanRanking)).toBe(true);
  });

  it("GET /v1/achillea/tournaments/99999999 returns 404 with typed not found", async () => {
    const res = await api.v1.achillea.tournaments({ id: 99999999 }).get();
    expect(res.status).toBe(404);
    expect(res.error).toBeDefined();
  });

  it("GET /v1/achillea/tournaments/:id keeps the triplet detail contract", async () => {
    const list = await api.v1.achillea.tournaments.get();
    const id = list.data?.data[0]?.id;
    if (id === undefined) return;
    const res = await api.v1.achillea.tournaments({ id }).get();
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
    expect(res.data).toHaveLength(3);
    expect(Array.isArray(res.data?.[1])).toBe(true);
    expect(res.data?.[2]).toBeDefined();
  });

  it("GET /v1/achillea/tournaments/:id/summary exposes the BracketService stats contract", async () => {
    const list = await api.v1.achillea.tournaments.get();
    const id = list.data?.data[0]?.id;
    if (id === undefined) return;
    const res = await api.v1.achillea.tournaments({ id }).summary.get();
    expect(res.status).toBe(200);
    if (res.data?.stats) {
      expect(typeof res.data.stats.matches).toBe("number");
      expect(typeof res.data.stats.totalGoals).toBe("number");
      expect(typeof res.data.stats.avgGoals).toBe("number");
      expect("biggestBlowout" in res.data.stats).toBe(true);
      expect("closestMatch" in res.data.stats).toBe(true);
    }
  });

  it("GET /v1/achillea/tournaments/99999999/events returns typed not found", async () => {
    const res = await api.v1.achillea.tournaments({ id: 99999999 }).events.get();
    expect(res.status).toBe(404);
  });

  it("tournament registration mutations require the unified session", async () => {
    const participate = await api.v1.achillea.tournaments.participate({ id: 99999999 }).post();
    const unregister = await api.v1.achillea.tournaments.unregister({ id: 99999999 }).post();
    expect(participate.status).toBe(401);
    expect(unregister.status).toBe(401);
  });

  it("tournament create/edit mutations require the unified session", async () => {
    const create = await app.handle(
      new Request("http://localhost/v1/achillea/tournaments/create/achillea", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ organization: 1 }),
      }),
    );
    const edit = await app.handle(
      new Request("http://localhost/v1/achillea/tournaments/99999999/edit", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(create.status).toBe(401);
    expect(edit.status).toBe(401);
  });

  it("scheduled tournament transitions are internal-only", async () => {
    const response = await app.handle(
      new Request("http://localhost/v1/achillea/tournaments/internal/schedule-transitions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ now: new Date().toISOString() }),
      }),
    );
    expect(response.status).toBe(401);
    const payload = (await response.json()) as { message?: string };
    expect(payload.message).toBe("Internal authentication required");
  });

  it("tournament score policy mutation requires the unified session", async () => {
    const res = await api.v1.achillea
      .tournaments({ id: 99999999 })
      ["score-policy"].post({ policy: "players" });
    expect(res.status).toBe(401);
  });

  it("tournament lobby score mutations require the unified session", async () => {
    const requests = [
      new Request("http://localhost/v1/achillea/tournaments/report-score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lobbyId: 1, gameNumber: 1, score1: 1, score2: 0 }),
      }),
      new Request("http://localhost/v1/achillea/tournaments/validate-score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lobbyId: 1, lobbyMatchId: 1 }),
      }),
      new Request("http://localhost/v1/achillea/tournaments/unvalidate-score", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ lobbyId: 1, lobbyMatchId: 1 }),
      }),
    ];
    for (const request of requests) expect((await app.handle(request)).status).toBe(401);
  });

  it("tournament lifecycle mutations require the unified session", async () => {
    const requests = [
      new Request("http://localhost/v1/achillea/tournaments/open-registrations/99999999", {
        method: "POST",
      }),
      new Request("http://localhost/v1/achillea/tournaments/99999999/close", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      }),
      new Request("http://localhost/v1/achillea/tournaments/99999999/cancel", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: "test" }),
      }),
      new Request("http://localhost/v1/achillea/tournaments/99999999/restore", { method: "POST" }),
      new Request("http://localhost/v1/achillea/tournaments/start/99999999", { method: "PUT" }),
      new Request("http://localhost/v1/achillea/tournaments/next-phase/99999999", {
        method: "PUT",
      }),
    ];
    for (const request of requests) expect((await app.handle(request)).status).toBe(401);
  });

  it("tournament participant administration requires the unified session", async () => {
    const requests = [
      new Request("http://localhost/v1/achillea/tournaments/remove-participant/99999999", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "u" }),
      }),
      new Request("http://localhost/v1/achillea/tournaments/99999999/disqualify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "u", reason: "test" }),
      }),
      new Request("http://localhost/v1/achillea/tournaments/99999999/reinstate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "u" }),
      }),
      new Request("http://localhost/v1/achillea/tournaments/99999999/promote-participant", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: "u" }),
      }),
    ];
    for (const request of requests) expect((await app.handle(request)).status).toBe(401);
  });

  it("tournament seeding mutations require the unified session", async () => {
    const requests = [
      new Request("http://localhost/v1/achillea/tournaments/set-participant-seeding/99999999", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ participant: { id: 1, seed: 1 } }),
      }),
      new Request("http://localhost/v1/achillea/tournaments/seed-by-ranked/99999999", {
        method: "POST",
      }),
      new Request("http://localhost/v1/achillea/tournaments/seed-random/99999999", {
        method: "POST",
      }),
      new Request("http://localhost/v1/achillea/tournaments/clear-seeds/99999999", {
        method: "POST",
      }),
      new Request("http://localhost/v1/achillea/tournaments/generate-bracket/99999999", {
        method: "POST",
      }),
    ];
    for (const request of requests) expect((await app.handle(request)).status).toBe(401);
  });

  it("tournament placement prizes require the unified session", async () => {
    const res = await app.handle(
      new Request("http://localhost/v1/achillea/tournaments/99999999/apply-placement-prizes", {
        method: "POST",
      }),
    );
    expect(res.status).toBe(401);
  });

  it("internal tournament placement trigger requires API_ADMIN_TOKEN", async () => {
    const res = await app.handle(
      new Request(
        "http://localhost/v1/achillea/tournaments/internal/99999999/apply-placement-prizes",
        { method: "POST" },
      ),
    );
    expect(res.status).toBe(401);
  });

  it("admin role and wallet mutations require the unified session", async () => {
    const role = await app.handle(
      new Request("http://localhost/v1/achillea/admin/users/u/role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role: 1 }),
      }),
    );
    const wallet = await app.handle(
      new Request("http://localhost/v1/achillea/admin/wallets/u/adjust", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: 1 }),
      }),
    );
    expect(role.status).toBe(401);
    expect(wallet.status).toBe(401);
  });

  it("admin users and wallets read contracts require the unified session", async () => {
    const users = await app.handle(
      new Request("http://localhost/v1/achillea/admin/ops/users?page=1&pagination=25"),
    );
    const wallets = await app.handle(
      new Request("http://localhost/v1/achillea/admin/ops/wallets?limit=25"),
    );
    expect(users.status).toBe(401);
    expect(wallets.status).toBe(401);
  });

  it("admin overview is owned by the unified API", async () => {
    const overview = await app.handle(
      new Request("http://localhost/v1/achillea/admin/ops/overview"),
    );
    expect(overview.status).toBe(401);
  });

  it("player-note reads and mutations require the unified session", async () => {
    const requests = [
      new Request("http://localhost/v1/achillea/player-notes"),
      new Request("http://localhost/v1/achillea/player-notes/summary/u"),
      new Request("http://localhost/v1/achillea/player-notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetId: "u", content: "note" }),
      }),
    ];
    for (const request of requests) expect((await app.handle(request)).status).toBe(401);
  });

  it("notification reads and mutations require the unified session", async () => {
    const requests = [
      new Request("http://localhost/v1/achillea/notifications/me"),
      new Request("http://localhost/v1/achillea/notifications/read/1", { method: "PATCH" }),
      new Request("http://localhost/v1/achillea/notifications/read-all", { method: "PATCH" }),
    ];
    for (const request of requests) expect((await app.handle(request)).status).toBe(401);
  });

  it("GET /v1/achillea/clans returns 200 with clans list", async () => {
    const res = await api.v1.achillea.clans.get();
    expect(res.status).toBe(200);
    expect(res.data).toBeDefined();
    if (res.data) {
      expect(Array.isArray(res.data.data)).toBe(true);
      expect(typeof res.data.count).toBe("number");
    }
  });

  it("clan name validation is internal-only and API-owned", async () => {
    const requests = [
      new Request("http://localhost/v1/achillea/clans/validate/name", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Achillea" }),
      }),
      new Request("http://localhost/v1/achillea/clans/validate/short-name", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ shortName: "AC" }),
      }),
    ];
    for (const request of requests) expect((await app.handle(request)).status).toBe(401);
  });

  it("PATCH /v1/achillea/clans/:id requires the unified session", async () => {
    const response = await app.handle(
      new Request("http://localhost/v1/achillea/clans/1", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ clanBiography: "unauthorized" }),
      }),
    );
    expect(response.status).toBe(401);
  });

  it("GET /v1/achillea/clans/:id/members is SQL-backed", async () => {
    const list = await api.v1.achillea.clans.get();
    const id = list.data?.data[0]?.id;
    if (id === undefined) return;
    const response = await app.handle(
      new Request(`http://localhost/v1/achillea/clans/${id}/members`),
    );
    expect(response.status).toBe(200);
    const members = (await response.json()) as Array<Record<string, unknown>>;
    expect(Array.isArray(members)).toBe(true);
    const first = members[0];
    if (first) {
      expect(typeof first.clanRole).toBe("number");
      expect(Array.isArray(first.distinctions)).toBe(true);
      expect(typeof first.clanFameContributed).toBe("number");
      expect(typeof first.user).toBe("object");
    }
  });

  it("GET /v1/achillea/clans/me requires the unified session", async () => {
    const res = await app.handle(new Request("http://localhost/v1/achillea/clans/me"));
    expect(res.status).toBe(401);
  });

  it("ranked public reads use the canonical unified contract", async () => {
    const leaderboard = await app.handle(
      new Request("http://localhost/v1/achillea/ranked/leaderboard?mode=2&page=0&pageSize=5"),
    );
    expect(leaderboard.status).toBe(200);
    const ladder = (await leaderboard.json()) as {
      mode: number;
      total: number;
      entries: unknown[];
    };
    expect(ladder.mode).toBe(2);
    expect(typeof ladder.total).toBe("number");
    expect(Array.isArray(ladder.entries)).toBe(true);

    const tiers = await app.handle(new Request("http://localhost/v1/achillea/ranked/tiers?mode=2"));
    expect(tiers.status).toBe(200);
    const tierData = (await tiers.json()) as unknown[];
    expect(tierData.length).toBeGreaterThan(0);
  });

  it("ranked profile read requires the unified Achillea session", async () => {
    const response = await app.handle(new Request("http://localhost/v1/achillea/ranked/me?mode=2"));
    expect(response.status).toBe(401);
  });

  it("ranked endpoints reject unsupported match modes", async () => {
    for (const path of ["leaderboard", "tiers", "me"]) {
      const response = await app.handle(
        new Request(`http://localhost/v1/achillea/ranked/${path}?mode=3`),
      );
      expect(response.status).toBe(400);
    }
  });

  it("GET /v1/achillea/organizations returns a typed list", async () => {
    const res = await api.v1.achillea.organizations.get({ query: { page: 1, pageSize: 5 } });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data?.data)).toBe(true);
    expect(typeof res.data?.count).toBe("number");
  });

  it("organization mutations require the unified session", async () => {
    const mine = await api.v1.achillea.organizations.me.get();
    expect(mine.status).toBe(401);
    const create = await api.v1.achillea.organizations.create.post({
      name: "Test Organization",
      normalizedName: "TEST ORGANIZATION",
      logo: "",
      description: "",
      origin: "fr",
      orgManagers: [],
      socialMedias: [],
      broadcastMedias: [],
    });
    expect(create.status).toBe(401);
  });

  it("organization review states require an administrator session", async () => {
    const response = await app.handle(
      new Request("http://localhost/v1/achillea/organizations?state=0"),
    );
    expect(response.status).toBe(401);
  });

  it("sanction persistence routes require a session", async () => {
    const list = await api.v1.achillea.sanctions.get();
    expect(list.status).toBe(401);
    const create = await api.v1.achillea.sanctions.post({
      userId: "u",
      guildId: "g",
      type: "warn",
    });
    expect(create.status).toBe(401);
  });

  it("GET /v1/achillea/leaderboard returns ranked entries", async () => {
    const res = await api.v1.achillea.leaderboard.get({ query: { mode: 0, limit: 5 } });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data?.data)).toBe(true);
    expect(typeof res.data?.count).toBe("number");
  });

  it("GET /v1/achillea/leagues/astral returns the canonical season", async () => {
    const res = await api.v1.achillea.leagues.astral.get();
    expect(res.status).toBe(200);
    expect(res.data?.meta.id).toBeDefined();
    expect(Array.isArray(res.data?.standings)).toBe(true);
    expect(Array.isArray(res.data?.results)).toBe(true);
  });

  it("GET /v1/achillea/users/leaderboard keeps the versioned client contract", async () => {
    const res = await api.v1.achillea.users.leaderboard.get({
      query: { mode: 0, season: "", limit: 5 },
    });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data?.entries)).toBe(true);
    expect(typeof res.data?.total).toBe("number");
    expect(res.data?.mode).toBe(0);
  });

  it("GET /v1/achillea/users/:id serves the unified public profile projection", async () => {
    const leaderboard = await api.v1.achillea.users.leaderboard.get({
      query: { mode: 0, season: "", limit: 1 },
    });
    const userId = leaderboard.data?.entries[0]?.userId;
    if (!userId) return;
    const res = await app.handle(
      new Request(`http://localhost/v1/achillea/users/${encodeURIComponent(userId)}`),
    );
    expect(res.status).toBe(200);
    const profile = (await res.json()) as {
      id?: string;
      ranked?: { solo?: { mode?: number }; duo?: { mode?: number } };
      interclans?: unknown;
      tournaments?: unknown;
    };
    expect(profile.id).toBe(userId);
    expect(profile.ranked?.solo?.mode).toBe(2);
    expect(profile.ranked?.duo?.mode).toBe(4);
    expect(profile.interclans).toBeDefined();
    expect(profile.tournaments).toBeDefined();
  });

  it("PUT /v1/achillea/users/me/profile requires the unified session", async () => {
    const res = await api.v1.achillea.users.me.profile.put({ bio: "x" });
    expect(res.status).toBe(401);
  });

  it("GET /v1/achillea/users/me/ranked-history is owned by the unified API", async () => {
    const res = await app.handle(
      new Request("http://localhost/v1/achillea/users/me/ranked-history?limit=20"),
    );
    expect(res.status).toBe(401);
  });

  it("GET /v1/achillea/users/:id/ranked-history exposes only that player's public results", async () => {
    const leaderboard = await api.v1.achillea.users.leaderboard.get({
      query: { mode: 2, limit: 1 },
    });
    const userId = leaderboard.data?.entries[0]?.userId;
    if (!userId) return;
    const response = await app.handle(
      new Request(
        `http://localhost/v1/achillea/users/${encodeURIComponent(userId)}/ranked-history?limit=5`,
      ),
    );
    expect(response.status).toBe(200);
    const history = (await response.json()) as Array<{
      lobbyId: number;
      opponent: { userId: string };
    }>;
    expect(Array.isArray(history)).toBe(true);
    expect(history.length).toBeLessThanOrEqual(5);
    expect(new Set(history.map((match) => match.lobbyId)).size).toBe(history.length);
    for (const match of history) {
      expect(typeof match.lobbyId).toBe("number");
      expect(typeof match.opponent.userId).toBe("string");
    }
  });

  it("GET /v1/achillea/users/me/ranked-trend is owned by the unified API", async () => {
    const res = await app.handle(
      new Request("http://localhost/v1/achillea/users/me/ranked-trend?days=7&last=20"),
    );
    expect(res.status).toBe(401);
  });

  it("GET /v1/achillea/users/me/ranked-history returns the shared DTO for a session", async () => {
    const leaderboard = await api.v1.achillea.users.leaderboard.get({
      query: { mode: 2, limit: 1 },
    });
    const userId = leaderboard.data?.entries[0]?.userId;
    const secret = process.env.JWT_SECRET_KEY;
    if (!userId || !secret) return;
    const token = signAchilleaSessionToken(
      { id: userId, username: "contract-test", avatar: null },
      secret,
    );
    const history = await app.handle(
      new Request("http://localhost/v1/achillea/users/me/ranked-history?limit=20", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    const trend = await app.handle(
      new Request("http://localhost/v1/achillea/users/me/ranked-trend?days=7&last=20", {
        headers: { authorization: `Bearer ${token}` },
      }),
    );
    expect(history.status).toBe(200);
    expect(Array.isArray(await history.json())).toBe(true);
    expect(trend.status).toBe(200);
    expect(typeof (await trend.json()).winRatePeriod).toBe("number");
  });

  it("GET /v1/achillea/licenses/verify rejects malformed QR values uniformly", async () => {
    const res = await api.v1.achillea.licenses.verify({ qrSecret: "short" }).get();
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ valid: false, reason: "not_found" });
  });

  it("GET /v1/achillea/licenses/me requires the unified session", async () => {
    const res = await app.handle(new Request("http://localhost/v1/achillea/licenses/me"));
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).not.toHaveProperty("verificationToken");
  });

  it("GET /v1/achillea/wallet/me requires the unified session", async () => {
    const res = await api.v1.achillea.wallet.me.get();
    expect(res.status).toBe(401);
    expect(res.error).toBeDefined();
  });

  it("GET /v1/achillea/wallet/me/history requires the unified session", async () => {
    const res = await api.v1.achillea.wallet.me.history.get({ query: { limit: 20, offset: 0 } });
    expect(res.status).toBe(401);
    expect(res.error).toBeDefined();
  });

  it("GET /v1/auth/oauth/callback rejects incomplete provider callbacks", async () => {
    const res = await api.v1.auth.oauth.callback.get({ query: { provider: "twitch" } });
    expect(res.status).toBe(400);
  });

  it("GET /v1/auth/me rejects requests without a purpose-bound session", async () => {
    const res = await api.v1.auth.me.get();
    expect(res.status).toBe(401);
    expect(res.error).toBeDefined();
  });

  it("POST /v1/auth/session/exchange is restricted to the internal bridge", async () => {
    const res = await app.handle(
      new Request("http://localhost/v1/auth/session/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "discord-user" }),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("GET /v1/auth/realtime-token rejects requests without a unified session", async () => {
    const res = await api.v1.auth["realtime-token"].get();
    expect(res.status).toBe(401);
    expect(res.error).toBeDefined();
  });

  it("GET /v1/auth/oauth/:provider/start rejects unauthenticated starts", async () => {
    const res = await api.v1.auth
      .oauth({ provider: "twitch" })
      .start.get({ query: { userId: "user-1" } });
    expect(res.status).toBe(401);
    expect(res.error).toBeDefined();
  });

  it("GET /v1/community/info returns 200 with brand data", async () => {
    const res = await api.v1.community.info.get();
    expect(res.status).toBe(200);
    expect(res.data?.name).toBe("Rose Griffon");
    expect(res.data?.colors.primary).toBe("#a14b3f");
  });

  it("GET /v1/community/emotes returns 200 with emotes list", async () => {
    const res = await api.v1.community.emotes.get();
    expect(res.status).toBe(200);
    expect(res.data?.success).toBe(true);
    expect(Array.isArray(res.data?.data)).toBe(true);
  });

  it("GET /v1/community/tags/popular returns 200 with top tags", async () => {
    const res = await api.v1.community.tags.popular.get();
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data)).toBe(true);
  });

  it("GET /v1/wiki/characters returns 200 with wiki characters data", async () => {
    const res = await api.v1.wiki.characters.get({ query: { limit: 2 } });
    expect(res.status).toBe(200);
    expect(res.data).toBeDefined();
  });

  it("GET /v1/content/news/feed returns 200 with articles feed", async () => {
    const res = await api.v1.content.news.feed.get({ query: { page: 1 } });
    expect(res.status).toBe(200);
    expect(res.data).toBeDefined();
    if (res.data) {
      expect(Array.isArray(res.data.items)).toBe(true);
      expect(typeof res.data.hasMore).toBe("boolean");
    }
  });

  it("GET /v1/content/calendar-events returns 200 with calendar events", async () => {
    const res = await api.v1.content["calendar-events"].get();
    expect(res.status).toBe(200);
    expect(res.data).toBeDefined();
    if (res.data) {
      expect(Array.isArray(res.data.events)).toBe(true);
    }
  });

  it("POST /v1/billing/webhooks/stripe returns 400 when missing signature", async () => {
    const res = await api.v1.billing.webhooks.stripe.post();
    expect(res.status).toBe(400);
  });

  it("POST /v1/billing/webhooks/stripe returns 200 with valid header", async () => {
    const res = await api.v1.billing.webhooks.stripe.post(null, {
      headers: { "stripe-signature": "test_sig" },
    });
    expect(res.status).toBe(200);
    expect(res.data?.received).toBe(true);
  });

  it("GET /v1/storage/health returns 200 with storage status", async () => {
    const res = await api.v1.storage.health.get();
    expect(res.status).toBe(200);
    expect(res.data?.ok).toBe(true);
  });

  it("GET /v1/realtime/health returns 200 with realtime status", async () => {
    const res = await api.v1.realtime.health.get();
    expect(res.status).toBe(200);
    expect(res.data?.ok).toBe(true);
  });

  it("GET /v1/inagle/health returns the game-data service status", async () => {
    const res = await api.v1.inagle.health.get();
    expect(res.status).toBe(200);
    expect(res.data).toEqual({ ok: true, service: "inagle" });
  });

  it("GET /v1/inagle/teams returns a stable paginated shape", async () => {
    const res = await api.v1.inagle.teams.get({ query: { limit: 2 } });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data?.data)).toBe(true);
    expect(typeof res.data?.count).toBe("number");
  });

  it("GET /v1/inagle/quests returns a stable paginated shape", async () => {
    const res = await api.v1.inagle.quests.get({ query: { limit: 2 } });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data?.data)).toBe(true);
    expect(typeof res.data?.count).toBe("number");
  });

  it("GET /v1/inagle/formations returns the SQL-backed projection", async () => {
    const res = await api.v1.inagle.formations.get({ query: { limit: 2 } });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data?.data)).toBe(true);
    expect(typeof res.data?.count).toBe("number");
  });

  it("GET /v1/inagle/items returns a stable paginated shape", async () => {
    const res = await api.v1.inagle.items.get({ query: { limit: 2 } });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data?.data)).toBe(true);
    expect(typeof res.data?.count).toBe("number");
  });

  it("GET /v1/inagle/drops/table/:id keeps the SQL/API contract", async () => {
    const res = await api.v1.inagle.drops.table({ id: "missing" }).get();
    expect(res.status).toBe(200);
    expect(res.data).toBeDefined();
  });

  it("GET /v1/inagle/drops/item/:id reads SQL drop sources", async () => {
    const res = await api.v1.inagle.drops.item({ id: "0" }).get();
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data?.data)).toBe(true);
  });

  it("GET /v1/inagle/souls reads the canonical PostgreSQL projection", async () => {
    const res = await api.v1.inagle.souls.get({ query: { limit: 2 } });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.data?.data)).toBe(true);
  });

  it("GET /v1/inagle/skill-cutins reads the canonical SQL projection", async () => {
    const res = await app.handle(new Request("http://localhost/v1/inagle/skill-cutins/whs01230"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data?: { skill_id_str?: string } };
    expect(body.data?.skill_id_str).toBe("whs01230");
  });

  it("GET /v1/inagle/skill-cutins/assets exposes the SQL CDN gate", async () => {
    const res = await app.handle(
      new Request("http://localhost/v1/inagle/skill-cutins/assets/ev60_00340"),
    );
    expect(res.status).toBe(200);
    expect((await res.json()).available).toBe(true);
  });

  it("GET /v1/azalee/health is served by the unified bridge", async () => {
    const res = await api.v1.azalee.health.get();
    expect(res.status).toBe(200);
    expect(res.data).toBeDefined();
  });

  it("GET /v1/azalee/api/teams uses the SQL wiki service", async () => {
    const res = await app.handle(new Request("http://localhost/v1/azalee/api/teams"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
  });

  it("GET /v1/azalee/api/items uses the SQL wiki service", async () => {
    const res = await app.handle(new Request("http://localhost/v1/azalee/api/items?limit=2"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.source).toBe("postgres");
  });

  it("GET /v1/azalee/api/cpk and /text use unified package handlers", async () => {
    const cpk = await app.handle(new Request("http://localhost/v1/azalee/api/cpk?limit=1"));
    expect(cpk.status).toBe(200);
    const cpkBody = (await cpk.json()) as { dir: string; source: string; dirs: unknown[] };
    expect(cpkBody.dir).toBeDefined();
    expect(cpkBody.source).toBe("postgres");
    expect(cpkBody.dirs.length).toBeGreaterThan(0);
    const text = await app.handle(new Request("http://localhost/v1/azalee/api/text/stats"));
    expect(text.status).toBe(200);
    const textStats = (await text.json()) as Array<{ category: string; count: number }>;
    expect(Array.isArray(textStats)).toBe(true);
    expect(textStats.length).toBeGreaterThan(0);
    const search = await app.handle(
      new Request("http://localhost/v1/azalee/api/text?q=Mark&locale=fr&limit=2"),
    );
    expect(search.status).toBe(200);
    const searchBody = (await search.json()) as { source: string; data: unknown[] };
    expect(searchBody.source).toBe("postgres");
    expect(searchBody.data.length).toBeGreaterThan(0);
  });

  it("GET /v1/azalee/api/cross/catalog is SQL-backed", async () => {
    const response = await app.handle(
      new Request("http://localhost/v1/azalee/api/cross/catalog?limit=2"),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { source: string; data: unknown[]; count: number };
    expect(body.source).toBe("postgres");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data.length).toBeGreaterThan(0);
    expect(body.count).toBeGreaterThan(0);
  });
});
