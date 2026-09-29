import { singleton } from "tsyringe";

import { Lobby, TournamentPhase, User } from "@/entities";
import { EventTypeEnum, LobbyState, MatchFormat, PhaseKind, PhaseStatus } from "@/utils/enums";

import { Database } from "./Database";

export interface SwissStanding {
	userId: string;
	points: number;
	buchholz: number;
	sonnebornBerger: number;
	pointsDiff: number;
	wins: number;
	losses: number;
	draws: number;
	byeCount: number;
}

interface MatchRecord {
	playerA: string;
	playerB: string | null;
	scoreA: number;
	scoreB: number;
	round: number;
	isBye: boolean;
}

export function computeSwissStandings(
	matches: MatchRecord[],
	participants: string[]
): SwissStanding[] {
	const pts: Record<string, number> = {};
	const wins: Record<string, number> = {};
	const losses: Record<string, number> = {};
	const draws: Record<string, number> = {};
	const byeCount: Record<string, number> = {};
	const opponents: Record<string, string[]> = {};
	const scoreVsOpponent: Record<string, Record<string, number>> = {};

	for (const p of participants) {
		pts[p] = 0;
		wins[p] = 0;
		losses[p] = 0;
		draws[p] = 0;
		byeCount[p] = 0;
		opponents[p] = [];
		scoreVsOpponent[p] = {};
	}

	for (const m of matches) {
		if (m.isBye || m.playerB === null) {
			pts[m.playerA] = (pts[m.playerA] ?? 0) + 1;
			wins[m.playerA] = (wins[m.playerA] ?? 0) + 1;
			byeCount[m.playerA] = (byeCount[m.playerA] ?? 0) + 1;
			continue;
		}

		opponents[m.playerA].push(m.playerB);
		opponents[m.playerB].push(m.playerA);

		if (m.scoreA > m.scoreB) {
			pts[m.playerA] = (pts[m.playerA] ?? 0) + 1;
			wins[m.playerA] = (wins[m.playerA] ?? 0) + 1;
			losses[m.playerB] = (losses[m.playerB] ?? 0) + 1;
			scoreVsOpponent[m.playerA][m.playerB] = (scoreVsOpponent[m.playerA][m.playerB] ?? 0) + 1;
		} else if (m.scoreB > m.scoreA) {
			pts[m.playerB] = (pts[m.playerB] ?? 0) + 1;
			wins[m.playerB] = (wins[m.playerB] ?? 0) + 1;
			losses[m.playerA] = (losses[m.playerA] ?? 0) + 1;
			scoreVsOpponent[m.playerB][m.playerA] = (scoreVsOpponent[m.playerB][m.playerA] ?? 0) + 1;
		} else {
			pts[m.playerA] = (pts[m.playerA] ?? 0) + 0.5;
			pts[m.playerB] = (pts[m.playerB] ?? 0) + 0.5;
			draws[m.playerA] = (draws[m.playerA] ?? 0) + 1;
			draws[m.playerB] = (draws[m.playerB] ?? 0) + 1;
		}
	}

	const standings: SwissStanding[] = participants.map((p) => {
		const buchholz = (opponents[p] ?? []).reduce((sum, opp) => sum + (pts[opp] ?? 0), 0);

		const sonnebornBerger = (opponents[p] ?? []).reduce((sum, opp) => {
			const scored = scoreVsOpponent[p]?.[opp] ?? 0;
			return sum + scored * (pts[opp] ?? 0);
		}, 0);

		const pointsDiff = (wins[p] ?? 0) - (losses[p] ?? 0);

		return {
			userId: p,
			points: pts[p] ?? 0,
			buchholz,
			sonnebornBerger,
			pointsDiff,
			wins: wins[p] ?? 0,
			losses: losses[p] ?? 0,
			draws: draws[p] ?? 0,
			byeCount: byeCount[p] ?? 0,
		};
	});

	standings.sort((a, b) => {
		if (b.points !== a.points) return b.points - a.points;
		if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
		if (b.sonnebornBerger !== a.sonnebornBerger) return b.sonnebornBerger - a.sonnebornBerger;
		if (b.pointsDiff !== a.pointsDiff) return b.pointsDiff - a.pointsDiff;
		return 0;
	});

	return standings;
}

