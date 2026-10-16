import { describe, expect, test } from "bun:test";

import { achilleaGuildDetailSchema, achilleaGuildPageSchema, achilleaGuildStatsSchema } from "../src/v1";
import { clanDtoSchema } from "../src/v1/clans";
import { adminOpsOverviewSchema, adminWalletsResponseSchema } from "../src/v1/admin";

const guild = {
  id: "123456789012345678",
  name: null,
  icon: null,
  banner: null,
  owner_id: null,
  member_count: "42",
  presence_count: null,
  features: null,
  premium_tier: null,
  verification_level: null,
  description: null,
  scanned_at: null,
};

describe("v1 guild schemas", () => {
  test("preserves nullable fields and normalizes serialized counters", () => {
    const parsed = achilleaGuildDetailSchema.parse(guild);

    expect(parsed.name).toBeNull();
    expect(parsed.member_count).toBe(42);
    expect(parsed.presence_count).toBeNull();
    expect(parsed.roles).toEqual([]);
    expect(parsed.channels).toEqual([]);
  });

  test("detects a renamed required field as contract drift", () => {
    const { scanned_at: _scannedAt, ...driftedGuild } = guild;
    const result = achilleaGuildDetailSchema.safeParse({
      ...driftedGuild,
      last_scan: null,
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["scanned_at"]);
  });

  test("requires the documented pagination envelope", () => {
    const valid = achilleaGuildPageSchema.safeParse({
      data: [guild],
      meta: { page: 1, limit: 25, total: 1, pageCount: 1 },
    });
    const drifted = achilleaGuildPageSchema.safeParse({
      guilds: [guild],
      meta: { page: 1, limit: 25, total: 1, pageCount: 1 },
    });

    expect(valid.success).toBe(true);
    expect(drifted.success).toBe(false);
  });

  test("parses the direct stats response without a data envelope", () => {
    const parsed = achilleaGuildStatsSchema.parse({
      total_guilds: 3,
      total_members: "1200",
      last_scan: null,
    });

    expect(parsed).toEqual({
      total_guilds: 3,
      total_members: 1200,
      last_scan: null,
      by_premium_tier: [],
      by_channel_type: [],
    });
  });
});

test("normalizes the compact unified clans projection", () => {
  const parsed = clanDtoSchema.parse({
    id: 61,
    name: "PROJECT ZOO",
    shortName: "ZOO",
    avatarUrl: "https://example.test/zoo.png",
    biography: "POUIK",
    fame: 0,
    isRecruiting: false,
    membersLimit: false,
  });

  expect(parsed.shortenedName).toBe("ZOO");
  expect(parsed.normalizedShortName).toBe("zoo");
  expect(parsed.founders).toEqual([]);
});

test("accepts the unified admin overview without legacy bot telemetry", () => {
  const result = adminOpsOverviewSchema.safeParse({
    users: { total: 3850, staff: 4 },
    wallet: { wallets: 14, totalBalance: 0, txToday: 0 },
    moderation: { sanctionsActive: 0, licensesActive: 0 },
    community: { tournamentsOngoing: 0, clansPending: 0, orgsPending: 0, castEventsOpen: 0 },
    ranked: { activeMatches: 0, contestedMatches: 0, finishedToday: 0, matchesToday: 0, totalPlayers: 12 },
    audit24h: 0,
    generatedAt: "2026-09-23T00:00:00.000Z",
  });
  expect(result.success).toBe(true);
});

test("preserves transaction ids serialized as strings by the unified API", () => {
  const result = adminWalletsResponseSchema.safeParse({
    top: [{ userId: "1", displayName: "Joueur", balance: 0, currency: "ACH" }],
    recent: [
      {
        id: "12345678901234567890",
        type: "Credit",
        amount: 1,
        reason: "Test",
        fromUserId: "1",
        toUserId: null,
        createdAt: "2026-09-23T00:00:00.000Z",
      },
    ],
  });
  expect(result.success).toBe(true);
  if (result.success) expect(result.data.recent[0]?.id).toBe("12345678901234567890");
});
