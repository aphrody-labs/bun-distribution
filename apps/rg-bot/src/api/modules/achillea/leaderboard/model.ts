import { t } from "elysia";

const entry = t.Object({
  userId: t.String(),
  username: t.Nullable(t.String()),
  displayName: t.String(),
  avatar: t.Nullable(t.String()),
  elo: t.Number(),
  peakRating: t.Number(),
  gamesPlayed: t.Number(),
  rank: t.Number(),
});

export const LeaderboardModel = {
  response: t.Object({ data: t.Array(entry), count: t.Number() }),
};
