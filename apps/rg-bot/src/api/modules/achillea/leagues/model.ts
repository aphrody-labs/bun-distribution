import { t } from "elysia";

const season = t.Object({
  id: t.String(),
  name: t.String(),
  season: t.String(),
  format: t.String(),
  description: t.String(),
  champion: t.Optional(t.String()),
  teamCount: t.Number(),
  matchdays: t.Number(),
  aliases: t.Array(t.String()),
});

export const LeagueModel = {
  list: t.Object({ items: t.Array(season) }),
  season: t.Object({
    meta: t.Any(),
    format: t.Any(),
    teams: t.Array(t.Any()),
    pointsConfig: t.Any(),
    standings: t.Array(t.Any()),
    results: t.Array(t.Any()),
    playoffs: t.Any(),
    schedule: t.Optional(t.Array(t.Any())),
    details: t.Any(),
  }),
};
