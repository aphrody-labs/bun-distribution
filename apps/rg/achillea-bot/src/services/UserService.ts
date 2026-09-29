import type { Guild } from "discord.js";
import { Client } from "@aphrody/discordx";
import { CompiledQuery, type Kysely } from "kysely";
import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";

import { Service } from "@/decorators";
import { UserView } from "@/entities";
import {
	freshDiscordAvatarUrl,
	hasActiveClanMembership,
	normalizeNames,
	resolveDiscordAvatarUrl,
	syncUser,
} from "@/utils/functions";

import type { EnrichedUserDTO } from "../api/models/dtos/enrichedUserDTO";
import { ClanMemberDistinction, MatchMode, Provider } from "../utils/enums";
import type { LobbyUserStruct } from "../utils/types/lobbyStruct";
import { Database } from "./Database";
import type { SuggestionRank } from "./Suggestions";

function emptyCompetitionStats() {
	return {
		total: 0,
		wins: 0,
		losses: 0,
		draws: 0,
		goalsScoredAvg: 0,
		goalsReceivedAvg: 0,
		personalTotal: 0,
		personalDraws: 0,
		personalLosses: 0,
		personalWins: 0,
	};
}

interface UserServiceSqlDatabase {
	query_boundary: never;
	user: {
		id: string;
		blacklist_id: number | null;
		avatar: string | null;
		username: string | null;
		display_name: string;
		normalized_display_name: string;
		bio: string | null;
		twitch_url: string | null;
	};
	user_view: UserViewSqlRow;
	user_elo: { user_id: string; mode: number; elo: number };
	user_connection: { user_id: string; provider: string; external_id: string | null; external_username: string | null };
	rank: { key: string; gradient: string[] };
	clan_member: { user_id: string; clan_id: number; role: number; distinctions: string[] };
	clan: { id: number; normalized_short_name: string; clan_emoji_id: string; shortened_name: string; name: string; clan_avatar_url: string };
}

interface UserViewSqlRow {
	id: string;
	username: string;
	lastInteract: Date;
	role: number;
	currentLevel: number;
	totalXp: number;
	clanId: number | null;
	solo_elo: number | null;
	solo_key: string | null;
	duo_elo: number | null;
	duo_key: string | null;
	hasTwitch: boolean;
	hasChallonge: boolean;
	hasYoutube: boolean;
	displayName: string;
	normalizedDisplayName: string;
	isBlacklisted: boolean;
}

const sqlDb = createAchilleaSql<UserServiceSqlDatabase>() as Kysely<UserServiceSqlDatabase>;

@Service()
export class UserService {
	constructor(
		private db: Database
	) {}

	private get client(): Client {
		const client = (globalThis as typeof globalThis & { __roseGriffonDiscordClient?: Client }).__roseGriffonDiscordClient;
		if (!client) throw new Error("Discord client is not initialized");
		return client;
	}

	async getUserDTO(userId: string): Promise<UserDTO> {
		const userView = await sqlDb.selectFrom("user_view").selectAll().where("id", "=", userId).executeTakeFirst();

		// fallback if no UserView yet
		if (!userView) {
			return {
				id: userId,
				type: "user",
				username: "Utilisateur inconnu",
				sim: 0,
				soloRank: { elo: 0, key: "Non classé", gradient: [] } as SuggestionRank,
				duoRank: { elo: 0, key: "Non classé", gradient: [] } as SuggestionRank,
			} as UserDTO;
		}

		// Avatar stocké (sync Discord) — normalisé (gif animé, fallback embed).
		// Pas de fetch Discord live ici (évite N+1 sur les listes tournoi).
		const user = await sqlDb.selectFrom("user").select("avatar").where("id", "=", userId).executeTakeFirst();
		const avatar = resolveDiscordAvatarUrl(userId, user?.avatar);

		return await this.toDTO(userView as unknown as UserView, avatar, 0);
	}

