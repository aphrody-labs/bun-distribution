import { Elysia, status, t } from "elysia";
import { resolveAchilleaSession } from "../../auth/session";
import { dbPlugin } from "../../../plugins/db";
import { LeaderboardService } from "../leaderboard/service";
import { RankedModel } from "./model";

/** Canonical public ranked reads. Matchmaking, lobbies and Discord notifications stay in the bot. */
export const rankedController = new Elysia({ prefix: "/ranked" })
	.use(dbPlugin)
	.get("/tiers", async ({ db, query }) => {
		const mode = Number(query.mode ?? 2);
		if (mode !== 2 && mode !== 4) return status(400, { message: "Invalid mode" as const });
		return LeaderboardService.findTiers(db, mode);
	}, {
		query: t.Object({ mode: t.Optional(t.Numeric()) }),
		response: { 200: RankedModel.tiers, 400: t.Object({ message: t.Literal("Invalid mode") }) },
	})
	.get("/leaderboard", async ({ db, query }) => {
		const mode = Number(query.mode ?? 2);
		if (mode !== 2 && mode !== 4) return status(400, { message: "Invalid mode" as const });
		if (query.minElo !== undefined && query.maxElo !== undefined && query.minElo > query.maxElo)
			return status(400, { message: "Invalid Elo range" as const });
		const page = Math.max(0, Math.floor(Number(query.page ?? 0)) || 0);
		const pageSize = Math.min(200, Math.max(1, Math.floor(Number(query.pageSize ?? 50)) || 50));
		const pageData = await LeaderboardService.findActiveTop(db, mode, pageSize, page * pageSize, query.search ?? "", query.minElo, query.maxElo);
		return { mode, total: pageData.count, entries: pageData.data };
	}, {
		query: t.Object({ mode: t.Optional(t.Numeric()), page: t.Optional(t.Numeric()), pageSize: t.Optional(t.Numeric()), search: t.Optional(t.String({ maxLength: 80 })), minElo: t.Optional(t.Numeric()), maxElo: t.Optional(t.Numeric()) }),
		response: { 200: RankedModel.leaderboard, 400: t.Object({ message: t.Union([t.Literal("Invalid mode"), t.Literal("Invalid Elo range")]) }) },
	})
	.get("/me", async ({ db, headers, query }) => {
		const mode = Number(query.mode ?? 2);
		if (mode !== 2 && mode !== 4) return status(400, { message: "Invalid mode" as const });
		const session = await resolveAchilleaSession(headers);
		if (!session) return status(401, { message: "Authentication required" as const });
		const profile = await LeaderboardService.findProfile(db, session.id, mode);
		if (!profile) return status(404, { message: "User not found" as const });
		return profile;
	}, {
		query: t.Object({ mode: t.Optional(t.Numeric()) }),
		response: {
			200: RankedModel.profile,
			400: t.Object({ message: t.Literal("Invalid mode") }),
			401: RankedModel.unauthorized,
			404: RankedModel.notFound,
		},
	});
