// Persistence des matches ranked dans les tables Mikro-ORM existantes (raw SQL).
// Tables visées : event, lobby, lobby_user, lobby_match, user_elo.
// Mikro-ORM mappe camelCase TS → snake_case SQL.

import { sql, getRanks, type RankRow } from "./db";
import { parseRankedId } from "./ids";
import { progressiveEloDelta, applyEloUpdate } from "./elo";

const RANKED_EVENT_ID_KEY = "RANKED_PERPETUAL_EVENT_ID";

/**
 * Index du palier (0 = plus bas, ex. Fer) couvrant un Elo, pour le barème AP
 * **progressif** (gain/perte asymétriques par rang). `ranks` est trié par
 * `min_elo` ASC (cf. `getRanks`). Hors barème : au-dessus du dernier palier →
 * dernier index ; en-deçà du premier → 0.
 */
function tierIndexForElo(elo: number, ranks: RankRow[]): number {
	for (let i = 0; i < ranks.length; i++) {
		if (elo >= ranks[i].min_elo && elo <= ranks[i].max_elo) return i;
	}
	return elo > 0 && ranks.length > 0 ? ranks.length - 1 : 0;
}

// Récupère ou crée un Event RANKED "perpétuel" servant de container pour les
// lobbies de matchmaking. Un seul event sert pour toute la durée d'une season.
export async function getOrCreatePerpetualRankedEventId(): Promise<number> {
	const fromEnv = process.env[RANKED_EVENT_ID_KEY];
	if (fromEnv) return parseRankedId(fromEnv);

	const existing = await sql<Array<{ id: number }>>`
		SELECT id FROM achillea.event
		WHERE type = 'RANKED' AND name = 'Ranked perpétuel'
		LIMIT 1
	`;
	if (existing[0]) return parseRankedId(existing[0].id);

	const created = await sql<Array<{ id: number }>>`
		INSERT INTO achillea.event (name, description, type, created_at, updated_at)
		VALUES ('Ranked perpétuel', 'Container ranked matchmaking', 'RANKED', NOW(), NOW())
		RETURNING id
	`;
	return parseRankedId(created[0].id);
}

export interface PersistMatchInput {
	eventId: number;
	mode: number; // MatchMode count (2 ou 4)
	p1: { userId: string; score: number; claimedOpp?: number; eloBefore: number };
	p2: { userId: string; score: number; claimedOpp?: number; eloBefore: number };
	contested: boolean; // si scores divergent à la création (disputed)
	adminValidated: boolean;
	forfeitUserId?: string; // joueur déclaré forfait (timeout de saisie)
}

export interface PersistMatchOutput {
	lobbyId: number;
}

export async function persistDisputedLobby(
	input: Omit<PersistMatchInput, "adminValidated">
): Promise<PersistMatchOutput> {
	return await sql.begin(async (tx: any) => {
		const lobby = await tx`
			INSERT INTO achillea.lobby (
				event_id, event_type, mode, state, match_format, created_at, updated_at
			)
			VALUES (
				${input.eventId}, 'RANKED', ${input.mode}, 'Contested', 'bo1', NOW(), NOW()
			)
			RETURNING id
		`;
		const lobbyId = parseRankedId(lobby[0].id);

		// Litige : on stocke les 2 scorelines COMPLÈTES réclamées (score perso + score
		// attribué à l'adversaire) pour que l'admin arbitre. validated_result=false,
		// state='Pending' (le lobby reste 'Contested' tant que l'admin n'a pas tranché).
		await tx`
			INSERT INTO achillea.lobby_user (
				user_id, lobby_id, team, score, claimed_opponent_score, forfeit, validated_result, state, created_at, updated_at
			)
			VALUES
				(${input.p1.userId}, ${lobbyId}, 1, ${input.p1.score}, ${input.p1.claimedOpp ?? null}, false, false, 'Pending', NOW(), NOW()),
				(${input.p2.userId}, ${lobbyId}, 2, ${input.p2.score}, ${input.p2.claimedOpp ?? null}, false, false, 'Pending', NOW(), NOW())
		`;

		await tx`
			INSERT INTO achillea.lobby_match (
				lobby_id, game_number, score_team1, score_team2, team1validated, team2validated, admin_validated, created_at, updated_at
			)
			VALUES (
				${lobbyId}, 1, ${input.p1.score}, ${input.p2.score}, false, false, false, NOW(), NOW()
			)
		`;

		return { lobbyId };
	});
}

