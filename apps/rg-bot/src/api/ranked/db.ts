// Bun.SQL pool partagé pour toutes les requêtes ranked.
// Postgres déjà utilisé par le bot (Mikro-ORM), on tape les mêmes tables en SQL brut.
// Mikro-ORM convertit camelCase TS → snake_case SQL : `Lobby` → table `lobby`,
// `LobbyMatch.scoreTeam1` → colonne `score_team1`, etc.

import { createBunSql } from "@rosegriffon/db/bun-sql";
import { getAchilleaDatabaseUrl } from "@rosegriffon/db/achillea";

// Ranked shares the RG database and explicitly selects its Achillea schema.
export const sql = createBunSql({
  url: getAchilleaDatabaseUrl(),
  max: Number(process.env.BUN_SQL_MAX ?? "5"),
  idleTimeout: Number(process.env.BUN_SQL_IDLE_TIMEOUT ?? "30"),
  connectionTimeout: Number(process.env.BUN_SQL_CONNECT_TIMEOUT ?? "10"),
});

export interface UserEloRow {
  user_id: string;
  mode: number;
  season_id: string | null;
  elo: number;
  peak_rating: number;
  games_played: number;
  wins: number;
  losses: number;
}

export interface RankRow {
  id: number;
  key: string;
  min_elo: number;
  max_elo: number;
  emoji_id: string;
  emoji_key: string;
  gradient: string[];
}

export interface UserRow {
  id: string;
  display_name: string;
  avatar: string;
  role: number;
}

export interface SeasonRow {
  id: string;
  name: string;
  state: string;
  config: { kFactor: number; baseRating: number; decayRate: number } | null;
}

export async function getActiveSeason(): Promise<SeasonRow | null> {
  const rows = await sql<SeasonRow[]>`
		SELECT id, name, state, config
		FROM achillea.season
		WHERE state = 'Active'
		ORDER BY starts_at DESC
		LIMIT 1
	`;
  return rows[0] ?? null;
}

export async function getUserRow(userId: string): Promise<UserRow | null> {
  const rows = await sql<UserRow[]>`
		SELECT id, display_name, avatar, role
		FROM achillea."user"
		WHERE id = ${userId}
	`;
  return rows[0] ?? null;
}

export async function getOrCreateElo(
  userId: string,
  mode: number,
  seasonId: string | null,
  baseRating: number,
): Promise<UserEloRow> {
  const existing = await sql<UserEloRow[]>`
		SELECT user_id, mode, season_id, elo, peak_rating, games_played, wins, losses
		FROM achillea.user_elo
		WHERE user_id = ${userId} AND mode = ${mode}
	`;
  if (existing[0]) return existing[0];

  await sql`
		INSERT INTO achillea.user_elo (user_id, mode, season_id, elo, peak_rating, games_played, wins, losses)
		VALUES (${userId}, ${mode}, ${seasonId}, ${baseRating}, ${baseRating}, 0, 0, 0)
		ON CONFLICT (user_id, mode) DO NOTHING
	`;
  const refreshed = await sql<UserEloRow[]>`
		SELECT user_id, mode, season_id, elo, peak_rating, games_played, wins, losses
		FROM achillea.user_elo
		WHERE user_id = ${userId} AND mode = ${mode}
	`;
  return (
    refreshed[0] ?? {
      user_id: userId,
      mode,
      season_id: seasonId,
      elo: baseRating,
      peak_rating: baseRating,
      games_played: 0,
      wins: 0,
      losses: 0,
    }
  );
}

export async function getRanks(): Promise<RankRow[]> {
  return await sql<RankRow[]>`
		SELECT id, key, min_elo, max_elo, emoji_id, emoji_key, gradient
		FROM achillea.rank
		ORDER BY min_elo ASC
	`;
}

