import { t } from "elysia";

export const UsersModel = {
  publicProfile: t.Any(),
  enriched: t.Object({
    id: t.String(),
    username: t.String(),
    displayName: t.String(),
    avatar: t.String(),
    rgProfileUsername: t.Optional(t.String()),
    role: t.Number(),
    clanId: t.Nullable(t.Number()),
    hasChallonge: t.Boolean(),
  }),
  profile: t.Object({
    id: t.String(),
    username: t.Nullable(t.String()),
    displayName: t.String(),
    avatar: t.Nullable(t.String()),
    bio: t.Nullable(t.String()),
    twitchUrl: t.Nullable(t.String()),
  }),
  leaderboard: t.Object({
    entries: t.Array(
      t.Object({
        rank: t.Number(),
        userId: t.String(),
        displayName: t.String(),
        avatar: t.Nullable(t.String()),
        elo: t.Number(),
        peakRating: t.Number(),
        gamesPlayed: t.Number(),
      }),
    ),
    total: t.Number(),
    mode: t.Number(),
  }),
};
