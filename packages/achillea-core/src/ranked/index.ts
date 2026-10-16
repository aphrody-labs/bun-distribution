import { TeamSide } from "../enums";

export * from "./challenges";

/** Pure rules used by the Ranked transport (Colyseus today, any runtime tomorrow). */
export function teamForIndex(index: number): TeamSide {
  return index === 0 ? TeamSide.TEAM_1 : TeamSide.TEAM_2;
}

export function isHomeTeam(team: number): boolean {
  return team === TeamSide.TEAM_1;
}

/** Bounds an untrusted score to a valid in-game integer. */
export function clampScore(value: unknown): number {
  const score = Math.floor(Number(value ?? 0));
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(99, score));
}

export const SUPPORTED_MODES = [2, 4] as const;

/** Only 1v1 and 2v2 are valid ranked modes; default safely to 1v1. */
export function parseMode(value: unknown): 2 | 4 {
  return Math.floor(Number(value)) === 4 ? 4 : 2;
}

/** Widens the matching window by 50 rating points every five seconds. */
export function eloWindow(base: number, waitedMs: number): number {
  return base + Math.floor(Math.max(0, waitedMs) / 5000) * 50;
}

export interface QueueCandidate {
  userId: string;
  elo: number;
  enqueuedAt: number;
}

/** Finds the first compatible, distinct-player pair in an ELO-sorted queue. */
export function selectQueuePair(
  sorted: readonly QueueCandidate[],
  now: number,
  baseWindow: number,
): [number, number] | null {
  for (let i = 0; i < sorted.length - 1; i++) {
    const first = sorted[i]!;
    for (let j = i + 1; j < sorted.length; j++) {
      const second = sorted[j]!;
      if (first.userId === second.userId) continue;
      const waited = Math.max(now - first.enqueuedAt, now - second.enqueuedAt);
      const window = eloWindow(baseWindow, waited);
      if (Math.abs(first.elo - second.elo) <= window) return [i, j];
      if (second.elo - first.elo > window) break;
    }
  }
  return null;
}

export interface ScoreInput {
  userId: string;
  myScore: number;
  oppScore: number;
  submitted: boolean;
}

export function scoresAgree(home: ScoreInput, away: ScoreInput): boolean {
  return home.submitted && away.submitted && home.myScore === away.oppScore && home.oppScore === away.myScore;
}

export function resultLabel(myScore: number, oppScore: number): "win" | "loss" | "draw" {
  if (myScore === oppScore) return "draw";
  return myScore > oppScore ? "win" : "loss";
}

export type ScoreOutcome =
  | { kind: "wait" }
  | { kind: "agree"; s1: number; s2: number }
  | { kind: "forfeit"; s1: number; s2: number; forfeitUserId: string }
  | { kind: "dispute" };

/** Resolves dual score reports without inspecting storage, sockets, or Discord. */
export function resolveScores(home: ScoreInput, away: ScoreInput, forced: boolean): ScoreOutcome {
  if (!forced && (!home.submitted || !away.submitted)) return { kind: "wait" };
  if (scoresAgree(home, away)) return { kind: "agree", s1: home.myScore, s2: home.oppScore };
  if (forced && home.submitted && !away.submitted) {
    return { kind: "forfeit", s1: home.myScore, s2: home.oppScore, forfeitUserId: away.userId };
  }
  if (forced && away.submitted && !home.submitted) {
    return { kind: "forfeit", s1: away.oppScore, s2: away.myScore, forfeitUserId: home.userId };
  }
  return { kind: "dispute" };
}