export interface OngoingLobbyInput {
	eventId: number;
	mode: number;
	p1: { userId: string; eloBefore: number };
	p2: { userId: string; eloBefore: number };
}

/**
 * Crée un lobby « Ongoing » dès l'entrée en phase de saisie (1er « Fin de match »).
 * Les 2 lignes lobby_user sont insérées immédiatement → les DEUX joueurs peuvent
 * uploader une preuve de score (POST /api/ranked/:lobbyId/dispute) AVANT toute
 * finalisation, et plus seulement en cas de litige. Le lobby est ensuite mis à jour
 * (Finished / Contested) par finalizeOngoingLobby / contestOngoingLobby.
 */
export async function createOngoingLobby(input: OngoingLobbyInput): Promise<PersistMatchOutput> {
	return await sql.begin(async (tx: any) => {
		const lobby = await tx`
			INSERT INTO achillea.lobby (
				event_id, event_type, mode, state, match_format, created_at, updated_at
			)
			VALUES (
				${input.eventId}, 'RANKED', ${input.mode}, 'Ongoing', 'bo1', NOW(), NOW()
			)
			RETURNING id
		`;
		const lobbyId = parseRankedId(lobby[0].id);

		await tx`
			INSERT INTO achillea.lobby_user (
				user_id, lobby_id, team, score, forfeit, validated_result, state, created_at, updated_at
			)
			VALUES
				(${input.p1.userId}, ${lobbyId}, 1, 0, false, false, 'Ongoing', NOW(), NOW()),
				(${input.p2.userId}, ${lobbyId}, 2, 0, false, false, 'Ongoing', NOW(), NOW())
		`;

		await tx`
			INSERT INTO achillea.lobby_match (
				lobby_id, game_number, score_team1, score_team2, team1validated, team2validated, admin_validated, created_at, updated_at
			)
			VALUES (
				${lobbyId}, 1, 0, 0, false, false, false, NOW(), NOW()
			)
		`;

		return { lobbyId };
	});
}

/**
 * Finalise un lobby « Ongoing » déjà créé (UPDATE, pas INSERT) : applique l'ELO et passe
 * en 'Finished'. Idempotent (no-op si déjà 'Finished'). Réservé au flux Colyseus où le
 * lobby a été créé par createOngoingLobby ; sinon utiliser persistAndApplyMatch.
 */
