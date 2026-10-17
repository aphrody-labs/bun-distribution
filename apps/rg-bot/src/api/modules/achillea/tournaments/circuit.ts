import { circuitPointsForRank, circuitPointsToTier, denseRankToTier } from "@rosegriffon/achillea-core";
import { sql, type Kysely } from "kysely";
import type { Database } from "@rosegriffon/db/schema";
import { finalTournamentStandings } from "./bracket";

type Player = {
  userId: string;
  displayName: string;
  username: string;
  avatar: string;
  clan: { id: number; name: string; shortName: string; avatar: string } | null;
  tournamentsPlayed: number;
  points: number;
  tournaments: number;
  wins: number;
  podiums: number;
  top4: number;
  top8: number;
  bestRank: number;
  bestRankLabel: string;
  tier: string;
};

/** Projection publique du circuit, entièrement lue par Kysely. */
export async function circuitRanking(db: Kysely<Database>) {
  const tournaments = await db
    .selectFrom("event")
    .select(["id", "name", "participants_number", "grand_final_at"])
    .where("type", "=", "TOURNAMENT")
    .where("internal_state", "=", "Finished")
    .where("tournament_type", "in", ["single_elimination", "double_elimination"])
    .orderBy("grand_final_at", "desc")
    .execute();
  const players = new Map<string, Player>();
  const summaries: Array<{
    id: number;
    name: string;
    size: number;
    grandFinalAt: string;
    podium: unknown[];
    standingsStatus: "resolved" | "unresolved";
  }> = [];
  for (const tournament of tournaments) {
    const size = Number(tournament.participants_number ?? 0);
    const summary = {
      id: tournament.id,
      name: tournament.name,
      size,
      grandFinalAt: (tournament.grand_final_at ?? new Date(0)).toISOString(),
      podium: [] as unknown[],
      standingsStatus: "unresolved" as "resolved" | "unresolved",
    };
    summaries.push(summary);
    if (size <= 0) continue;
    let standings;
    try {
      standings = await finalTournamentStandings(db, tournament.id);
    } catch {
      // A migrated/unfinished bracket is still part of the public history,
      // but contributes no resolved circuit points yet.
      continue;
    }
    const ids = standings.map(s => s.userId);
    const users = ids.length
      ? await db
          .selectFrom("user")
          .select(["id", "display_name", "username", "avatar"])
          .where("id", "in", ids)
          .execute()
      : [];
    const byId = new Map(users.map(u => [u.id, u]));
    if (standings.length > 0) summary.standingsStatus = "resolved";
    for (const standing of standings) {
      const user = byId.get(standing.userId);
      if (!user) continue;
      const tier = denseRankToTier(standing.rank);
      const points = circuitPointsForRank(size, standing.rank);
      const entry = players.get(user.id) ?? {
        userId: user.id,
        displayName: user.display_name,
        username: user.username ?? user.display_name,
        avatar: user.avatar ?? "",
        clan: null,
        tournamentsPlayed: 0,
        points: 0,
        tournaments: 0,
        wins: 0,
        podiums: 0,
        top4: 0,
        top8: 0,
        bestRank: Number.POSITIVE_INFINITY,
        bestRankLabel: "",
        tier: circuitPointsToTier(0).key,
      };
      entry.points += points;
      entry.tournaments += 1;
      entry.tournamentsPlayed += 1;
      if (standing.rank === 1) entry.wins += 1;
      if (standing.rank <= 2) entry.podiums += 1;
      if (tier.hi <= 4) entry.top4 += 1;
      if (tier.hi <= 8) entry.top8 += 1;
      if (standing.rank < entry.bestRank) {
        entry.bestRank = standing.rank;
        entry.bestRankLabel = tier.label;
      }
      entry.tier = circuitPointsToTier(entry.points).key;
      players.set(user.id, entry);
      if (standing.rank <= 8)
        summary.podium.push({
          rank: standing.rank,
          rankLabel: tier.label,
          userId: user.id,
          displayName: user.display_name,
          avatar: user.avatar ?? "",
        });
    }
  }
  const memberships = players.size
    ? await db
        .selectFrom("clan_member as cm")
        .innerJoin("clan as c", "c.id", "cm.clan_id")
        .select(["cm.user_id", "c.id", "c.name", "c.shortened_name", "c.clan_avatar_url"])
        .where("cm.user_id", "in", [...players.keys()])
        .where("c.is_hidden", "=", false)
        .where("c.is_disbanded", "=", false)
        .orderBy("c.id", "asc")
        .execute()
    : [];
  const clanTotals = new Map<
    number,
    {
      id: number;
      name: string;
      shortName: string;
      avatar: string;
      points: number;
      players: number;
      tournamentsPlayed: number;
      wins: number;
      podiums: number;
      tier: string;
    }
  >();
  for (const membership of memberships) {
    const player = players.get(membership.user_id);
    if (!player || player.clan) continue;
    const clan = {
      id: membership.id,
      name: membership.name,
      shortName: membership.shortened_name,
      avatar: membership.clan_avatar_url,
    };
    player.clan = clan;
    const total = clanTotals.get(clan.id) ?? {
      ...clan,
      points: 0,
      players: 0,
      tournamentsPlayed: 0,
      wins: 0,
      podiums: 0,
      tier: circuitPointsToTier(0).key,
    };
    total.points += player.points;
    total.players += 1;
    total.tournamentsPlayed += player.tournamentsPlayed;
    total.wins += player.wins;
    total.podiums += player.podiums;
    total.tier = circuitPointsToTier(total.points).key;
    clanTotals.set(clan.id, total);
  }
  return {
    leaderboard: [...players.values()].sort(
      (a, b) => b.points - a.points || b.tournamentsPlayed - a.tournamentsPlayed || a.bestRank - b.bestRank,
    ),
    tournaments: summaries,
    clanRanking: [...clanTotals.values()].sort((a, b) => b.points - a.points || b.wins - a.wins || a.id - b.id),
  };
}

