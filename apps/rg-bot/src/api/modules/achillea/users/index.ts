import { Elysia, status, t } from "elysia";
import { sql } from "kysely";
import type { Kysely } from "kysely";
import type { Database } from "@rosegriffon/db/schema";
import { dbPlugin } from "../../../plugins/db";
import { LeaderboardService } from "../leaderboard/service";
import { UsersModel } from "./model";
import { resolveAchilleaSession } from "../../auth/session";
import { findLinkedPublicProfile, projectPublicIdentity } from "./public-profile";

async function rankedHistory(db: Kysely<Database>, userId: string, query: { mode?: number; limit?: number; offset?: number }) {
	const user = await db.selectFrom("user").select("id").where("id", "=", userId).executeTakeFirst();
	if (!user) return null;
	const limit = Math.max(1, Math.min(100, Number(query.limit ?? 20) || 20));
	const offset = Math.max(0, Number(query.offset ?? 0) || 0);
	const mode = query.mode == null ? null : Number(query.mode);
	let request = db.selectFrom("lobby as l")
		.innerJoin("lobby_user as me", (join) => join.onRef("me.lobby_id", "=", "l.id").on("me.user_id", "=", userId))
		// A duo lobby contains a teammate as well as two opponents.  The old
		// `user_id <> me.user_id` predicate selected all three rows, so the
		// history could label a teammate as an opponent and render the same
		// lobby more than once.  The public DTO has one opponent slot, therefore
		// project one stable player from the opposing team per lobby below.
		.innerJoin("lobby_user as opp", (join) => join.onRef("opp.lobby_id", "=", "l.id").onRef("opp.team", "<>", "me.team"))
		.innerJoin("user as u", "u.id", "opp.user_id")
		.select([
			"l.id as lobby_id", "l.mode", "l.state", "l.created_at",
			"me.score as my_score", "me.elo_variation as my_elo_delta", "me.forfeit as my_forfeit",
			"opp.user_id as opp_user_id", "opp.score as opp_score", "opp.forfeit as opp_forfeit",
			"u.display_name as opp_display_name", "u.username as opp_username", "u.avatar as opp_avatar",
		])
		.where("l.state", "in", ["Finished", "Forfeited"])
		.where((eb) => eb.or([
			eb("l.event_type", "=", "RANKED"),
			eb.and([eb("l.event_type", "=", "TOURNAMENT"), eb("l.ranked_elo_applied", "=", true)]),
		]));
	if (mode !== null && Number.isFinite(mode)) request = request.where("l.mode", "=", mode);
	const rows = await db
		.selectFrom(
			request
				.distinctOn("l.id")
				.orderBy("l.id")
				.orderBy("opp.user_id")
				.as("ranked_history")
		)
		.selectAll()
		.orderBy("created_at", "desc")
		.limit(limit)
		.offset(offset)
		.execute();
	const avatar = (id: string, value: string | null) => {
		if (value?.startsWith("http")) return value;
		try { return `https://cdn.discordapp.com/embed/avatars/${(BigInt(id) >> 22n) % 6n}.png`; }
		catch { return "https://cdn.discordapp.com/embed/avatars/0.png"; }
	};
	return rows.map((row) => {
		const mine = Number(row.my_score ?? 0);
		const theirs = Number(row.opp_score ?? 0);
		const forfeited = Boolean(row.my_forfeit);
		const opponentForfeited = Boolean(row.opp_forfeit);
		return {
			lobbyId: Number(row.lobby_id), mode: Number(row.mode), state: String(row.state),
			endedAt: new Date(row.created_at).toISOString(), myScore: mine, opponentScore: theirs,
			eloDelta: Number(row.my_elo_delta ?? 0),
			result: forfeited ? "forfeit" : opponentForfeited || mine > theirs ? "win" : mine < theirs ? "loss" : "draw",
			opponent: { userId: String(row.opp_user_id), displayName: row.opp_display_name ?? row.opp_username ?? String(row.opp_user_id), avatar: avatar(String(row.opp_user_id), row.opp_avatar) },
		};
	});
}