export async function finalizeOngoingLobby(
	lobbyId: number,
	input: PersistMatchInput,
	kFactor: number
): Promise<{
	lobbyId: number;
	eloAfter: { p1: number; p2: number };
	eloDelta: { p1: number; p2: number };
}> {
	const p1Win = input.p1.score > input.p2.score;
	const p2Win = input.p2.score > input.p1.score;
	const draw = !p1Win && !p2Win;

	// Barème AP progressif : K directionnel selon le palier de CHAQUE joueur.
	const ranks = await getRanks();
	const tierP1 = tierIndexForElo(input.p1.eloBefore, ranks);
	const tierP2 = tierIndexForElo(input.p2.eloBefore, ranks);
	const dP1 = progressiveEloDelta(
		input.p1.eloBefore,
		input.p2.eloBefore,
		p1Win ? 1 : draw ? 0.5 : 0,
		tierP1,
		kFactor
	);
	const dP2 = progressiveEloDelta(
		input.p2.eloBefore,
		input.p1.eloBefore,
		p2Win ? 1 : draw ? 0.5 : 0,
		tierP2,
		kFactor
	);
	const upP1 = applyEloUpdate(input.p1.eloBefore, dP1);
	const upP2 = applyEloUpdate(input.p2.eloBefore, dP2);
	const p1Forfeit = input.forfeitUserId === input.p1.userId;
	const p2Forfeit = input.forfeitUserId === input.p2.userId;

	await sql.begin(async (tx: any) => {
		// Idempotence : ne ré-applique pas l'ELO si le lobby est déjà finalisé
		// (double-clic / retry réseau / timeout + saisie concurrente).
		const cur = await tx`SELECT state FROM achillea.lobby WHERE id = ${lobbyId} FOR UPDATE`;
		if (!cur[0] || cur[0].state === "Finished" || cur[0].state === "Canceled") {
			return;
		}
		await tx`UPDATE achillea.lobby SET state = 'Finished', updated_at = NOW() WHERE id = ${lobbyId}`;
		await tx`
			UPDATE achillea.lobby_match SET
				score_team1 = ${input.p1.score}, score_team2 = ${input.p2.score},
				team1validated = true, team2validated = true, admin_validated = ${input.adminValidated},
				updated_at = NOW()
			WHERE lobby_id = ${lobbyId}
		`;
		await tx`
			UPDATE achillea.lobby_user SET
				score = ${input.p1.score}, forfeit = ${p1Forfeit}, elo_variation = ${upP1.clampedDelta},
				validated_result = true, state = 'Finished', updated_at = NOW()
			WHERE lobby_id = ${lobbyId} AND team = 1
		`;
		await tx`
			UPDATE achillea.lobby_user SET
				score = ${input.p2.score}, forfeit = ${p2Forfeit}, elo_variation = ${upP2.clampedDelta},
				validated_result = true, state = 'Finished', updated_at = NOW()
			WHERE lobby_id = ${lobbyId} AND team = 2
		`;
		await tx`
			UPDATE achillea.user_elo SET
				elo = elo + ${upP1.clampedDelta},
				peak_rating = GREATEST(peak_rating, elo + ${upP1.clampedDelta}),
				games_played = games_played + 1,
				wins = wins + ${p1Win ? 1 : 0},
				losses = losses + ${p2Win ? 1 : 0},
				updated_at = now()
			WHERE user_id = ${input.p1.userId} AND mode = ${input.mode}
		`;
		await tx`
			UPDATE achillea.user_elo SET
				elo = elo + ${upP2.clampedDelta},
				peak_rating = GREATEST(peak_rating, elo + ${upP2.clampedDelta}),
				games_played = games_played + 1,
				wins = wins + ${p2Win ? 1 : 0},
				losses = losses + ${p1Win ? 1 : 0},
				updated_at = now()
			WHERE user_id = ${input.p2.userId} AND mode = ${input.mode}
		`;
	});

	return {
		lobbyId,
		eloAfter: { p1: upP1.newElo, p2: upP2.newElo },
		eloDelta: { p1: upP1.clampedDelta, p2: upP2.clampedDelta },
	};
}

/**
 * Passe un lobby « Ongoing » existant en 'Contested' (désaccord de scores) en stockant les
 * 2 scorelines réclamées pour l'arbitrage admin. Les preuves déjà uploadées (screenshot_url)
 * sont conservées. Idempotent. Si le lobby n'existe pas encore, utiliser persistDisputedLobby.
 */
export async function contestOngoingLobby(
	lobbyId: number,
	input: Omit<PersistMatchInput, "adminValidated">
): Promise<void> {
	await sql.begin(async (tx: any) => {
		const cur = await tx`SELECT state FROM achillea.lobby WHERE id = ${lobbyId} FOR UPDATE`;
		if (!cur[0] || cur[0].state === "Finished" || cur[0].state === "Canceled") {
			return;
		}
		await tx`UPDATE achillea.lobby SET state = 'Contested', updated_at = NOW() WHERE id = ${lobbyId}`;
		await tx`
			UPDATE achillea.lobby_user SET
				score = ${input.p1.score}, claimed_opponent_score = ${input.p1.claimedOpp ?? null},
				validated_result = false, state = 'Pending', updated_at = NOW()
			WHERE lobby_id = ${lobbyId} AND team = 1
		`;
		await tx`
			UPDATE achillea.lobby_user SET
				score = ${input.p2.score}, claimed_opponent_score = ${input.p2.claimedOpp ?? null},
				validated_result = false, state = 'Pending', updated_at = NOW()
			WHERE lobby_id = ${lobbyId} AND team = 2
		`;
		await tx`
			UPDATE achillea.lobby_match SET
				score_team1 = ${input.p1.score}, score_team2 = ${input.p2.score}, updated_at = NOW()
			WHERE lobby_id = ${lobbyId}
		`;
	});
}

