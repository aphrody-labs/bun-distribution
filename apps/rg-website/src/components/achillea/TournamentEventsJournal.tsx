"use client";

import { useResetState } from "@/hooks/use-reset-state";

import React, { useEffect } from "react";
import { createAchilleaClient } from "@/lib/achillea";
import {
  Activity,
  Calendar,
  CheckCircle,
  AlertCircle,
  UserPlus,
  FastForward,
  Trophy,
  Gavel,
  Loader2,
  Layers,
  FileEdit,
} from "lucide-react";
import type { TournamentEventDTO } from "@rosegriffon/achillea-types";
import { TournamentEventType } from "@rosegriffon/achillea-types/enums/eventEnums";

interface TournamentEventsJournalProps {
  tournamentId: number;
}

export function TournamentEventsJournal({ tournamentId }: TournamentEventsJournalProps) {
  const [events, setEvents] = useResetState<TournamentEventDTO[]>([], tournamentId);
  const [loading, setLoading] = useResetState<boolean>(true, tournamentId);
  const [_error, setError] = useResetState<string | null>(null, tournamentId);

  useEffect(() => {
    let cancelled = false;
    const client = createAchilleaClient();

    client.tournaments
      .events(tournamentId)
      .then(res => {
        if (cancelled) return;
        if (res.ok && res.value) {
          setEvents(res.value);
        } else {
          setEvents([]);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Impossible de charger les événements.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [tournamentId]);

  if (loading) {
    return (
      <div className="py-12 text-center space-y-2">
        <Loader2 className="w-6 h-6 animate-spin text-primary mx-auto" />
        <p className="text-xs text-muted-foreground">Chargement du journal d&apos;événements…</p>
      </div>
    );
  }

  if (events.length === 0) {
    return (
      <div className="p-8 border border-dashed border-border rounded-2xl text-center space-y-2">
        <Activity className="w-8 h-8 text-muted-foreground/60 mx-auto" />
        <p className="text-xs text-muted-foreground">
          Aucun événement consigné dans le journal du tournoi pour le moment.
        </p>
      </div>
    );
  }

  const getEventDetails = (evt: TournamentEventDTO) => {
    switch (evt.type) {
      case TournamentEventType.REGISTRATIONS_OPENED:
        return {
          label: "Ouverture des inscriptions",
          icon: <Calendar className="w-4 h-4 text-emerald-400" />,
        };
      case TournamentEventType.REGISTRATIONS_CLOSED:
        return {
          label: "Clôture des inscriptions",
          icon: <Calendar className="w-4 h-4 text-amber-400" />,
        };
      case TournamentEventType.PARTICIPANT_REGISTERED:
        return {
          label: evt.target ? `${evt.target.displayName || evt.target.username} s'est inscrit` : "Nouvelle inscription",
          icon: <UserPlus className="w-4 h-4 text-emerald-400" />,
        };
      case TournamentEventType.PARTICIPANT_UNREGISTERED:
      case TournamentEventType.PARTICIPANT_REMOVED:
        return {
          label: evt.target ? `${evt.target.displayName || evt.target.username} a été désinscrit` : "Désinscription",
          icon: <AlertCircle className="w-4 h-4 text-rose-400" />,
        };
      case TournamentEventType.PARTICIPANT_DISQUALIFIED:
        return {
          label: evt.target
            ? `Disqualification de ${evt.target.displayName || evt.target.username}`
            : "Disqualification",
          icon: <Gavel className="w-4 h-4 text-rose-400" />,
        };
      case TournamentEventType.BRACKET_GENERATED:
        return {
          label: "Arbre de compétition généré",
          icon: <Layers className="w-4 h-4 text-primary" />,
        };
      case TournamentEventType.TOURNAMENT_STARTED:
        return {
          label: "Démarrage officiel du tournoi",
          icon: <FastForward className="w-4 h-4 text-primary" />,
        };
      case TournamentEventType.PHASE_ADVANCED:
        return {
          label: "Passage au tour suivant",
          icon: <FastForward className="w-4 h-4 text-primary" />,
        };
      case TournamentEventType.SCORE_REPORTED:
        return {
          label: "Saisie d'un score de manche",
          icon: <FileEdit className="w-4 h-4 text-blue-400" />,
        };
      case TournamentEventType.SCORE_VALIDATED:
        return {
          label: "Score de manche validé",
          icon: <CheckCircle className="w-4 h-4 text-emerald-400" />,
        };
      case TournamentEventType.TOURNAMENT_CLOSED:
        return {
          label: "Clôture du tournoi",
          icon: <Trophy className="w-4 h-4 text-amber-400" />,
        };
      case TournamentEventType.TOURNAMENT_CANCELED:
        return {
          label: "Annulation du tournoi",
          icon: <Gavel className="w-4 h-4 text-rose-400" />,
        };
      default:
        return {
          label: `Événement : ${evt.type}`,
          icon: <Activity className="w-4 h-4 text-muted-foreground" />,
        };
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-border/60 pb-3">
        <h4 className="text-xs font-bold uppercase tracking-wider text-muted-foreground flex items-center gap-2">
          <Activity className="w-4 h-4 text-primary" />
          Journal officiel de compétition ({events.length})
        </h4>
      </div>

      <div className="divide-y divide-border/60 border border-border rounded-2xl overflow-hidden bg-card shadow-xs">
        {events.map((evt, idx) => {
          const dateStr = new Date(evt.createdAt).toLocaleString("fr-FR", {
            day: "numeric",
            month: "short",
            hour: "2-digit",
            minute: "2-digit",
          });
          const details = getEventDetails(evt);

          return (
            <div
              key={evt.id ?? idx}
              className="p-3.5 px-4 flex items-center justify-between gap-4 hover:bg-muted/20 transition text-xs"
            >
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-background border border-border shrink-0">{details.icon}</div>
                <div className="space-y-0.5">
                  <div className="font-semibold text-foreground">{details.label}</div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2">
                    {evt.actor && (
                      <span>
                        Par <strong className="text-foreground">{evt.actor.displayName || evt.actor.username}</strong>
                      </span>
                    )}
                    {evt.reason && <span className="italic text-rose-400">({evt.reason})</span>}
                    <span>·</span>
                    <span>{dateStr}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