	async isBlacklisted(userId: string): Promise<boolean> {
		const row = await sqlDb
			.selectFrom("user")
			.select("blacklist_id")
			.where("id", "=", userId)
			.executeTakeFirst();
		return row?.blacklist_id !== null && row?.blacklist_id !== undefined;
	}

	async isClanMember(userId: string) {
		// Une adhésion à un Clan inactif ne bloque pas (transfert/prêt implicite).
		return hasActiveClanMembership(userId, this.db.em);
	}

	async getLobbyPlayerInfo(userId: string, mode: MatchMode) {
		const [user, eloEntry, twitchConn] = await Promise.all([
			sqlDb.selectFrom("user").select("id").where("id", "=", userId).executeTakeFirst(),
			sqlDb.selectFrom("user_elo").select(["elo"]).where("user_id", "=", userId).where("mode", "=", mode).executeTakeFirst(),
			sqlDb.selectFrom("user_connection").select(["external_id", "external_username"]).where("user_id", "=", userId).where("provider", "=", Provider.TWITCH).executeTakeFirst(),
		]);

		if (!user) {
			throw new Error(`User not found: ${userId}`);
		}

		const elo = eloEntry?.elo ?? 0;
		const twitchId = twitchConn?.external_id;
		const twitchLogin = twitchConn?.external_username;

		return { userId, elo, twitchId, twitchLogin } as LobbyUserStruct;
	}

	/**
	 * Fetch the Discord username and, if they have a ClanMember record,
	 * lookup its Clan and append `<:shortName:emojiId>` to the name.
	 */
	async getDisplayNameWithClan(userId: string, isFirst: boolean, guild: Guild): Promise<string> {
		// 1) fetch the Discord user (for their username)
		const user = await guild.members.fetch(userId);

		// 2) check clan membership
		const cm = await sqlDb
			.selectFrom("clan_member")
			.innerJoin("clan", "clan.id", "clan_member.clan_id")
			.select([
				"clan.normalized_short_name",
				"clan.clan_emoji_id",
			])
			.where("clan_member.user_id", "=", userId)
			.executeTakeFirst();
		let name = "";

		// 3) if they’re in a clan, append its emoji
		if (isFirst) {
			if (cm) {
				name += `<:${cm.normalized_short_name}:${cm.clan_emoji_id}>`;
			} else {
				name += `<:Achillea:1391477048488497212>`; // Default emoji if not in a clan
			}

			name += ` ${user.displayName}`;
		} else {
			name += `${user.displayName} `;
			if (cm) {
				name += `<:${cm.normalized_short_name}:${cm.clan_emoji_id}>`;
			} else {
				name += `<:Achillea:1391477048488497212>`; // Default emoji if not in a clan
			}
		}

		return name;
	}

	async getDiscordUser(userId: string) {
		// 1️⃣ Try cache first (fast, no API call)
		const cached = this.client.users.cache.get(userId);
		if (cached) return cached;

		// 2️⃣ Fallback to Discord API
		try {
			return await this.client.users.fetch(userId);
		} catch {
			return null;
		}
	}

	async getUserAsGuildMember(guild: Guild, userId: string) {
		return await guild.members.fetch(userId);
	}

	async getUserData(userId: string) {
		const row = await sqlDb.selectFrom("user_view").selectAll().where("id", "=", userId).executeTakeFirst();
		return (row as unknown as UserView | undefined) ?? null;
	}

	async syncWebUser(userId: string) {
		const dUser = await this.getDiscordUser(userId);
		if (dUser) {
			await syncUser(dUser);
			await sqlDb.executeQuery(
				CompiledQuery.raw('UPDATE "user" SET last_interact = NOW() WHERE id = $1', [dUser.id])
			);
		}
		// Discord injoignable (ou utilisateur de test) → on retombe sur la donnée stockée.
		// La protection contre les jetons forgés reste la vérification centralisée du JWT
		// (signature, audience et usage) ; en complément, getUserData renvoie null
		// pour un id sans ligne user_view → un jeton signé pointant un user inexistant est aussi rejeté.
		return await this.getUserData(userId);
	}

