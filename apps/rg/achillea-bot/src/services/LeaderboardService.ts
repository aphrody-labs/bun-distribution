import { singleton } from "tsyringe";
import type { Kysely } from "kysely";
import { sql as sqlTag } from "kysely";

import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import { MatchMode } from "@/utils/enums";

interface LeaderboardDatabase {
	user_elo: {
		user_id: string;
		season_id: string | null;
		mode: number;
		elo: number;
		peak_rating: number;
		games_played: number;
	};
}

const sql = createAchilleaSql<LeaderboardDatabase>() as Kysely<LeaderboardDatabase>;

type LeaderboardRow = {
	user_id: string;
	elo: number;
	peak_rating: number;
	games_played: number;
	rank: string | number;
};

async function executeRows<T>(query: ReturnType<typeof sqlTag>): Promise<T[]> {
	const result = await query.execute(sql);
	return result.rows as T[];
}

export interface LeaderboardEntry {
	userId: string;
	elo: number;
	peakRating: number;
	gamesPlayed: number;
	rank: number;
}

export interface LeaderboardPage {
	entries: LeaderboardEntry[];
	total: number;
}

@singleton()
export class LeaderboardService {
	async getTop(
		seasonId: string | null,
		mode: MatchMode,
		limit: number = 10,
		offset: number = 0
	): Promise<LeaderboardPage> {
		const seasonPredicate = seasonId !== null
			? sqlTag`ue.season_id = ${seasonId}`
			: sqlTag`ue.season_id IS NULL`;
		const rankedSql = sqlTag`
			SELECT
				ue.user_id,
				ue.elo,
				ue.peak_rating,
				ue.games_played,
				DENSE_RANK() OVER (ORDER BY ue.elo DESC) AS rank
			FROM user_elo AS ue
			WHERE ${seasonPredicate}
			  AND ue.mode = ${mode}
		`;
		const countSql = sqlTag`
			SELECT COUNT(*) AS total
			FROM user_elo AS ue
			WHERE ${seasonPredicate}
			  AND ue.mode = ${mode}
		`;
		const paginatedSql = sqlTag`
			SELECT * FROM (${rankedSql}) AS ranked
			ORDER BY rank ASC
			LIMIT ${limit} OFFSET ${offset}
		`;

		const [countRows, rows] = await Promise.all([
			executeRows<{ total: string | number }>(countSql),
			executeRows<LeaderboardRow>(paginatedSql),
		]);

		const total = Number(countRows[0]?.total ?? 0);

		const entries: LeaderboardEntry[] = rows.map((row) => ({
			userId: row.user_id,
			elo: Number(row.elo),
			peakRating: Number(row.peak_rating),
			gamesPlayed: Number(row.games_played),
			rank: Number(row.rank),
		}));

		return { entries, total };
	}

	async getUserRank(
		seasonId: string | null,
		userId: string,
		mode: MatchMode
	): Promise<LeaderboardEntry | null> {
		const seasonPredicate = seasonId !== null
			? sqlTag`ue.season_id = ${seasonId}`
			: sqlTag`ue.season_id IS NULL`;
		const rankedSql = sqlTag`
			SELECT
				ue.user_id,
				ue.elo,
				ue.peak_rating,
				ue.games_played,
				DENSE_RANK() OVER (ORDER BY ue.elo DESC) AS rank
			FROM user_elo AS ue
			WHERE ${seasonPredicate}
			  AND ue.mode = ${mode}
		`;

		const rows = await executeRows<LeaderboardRow>(
			sqlTag`SELECT * FROM (${rankedSql}) AS ranked WHERE user_id = ${userId}`
		);

		const row = rows[0];
		if (!row) return null;

		return {
			userId: row.user_id,
			elo: Number(row.elo),
			peakRating: Number(row.peak_rating),
			gamesPlayed: Number(row.games_played),
			rank: Number(row.rank),
		};
	}
}