/** Enregistre l'URL de capture de preuve d'un joueur sur un lobby contesté. */
export async function setLobbyUserScreenshot(
	lobbyId: number,
	userId: string,
	url: string
): Promise<void> {
	await sql`
		UPDATE achillea.lobby_user SET screenshot_url = ${url}, updated_at = NOW()
		WHERE lobby_id = ${lobbyId} AND user_id = ${userId}
	`;
}

/**
 * Persiste la saisie d'un joueur AU FIL DE L'EAU (avant toute finalisation) : son score et le
 * score qu'il attribue à l'adversaire (claimed_opponent_score, non-null = « a saisi »). N'altère
 * pas l'état du lobby (reste 'Ongoing'). RÉSILIENCE : un crash/restart du bot ne perd plus les
 * scores déjà saisis (l'état Colyseus en mémoire, lui, serait perdu). state='Ready' = a soumis.
 */
export async function recordLobbyUserScore(
	lobbyId: number,
	userId: string,
	myScore: number,
	oppScore: number
): Promise<void> {
	await sql`
		UPDATE achillea.lobby_user
		SET score = ${myScore}, claimed_opponent_score = ${oppScore}, state = 'Ready', updated_at = NOW()
		WHERE lobby_id = ${lobbyId} AND user_id = ${userId}
	`;
}

/**
 * Annulation admin d'un lobby : passe en 'Canceled' (valeur LobbyState valide, 1 seul L),
 * AUCUN ELO appliqué. Idempotent : ne touche pas un lobby déjà 'Finished' ou 'Canceled'.
 * NB : LobbyUserState n'a pas d'état « annulé » → on laisse lobby_user.state tel quel et on
 * marque juste validated_result=false (le state du lobby fait foi).
 */
export async function cancelLobby(lobbyId: number): Promise<boolean> {
	const cur = await sql<Array<{ state: string; event_type: string }>>`
		SELECT state, event_type FROM achillea.lobby WHERE id = ${lobbyId} LIMIT 1
	`;
	if (!cur[0]) return false;
	// Garde-fou : l'arbitrage ranked ne touche QUE des lobbies ranked.
	if (cur[0].event_type !== "RANKED") return false;
	if (cur[0].state === "Finished" || cur[0].state === "Canceled") return false;
	await sql.begin(async (tx: any) => {
		await tx`UPDATE achillea.lobby SET state = 'Canceled', updated_at = NOW() WHERE id = ${lobbyId}`;
		await tx`UPDATE achillea.lobby_user SET validated_result = false, updated_at = NOW() WHERE lobby_id = ${lobbyId}`;
		await tx`UPDATE achillea.lobby_match SET admin_validated = true, updated_at = NOW() WHERE lobby_id = ${lobbyId}`;
	});
	return true;
}