type RawMatch = { opponent1Id: number; opponent2Id: number; score1: number; score2: number; isFinal: boolean };

async function rawMatches(db: Kysely<Database>, tournamentId: number): Promise<RawMatch[]> {
  const stage = await sql<{
    id: number;
  }>`select id from bm_stage where tournament_id = ${tournamentId} order by id desc limit 1`.execute(db);
  if (!stage.rows[0]) return [];
  const rows = await sql<{ round_id: number; opponent1: unknown; opponent2: unknown; round_number: number }>`
		select m.round_id, m.opponent1, m.opponent2, r.number as round_number
		from bm_match m left join bm_round r on r.id = m.round_id where m.stage_id = ${stage.rows[0].id}
	`.execute(db);
  const maxRound = Math.max(0, ...rows.rows.map(r => Number(r.round_number ?? 0)));
  const parse = (value: unknown) =>
    (typeof value === "string" ? JSON.parse(value) : value) as { id?: number; score?: number } | null;
  return rows.rows.flatMap(row => {
    const one = parse(row.opponent1);
    const two = parse(row.opponent2);
    if (one?.id == null || two?.id == null || one.score == null || two.score == null) return [];
    return [
      {
        opponent1Id: Number(one.id),
        opponent2Id: Number(two.id),
        score1: Number(one.score),
        score2: Number(two.score),
        isFinal: Number(row.round_number) === maxRound,
      },
    ];
  });
}