export function pairMonrad(
	participants: string[],
	played: MatchRecord[],
	standings: SwissStanding[],
	round: number
): { playerA: string; playerB: string | null; isBye: boolean }[] {
	const sorted = [...standings].sort((a, b) => {
		if (b.points !== a.points) return b.points - a.points;
		if (b.buchholz !== a.buchholz) return b.buchholz - a.buchholz;
		return 0;
	});

	const playedPairs = new Set<string>(
		played.filter((m) => !m.isBye && m.playerB !== null).map((m) => pairKey(m.playerA, m.playerB!))
	);

	const byePlayers = new Set<string>(played.filter((m) => m.isBye).map((m) => m.playerA));

	const pool = sorted.map((s) => s.userId);
	const paired: { playerA: string; playerB: string | null; isBye: boolean }[] = [];
	const used = new Set<string>();

	let byePlayer: string | null = null;
	if (pool.length % 2 !== 0) {
		for (let i = pool.length - 1; i >= 0; i--) {
			const candidate = pool[i];
			if (!byePlayers.has(candidate)) {
				byePlayer = candidate;
				break;
			}
		}
		if (byePlayer === null) {
			byePlayer = pool[pool.length - 1];
		}
		used.add(byePlayer);
		paired.push({ playerA: byePlayer, playerB: null, isBye: true });
	}

	for (let i = 0; i < pool.length; i++) {
		const a = pool[i];
		if (used.has(a)) continue;

		for (let j = i + 1; j < pool.length; j++) {
			const b = pool[j];
			if (used.has(b)) continue;
			if (playedPairs.has(pairKey(a, b))) continue;

			paired.push({ playerA: a, playerB: b, isBye: false });
			used.add(a);
			used.add(b);
			break;
		}

		if (!used.has(a)) {
			for (let j = i + 1; j < pool.length; j++) {
				const b = pool[j];
				if (used.has(b)) continue;
				paired.push({ playerA: a, playerB: b, isBye: false });
				used.add(a);
				used.add(b);
				break;
			}
		}
	}

	return paired;
}

function pairKey(a: string, b: string): string {
	return [a, b].sort().join("|");
}

@singleton()
export class SwissStageService {
	constructor(private db: Database) {}

	private async getPhaseLobbies(phase: TournamentPhase): Promise<Lobby[]> {
		const em = this.db.em.fork();
		return em.find(Lobby, { phase: phase.id }, { populate: ["lobbyUsers"] });
	}

	private lobbiesToMatchRecords(lobbies: Lobby[]): MatchRecord[] {
		return lobbies.map((l) => {
			const users = l.lobbyUsers.getItems();
			const isBye = users.length === 1;
			const playerA = users[0]?.user?.id ?? "";
			const playerB = isBye ? null : (users[1]?.user?.id ?? null);
			return {
				playerA,
				playerB,
				scoreA: users[0]?.score ?? 0,
				scoreB: users[1]?.score ?? 0,
				round: l.swissRound ?? 1,
				isBye,
			};
		});
	}

	async startSwiss(phase: TournamentPhase, participants: User[]): Promise<void> {
		const em = this.db.em.fork();

		const loaded = await em.findOneOrFail(TournamentPhase, phase.id, {
			populate: ["tournament"],
		});

		loaded.status = PhaseStatus.Active;
		loaded.startedAt = new Date();

		const ids = participants.map((p) => p.id);
		const seeded = loaded.config?.seeded ?? false;
		const shuffled = seeded ? [...ids] : ids.sort(() => Math.random() - 0.5);

		const initialStandings: SwissStanding[] = shuffled.map((id) => ({
			userId: id,
			points: 0,
			buchholz: 0,
			sonnebornBerger: 0,
			pointsDiff: 0,
			wins: 0,
			losses: 0,
			draws: 0,
			byeCount: 0,
		}));

		const pairings = pairMonrad(shuffled, [], initialStandings, 1);

		for (const _pair of pairings) {
			const lobby = new Lobby();
			lobby.eventType = EventTypeEnum.TOURNAMENT;
			lobby.event = loaded.tournament;
			lobby.state = LobbyState.FRESH;
			lobby.matchFormat = MatchFormat.BO1;
			lobby.phase = loaded;
			lobby.swissRound = 1;
			em.persist(lobby);
		}

		await em.flush();
	}