/** Player routes backed by the unified API. */
export const usersController = new Elysia({ prefix: "/users" })
	.use(dbPlugin)
	.get("/me/ranked-history", async ({ db, headers, query }) => {
		const session = await resolveAchilleaSession(headers);
		if (!session) return status(401, { message: "Authentication required" as const });
		return (await rankedHistory(db, session.id, query)) ?? [];
	}, {
		query: t.Object({ mode: t.Optional(t.Numeric()), limit: t.Optional(t.Numeric()), offset: t.Optional(t.Numeric()) }),
		response: { 200: t.Array(t.Any()), 401: t.Object({ message: t.Literal("Authentication required") }) },
	})
	.get("/me/ranked-trend", async ({ db, headers, query }) => {
		const session = await resolveAchilleaSession(headers);
		if (!session) return status(401, { message: "Authentication required" as const });
		const days = Math.max(1, Math.min(90, Number(query.days ?? 7) || 7));
		const last = Math.max(1, Math.min(50, Number(query.last ?? 20) || 20));
		const mode = query.mode == null ? null : Number(query.mode);
		const modeClause = mode !== null && Number.isFinite(mode) ? sql`and l.mode = ${mode}` : sql``;
		const spark = await sql<{ delta: number | string }>`
			select lu.elo_variation as delta
			from lobby l join lobby_user lu on lu.lobby_id = l.id and lu.user_id = ${session.id}
			where l.event_type = 'RANKED' and l.state in ('Finished', 'Forfeited') ${modeClause}
			order by l.created_at desc limit ${last}
		`.execute(db);
		const period = await sql<{ delta_total: number | string; games: number | string; wins: number | string }>`
			select coalesce(sum(lu.elo_variation), 0) as delta_total, count(*) as games,
			count(*) filter (where not lu.forfeit and exists (
				select 1 from lobby_user opp
				where opp.lobby_id = l.id and opp.user_id <> lu.user_id
				and (opp.forfeit or lu.score > opp.score)
			)) as wins
			from lobby l join lobby_user lu on lu.lobby_id = l.id and lu.user_id = ${session.id}
			where l.event_type = 'RANKED' and l.state in ('Finished', 'Forfeited')
			and l.created_at >= now() - (${days} || ' days')::interval ${modeClause}
		`.execute(db);
		const row = period.rows[0];
		const games = Number(row?.games ?? 0);
		return {
			sparkline: spark.rows.map((item) => Number(item.delta ?? 0)).reverse(),
			deltaPeriod: Number(row?.delta_total ?? 0), gamesInPeriod: games,
			winRatePeriod: games > 0 ? Number(row?.wins ?? 0) / games : 0, days,
		};
	}, {
		query: t.Object({ mode: t.Optional(t.Numeric()), days: t.Optional(t.Numeric()), last: t.Optional(t.Numeric()) }),
		response: { 200: t.Any(), 401: t.Object({ message: t.Literal("Authentication required") }) },
	})
	.get("/:id/ranked-history", async ({ db, params: { id }, query }) => {
		const history = await rankedHistory(db, id, query);
		return history ?? status(404, { message: "User not found" as const });
	}, {
		params: t.Object({ id: t.String() }),
		query: t.Object({ mode: t.Optional(t.Numeric()), limit: t.Optional(t.Numeric()), offset: t.Optional(t.Numeric()) }),
		response: { 200: t.Array(t.Any()), 404: t.Object({ message: t.Literal("User not found") }) },
	})
	.get("/:id", async ({ db, params: { id } }) => {
		const user = await db.selectFrom("user").select(["id", "username", "display_name", "avatar", "role", "bio", "twitch_url", "last_interact"]).where("id", "=", id).executeTakeFirst();
		if (!user) return status(404, { message: "User not found" as const });
		const [elos, ranks, clan, publicProfile, rankedStats] = await Promise.all([
			db.selectFrom("user_elo").select(["mode", "elo", "games_played", "wins", "losses"]).where("user_id", "=", id).execute(),
			db.selectFrom("rank").selectAll().orderBy("min_elo", "asc").execute(),
			db.selectFrom("clan_member as cm").innerJoin("clan as c", "c.id", "cm.clan_id").select(["cm.clan_id", "cm.role", "cm.distinctions", "c.name", "c.shortened_name", "c.clan_avatar_url"]).where("cm.user_id", "=", id).executeTakeFirst(),
			findLinkedPublicProfile(db, id),
			sql<{ mode: number; total: number | string; wins: number | string; losses: number | string; draws: number | string; goals_scored: number | string; goals_received: number | string }>`
				with user_matches as (
					select l.id as lobby_id, l.mode, me.score as my_score, opp.score as opp_score,
						me.forfeit as my_forfeit, opp.forfeit as opp_forfeit
					from lobby l
					join lobby_user me on me.lobby_id = l.id and me.user_id = ${id}
					join lobby_user opp on opp.lobby_id = l.id and opp.team <> me.team
					where l.state in ('Finished', 'Forfeited')
					and (l.event_type = 'RANKED' or (l.event_type = 'TOURNAMENT' and l.ranked_elo_applied = true))
				), stats as (
					select mode, count(distinct lobby_id) as total,
						count(distinct case when not my_forfeit and (opp_forfeit or my_score > opp_score) then lobby_id end) as wins,
						count(distinct case when my_forfeit or (not opp_forfeit and my_score < opp_score) then lobby_id end) as losses,
						count(distinct case when not my_forfeit and not opp_forfeit and my_score = opp_score then lobby_id end) as draws
					from user_matches group by mode
				), goals as (
					select mode, sum(my_score)::bigint as goals_scored, sum(opp_score)::bigint as goals_received
					from (select distinct lobby_id, mode, my_score, opp_score from user_matches
						where not my_forfeit and not opp_forfeit) scored
					group by mode
				)
				select stats.*, coalesce(goals.goals_scored, 0) as goals_scored,
					coalesce(goals.goals_received, 0) as goals_received
				from stats left join goals on goals.mode = stats.mode
			`.execute(db).then((result) => result.rows),
		]);
		const modeStats = (mode: number) => {
			const row = elos.find((elo) => Number(elo.mode) === mode);
			const matches = rankedStats.find((stats) => Number(stats.mode) === mode);
			const rating = Number(row?.elo ?? 0);
			const tier = ranks.find((rank) => rating >= rank.min_elo && rating <= rank.max_elo);
			return {
				mode, total: Number(matches?.total ?? 0), wins: Number(matches?.wins ?? 0), losses: Number(matches?.losses ?? 0),
				draws: Number(matches?.draws ?? 0), goalsScored: Number(matches?.goals_scored ?? 0), goalsReceived: Number(matches?.goals_received ?? 0),
				rank: { elo: rating, key: tier?.key ?? "Non classé", gradient: tier?.gradient ?? [] },
			};
		};
		const solo = modeStats(2); const duo = modeStats(4);
		const avatar = (() => {
			if (user.avatar?.startsWith("http")) return user.avatar;
			try {
				return `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) >> 22n) % 6n}.png`;
			} catch {
				return "https://cdn.discordapp.com/embed/avatars/0.png";
			}
		})();
		const emptyCompetition = { total: 0, wins: 0, losses: 0, draws: 0, goalsScoredAvg: 0, goalsReceivedAvg: 0, personalTotal: 0, personalWins: 0, personalLosses: 0, personalDraws: 0 };
		const identity = projectPublicIdentity(publicProfile, { username: user.display_name ?? user.username ?? user.id, avatar, bio: user.bio ?? null });
		return {
			id: user.id, type: "user", username: identity.username, sim: 0,
			avatar: identity.avatar ?? avatar, rgProfileUsername: publicProfile?.username ?? undefined,
			clanId: clan?.clan_id ?? null, soloRank: solo.rank, duoRank: duo.rank, lastInteract: user.last_interact, role: Number(user.role ?? 0),
			bio: identity.bio, twitchUrl: user.twitch_url ?? null, hasTwitch: Boolean(user.twitch_url), hasChallonge: false, hasYoutube: false,
			clan: clan ? { id: clan.clan_id, shortenedName: clan.shortened_name, name: clan.name, avatarUrl: clan.clan_avatar_url, role: Number(clan.role), distinctions: clan.distinctions ?? [] } : undefined,
			interclans: emptyCompetition, tournaments: emptyCompetition, ranked: { solo: { ...solo, rank: undefined }, duo: { ...duo, rank: undefined } },
		};
	}, {
		params: t.Object({ id: t.String() }), response: { 200: UsersModel.publicProfile, 404: t.Object({ message: t.Literal("User not found") }) },
	})
	.get("/me", async ({ db, headers }) => {
		const session = await resolveAchilleaSession(headers);
		if (!session) return status(401, { message: "Authentication required" as const });
		const user = await db.selectFrom("user")
			.select(["id", "username", "display_name", "avatar", "role"])
			.where("id", "=", session.id)
			.executeTakeFirst();
		if (!user) return status(404, { message: "User not found" as const });
		const [clan, connection, publicProfile] = await Promise.all([
			db.selectFrom("clan_member").select("clan_id").where("user_id", "=", session.id).executeTakeFirst(),
			db.selectFrom("user_connection").select("user_id")
				.where("user_id", "=", session.id).where("provider", "=", "challonge").executeTakeFirst(),
			findLinkedPublicProfile(db, session.id),
		]);
		const avatar = user.avatar
			? user.avatar.startsWith("http") ? user.avatar : `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png`
			: `https://cdn.discordapp.com/embed/avatars/${(BigInt(user.id) >> 22n) % 6n}.png`;
		const identity = projectPublicIdentity(publicProfile, { username: user.username ?? session.username ?? "", avatar, bio: null });
		return {
			id: user.id, username: identity.username, displayName: publicProfile?.username ?? user.display_name ?? "",
			avatar: identity.avatar ?? avatar, rgProfileUsername: publicProfile?.username ?? undefined,
			role: Number(user.role ?? 0), clanId: clan?.clan_id ?? null, hasChallonge: Boolean(connection),
		};
	}, {
		response: {
			200: UsersModel.enriched,
			401: t.Object({ message: t.Literal("Authentication required") }),
			404: t.Object({ message: t.Literal("User not found") }),
		},
	})
	.put("/me/profile", async ({ db, headers, body }) => {
		const session = await resolveAchilleaSession(headers);
		if (!session) return status(401, { message: "Authentication required" as const });
		const bio = body.bio?.trim() || null;
		const twitchUrl = body.twitchUrl?.trim() || null;
		if (bio && bio.length > 500) return status(400, { message: "Bio too long" as const });
		if (twitchUrl) {
			try {
				if (new URL(twitchUrl).hostname.replace(/^www\./, "") !== "twitch.tv") throw new Error();
			} catch {
				return status(400, { message: "Invalid Twitch URL" as const });
			}
		}
		const current = await db.selectFrom("user").select(["id", "username", "display_name", "avatar", "twitch_url"]).where("id", "=", session.id).executeTakeFirst();
		if (!current) return status(404, { message: "User not found" as const });
		const publicProfile = await findLinkedPublicProfile(db, session.id);
		if (body.bio !== undefined && !publicProfile) return status(409, { message: "Rose Griffon profile required" as const });
		await db.transaction().execute(async (trx) => {
			if (body.bio !== undefined && publicProfile) {
				await sql`update public.profiles set bio = ${bio}, updated_at = now()
					where id::text = ${publicProfile.id} and claimed_at is not null`.execute(trx);
			}
			if (body.twitchUrl !== undefined) {
				await trx.updateTable("user").set({ twitch_url: twitchUrl }).where("id", "=", session.id).execute();
			}
		});
		return { id: current.id, username: publicProfile?.username ?? current.username, displayName: publicProfile?.username ?? current.display_name ?? "", avatar: publicProfile?.avatar_url ?? current.avatar, bio: body.bio === undefined ? publicProfile?.bio ?? null : bio, twitchUrl: body.twitchUrl === undefined ? current.twitch_url : twitchUrl };
	}, {
		body: t.Object({ bio: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))), twitchUrl: t.Optional(t.Nullable(t.String({ maxLength: 500 }))) }),
		response: { 200: UsersModel.profile, 400: t.Object({ message: t.String() }), 401: t.Object({ message: t.Literal("Authentication required") }), 404: t.Object({ message: t.Literal("User not found") }), 409: t.Object({ message: t.Literal("Rose Griffon profile required") }) },
	})
	.get("/leaderboard", async ({ db, query }) => {
		const mode = Number(query.mode ?? 2);
		const season = query.season?.trim() || null;
		const page = await LeaderboardService.findTop(db, mode, season, query.limit, query.offset);
		return { entries: page.data, total: page.count, mode };
	}, {
		query: t.Object({
			mode: t.Optional(t.Numeric()), season: t.Optional(t.String()),
			limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })),
			offset: t.Optional(t.Numeric({ minimum: 0 })),
		}),
		response: { 200: UsersModel.leaderboard },
	});