export function findTier(elo: number, ranks: RankRow[]): RankRow | null {
  for (const r of ranks) {
    if (elo >= r.min_elo && elo <= r.max_elo) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Administration des SAISONS (dashboard admin — pilotage sans coder).
// ---------------------------------------------------------------------------

export type SeasonStateValue = "Upcoming" | "Active" | "Closed";
export const SEASON_STATES: readonly SeasonStateValue[] = ["Upcoming", "Active", "Closed"];

export interface SeasonAdminRow {
  id: string;
  name: string;
  state: SeasonStateValue;
  starts_at: string;
  ends_at: string;
  config: { kFactor: number; baseRating: number; decayRate: number } | null;
  player_count: number;
}

export interface SeasonConfigInput {
  kFactor: number;
  baseRating: number;
  decayRate: number;
}

/** Liste toutes les saisons (récentes d'abord) + nombre de joueurs rattachés. */
export async function listSeasonsAdmin(): Promise<SeasonAdminRow[]> {
  return await sql<SeasonAdminRow[]>`
		SELECT s.id, s.name, s.state, s.starts_at, s.ends_at, s.config,
			(SELECT COUNT(*)::int FROM achillea.user_elo ue WHERE ue.season_id = s.id) AS player_count
		FROM achillea.season s
		ORDER BY s.starts_at DESC
	`;
}

async function getSeasonAdmin(id: string): Promise<SeasonAdminRow | null> {
  const rows = await sql<SeasonAdminRow[]>`
		SELECT s.id, s.name, s.state, s.starts_at, s.ends_at, s.config,
			(SELECT COUNT(*)::int FROM achillea.user_elo ue WHERE ue.season_id = s.id) AS player_count
		FROM achillea.season s
		WHERE s.id = ${id}
		LIMIT 1
	`;
  return rows[0] ?? null;
}

/** Crée une saison (état 'Upcoming') — le cron de bascule l'activera/clôturera selon ses dates. */
export async function createSeasonAdmin(input: {
  name: string;
  startsAt: string;
  endsAt: string;
  config: SeasonConfigInput;
}): Promise<SeasonAdminRow> {
  const rows = await sql<Array<{ id: string }>>`
		INSERT INTO achillea.season (name, starts_at, ends_at, config)
		VALUES (${input.name}, ${input.startsAt}, ${input.endsAt}, ${JSON.stringify(input.config)}::jsonb)
		RETURNING id
	`;
  return (await getSeasonAdmin(rows[0].id))!;
}

/** Met à jour une saison (champs partiels). Renvoie null si introuvable. */
export async function updateSeasonAdmin(
  id: string,
  patch: {
    name?: string;
    startsAt?: string;
    endsAt?: string;
    state?: SeasonStateValue;
    config?: SeasonConfigInput;
  },
): Promise<SeasonAdminRow | null> {
  const cur = await getSeasonAdmin(id);
  if (!cur) return null;
  const name = patch.name ?? cur.name;
  const startsAt = patch.startsAt ?? cur.starts_at;
  const endsAt = patch.endsAt ?? cur.ends_at;
  const state = patch.state ?? cur.state;
  const config = patch.config ?? cur.config ?? { kFactor: 32, baseRating: 0, decayRate: 0 };
  await sql`
		UPDATE achillea.season
		SET name = ${name},
			starts_at = ${startsAt},
			ends_at = ${endsAt},
			state = ${state}::achillea.season_state,
			config = ${JSON.stringify(config)}::jsonb,
			updated_at = NOW()
		WHERE id = ${id}
	`;
  return await getSeasonAdmin(id);
}

/** Active une saison et clôt toute autre saison actuellement 'Active'. */
export async function activateSeasonAdmin(id: string): Promise<SeasonAdminRow | null> {
  const cur = await getSeasonAdmin(id);
  if (!cur) return null;
  await sql`UPDATE achillea.season SET state = 'Closed'::achillea.season_state, updated_at = NOW() WHERE state = 'Active' AND id <> ${id}`;
  await sql`UPDATE achillea.season SET state = 'Active'::achillea.season_state, updated_at = NOW() WHERE id = ${id}`;
  return await getSeasonAdmin(id);
}

/**
 * Reset du ladder : remet TOUTES les lignes user_elo à la baseRating de la saison
 * (elo, peak, games, wins, losses). Volontairement N'AFFECTE PAS season_id (le
 * leaderboard live en dépend) — mêmes sémantiques que le reset de migration. Renvoie
 * le nombre de joueurs réinitialisés, ou null si la saison est introuvable.
 */
export async function resetLadderForSeason(id: string): Promise<number | null> {
  const season = await sql<Array<{ config: { baseRating?: number } | null }>>`
		SELECT config FROM achillea.season WHERE id = ${id} LIMIT 1
	`;
  if (!season[0]) return null;
  const base = Math.max(0, Math.floor(Number(season[0].config?.baseRating ?? 0)));
  const rows = await sql<Array<{ user_id: string }>>`
		UPDATE achillea.user_elo
		SET elo = ${base}, peak_rating = ${base}, games_played = 0, wins = 0, losses = 0
		RETURNING user_id
	`;
  return rows.length;
}