	async pairNextRound(phase: TournamentPhase): Promise<void> {
		const em = this.db.em.fork();

		const loaded = await em.findOneOrFail(TournamentPhase, phase.id, {
			populate: ["tournament"],
		});

		const lobbies = await em.find(Lobby, { phase: loaded.id }, { populate: ["lobbyUsers.user"] });

		const rounds = lobbies.map((l) => l.swissRound ?? 1);
		const maxRound = rounds.length > 0 ? Math.max(...rounds) : 0;
		const nextRound = maxRound + 1;

		const matchRecords = this.lobbiesToMatchRecords(lobbies);
		const participantIds = new Set<string>();
		for (const m of matchRecords) {
			if (m.playerA) participantIds.add(m.playerA);
			if (m.playerB) participantIds.add(m.playerB);
		}

		const ids = [...participantIds];
		const standings = computeSwissStandings(matchRecords, ids);
		const pairings = pairMonrad(ids, matchRecords, standings, nextRound);

		for (const _pair of pairings) {
			const lobby = new Lobby();
			lobby.eventType = EventTypeEnum.TOURNAMENT;
			lobby.event = loaded.tournament;
			lobby.state = LobbyState.FRESH;
			lobby.matchFormat = MatchFormat.BO1;
			lobby.phase = loaded;
			lobby.swissRound = nextRound;
			em.persist(lobby);
		}

		await em.flush();
	}

	async computeStandings(phase: TournamentPhase): Promise<SwissStanding[]> {
		const lobbies = await this.getPhaseLobbies(phase);
		const matchRecords = this.lobbiesToMatchRecords(lobbies);

		const participantIds = new Set<string>();
		for (const m of matchRecords) {
			if (m.playerA) participantIds.add(m.playerA);
			if (m.playerB) participantIds.add(m.playerB);
		}

		return computeSwissStandings(matchRecords, [...participantIds]);
	}

	isComplete(phase: TournamentPhase, matches: MatchRecord[]): boolean {
		if (matches.length === 0) return false;
		return matches.every((m) => m.isBye || m.scoreA > 0 || m.scoreB > 0);
	}

	async advanceToNextPhase(currentPhase: TournamentPhase): Promise<TournamentPhase | null> {
		const em = this.db.em.fork();

		const loaded = await em.findOneOrFail(TournamentPhase, currentPhase.id, {
			populate: ["tournament"],
		});

		if (loaded.status === PhaseStatus.Completed) {
			return null;
		}

		loaded.status = PhaseStatus.Completed;
		loaded.endedAt = new Date();

		const nextPhases = await em.find(
			TournamentPhase,
			{
				tournament: loaded.tournament.id,
				index: { $gt: loaded.index },
				status: PhaseStatus.Pending,
			},
			{ orderBy: { index: "ASC" }, limit: 1 }
		);

		const nextPhase = nextPhases[0];
		if (!nextPhase) {
			await em.flush();
			return null;
		}

		const lobbies = await em.find(Lobby, { phase: loaded.id }, { populate: ["lobbyUsers.user"] });

		const matchRecords = this.lobbiesToMatchRecords(lobbies);
		const participantIds = new Set<string>();
		for (const m of matchRecords) {
			if (m.playerA) participantIds.add(m.playerA);
			if (m.playerB) participantIds.add(m.playerB);
		}

		const standings = computeSwissStandings(matchRecords, [...participantIds]);
		const qualifiedCount = loaded.qualifiersCount > 0 ? loaded.qualifiersCount : standings.length;
		const qualified = standings.slice(0, qualifiedCount);

		nextPhase.status = PhaseStatus.Active;
		nextPhase.startedAt = new Date();

		const nextSize = nextPhase.qualifiersCount > 0 ? nextPhase.qualifiersCount : qualified.length;

		if (nextPhase.kind === PhaseKind.Top8Bracket || nextPhase.kind === PhaseKind.SingleElim) {
			const top = qualified.slice(0, nextSize);
			const half = Math.floor(top.length / 2);

			for (let i = 0; i < half; i++) {
				const seedHigh = top[i];
				const seedLow = top[top.length - 1 - i];
				if (!seedHigh || !seedLow) continue;

				const lobby = new Lobby();
				lobby.eventType = EventTypeEnum.TOURNAMENT;
				lobby.event = loaded.tournament;
				lobby.state = LobbyState.FRESH;
				lobby.matchFormat = MatchFormat.BO3;
				lobby.phase = nextPhase;
				lobby.swissRound = null;
				em.persist(lobby);
			}
		}

		await em.flush();
		return nextPhase;
	}
}
