import { Elysia, t } from "elysia";
import { dbPlugin } from "../../../plugins/db";
import { LeaderboardModel } from "./model";
import { LeaderboardService } from "./service";

export const leaderboardController = new Elysia({ prefix: "/leaderboard" })
  .use(dbPlugin)
  .get(
    "/",
    ({ db, query }) => LeaderboardService.findTop(db, query.mode, query.seasonId ?? null, query.limit, query.offset),
    {
      query: t.Object({
        mode: t.Numeric({ minimum: 0 }),
        seasonId: t.Optional(t.String()),
        limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
        offset: t.Optional(t.Numeric({ minimum: 0 })),
      }),
      response: { 200: LeaderboardModel.response },
    },
  );
