import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import { sql as kyselySql } from "kysely";

import { Service } from "@/decorators";
import type { UserRole } from "../utils/enums";

export type Suggestion = {
	id: string;
	type: "clan" | "user";
	label: string;
	sim: number;
	clanShortName?: string;
	avatar?: string;
	soloRank: SuggestionRank;
	duoRank: SuggestionRank;
	lastInteract?: Date;
	role?: UserRole;
	currentLevel?: number;
	totalXp?: number;
	hasTwitch?: boolean;
	hasChallonge?: boolean;
	hasYoutube?: boolean;
};

export type SuggestionRank = { elo: number; key: string; gradient: string[] };

interface SuggestionDatabase {
	user_view: unknown;
	clan_member: unknown;
	clan: unknown;
}

const db = createAchilleaSql<SuggestionDatabase>();

@Service()
export class Suggestions {
	async searchAll(query: string): Promise<Suggestion[]> {
		if (!query) return [];
		const term = query.toLowerCase();
		const [clans, players] = await Promise.all([this.searchClans(term), this.searchPlayers(term)]);
		return [...clans, ...players].toSorted((a, b) => b.sim - a.sim).slice(0, 5);
	}

	async searchClans(query: string): Promise<Suggestion[]> {
		if (!query) return [];
		const term = query.toLowerCase();
		const { rows } = await kyselySql<SuggestionClanRow>`
			SELECT id, name, shortened_name, clan_avatar_url,
				GREATEST(similarity(name, ${term}), similarity(shortened_name, ${term}),
					similarity(normalized_short_name, ${term})) AS sim
			FROM clan
			WHERE name % ${term} OR shortened_name % ${term} OR normalized_short_name % ${term}
			ORDER BY sim DESC LIMIT 5
		`.execute(db);

		return rows.map((clan) => ({
			id: String(clan.id), type: "clan" as const, label: clan.name,
			avatar: clan.clan_avatar_url ?? undefined, sim: Number(clan.sim ?? 0),
			clanShortName: clan.shortened_name, soloRank: emptyRank(), duoRank: emptyRank(),
		}));
	}

	async searchPlayers(query: string): Promise<Suggestion[]> {
		if (!query) return [];
		const term = query.toLowerCase();
		let rows: SuggestionUserRow[];
		try {
			rows = (await kyselySql<SuggestionUserRow>`
				SELECT u.id, u.username, u."displayName", u."lastInteract", u.role,
					u."currentLevel", u."totalXp", u.solo_elo, u.solo_key, u.duo_elo, u.duo_key,
					u."hasTwitch" AS has_twitch, u."hasChallonge" AS has_challonge,
					u."hasYoutube" AS has_youtube, c.shortened_name AS clan_short_name,
					GREATEST(similarity(u.username, ${term}), similarity(u."displayName", ${term}),
						similarity(u."normalizedDisplayName", ${term})) AS sim
				FROM user_view u
				LEFT JOIN clan_member cm ON cm.user_id = u.id
				LEFT JOIN clan c ON c.id = cm.clan_id
				WHERE (u.username % ${term} OR u."displayName" % ${term}
					OR u."normalizedDisplayName" % ${term})
					AND NOT COALESCE(u."isBlacklisted", false)
				ORDER BY sim DESC LIMIT 8
			`.execute(db)).rows;
		} catch (error) {
			console.error("[suggestions] fuzzy search failed, using ILIKE fallback:", (error as Error)?.message);
			const like = `%${term}%`;
			rows = (await kyselySql<SuggestionUserRow>`
				SELECT u.id, u.username, u."displayName", u."lastInteract", u.role,
					u."currentLevel", u."totalXp", u.solo_elo, u.solo_key, u.duo_elo, u.duo_key,
					u."hasTwitch" AS has_twitch, u."hasChallonge" AS has_challonge,
					u."hasYoutube" AS has_youtube, c.shortened_name AS clan_short_name, 1.0 AS sim
				FROM user_view u
				LEFT JOIN clan_member cm ON cm.user_id = u.id
				LEFT JOIN clan c ON c.id = cm.clan_id
				WHERE (u.username ILIKE ${like} OR u."displayName" ILIKE ${like}
					OR u."normalizedDisplayName" ILIKE ${like})
					AND NOT COALESCE(u."isBlacklisted", false)
				ORDER BY u."displayName" ASC LIMIT 8
			`.execute(db)).rows;
		}

		return rows.map((user) => ({
			id: String(user.id), type: "user" as const,
			label: user.displayName ?? user.username ?? String(user.id),
			lastInteract: user.lastInteract ?? undefined, role: user.role as UserRole | undefined,
			currentLevel: user.currentLevel ?? undefined, totalXp: user.totalXp ?? undefined,
			soloRank: { elo: Number(user.solo_elo ?? 0), key: user.solo_key ?? "Fer", gradient: [] },
			duoRank: { elo: Number(user.duo_elo ?? 0), key: user.duo_key ?? "Fer", gradient: [] },
			hasTwitch: !!user.has_twitch, hasChallonge: !!user.has_challonge,
			hasYoutube: !!user.has_youtube, clanShortName: user.clan_short_name ?? undefined,
			sim: Number(user.sim ?? 0),
		}));
	}
}

interface SuggestionClanRow {
	id: number; name: string; shortened_name: string; clan_avatar_url: string | null; sim: number;
}

interface SuggestionUserRow {
	id: string; username: string | null; displayName: string | null; lastInteract: Date | null;
	role: number | null; currentLevel: number | null; totalXp: number | null;
	solo_elo: number | null; solo_key: string | null; duo_elo: number | null; duo_key: string | null;
	has_twitch: boolean | null; has_challonge: boolean | null; has_youtube: boolean | null;
	clan_short_name: string | null; sim: number;
}

function emptyRank(): SuggestionRank { return { elo: 0, key: "Fer", gradient: [] }; }