export async function persistAndApplyMatch(
	input: PersistMatchInput,
	kFactor: number
): Promise<{
	lobbyId: number;
	eloAfter: { p1: number; p2: number };
	eloDelta: { p1: number; p2: number };
}> {
	const p1Win = input.p1.score > input.p2.score;
	const p2Win = input.p2.score > input.p1.score;
	const draw = !p1Win && !p2Win;

	const actualP1 = p1Win ? 1 : draw ? 0.5 : 0;
	const actualP2 = p2Win ? 1 : draw ? 0.5 : 0;

	// Barème AP progressif : K directionnel selon le palier de CHAQUE joueur.
	const ranks = await getRanks();
	const tierP1 = tierIndexForElo(input.p1.eloBefore, ranks);
	const tierP2 = tierIndexForElo(input.p2.eloBefore, ranks);
	const dP1 = progressiveEloDelta(
		input.p1.eloBefore,
		input.p2.eloBefore,
		actualP1,
		tierP1,
		kFactor
	);
	const dP2 = progressiveEloDelta(
		input.p2.eloBefore,
		input.p1.eloBefore,
		actualP2,
		tierP2,
		kFactor
	);

	const upP1 = applyEloUpdate(input.p1.eloBefore, dP1);
	const upP2 = applyEloUpdate(input.p2.eloBefore, dP2);

	const lobbyId = await sql.begin(async (tx: any) => {
		const lobby = await tx`
			INSERT INTO achillea.lobby (
				event_id, event_type, mode, state, match_format, created_at, updated_at
			)
			VALUES (
				${input.eventId}, 'RANKED', ${input.mode}, 'Finished',
				'bo1', NOW(), NOW()
			)
			RETURNING id
		`;
		const id = parseRankedId(lobby[0].id);

		await tx`
			INSERT INTO achillea.lobby_user (
				user_id, lobby_id, team, score, forfeit, elo_variation, validated_result, state, created_at, updated_at
			)
			VALUES
				(${input.p1.userId}, ${id}, 1, ${input.p1.score}, false, ${upP1.clampedDelta}, true, 'Finished', NOW(), NOW()),
				(${input.p2.userId}, ${id}, 2, ${input.p2.score}, false, ${upP2.clampedDelta}, true, 'Finished', NOW(), NOW())
		`;

		await tx`
			INSERT INTO achillea.lobby_match (
				lobby_id, game_number, score_team1, score_team2,
				team1validated, team2validated, admin_validated,
				created_at, updated_at
			)
			VALUES (
				${id}, 1, ${input.p1.score}, ${input.p2.score},
				true, true, ${input.adminValidated},
				NOW(), NOW()
			)
		`;

		await tx`
			UPDATE achillea.user_elo SET
				elo = elo + ${upP1.clampedDelta},
				peak_rating = GREATEST(peak_rating, elo + ${upP1.clampedDelta}),
				games_played = games_played + 1,
				wins = wins + ${p1Win ? 1 : 0},
				losses = losses + ${p2Win ? 1 : 0},
				updated_at = now()
			WHERE user_id = ${input.p1.userId} AND mode = ${input.mode}
		`;

		await tx`
			UPDATE achillea.user_elo SET
				elo = elo + ${upP2.clampedDelta},
				peak_rating = GREATEST(peak_rating, elo + ${upP2.clampedDelta}),
				games_played = games_played + 1,
				wins = wins + ${p2Win ? 1 : 0},
				losses = losses + ${p1Win ? 1 : 0},
				updated_at = now()
			WHERE user_id = ${input.p2.userId} AND mode = ${input.mode}
		`;

		return id;
	});

	return {
		lobbyId,
		eloAfter: { p1: upP1.newElo, p2: upP2.newElo },
		eloDelta: { p1: upP1.clampedDelta, p2: upP2.clampedDelta },
	};
}

export interface DisputePlayer {
	userId: string;
	displayName: string;
	score: number; // buts réclamés par ce joueur (son propre score)
	claimedOpponentScore: number | null; // buts qu'il attribue à l'adversaire
	screenshotUrl: string | null; // capture de preuve uploadée (si fournie)
}

export async function listDisputedLobbies(): Promise<
	Array<{
		lobbyId: number;
		mode: number;
		p1: DisputePlayer;
		p2: DisputePlayer;
		createdAt: string;
	}>