	/**
	 * Rafraîchit `user.avatar` depuis Discord pour **tous** les comptes.
	 * Les URLs CDN Discord deviennent 404 dès qu'un joueur change d'avatar.
	 * Batché (10 / lot, 1.2 s) pour le rate-limit Discord.
	 */
	async resyncAvatars(): Promise<{ scanned: number; updated: number; failed: number }> {
		const all = await sqlDb
			.selectFrom("user")
			.select(["id", "avatar", "username", "display_name", "normalized_display_name"])
			.execute();
		let updated = 0;
		let failed = 0;
		const CHUNK = 10;
		for (let i = 0; i < all.length; i += CHUNK) {
			const rows = all.slice(i, i + CHUNK);
			const changes: Array<[string, string | null, string | null, string, string]> = [];
			await Promise.all(rows.map(async (u) => {
					try {
						const d = await this.getDiscordUser(u.id);
						if (!d) {
							// Discord introuvable → normalise l'URL stockée / fallback embed
							const normalized = resolveDiscordAvatarUrl(u.id, u.avatar);
							if (u.avatar !== normalized) {
								changes.push([u.id, normalized, u.username, u.display_name, u.normalized_display_name]);
								updated++;
							}
							return;
						}
						const url = freshDiscordAvatarUrl(d);
						// username/displayName sont NOT NULL en base : jamais d'écrasement
						// par une valeur Discord vide (payload partiel/inconnu de discord.js).
						const safeUsername = d.username || u.username || "";
						const safeDisplayName = d.displayName || safeUsername || u.display_name;
						if (
							u.avatar !== url ||
							u.username !== safeUsername ||
							u.display_name !== safeDisplayName
						) {
							changes.push([u.id, url, safeUsername, safeDisplayName, normalizeNames(safeDisplayName)]);
							updated++;
						}
					} catch {
						failed++;
					}
				}));
			if (changes.length) {
				const placeholders = changes
					.map((_, index) => {
						const base = index * 5;
						return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
					})
					.join(", ");
				await sqlDb.executeQuery(
					CompiledQuery.raw(
						`UPDATE "user" AS u
						 SET avatar = v.avatar, username = v.username,
						     display_name = v.display_name, normalized_display_name = v.normalized_display_name
						 FROM (VALUES ${placeholders}) AS v(id, avatar, username, display_name, normalized_display_name)
						 WHERE u.id = v.id`,
						changes.flatMap((change) => change)
					)
				);
			}
			if (i + CHUNK < all.length) await new Promise((r) => setTimeout(r, 1200));
		}
		return { scanned: all.length, updated, failed };
	}

	/**
	 * Crée un utilisateur de test ANONYME (id factice en forme de snowflake) pour tester le
	 * ranked sans login Discord réel. La ligne `user` suffit : `user_view` se dérive seule et
	 * le ranked crée l'`user_elo` à la volée (getOrCreateElo). Réservé au flux /auth/test-login
	 * (gardé par un secret), jamais déclenché par un vrai login.
	 */
	async createTestUser(): Promise<{ id: string; username: string; avatar: string }> {
		const id = `99${Date.now()}${Math.floor(Math.random() * 900 + 100)}`; // 18-19 chiffres, préfixe 99
		const tag = id.slice(-4);
		const displayName = `Testeur ${tag}`;
		const avatar = `https://cdn.discordapp.com/embed/avatars/${Number(id.slice(-1)) % 6}.png`;
		const username = `tester_${tag}`;
		await sqlDb.executeQuery(
			CompiledQuery.raw(
				`INSERT INTO "user" (id, last_interact, role, username, avatar, display_name, normalized_display_name)
				 VALUES ($1, NOW(), 0, $2, $3, $4, $5)`,
				[id, username, avatar, displayName, normalizeNames(displayName)]
			)
		);
		return { id, username, avatar };
	}