export async function tournamentSummary(db: Kysely<Database>, tournamentId: number) {
  const tournament = await db
    .selectFrom("event")
    .select(["id", "name", "participants_number"])
    .where("id", "=", tournamentId)
    .where("type", "=", "TOURNAMENT")
    .executeTakeFirst();
  if (!tournament) return null;
  const matches = await rawMatches(db, tournamentId);
  const participants = await db
    .selectFrom("tournament_participant as p")
    .innerJoin("user as u", "u.id", "p.user_id")
    .select(["p.bracket_participant_id", "p.user_id", "u.display_name", "u.avatar"])
    .where("p.tournament_id", "=", tournamentId)
    .execute();
  const users = new Map(
    participants.filter(p => p.bracket_participant_id != null).map(p => [Number(p.bracket_participant_id), p]),
  );
  const goalsByUser = new Map<string, { scored: number; conceded: number }>();
  for (const match of matches) {
    for (const [participantId, scored, conceded] of [
      [match.opponent1Id, match.score1, match.score2],
      [match.opponent2Id, match.score2, match.score1],
    ]) {
      const userId = users.get(participantId)?.user_id;
      if (!userId) continue;
      const goals = goalsByUser.get(userId) ?? { scored: 0, conceded: 0 };
      goals.scored += scored;
      goals.conceded += conceded;
      goalsByUser.set(userId, goals);
    }
  }
  const stats = matches.length
    ? (() => {
        const goals = matches.reduce((n, m) => n + m.score1 + m.score2, 0);
        const margins = matches.map(m => Math.abs(m.score1 - m.score2));
        const matchup = (m: RawMatch | undefined, _max = false) => {
          if (!m) return null;
          const a =
            m.score1 >= m.score2
              ? [m.opponent1Id, m.score1, m.score2, m.opponent2Id]
              : [m.opponent2Id, m.score2, m.score1, m.opponent1Id];
          const w = users.get(a[0] as number);
          const l = users.get(a[3] as number);
          return w && l
            ? {
                winnerDisplayName: w.display_name,
                winnerAvatar: w.avatar ?? "",
                loserDisplayName: l.display_name,
                loserAvatar: l.avatar ?? "",
                scoreWinner: a[1],
                scoreLoser: a[2],
              }
            : null;
        };
        return {
          matches: matches.length,
          totalGoals: goals,
          avgGoals: Math.round((goals / matches.length) * 100) / 100,
          topScore: Math.max(...matches.flatMap(m => [m.score1, m.score2])),
          minMargin: Math.min(...margins),
          maxMargin: Math.max(...margins),
          biggestBlowout: matchup(matches[margins.indexOf(Math.max(...margins))], true),
          closestMatch: matchup(matches[margins.indexOf(Math.min(...margins))]),
        };
      })()
    : null;
  let top10: unknown[] = [];
  try {
    const standings = await finalTournamentStandings(db, tournamentId);
    const ids = standings.map(s => s.userId);
    const rows = ids.length
      ? await db.selectFrom("user").select(["id", "display_name", "avatar"]).where("id", "in", ids).execute()
      : [];
    const byId = new Map(rows.map(u => [u.id, u]));
    top10 = standings
      .filter(s => s.rank <= 10)
      .map(s => {
        const u = byId.get(s.userId);
        if (!u) return null;
        const points = circuitPointsForRank(Number(tournament.participants_number ?? 0), s.rank);
        const goals = goalsByUser.get(u.id) ?? { scored: 0, conceded: 0 };
        return {
          rank: s.rank,
          rankLabel: denseRankToTier(s.rank).label,
          userId: u.id,
          displayName: u.display_name,
          avatar: u.avatar ?? "",
          clan: null,
          points,
          tier: circuitPointsToTier(points).key,
          goalsScored: goals.scored,
          goalsConceded: goals.conceded,
          goalAverage: goals.conceded ? Math.round((goals.scored / goals.conceded) * 100) / 100 : goals.scored,
        };
      })
      .filter(Boolean);
  } catch {
    /* unfinished bracket */
  }
  return { top10, stats };
}

