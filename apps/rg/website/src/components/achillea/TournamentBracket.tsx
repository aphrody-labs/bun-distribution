"use client";

import React, { useMemo } from "react";
import { UserAvatar } from "./UserAvatar";
import { Badge } from "@rosegriffon/ui";
import { Trophy, Swords, Clock, ChevronRight } from "lucide-react";
import type { WireParticipant } from "@rosegriffon/achillea-types/domain/tournament-ops";

interface BracketParticipantData {
  id: number | string;
  name?: string;
  avatar?: string;
}

interface BracketMatchData {
  id: number;
  stage_id?: number;
  round_id?: number;
  number?: number;
  status?: number;
  opponent1?: {
    id: number | string | null;
    score?: number;
    result?: "win" | "loss";
  } | null;
  opponent2?: {
    id: number | string | null;
    score?: number;
    result?: "win" | "loss";
  } | null;
}

interface RawBracketData {
  stage?: Array<{ id: number; name?: string; type?: string }>;
  match?: BracketMatchData[];
  participant?: BracketParticipantData[];
}

interface TournamentBracketProps {
  bracketData: unknown;
  participants: WireParticipant[];
  maxSlots?: number;
  isOngoing?: boolean;
  canReportScore?: boolean;
  onSelectMatch?: (matchId: number) => void;
}