	async toDTO(userView: UserView, avatar: string, sim: number): Promise<UserDTO> {
		const rankKeys = [userView.solo_key, userView.duo_key].filter(
			(key): key is string => Boolean(key)
		);
		const ranks = rankKeys.length
			? await sqlDb.selectFrom("rank").select(["key", "gradient"]).where("key", "in", rankKeys).execute()
			: [];
		const rankByKey = new Map(ranks.map((rank) => [rank.key, rank]));
		const soloRank = userView.solo_key ? rankByKey.get(userView.solo_key) : undefined;
		const duoRank = userView.duo_key ? rankByKey.get(userView.duo_key) : undefined;

		return {
			id: userView.id,
			type: "user",
			username: userView.displayName,
			clanId: userView.clanId,
			sim,
			avatar,
			soloRank: {
				elo: userView.solo_elo ?? 0,
				key: userView.solo_key || "Non classé",
				gradient: soloRank?.gradient ?? [],
			},
			duoRank: {
				elo: userView.duo_elo ?? 0,
				key: userView.duo_key || "Non classé",
				gradient: duoRank?.gradient ?? [],
			},
			lastInteract: userView.lastInteract,
			role: userView.role,
			currentLevel: userView.currentLevel,
			totalXp: userView.totalXp,
			hasTwitch: userView.hasTwitch,
			hasChallonge: userView.hasChallonge,
			hasYoutube: userView.hasYoutube,
		};
	}

	async getEnrichedUserDTO(userId: string): Promise<EnrichedUserDTO | null> {
		const userData = await this.getUserData(userId);
		if (!userData) return null;
		const discordUser = await this.getDiscordUser(userId);
		if (!discordUser) return null;
		const stored = await sqlDb
			.selectFrom("user")
			.select(["avatar", "bio", "twitch_url"])
			.where("id", "=", userId)
			.executeTakeFirst();
		// Profil enrichi : avatar frais Discord si dispo, sinon stock normalisé.
		let avatar = resolveDiscordAvatarUrl(userId, undefined);
		if (discordUser) {
			avatar = freshDiscordAvatarUrl(discordUser);
			// Persiste le refresh pour les listes (qui lisent la colonne stockée)
			try {
				if (stored && stored.avatar !== avatar) {
					await sqlDb
						.updateTable("user")
						.set({
							avatar,
							username: discordUser.username,
							display_name: discordUser.displayName,
							normalized_display_name: normalizeNames(discordUser.displayName),
						})
						.where("id", "=", userId)
						.execute();
				}
			} catch {
				/* non bloquant */
			}
		}
		const userDTO = await this.toDTO(userData, avatar, 0);
		// bio/twitchUrl : éditables par le titulaire (PUT /users/me/profile), pas dans UserView.

		const dto: EnrichedUserDTO = {
			id: userDTO.id,
			clanId: userDTO.clanId,
			type: userDTO.type,
			username: userDTO.username,
			sim: userDTO.sim,
			avatar: userDTO.avatar,
			soloRank: userDTO.soloRank,
			duoRank: userDTO.duoRank,
			bio: stored?.bio ?? null,
			twitchUrl: stored?.twitch_url ?? null,
			lastInteract: userDTO.lastInteract,
			role: userDTO.role,
			currentLevel: userDTO.currentLevel,
			totalXp: userDTO.totalXp,
			hasTwitch: userDTO.hasTwitch,
			hasChallonge: userDTO.hasChallonge,
			hasYoutube: userDTO.hasYoutube,

			interclans: emptyCompetitionStats(),
			tournaments: emptyCompetitionStats(),
			ranked: {
				solo: {
					mode: MatchMode.ONE_VS_ONE,
					total: 0,
					wins: 0,
					losses: 0,
					draws: 0,
					goalsScored: 0,
					goalsReceived: 0,
				},
				duo: {
					mode: MatchMode.TWO_VS_TWO,
					total: 0,
					wins: 0,
					losses: 0,
					draws: 0,
					goalsScored: 0,
					goalsReceived: 0,
				},
			},
		};

		// 🏰 Clan info
		if (userDTO.clanId) {
			const clanMember = await sqlDb
				.selectFrom("clan_member")
				.innerJoin("clan", "clan.id", "clan_member.clan_id")
				.select([
					"clan.id",
					"clan.shortened_name",
					"clan.name",
					"clan.clan_avatar_url",
					"clan_member.role",
					"clan_member.distinctions",
				])
				.where("clan_member.user_id", "=", userDTO.id)
				.executeTakeFirst();
			if (clanMember) {
				dto.clan = {
					id: clanMember.id,
					shortenedName: clanMember.shortened_name,
					name: clanMember.name,
					avatarUrl: clanMember.clan_avatar_url,
					role: clanMember.role,
					distinctions: clanMember.distinctions as ClanMemberDistinction[],
				};
			} else {
				userDTO.clanId = undefined;
			}
		}

		const interclanStats = await this.getInterclanStatsForUser(userDTO.id);
		if (interclanStats) dto.interclans = interclanStats;

		const tournamentStats = await this.getTournamentStatsForUser(userDTO.id);
		if (tournamentStats) dto.tournaments = tournamentStats;

		const rankedStats = await this.getRankedStatsForUser(userDTO.id);
		if (rankedStats?.length) {
			const solo = rankedStats.find((r) => r.mode === MatchMode.ONE_VS_ONE) ?? {
				mode: MatchMode.ONE_VS_ONE,
				total: 0,
				wins: 0,
				losses: 0,
				draws: 0,
				goalsScored: 0,
				goalsReceived: 0,
			};
			const duo = rankedStats.find((r) => r.mode === MatchMode.TWO_VS_TWO) ?? {
				mode: MatchMode.TWO_VS_TWO,
				total: 0,
				wins: 0,
				losses: 0,
				draws: 0,
				goalsScored: 0,
				goalsReceived: 0,
			};
			dto.ranked = { solo, duo };
		}

		return dto;
	}

