"use client";

import { useResetState } from "@/hooks/use-reset-state";

import React, { useEffect, useState } from "react";
import { createAchilleaClient } from "@/lib/achillea";
import { Button, Badge } from "@rosegriffon/ui";
import {
  ShieldAlert,
  Play,
  FastForward,
  CheckCircle,
  XCircle,
  Coins,
  Dices,
  TrendingUp,
  Layers,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { TournamentState } from "@rosegriffon/achillea-types/enums/eventEnums";
import type { WireTournament } from "@rosegriffon/achillea-types/domain/tournament-ops";

interface TournamentLifecycleActionsProps {
  tournament: WireTournament;
  onUpdated: () => void;
}

export function TournamentLifecycleActions({ tournament, onUpdated }: TournamentLifecycleActionsProps) {
  const [loadingAction, setLoadingAction] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; type: "success" | "error" } | null>(null);
  const [cancelReason, setCancelReason] = useState<string>("");
  const [showCancelPrompt, setShowCancelPrompt] = useState<boolean>(false);
  const [payoutReadiness, setPayoutReadiness] = useResetState<"checking" | "ready" | "unresolved" | "unavailable">(
    "checking",
    `${tournament.id}:${tournament.internalState}`,
  );

  useEffect(() => {
    if (tournament.internalState !== TournamentState.FINISHED) return;
    let cancelled = false;
    createAchilleaClient()
      .tournaments.summary(tournament.id)
      .then(result => {
        if (cancelled) return;
        setPayoutReadiness(
          result.ok && result.value
            ? result.value.top10.some(standing => standing.rank === 1)
              ? "ready"
              : "unresolved"
            : "unavailable",
        );
      })
      .catch(() => {
        if (!cancelled) setPayoutReadiness("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [tournament.id, tournament.internalState]);

  const executeAction = async (actionKey: string, fn: () => Promise<{ ok: boolean; error?: { message: string } }>) => {
    setLoadingAction(actionKey);
    setMessage(null);
    try {
      const res = await fn();
      if (res.ok) {
        setMessage({ text: "Action exécutée avec succès.", type: "success" });
        onUpdated();
      } else {
        setMessage({ text: res.error?.message || "L'action a échoué.", type: "error" });
      }
    } catch {
      setMessage({ text: "Erreur de communication avec le serveur.", type: "error" });
    } finally {
      setLoadingAction(null);
    }
  };

  const client = createAchilleaClient({ credentials: "include" });

  return (
    <div className="p-6 rounded-3xl bg-card border border-primary/30 shadow-xs space-y-4">
      <div className="flex items-center justify-between gap-4 border-b border-border/60 pb-3">
        <div className="flex items-center gap-2.5">
          <span className="p-2 rounded-xl bg-primary/10 text-primary border border-primary/20">
            <ShieldAlert className="w-4 h-4" />
          </span>
          <div>
            <h3 className="font-bold text-sm text-foreground">Panneau d&apos;Organisation Officiel</h3>
            <p className="text-xs text-muted-foreground">Contrôle du cycle de vie et de l&apos;arbre de compétition.</p>
          </div>
        </div>

        <Badge variant="outline" className="border-primary/40 text-primary text-xs">
          Organisateur
        </Badge>
      </div>

      {message && (
        <div
          className={`p-3 rounded-xl text-xs flex items-center gap-2 border ${
            message.type === "success"
              ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
              : "bg-rose-500/10 border-rose-500/30 text-rose-400"
          }`}
        >
          {message.type === "success" ? (
            <CheckCircle className="w-4 h-4 shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 shrink-0" />
          )}
          {message.text}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2.5 pt-1">
        {/* Ouvrir inscriptions */}
        {tournament.internalState === TournamentState.PENDING && (
          <Button
            size="sm"
            disabled={loadingAction !== null}
            onClick={() =>
              executeAction("openRegistrations", () => client.tournaments.openRegistrations(tournament.id))
            }
            className="text-xs font-bold gap-1.5"
          >
            {loadingAction === "openRegistrations" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Ouvrir les inscriptions
          </Button>
        )}

        {/* Générer l'arbre */}
        {(tournament.internalState === TournamentState.PREREGISTERING ||
          tournament.internalState === TournamentState.PREPARING) && (
          <>
            <Button
              size="sm"
              variant="outline"
              disabled={loadingAction !== null}
              onClick={() => executeAction("generateBracket", () => client.tournaments.generateBracket(tournament.id))}
              className="text-xs font-semibold gap-1.5"
            >
              {loadingAction === "generateBracket" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Layers className="w-3.5 h-3.5" />
              )}
              Générer l&apos;arbre de tournoi
            </Button>

            <Button
              size="sm"
              variant="ghost"
              disabled={loadingAction !== null}
              onClick={() => executeAction("seedByRanked", () => client.tournaments.seedByRanked(tournament.id))}
              className="text-xs font-semibold gap-1.5"
              title="Attribue les têtes de séries par niveau ELO solo"
            >
              {loadingAction === "seedByRanked" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <TrendingUp className="w-3.5 h-3.5 text-amber-400" />
              )}
              Seeding par Elo
            </Button>

            <Button
              size="sm"
              variant="ghost"
              disabled={loadingAction !== null}
              onClick={() => executeAction("seedRandom", () => client.tournaments.seedRandom(tournament.id))}
              className="text-xs font-semibold gap-1.5"
            >
              {loadingAction === "seedRandom" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Dices className="w-3.5 h-3.5" />
              )}
              Seeding Aléatoire
            </Button>
          </>
        )}

        {/* Démarrer le tournoi */}
        {tournament.internalState === TournamentState.PREPARING && (
          <Button
            size="sm"
            disabled={loadingAction !== null}
            onClick={() => executeAction("start", () => client.tournaments.start(tournament.id))}
            className="text-xs font-bold gap-1.5 bg-emerald-600 hover:bg-emerald-500 text-white"
          >
            {loadingAction === "start" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Démarrer le tournoi
          </Button>
        )}

        {/* Passer à la phase suivante */}
        {tournament.internalState === TournamentState.ONGOING && (
          <Button
            size="sm"
            disabled={loadingAction !== null}
            onClick={() => executeAction("nextPhase", () => client.tournaments.nextPhase(tournament.id))}
            className="text-xs font-bold gap-1.5"
          >
            {loadingAction === "nextPhase" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <FastForward className="w-3.5 h-3.5" />
            )}
            Passer à la phase suivante
          </Button>
        )}

        {/* Clôturer / Verser les récompenses */}
        {tournament.internalState === TournamentState.ONGOING && (
          <Button
            size="sm"
            variant="outline"
            disabled={loadingAction !== null}
            onClick={() => executeAction("close", () => client.tournaments.close(tournament.id, false))}
            className="text-xs font-semibold gap-1.5 border-emerald-500/40 text-emerald-400"
          >
            {loadingAction === "close" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <CheckCircle className="w-3.5 h-3.5" />
            )}
            Clôturer le tournoi
          </Button>
        )}

        {tournament.internalState === TournamentState.FINISHED && (
          <div className="space-y-2">
            <Button
              size="sm"
              variant="outline"
              disabled={loadingAction !== null || payoutReadiness !== "ready"}
              onClick={() =>
                executeAction("applyPlacementPrizes", () => client.tournaments.applyPlacementPrizes(tournament.id))
              }
              className="text-xs font-semibold gap-1.5 border-amber-500/40 text-amber-400"
            >
              {loadingAction === "applyPlacementPrizes" ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Coins className="w-3.5 h-3.5 text-amber-400" />
              )}
              Distribuer les AP Podium
            </Button>
            {payoutReadiness !== "ready" && (
              <output className="max-w-sm text-lg text-muted-foreground">
                {payoutReadiness === "checking"
                  ? "Vérification du classement final…"
                  : payoutReadiness === "unresolved"
                    ? "Récompenses indisponibles : le bracket historique ne fournit pas de champion vérifié."
                    : "Récompenses indisponibles : le classement final n’a pas pu être vérifié."}
              </output>
            )}
          </div>
        )}

        {/* Annuler */}
        {tournament.internalState !== TournamentState.FINISHED &&
          tournament.internalState !== TournamentState.CANCELED && (
            <Button
              size="sm"
              variant="ghost"
              disabled={loadingAction !== null}
              onClick={() => setShowCancelPrompt(true)}
              className="text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 ml-auto"
            >
              <XCircle className="w-3.5 h-3.5 mr-1" />
              Annuler le tournoi
            </Button>
          )}
      </div>

      {showCancelPrompt && (
        <div className="p-4 rounded-2xl bg-rose-500/10 border border-rose-500/30 space-y-3 mt-3">
          <h4 className="text-xs font-bold text-rose-400">Confirmation d&apos;annulation du tournoi</h4>
          <input
            type="text"
            value={cancelReason}
            onChange={e => setCancelReason(e.target.value)}
            placeholder="Motif de l'annulation (obligatoire)"
            className="w-full px-3 py-2 rounded-xl bg-background border border-border text-xs focus:outline-hidden focus:ring-1 focus:ring-rose-500"
          />
          <div className="flex items-center justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setShowCancelPrompt(false)} className="text-xs">
              Retour
            </Button>
            <Button
              size="sm"
              disabled={!cancelReason.trim() || loadingAction !== null}
              onClick={() => {
                setShowCancelPrompt(false);
                executeAction("cancel", () => client.tournaments.cancel(tournament.id, cancelReason));
              }}
              className="text-xs font-bold bg-rose-600 hover:bg-rose-500 text-white"
            >
              Confirmer l&apos;annulation
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