> {
	const rows = await sql<
		Array<{
			lobby_id: number;
			mode: number;
			created_at: string;
			user_id: string;
			team: number;
			score: number;
			claimed_opponent_score: number | null;
			screenshot_url: string | null;
			display_name: string;
		}>
	>`
		SELECT
			l.id AS lobby_id,
			l.mode,
			l.created_at,
			lu.user_id,
			lu.team,
			lu.score,
			lu.claimed_opponent_score,
			lu.screenshot_url,
			u.display_name
		FROM achillea.lobby l
		JOIN achillea.lobby_user lu ON lu.lobby_id = l.id
		JOIN achillea."user" u ON u.id = lu.user_id
		WHERE l.state = 'Contested'
		ORDER BY l.created_at DESC
	`;

	const grouped = new Map<
		number,
		{
			mode: number;
			createdAt: string;
			p1?: DisputePlayer;
			p2?: DisputePlayer;
		}
	>();
	for (const r of rows) {
		const slot = grouped.get(parseRankedId(r.lobby_id)) ?? {
			mode: r.mode,
			createdAt: r.created_at,
		};
		const player: DisputePlayer = {
			userId: r.user_id,
			displayName: r.display_name,
			score: r.score,
			claimedOpponentScore: r.claimed_opponent_score,
			screenshotUrl: r.screenshot_url,
		};
		if (r.team === 1) slot.p1 = player;
		else slot.p2 = player;
		grouped.set(parseRankedId(r.lobby_id), slot);
	}

	return Array.from(grouped.entries())
		.filter(([, v]) => v.p1 && v.p2)
		.map(([lobbyId, v]) => ({
			lobbyId,
			mode: v.mode,
			p1: v.p1!,
			p2: v.p2!,
			createdAt: v.createdAt,
		}));
}

export interface ActiveLobbyPlayer {
	userId: string;
	displayName: string;
	team: number; // 1 = domicile, 2 = extérieur
	score: number; // buts saisis (0 par défaut)
	claimedOpponentScore: number | null; // buts attribués à l'adversaire (null = pas encore saisi)
	submitted: boolean; // a soumis son score (claimed_opponent_score non-null)
	hasProof: boolean; // a uploadé une capture
}

/**
 * Liste les matchs EN COURS (lobby 'Ongoing') avec l'état live persisté (qui a saisi, scores,
 * preuves). Sert la vue admin « Matchs en cours » — visible grâce à la persistance au fil de
 * l'eau (recordLobbyUserScore / createOngoingLobby). Modérateur+.
 */
export async function listActiveLobbies(): Promise<
	Array<{
		lobbyId: number;
		mode: number;
		createdAt: string;
		p1: ActiveLobbyPlayer;
		p2: ActiveLobbyPlayer;
	}>
> {
	const rows = await sql<
		Array<{
			lobby_id: number;
			mode: number;
			created_at: string;
			user_id: string;
			team: number;
			score: number;
			claimed_opponent_score: number | null;
			screenshot_url: string | null;
			display_name: string;
		}>
	>`
		SELECT
			l.id AS lobby_id, l.mode, l.created_at,
			lu.user_id, lu.team, lu.score, lu.claimed_opponent_score, lu.screenshot_url,
			u.display_name
		FROM achillea.lobby l
		JOIN achillea.lobby_user lu ON lu.lobby_id = l.id
		JOIN achillea."user" u ON u.id = lu.user_id
		WHERE l.state = 'Ongoing' AND l.event_type = 'RANKED'
		ORDER BY l.created_at DESC
	`;

	const grouped = new Map<
		number,
		{ mode: number; createdAt: string; p1?: ActiveLobbyPlayer; p2?: ActiveLobbyPlayer }
	>();
	for (const r of rows) {
		const slot = grouped.get(parseRankedId(r.lobby_id)) ?? { mode: r.mode, createdAt: r.created_at };
		const player: ActiveLobbyPlayer = {
			userId: r.user_id,
			displayName: r.display_name,
			team: r.team,
			score: r.score,
			claimedOpponentScore: r.claimed_opponent_score,
			submitted: r.claimed_opponent_score !== null,
			hasProof: !!r.screenshot_url,
		};
		if (r.team === 1) slot.p1 = player;
		else slot.p2 = player;
		grouped.set(parseRankedId(r.lobby_id), slot);
	}

	return Array.from(grouped.entries())
		.filter(([, v]) => v.p1 && v.p2)
		.map(([lobbyId, v]) => ({
			lobbyId,
			mode: v.mode,
			createdAt: v.createdAt,
			p1: v.p1!,
			p2: v.p2!,
		}));
}

