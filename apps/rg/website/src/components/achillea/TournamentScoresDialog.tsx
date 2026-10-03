"use client";

import { useResetState } from "@/hooks/use-reset-state";

import React, { useEffect, useState } from "react";
import { createAchilleaClient, useAchilleaAuth } from "@/lib/achillea";
import { UserAvatar } from "./UserAvatar";
import { Button, Badge } from "@rosegriffon/ui";
import { X, Check, Swords, AlertCircle, Loader2, Plus } from "lucide-react";
import type { LobbyDTO, GameScoreDTO } from "@rosegriffon/achillea-types";

interface TournamentScoresDialogProps {
  matchId: number | null;
  tournamentId: number;
  isOrganizer: boolean;
  onClose: () => void;
  onScoreUpdated?: () => void;
}

export function TournamentScoresDialog({
  matchId,
  tournamentId: _tournamentId,
  isOrganizer: _isOrganizer,
  onClose,
  onScoreUpdated,
}: TournamentScoresDialogProps) {
  const { user } = useAchilleaAuth();
  const [lobby, setLobby] = useResetState<LobbyDTO | null>(null, matchId);
  const [loading, setLoading] = useResetState<boolean>(true, matchId);
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useResetState<string | null>(null, matchId);

  const [score1, setScore1] = useState<number>(0);
  const [score2, setScore2] = useState<number>(0);

  useEffect(() => {
    if (matchId == null) return;
    let cancelled = false;

    const client = createAchilleaClient({ credentials: "include" });
    client.tournaments
      .lobby(matchId)
      .then((res) => {
        if (cancelled) return;
        if (res.ok && res.value) {
          setLobby(res.value);
        } else {
          setError("Aucun lobby en cours associé à cette rencontre.");
        }
      })
      .catch(() => {
        if (!cancelled) setError("Erreur de chargement du lobby.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [matchId]);

  if (matchId == null) return null;

  const handleReportScore = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!lobby) return;
    setSubmitting(true);
    const client = createAchilleaClient({ credentials: "include" });

    try {
      const nextGameNumber = (lobby.lobbyMatches?.length ?? 0) + 1;
      const payload: GameScoreDTO = {
        lobbyId: lobby.id,
        gameNumber: nextGameNumber,
        score1,
        score2,
      };
      const res = await client.tournaments.reportScore(payload);
      if (res.ok) {
        onScoreUpdated?.();
        // Recharger le lobby
        const refreshed = await client.tournaments.lobby(matchId);
        if (refreshed.ok) setLobby(refreshed.value);
      } else {
        setError(res.detail || "Échec de la soumission du score.");
      }
    } catch {
      setError("Erreur réseau lors de la soumission.");
    } finally {
      setSubmitting(false);
    }
  };

  const handleValidateScore = async (lobbyMatchId: number) => {
    if (!user || !lobby) return;
    setSubmitting(true);
    const client = createAchilleaClient({ credentials: "include" });
    try {
      const res = await client.tournaments.validateScore({
        lobbyId: lobby.id,
        lobbyMatchId,
      });
      if (res.ok) {
        onScoreUpdated?.();
        const refreshed = await client.tournaments.lobby(matchId);
        if (refreshed.ok) setLobby(refreshed.value);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const p1 = lobby?.lobbyUsers?.[0];
  const p2 = lobby?.lobbyUsers?.[1];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div className="w-full max-w-lg bg-card border border-border rounded-3xl shadow-xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* En-tête du modal */}
        <div className="p-5 border-b border-border flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-2.5">
            <span className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <Swords className="w-4 h-4" />
            </span>
            <div>
              <h3 className="font-bold text-sm text-foreground">
                Arbitrage et Scores du Match #{matchId}
              </h3>
              <p className="text-xs text-muted-foreground">
                Validation mutuelle ou décision d&apos;arbitre officiel.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Contenu */}
        <div className="p-6 space-y-6 overflow-y-auto flex-1">
          {loading ? (
            <div className="py-12 text-center space-y-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary mx-auto" />
              <p className="text-xs text-muted-foreground">Chargement des données du match…</p>
            </div>
          ) : error && !lobby ? (
            <div className="py-8 text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-amber-500 mx-auto" />
              <p className="text-xs text-muted-foreground">{error}</p>
            </div>
          ) : (
            <>
              {/* Versus strip */}
              <div className="grid grid-cols-3 items-center p-4 rounded-2xl bg-muted/40 border border-border/80 text-center">
                <div className="flex flex-col items-center gap-1.5">
                  <UserAvatar
                    avatar={p1?.user?.avatar}
                    displayName={p1?.user?.displayName || "Joueur 1"}
                    className="w-10 h-10"
                  />
                  <span className="font-semibold text-xs truncate max-w-[100px]">
                    {p1?.user?.displayName || "Joueur 1"}
                  </span>
                </div>

                <div className="font-black text-xs uppercase tracking-widest text-muted-foreground">
                  VS
                </div>

                <div className="flex flex-col items-center gap-1.5">
                  <UserAvatar
                    avatar={p2?.user?.avatar}
                    displayName={p2?.user?.displayName || "Joueur 2"}
                    className="w-10 h-10"
                  />
                  <span className="font-semibold text-xs truncate max-w-[100px]">
                    {p2?.user?.displayName || "Joueur 2"}
                  </span>
                </div>
              </div>

              {/* Manches enregistrées */}
              <div className="space-y-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Manches disputées
                </h4>

                {lobby?.lobbyMatches && lobby.lobbyMatches.length > 0 ? (
                  <div className="divide-y divide-border/60 border border-border rounded-xl overflow-hidden bg-background/50">
                    {lobby.lobbyMatches.map((m) => (
                      <div
                        key={m.id}
                        className="p-3 flex items-center justify-between gap-4 text-xs"
                      >
                        <span className="font-bold text-muted-foreground">
                          Manche {m.gameNumber}
                        </span>
                        <span className="font-mono font-bold text-sm">
                          {m.scoreTeam1} - {m.scoreTeam2}
                        </span>
                        <div className="flex items-center gap-2">
                          {m.team1Validated && m.team2Validated ? (
                            <Badge
                              variant="outline"
                              className="text-xs border-emerald-500/40 text-emerald-400"
                            >
                              Validé
                            </Badge>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-7 text-xs gap-1"
                              onClick={() => handleValidateScore(m.id)}
                              disabled={submitting}
                            >
                              <Check className="w-3 h-3 text-emerald-400" />
                              Valider
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-dashed border-border text-center text-xs text-muted-foreground">
                    Aucune manche enregistrée pour ce match.
                  </div>
                )}
              </div>

              {/* Formulaire de saisie d'un nouveau score */}
              <form
                onSubmit={handleReportScore}
                className="p-4 rounded-2xl bg-card border border-border space-y-4 shadow-xs"
              >
                <h4 className="text-xs font-bold uppercase tracking-wider text-foreground">
                  Saisir le score d&apos;une manche
                </h4>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">
                      Score {p1?.user?.displayName || "Joueur 1"}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={score1}
                      onChange={(e) => setScore1(parseInt(e.target.value, 10) || 0)}
                      className="w-full px-3 py-2 rounded-xl bg-background border border-border text-center font-mono font-bold text-sm focus:outline-hidden focus:ring-1 focus:ring-primary"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-semibold text-muted-foreground">
                      Score {p2?.user?.displayName || "Joueur 2"}
                    </label>
                    <input
                      type="number"
                      min={0}
                      max={99}
                      value={score2}
                      onChange={(e) => setScore2(parseInt(e.target.value, 10) || 0)}
                      className="w-full px-3 py-2 rounded-xl bg-background border border-border text-center font-mono font-bold text-sm focus:outline-hidden focus:ring-1 focus:ring-primary"
                    />
                  </div>
                </div>

                {error && (
                  <div className="p-2.5 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    {error}
                  </div>
                )}

                <Button
                  type="submit"
                  disabled={submitting}
                  className="w-full gap-2 text-xs font-bold"
                >
                  {submitting ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  Enregistrer la manche
                </Button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
