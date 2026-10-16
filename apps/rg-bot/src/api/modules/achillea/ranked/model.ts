import { t } from "elysia";

const tier = t.Object({
  key: t.String(),
  minElo: t.Number(),
  maxElo: t.Number(),
  gradient: t.Array(t.String()),
  emojiId: t.String(),
  emojiKey: t.String(),
});

const profile = t.Object({
  userId: t.String(),
  mode: t.Number(),
  elo: t.Number(),
  peakRating: t.Number(),
  gamesPlayed: t.Number(),
  wins: t.Number(),
  losses: t.Number(),
  seasonId: t.Nullable(t.String()),
  globalRank: t.Nullable(t.Number()),
  totalPlayers: t.Number(),
  percentile: t.Nullable(t.Number()),
  tier: t.Nullable(tier),
});

const entry = t.Object({
  rank: t.Number(),
  userId: t.String(),
  displayName: t.String(),
  avatar: t.Nullable(t.String()),
  elo: t.Number(),
  peakRating: t.Number(),
  gamesPlayed: t.Number(),
});

export const RankedModel = {
  tier,
  tiers: t.Array(t.Intersect([tier, t.Object({ playerCount: t.Number() })])),
  profile,
  leaderboard: t.Object({ mode: t.Number(), total: t.Number(), entries: t.Array(entry) }),
  unauthorized: t.Object({ message: t.Literal("Authentication required") }),
  notFound: t.Object({ message: t.Literal("User not found") }),
};