/** Compteurs synthétiques pour la vue admin « overview » du ranked. */
export async function getRankedOverview(): Promise<{
	activeMatches: number;
	contestedMatches: number;
	finishedToday: number;
	matchesToday: number;
	totalPlayers: number;
}> {
	const rows = await sql<
		Array<{
			active_matches: string | number;
			contested_matches: string | number;
			finished_today: string | number;
			matches_today: string | number;
			total_players: string | number;
		}>
	>`
		SELECT
			(SELECT COUNT(*) FROM achillea.lobby WHERE event_type = 'RANKED' AND state = 'Ongoing') AS active_matches,
			(SELECT COUNT(*) FROM achillea.lobby WHERE event_type = 'RANKED' AND state = 'Contested') AS contested_matches,
			(SELECT COUNT(*) FROM achillea.lobby WHERE event_type = 'RANKED' AND state = 'Finished'
				AND updated_at >= date_trunc('day', now())) AS finished_today,
			(SELECT COUNT(*) FROM achillea.lobby WHERE event_type = 'RANKED'
				AND created_at >= date_trunc('day', now())) AS matches_today,
			(SELECT COUNT(*) FROM achillea.user_elo WHERE games_played > 0) AS total_players
	`;
	const r = rows[0];
	return {
		activeMatches: Number(r?.active_matches ?? 0),
		contestedMatches: Number(r?.contested_matches ?? 0),
		finishedToday: Number(r?.finished_today ?? 0),
		matchesToday: Number(r?.matches_today ?? 0),
		totalPlayers: Number(r?.total_players ?? 0),
	};
}

