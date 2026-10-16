// Télémétrie ranked — journal de tout le flow d'un match (table `ranked_match_event`).
// Best-effort : un échec d'écriture ne doit JAMAIS interrompre un match.

import { sql } from "./db";
import { parseRankedId } from "./ids";

export type RankedEventType =
  // matchmaking (file aléatoire)
  | "queue_join"
  | "queue_leave"
  | "queue_pair"
  // invitation directe (lobby de présence)
  | "invite_sent"
  | "invite_accepted"
  | "invite_declined"
  | "invite_expired"
  // lien de défi partageable (invitation hors présence)
  | "challenge_created"
  | "challenge_accepted"
  // cycle de vie du match
  | "match_created"
  | "player_joined"
  | "match_started"
  | "playing"
  | "lobby_opened"
  | "finish_confirmed"
  | "score_submitted"
  | "scores_agreed"
  | "scores_disagreed"
  | "score_mismatch_retry"
  | "proof_uploaded"
  | "finished"
  | "void"
  | "surrendered"
  | "disputed"
  | "score_timeout"
  | "player_left"
  // arbitrage
  | "admin_validated"
  | "admin_cancelled"
  // administration ranked (saisons / paliers / joueurs — pilotage dashboard)
  | "admin_season_created"
  | "admin_season_updated"
  | "admin_season_activated"
  | "admin_ladder_reset";

export interface MatchEventInput {
  type: RankedEventType;
  lobbyId?: number | null;
  roomCode?: string | null;
  mode?: number | null;
  userId?: string | null;
  detail?: Record<string, unknown>;
}

/**
 * Écrit un événement de télémétrie. Best-effort : capture toute erreur (la télémétrie
 * est observationnelle, elle ne doit jamais faire échouer la logique de match).
 */
export async function logMatchEvent(evt: MatchEventInput): Promise<void> {
  try {
    await sql`
			INSERT INTO achillea.ranked_match_event (lobby_id, room_code, mode, user_id, event_type, detail)
			VALUES (
				${evt.lobbyId ?? null}, ${evt.roomCode ?? null}, ${evt.mode ?? null},
				${evt.userId ?? null}, ${evt.type}, ${evt.detail ?? {}}::jsonb
			)
		`;
  } catch (err) {
    console.error("[ranked] logMatchEvent failed:", (err as Error)?.message ?? err);
  }
}

export interface MatchEventRow {
  id: number;
  created_at: string;
  lobby_id: number | null;
  room_code: string | null;
  mode: number | null;
  user_id: string | null;
  display_name: string | null;
  event_type: string;
  detail: Record<string, unknown>;
}

/**
 * Liste les événements de télémétrie (du plus récent au plus ancien), avec filtres
 * optionnels combinés en AND (chacun no-op si absent). `display_name` joint si dispo.
 */
export async function listMatchEvents(
  opts: {
    lobbyId?: number | null;
    roomCode?: string | null;
    userId?: string | null;
    limit?: number;
  } = {},
): Promise<MatchEventRow[]> {
  const limit = Math.min(500, Math.max(1, Math.floor(opts.limit ?? 200)));
  const lobbyId = opts.lobbyId ?? null;
  const roomCode = opts.roomCode ?? null;
  const userId = opts.userId ?? null;
  const rows = await sql<MatchEventRow[]>`
		SELECT e.id, e.created_at, e.lobby_id, e.room_code, e.mode, e.user_id,
		       u.display_name, e.event_type, e.detail
		FROM achillea.ranked_match_event e
		LEFT JOIN achillea."user" u ON u.id = e.user_id
		WHERE (${lobbyId}::int IS NULL OR e.lobby_id = ${lobbyId})
		  AND (${roomCode}::text IS NULL OR e.room_code = ${roomCode})
		  AND (${userId}::text IS NULL OR e.user_id = ${userId})
		ORDER BY e.id DESC
		LIMIT ${limit}
	`;
  for (const row of rows) {
    row.id = parseRankedId(row.id);
    row.lobby_id = row.lobby_id === null ? null : parseRankedId(row.lobby_id);
  }
  return rows;
}