export function TournamentBracket({
  bracketData,
  participants,
  maxSlots = 16,
  isOngoing: _isOngoing = false,
  canReportScore: _canReportScore = false,
  onSelectMatch,
}: TournamentBracketProps) {
  // Créer un index rapide des participants pour afficher les pseudos réels et avatars
  const participantMap = useMemo(() => {
    const map = new Map<string, { username: string; avatar?: string }>();
    for (const p of participants) {
      const info = {
        username: p.user?.username || `Participant #${p.id}`,
        avatar: p.user?.avatar,
      };
      if (p.id != null) map.set(String(p.id), info);
      if (p.bracketParticipantId != null) map.set(String(p.bracketParticipantId), info);
    }
    return map;
  }, [participants]);

  const raw = bracketData as RawBracketData | null;
  const hasRealMatches = Boolean(raw?.match && Array.isArray(raw.match) && raw.match.length > 0);

  // Regroupement des matchs par Round
  const rounds = useMemo(() => {
    if (!hasRealMatches || !raw?.match) return [];
    const roundMap = new Map<number, BracketMatchData[]>();

    for (const m of raw.match) {
      const rId = m.round_id ?? 1;
      if (!roundMap.has(rId)) roundMap.set(rId, []);
      roundMap.get(rId)!.push(m);
    }

    return Array.from(roundMap.entries())
      .sort(([a], [b]) => a - b)
      .map(([rId, matches]) => ({
        roundId: rId,
        matches: matches.sort((a, b) => (a.number ?? 0) - (b.number ?? 0)),
      }));
  }, [hasRealMatches, raw]);

  const getRoundTitle = (roundIndex: number, totalRounds: number) => {
    const reverseIndex = totalRounds - roundIndex;
    if (reverseIndex === 1) return "Grande Finale";
    if (reverseIndex === 2) return "Demi-finales";
    if (reverseIndex === 3) return "Quarts de finale";
    if (reverseIndex === 4) return "8èmes de finale";
    return `Tour ${roundIndex + 1}`;
  };

  // Si aucun match réel n'a encore été généré, afficher un arbre simulé élégant basé sur les slots
  if (!hasRealMatches || rounds.length === 0) {
    const totalSlots = Math.max(4, Math.min(64, maxSlots));
    const totalRounds = Math.ceil(Math.log2(totalSlots));
    const simulatedRounds = Array.from({ length: totalRounds }).map((_, rIdx) => {
      const matchesCount = totalSlots / 2 ** (rIdx + 1);
      return {
        roundIndex: rIdx,
        title: getRoundTitle(rIdx, totalRounds),
        matchesCount: Math.max(1, matchesCount),
      };
    });

    return (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-muted/40 border border-border">
          <div className="flex items-center gap-3">
            <span className="p-2 rounded-xl bg-amber-500/10 text-amber-400 border border-amber-500/20">
              <Clock className="w-6 h-6" />
            </span>
            <div>
              <h4 className="text-lg font-bold text-foreground uppercase tracking-wider">
                Arbre de compétition prévisionnel
              </h4>
              <p className="text-lg text-muted-foreground mt-0.5">
                L&apos;arbre officiel sera calculé et verrouillé par l&apos;arbitrage dès la clôture
                des inscriptions.
              </p>
            </div>
          </div>
          <Badge variant="outline" className="text-lg border-amber-500/40 text-amber-400">
            {participants.length} / {totalSlots} participants inscrits
          </Badge>
        </div>

        <div className="overflow-x-auto pb-4 pt-2">
          <div className="flex flex-col sm:flex-row items-stretch gap-6 sm:gap-8 min-w-0 sm:min-w-[720px]">
            {simulatedRounds.map((r, rIdx) => (
              <div key={rIdx} className="flex-1 space-y-4">
                <div className="text-center font-bold text-lg uppercase tracking-wider py-1.5 px-3 rounded-lg bg-card border border-border text-foreground shadow-sm">
                  {r.title}
                </div>

                <div className="space-y-4 flex flex-col justify-around h-full">
                  {Array.from({ length: r.matchesCount }).map((_, mIdx) => {
                    // Pour le premier tour, on peut tenter d'afficher les premiers inscrits
                    const p1 = rIdx === 0 ? participants[mIdx * 2] : null;
                    const p2 = rIdx === 0 ? participants[mIdx * 2 + 1] : null;

                    return (
                      <div
                        key={mIdx}
                        className="p-3 rounded-xl bg-card border border-border/70 shadow-xs space-y-2 relative"
                      >
                        <div className="flex items-center justify-between gap-2 text-lg">
                          <div className="flex items-center gap-2 truncate">
                            {p1 ? (
                              <UserAvatar
                                avatar={p1.user?.avatar}
                                displayName={p1.user?.username || "Joueur"}
                                className="w-8 h-8 shrink-0"
                              />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-muted border border-border/80 flex items-center justify-center text-lg text-muted-foreground font-mono">
                                {mIdx * 2 + 1}
                              </div>
                            )}
                            <span
                              className={`truncate font-medium ${p1 ? "text-foreground" : "text-muted-foreground italic"}`}
                            >
                              {p1?.user?.username || "En attente"}
                            </span>
                          </div>
                          <span className="font-mono text-lg font-bold text-muted-foreground">
                            -
                          </span>
                        </div>

                        <div className="border-t border-border/40" />

                        <div className="flex items-center justify-between gap-2 text-lg">
                          <div className="flex items-center gap-2 truncate">
                            {p2 ? (
                              <UserAvatar
                                avatar={p2.user?.avatar}
                                displayName={p2.user?.username || "Joueur"}
                                className="w-8 h-8 shrink-0"
                              />
                            ) : (
                              <div className="w-8 h-8 rounded-full bg-muted border border-border/80 flex items-center justify-center text-lg text-muted-foreground font-mono">
                                {mIdx * 2 + 2}
                              </div>
                            )}
                            <span
                              className={`truncate font-medium ${p2 ? "text-foreground" : "text-muted-foreground italic"}`}
                            >
                              {p2?.user?.username || "En attente"}
                            </span>
                          </div>
                          <span className="font-mono text-lg font-bold text-muted-foreground">
                            -
                          </span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Affichage des matchs réels de l'arbre de compétition
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4 p-4 rounded-2xl bg-card border border-border shadow-xs">
        <div className="flex items-center gap-2">
          <span className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <Swords className="w-6 h-6" />
          </span>
          <div>
            <h4 className="text-lg font-bold text-foreground uppercase tracking-wider">
              Arbre de compétition enregistré
            </h4>
            <p className="text-lg text-muted-foreground">
              {onSelectMatch
                ? "Ouvrez une rencontre pour voir les manches et les actions disponibles."
                : "Résultats enregistrés pour ce tournoi."}
            </p>
          </div>
        </div>

        <Badge variant="outline" className="border-emerald-500/40 text-emerald-400 text-lg gap-1.5">
          Matchs enregistrés
        </Badge>
      </div>

      <div className="overflow-x-auto pb-6 pt-2">
        <div className="flex flex-col sm:flex-row items-stretch gap-6 sm:gap-8 min-w-0 sm:min-w-[850px]">
          {rounds.map((round, rIdx) => {
            const title = getRoundTitle(rIdx, rounds.length);
            const isFinal = rIdx === rounds.length - 1;

            return (
              <div key={round.roundId} className="flex-1 flex flex-col space-y-4">
                <div
                  className={`text-center font-bold text-lg uppercase tracking-wider py-2 px-3 rounded-xl border shadow-xs flex items-center justify-center gap-1.5 ${
                    isFinal
                      ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                      : "bg-card border-border text-foreground"
                  }`}
                >
                  {isFinal && <Trophy className="w-5 h-5 text-amber-400" />}
                  {title}
                </div>

                <div className="space-y-6 flex-1 flex flex-col justify-around">
                  {round.matches.map((m) => {
                    const opp1Info =
                      m.opponent1?.id != null ? participantMap.get(String(m.opponent1.id)) : null;
                    const opp2Info =
                      m.opponent2?.id != null ? participantMap.get(String(m.opponent2.id)) : null;

                    const isWon1 = m.opponent1?.result === "win";
                    const isWon2 = m.opponent2?.result === "win";

                    const score1 = m.opponent1?.score ?? "-";
                    const score2 = m.opponent2?.score ?? "-";

                    return (
                      <div
                        key={m.id}
                        onClick={() => onSelectMatch?.(m.id)}
                        onKeyDown={(event) => {
                          if (onSelectMatch && (event.key === "Enter" || event.key === " ")) {
                            event.preventDefault();
                            onSelectMatch(m.id);
                          }
                        }}
                        role={onSelectMatch ? "button" : undefined}
                        tabIndex={onSelectMatch ? 0 : undefined}
                        aria-label={
                          onSelectMatch
                            ? `Voir le match ${m.number ?? m.id} : ${opp1Info?.username ?? "participant en attente"} contre ${opp2Info?.username ?? "participant en attente"}`
                            : undefined
                        }
                        className={`p-3.5 min-h-11 rounded-2xl border transition-all duration-200 shadow-xs relative group focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-primary ${
                          onSelectMatch ? "hover:border-primary/60 hover:shadow-md" : ""
                        } bg-card border-border/80`}
                      >
                        <div className="space-y-2.5">
                          {/* Opponent 1 */}
                          <div
                            className={`flex items-center justify-between gap-2 text-lg p-1.5 rounded-lg transition ${
                              isWon1
                                ? "bg-emerald-500/10 text-emerald-400 font-bold"
                                : "text-foreground font-medium"
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <UserAvatar
                                avatar={opp1Info?.avatar}
                                displayName={opp1Info?.username || "Joueur 1"}
                                className="w-8 h-8 shrink-0"
                              />
                              <span className="truncate">
                                {opp1Info?.username ||
                                  (m.opponent1?.id != null
                                    ? `Participant #${m.opponent1.id}`
                                    : "En attente")}
                              </span>
                            </div>
                            <span className="font-mono text-lg font-bold px-1.5 py-0.5 rounded bg-muted/60">
                              {score1}
                            </span>
                          </div>

                          <div className="border-t border-border/40" />

                          {/* Opponent 2 */}
                          <div
                            className={`flex items-center justify-between gap-2 text-lg p-1.5 rounded-lg transition ${
                              isWon2
                                ? "bg-emerald-500/10 text-emerald-400 font-bold"
                                : "text-foreground font-medium"
                            }`}
                          >
                            <div className="flex items-center gap-2 truncate">
                              <UserAvatar
                                avatar={opp2Info?.avatar}
                                displayName={opp2Info?.username || "Joueur 2"}
                                className="w-8 h-8 shrink-0"
                              />
                              <span className="truncate">
                                {opp2Info?.username ||
                                  (m.opponent2?.id != null
                                    ? `Participant #${m.opponent2.id}`
                                    : "En attente")}
                              </span>
                            </div>
                            <span className="font-mono text-lg font-bold px-1.5 py-0.5 rounded bg-muted/60">
                              {score2}
                            </span>
                          </div>
                        </div>

                        {onSelectMatch && (
                          <div className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition">
                            <ChevronRight className="w-5 h-5 text-primary" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