export async function adminResolveLobby(
	lobbyId: number,
	scoreTeam1: number,
	scoreTeam2: number,
	forfeitUserId: string | undefined,
	mode: number,
	kFactor: number
): Promise<{ applied: boolean; eloDelta: { p1: number; p2: number } }> {
	// Idempotence (chemin rapide) : ne pas ré-appliquer l'Elo si le lobby est déjà finalisé
	// (double-validation / double-clic admin / retry → inflation Elo + stats faussées).
	// Le verrou authoritatif est posé DANS la transaction (SELECT … FOR UPDATE) ci-dessous,
	// pour sérialiser 2 validations admin concurrentes.
	const lobbyState = await sql<Array<{ state: string }>>`
		SELECT state FROM achillea.lobby WHERE id = ${lobbyId} LIMIT 1
	`;
	if (lobbyState[0]?.state === "Finished" || lobbyState[0]?.state === "Canceled") {
		return { applied: false, eloDelta: { p1: 0, p2: 0 } };
	}

	// Récupère les 2 joueurs pour calcul Elo
	const players = await sql<Array<{ user_id: string; team: number; elo: number }>>`
		SELECT lu.user_id, lu.team, COALESCE(ue.elo, 0) AS elo
		FROM achillea.lobby_user lu
		LEFT JOIN achillea.user_elo ue ON ue.user_id = lu.user_id AND ue.mode = ${mode}
		WHERE lu.lobby_id = ${lobbyId}
		ORDER BY lu.team ASC
	`;
	const p1 = players.find((x) => x.team === 1)!;
	const p2 = players.find((x) => x.team === 2)!;

	// Forfeit override : score = 0 au forfait, autre = max
	let s1 = scoreTeam1;
	let s2 = scoreTeam2;
	let p1Forfeit = false;
	let p2Forfeit = false;
	if (forfeitUserId === p1.user_id) {
		s1 = 0;
		s2 = Math.max(s2, 1);
		p1Forfeit = true;
	} else if (forfeitUserId === p2.user_id) {
		s2 = 0;
		s1 = Math.max(s1, 1);
		p2Forfeit = true;
	}

	const p1Win = s1 > s2;
	const p2Win = s2 > s1;
	const draw = !p1Win && !p2Win;

	// Barème AP progressif : K directionnel selon le palier de CHAQUE joueur.
	const ranks = await getRanks();
	const tierP1 = tierIndexForElo(p1.elo, ranks);
	const tierP2 = tierIndexForElo(p2.elo, ranks);
	const dP1 = progressiveEloDelta(p1.elo, p2.elo, p1Win ? 1 : draw ? 0.5 : 0, tierP1, kFactor);
	const dP2 = progressiveEloDelta(p2.elo, p1.elo, p2Win ? 1 : draw ? 0.5 : 0, tierP2, kFactor);
	const upP1 = applyEloUpdate(p1.elo, dP1);
	const upP2 = applyEloUpdate(p2.elo, dP2);

	let applied = true;
	await sql.begin(async (tx: any) => {
		// Verrou + re-vérification idempotente sous transaction : si une autre validation
		// concurrente a déjà finalisé/annulé le lobby, on n'applique RIEN (anti double-ELO).
		const cur = await tx`SELECT state FROM achillea.lobby WHERE id = ${lobbyId} FOR UPDATE`;
		if (!cur[0] || cur[0].state === "Finished" || cur[0].state === "Canceled") {
			applied = false;
			return;
		}
		await tx`
			UPDATE achillea.lobby SET state = 'Finished', updated_at = NOW()
			WHERE id = ${lobbyId}
		`;
		await tx`
			UPDATE achillea.lobby_match SET
				score_team1 = ${s1},
				score_team2 = ${s2},
				team1validated = true,
				team2validated = true,
				admin_validated = true,
				updated_at = NOW()
			WHERE lobby_id = ${lobbyId}
		`;
		await tx`
			UPDATE achillea.lobby_user SET
				score = ${s1}, forfeit = ${p1Forfeit}, elo_variation = ${upP1.clampedDelta},
				validated_result = true, state = 'Finished', updated_at = NOW()
			WHERE lobby_id = ${lobbyId} AND team = 1
		`;
		await tx`
			UPDATE achillea.lobby_user SET
				score = ${s2}, forfeit = ${p2Forfeit}, elo_variation = ${upP2.clampedDelta},
				validated_result = true, state = 'Finished', updated_at = NOW()
			WHERE lobby_id = ${lobbyId} AND team = 2
		`;
		await tx`
			UPDATE achillea.user_elo SET
				elo = elo + ${upP1.clampedDelta},
				peak_rating = GREATEST(peak_rating, elo + ${upP1.clampedDelta}),
				games_played = games_played + 1,
				wins = wins + ${p1Win ? 1 : 0},
				losses = losses + ${p2Win ? 1 : 0},
				updated_at = now()
			WHERE user_id = ${p1.user_id} AND mode = ${mode}
		`;
		await tx`
			UPDATE achillea.user_elo SET
				elo = elo + ${upP2.clampedDelta},
				peak_rating = GREATEST(peak_rating, elo + ${upP2.clampedDelta}),
				games_played = games_played + 1,
				wins = wins + ${p2Win ? 1 : 0},
				losses = losses + ${p1Win ? 1 : 0},
				updated_at = now()
			WHERE user_id = ${p2.user_id} AND mode = ${mode}
		`;
	});

	return {
		applied,
		eloDelta: applied ? { p1: upP1.clampedDelta, p2: upP2.clampedDelta } : { p1: 0, p2: 0 },
	};
}

/**
 * Annule (state='Canceled') les lobbies 'Ongoing' jamais finalisés et trop vieux (matchs
 * abandonnés, les 2 joueurs partis sans valider). PRÉSERVE les 'Contested' (arbitrage staff
 * en attente). Annulation plutôt que suppression : aucun risque de FK, et la trace reste
 * auditable. Renvoie le nombre de lobbies annulés.
 */
export async function cleanupStaleOngoingLobbies(maxAgeHours = 24): Promise<number> {
	const rows = await sql<Array<{ id: number }>>`
		UPDATE achillea.lobby SET state = 'Canceled', updated_at = now()
		WHERE event_type = 'RANKED' AND state = 'Ongoing' AND created_at < now() - make_interval(hours => ${maxAgeHours})
		RETURNING id
	`;
	return rows.length;
}