export async function playerCircuitProfile(db: Kysely<Database>, userId: string) {
  const user = await db.selectFrom("user").select("id").where("id", "=", userId).executeTakeFirst();
  if (!user) return null;
  const participations = await db
    .selectFrom("tournament_participant as p")
    .innerJoin("event as e", "e.id", "p.tournament_id")
    .select(["p.tournament_id", "p.bracket_participant_id", "e.name", "e.participants_number", "e.grand_final_at"])
    .where("p.user_id", "=", userId)
    .where("e.internal_state", "=", "Finished")
    .orderBy("e.grand_final_at", "desc")
    .execute();
  let points = 0,
    wins = 0,
    podiums = 0,
    top4 = 0,
    top8 = 0,
    bestRank = Number.POSITIVE_INFINITY,
    goalsScored = 0,
    goalsConceded = 0,
    bestStreak = 0;
  const history: unknown[] = [];
  for (const p of participations) {
    let rank: number | null = null;
    let tournamentPoints = 0;
    let rankLabel = "—";
    try {
      const standing = (await finalTournamentStandings(db, p.tournament_id)).find(s => s.userId === userId);
      if (standing) {
        rank = standing.rank;
        const rankTier = denseRankToTier(rank);
        rankLabel = rankTier.label;
        tournamentPoints = circuitPointsForRank(Number(p.participants_number ?? 0), rank);
        points += tournamentPoints;
        bestRank = Math.min(bestRank, rank);
        if (rank === 1) wins++;
        if (rank <= 2) podiums++;
        if (rankTier.hi <= 4) top4++;
        if (rankTier.hi <= 8) top8++;
      }
    } catch {}
    const matches = await rawMatches(db, p.tournament_id);
    let streak = 0;
    let gs = 0,
      gc = 0;
    for (const m of matches) {
      const side =
        Number(p.bracket_participant_id) === m.opponent1Id
          ? [m.score1, m.score2]
          : Number(p.bracket_participant_id) === m.opponent2Id
            ? [m.score2, m.score1]
            : null;
      if (!side) continue;
      gs += side[0];
      gc += side[1];
      if (side[0] > side[1]) {
        streak++;
        bestStreak = Math.max(bestStreak, streak);
      } else if (side[0] !== side[1]) streak = 0;
    }
    goalsScored += gs;
    goalsConceded += gc;
    history.push({
      tournamentId: p.tournament_id,
      tournamentName: p.name,
      grandFinalAt: p.grand_final_at,
      size: Number(p.participants_number ?? 0),
      rank,
      rankLabel,
      points: tournamentPoints,
      tier: circuitPointsToTier(tournamentPoints).key,
      goalsScored: gs,
      goalsConceded: gc,
    });
  }
  return {
    tournamentsPlayed: history.length,
    points,
    tier: circuitPointsToTier(points).key,
    wins,
    podiums,
    top4,
    top8,
    bestRankLabel: Number.isFinite(bestRank) ? denseRankToTier(bestRank).label : "—",
    goalsScored,
    goalsConceded,
    goalAverage: goalsConceded ? Math.round((goalsScored / goalsConceded) * 100) / 100 : goalsScored,
    bestStreak,
    history,
  };
}

export async function circuitStats(db: Kysely<Database>) {
  const circuit = await circuitRanking(db);
  const finished = await db
    .selectFrom("event")
    .select(["id", "name", "participants_number", "grand_final_at"])
    .where("type", "=", "TOURNAMENT")
    .where("internal_state", "=", "Finished")
    .orderBy("grand_final_at", "desc")
    .execute();
  let totalMatches = 0,
    totalGoals = 0;
  const tournamentHistory: unknown[] = [];
  for (const t of finished) {
    const summary = await tournamentSummary(db, t.id);
    const stats = summary?.stats as { matches?: number; totalGoals?: number } | null;
    totalMatches += stats?.matches ?? 0;
    totalGoals += stats?.totalGoals ?? 0;
    const podium = (circuit.tournaments.find(x => x.id === t.id)?.podium ?? []) as Array<{
      rank: number;
      displayName: string;
    }>;
    tournamentHistory.push({
      id: t.id,
      name: t.name,
      grandFinalAt: t.grand_final_at,
      size: Number(t.participants_number ?? 0),
      matches: stats?.matches ?? 0,
      goals: stats?.totalGoals ?? 0,
      champion: podium.find(p => p.rank === 1)?.displayName ?? null,
      runnerUp: podium.find(p => p.rank === 2)?.displayName ?? null,
    });
  }
  return {
    overview: {
      totalTournaments: finished.length,
      totalMatches,
      totalGoals,
      avgGoalsPerMatch: totalMatches ? Math.round((totalGoals / totalMatches) * 100) / 100 : 0,
      totalPlayers: circuit.leaderboard.length,
      totalClans: circuit.clanRanking.length,
    },
    records: {
      topScorer: null,
      mostTitles: null,
      mostTournaments: null,
      bestStreakPlayer: null,
      biggestTournament: finished.reduce(
        (best, t) =>
          !best || Number(t.participants_number ?? 0) > best.size
            ? { id: t.id, name: t.name, size: Number(t.participants_number ?? 0) }
            : best,
        null as { id: number; name: string; size: number } | null,
      ),
      highestScoringMatch: null,
      closestFinal: null,
      biggestBlowoutFinal: null,
    },
    players: circuit.leaderboard,
    clans: circuit.clanRanking,
    tournamentHistory,
    tournaments: circuit.tournaments,
  };
}