	/** Stats de matchs de tournoi (brackets / swiss) pour le profil. */
	async getTournamentStatsForUser(userId: string) {
		const sql = `
			WITH participations AS (
				SELECT COUNT(DISTINCT l.event_id) AS total
				FROM lobby_user lu
				JOIN lobby l ON l.id = lu.lobby_id
				WHERE lu.user_id = ?
				  AND l.event_type = 'TOURNAMENT'
				  AND l.state IN ('Finished', 'Forfeited')
			),
			personal_stats AS (
				SELECT
					COUNT(*) AS personal_total,
					COUNT(CASE
						WHEN lu.forfeit THEN NULL
						WHEN opp.forfeit THEN 1
						WHEN lu.score > opp.score THEN 1
					END) AS personal_wins,
					COUNT(CASE
						WHEN lu.forfeit THEN 1
						WHEN opp.forfeit THEN NULL
						WHEN lu.score < opp.score THEN 1
					END) AS personal_losses,
					COUNT(CASE
						WHEN NOT lu.forfeit AND NOT opp.forfeit AND lu.score = opp.score THEN 1
					END) AS personal_draws
				FROM lobby_user lu
				JOIN lobby l ON l.id = lu.lobby_id
				JOIN lobby_user opp ON opp.lobby_id = l.id AND opp.team <> lu.team
				WHERE l.event_type = 'TOURNAMENT'
				  AND l.state IN ('Finished', 'Forfeited')
				  AND lu.user_id = ?
			),
			goal_avgs AS (
				SELECT
					COALESCE(AVG(lu.score), 0) AS goal_scored_avg,
					COALESCE(AVG(opp.score), 0) AS goal_received_avg
				FROM lobby_user lu
				JOIN lobby l ON l.id = lu.lobby_id
				JOIN lobby_user opp ON opp.lobby_id = l.id AND opp.team <> lu.team
				WHERE l.event_type = 'TOURNAMENT'
				  AND l.state IN ('Finished', 'Forfeited')
				  AND lu.user_id = ?
				  AND NOT lu.forfeit
				  AND NOT opp.forfeit
			)
			SELECT
				p.total,
				ps.personal_total,
				ps.personal_wins,
				ps.personal_losses,
				ps.personal_draws,
				g.goal_scored_avg,
				g.goal_received_avg
			FROM participations p, personal_stats ps, goal_avgs g;
		`;

		const { rows: tournamentRows } = await sqlDb.executeQuery(
			CompiledQuery.raw(sql, [userId, userId, userId])
		);
		const [result] = tournamentRows as Array<Record<string, unknown>>;

		const personalWins = Number(result?.personal_wins ?? 0);
		const personalLosses = Number(result?.personal_losses ?? 0);

		return {
			total: Number(result?.total ?? 0),
			// Pour les tournois, « contrib » = bilan perso (pas de notion de clan)
			wins: personalWins,
			losses: personalLosses,
			draws: Number(result?.personal_draws ?? 0),
			personalTotal: Number(result?.personal_total ?? 0),
			personalWins,
			personalLosses,
			personalDraws: Number(result?.personal_draws ?? 0),
			goalsScoredAvg: Number(result?.goal_scored_avg ?? 0),
			goalsReceivedAvg: Number(result?.goal_received_avg ?? 0),
		};
	}

	async getInterclanStatsForUser(userId: string) {
		const sql = `
			WITH interclan_stats AS (
				SELECT
					COUNT(DISTINCT e.id) AS total,
					COUNT(DISTINCT CASE WHEN e.winner_clan_id::bigint = il.clan_id::bigint THEN e.id END) AS wins,
					COUNT(DISTINCT CASE WHEN e.winner_clan_id IS NOT NULL AND e.winner_clan_id::bigint <> il.clan_id::bigint THEN e.id END) AS losses,
					COUNT(DISTINCT CASE WHEN e.winner_clan_id IS NULL THEN e.id END) AS draws
				FROM interclan_lineup_member ilm
						 JOIN interclan_lineup il ON il.id = ilm.lineup_id
						 JOIN event e ON e.id = il.event_id
				WHERE ilm.user_id = ?
				  AND e."type" = 'INTERCLAN'
				  AND e.state = 7
			),
				 personal_stats AS (
					 SELECT
						 COUNT(*) AS personal_total,
						 COUNT(CASE WHEN lu.score > opp.score THEN 1 END) AS personal_wins,
						 COUNT(CASE WHEN lu.score < opp.score THEN 1 END) AS personal_losses,
						 COUNT(CASE WHEN lu.score = opp.score THEN 1 END) AS personal_draws
					 FROM lobby_user lu
							  JOIN lobby l ON l.id = lu.lobby_id
							  JOIN lobby_user opp ON opp.lobby_id = l.id AND opp.team <> lu.team
							  JOIN event e ON e.id = l.event_id
					 WHERE l.event_type = 'INTERCLAN'
					   AND lu.user_id = ?
					   AND e.state = 7
				 ),
				 goal_avgs AS (
					 SELECT
						 COALESCE(AVG(lu.score), 0) AS goal_scored_avg,
						 COALESCE(AVG(opp.score), 0) AS goal_received_avg
					 FROM lobby_user lu
							  JOIN lobby l ON l.id = lu.lobby_id
							  JOIN lobby_user opp ON opp.lobby_id = l.id AND opp.team <> lu.team
							  JOIN event e ON e.id = l.event_id
					 WHERE l.event_type = 'INTERCLAN'
					   AND lu.user_id = ?
					   AND e.state = 7
				 )
			SELECT
				i.total,
				i.wins,
				i.losses,
				i.draws,
				p.personal_total,
				p.personal_wins,
				p.personal_losses,
				p.personal_draws,
				g.goal_scored_avg,
				g.goal_received_avg
			FROM interclan_stats i, personal_stats p, goal_avgs g;
		`;

		const { rows: interclanRows } = await sqlDb.executeQuery(
			CompiledQuery.raw(sql, [
				userId, // first placeholder → ilm.user_id
				userId, // second placeholder → lu.user_id (personal_stats)
				userId, // third placeholder → lu.user_id (goal_avgs)
			])
		);
		const [result] = interclanRows as Array<Record<string, unknown>>;

		return {
			total: Number(result.total ?? 0),
			wins: Number(result.wins ?? 0),
			losses: Number(result.losses ?? 0),
			draws: Number(result.draws ?? 0),
			personalTotal: Number(result.personal_total ?? 0),
			personalWins: Number(result.personal_wins ?? 0),
			personalLosses: Number(result.personal_losses ?? 0),
			personalDraws: Number(result.personal_draws ?? 0),
			goalsScoredAvg: Number(result.goal_scored_avg ?? 0),
			goalsReceivedAvg: Number(result.goal_received_avg ?? 0),
		};
	}

	/**
	 * Stats ranked affichées sur le profil.
	 * Inclut les matchs file Colyseus (RANKED) ET les matchs de tournoi
	 * dont l'Elo a été appliqué (`ranked_elo_applied`).
	 */
	async getRankedStatsForUser(userId: string) {
		const { rows } = await sqlDb.executeQuery(
			CompiledQuery.raw(
			`
			WITH user_matches AS (
				SELECT
					l.id AS lobby_id,
					l.mode,
					lu.score AS my_score,
					opp.score AS opp_score,
					lu.forfeit AS my_forfeit,
					opp.forfeit AS opp_forfeit
				FROM lobby l
				JOIN lobby_user lu ON lu.lobby_id = l.id AND lu.user_id = ?
				JOIN lobby_user opp ON opp.lobby_id = l.id AND opp.team <> lu.team
				WHERE l.state IN ('Finished', 'Forfeited')
				  AND (
					l.event_type = 'RANKED'
					OR (l.event_type = 'TOURNAMENT' AND l.ranked_elo_applied = true)
				  )
			),
			ranked_stats AS (
				SELECT
					mode,
					COUNT(DISTINCT lobby_id) AS total,
					COUNT(DISTINCT CASE
						WHEN my_forfeit THEN NULL
						WHEN opp_forfeit THEN lobby_id
						WHEN my_score > opp_score THEN lobby_id
					END) AS wins,
					COUNT(DISTINCT CASE
						WHEN my_forfeit THEN lobby_id
						WHEN opp_forfeit THEN NULL
						WHEN my_score < opp_score THEN lobby_id
					END) AS losses,
					COUNT(DISTINCT CASE
						WHEN NOT my_forfeit AND NOT opp_forfeit AND my_score = opp_score THEN lobby_id
					END) AS draws
				FROM user_matches
				GROUP BY mode
			),
			goal_totals AS (
				SELECT
					mode,
					SUM(my_score)::bigint AS goals_scored,
					SUM(opp_score)::bigint AS goals_received
				FROM (
					SELECT DISTINCT lobby_id, mode, my_score, opp_score
					FROM user_matches
					WHERE NOT my_forfeit AND NOT opp_forfeit
				) AS um
				GROUP BY mode
			)
			SELECT
				COALESCE(rs.mode, gt.mode) AS mode,
				COALESCE(rs.total, 0) AS total,
				COALESCE(rs.wins, 0) AS wins,
				COALESCE(rs.losses, 0) AS losses,
				COALESCE(rs.draws, 0) AS draws,
				COALESCE(gt.goals_scored, 0) AS goals_scored,
				COALESCE(gt.goals_received, 0) AS goals_received
			FROM ranked_stats rs
			FULL JOIN goal_totals gt ON gt.mode = rs.mode;
			`,
			[userId]
			)
		);

		return (rows as Array<Record<string, unknown>>).map((r) => ({
			mode: r.mode as MatchMode,
			total: Number(r.total ?? 0),
			wins: Number(r.wins ?? 0),
			losses: Number(r.losses ?? 0),
			draws: Number(r.draws ?? 0),
			goalsScored: Number(r.goals_scored ?? 0),
			goalsReceived: Number(r.goals_received ?? 0),
		}));
	}

}

// Source unique : @rosegriffon/achillea-types (contrat partagé bot ↔ web).
// (RankDTO du package ≡ SuggestionRank ; UserRole = enum partagé.)
import type { UserDTO } from "@rosegriffon/achillea-types";

export type { UserDTO };
