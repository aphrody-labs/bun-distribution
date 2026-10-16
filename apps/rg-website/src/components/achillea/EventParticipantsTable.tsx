"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { createAchilleaClient } from "@/lib/achillea";
import type { ParticipantDTO } from "@rosegriffon/achillea-types";
import { ParticipantStatus, TournamentState } from "@rosegriffon/achillea-types/enums/eventEnums";
import {
  activeParticipants,
  waitlist,
  disqualifiedCount,
  participantStatus,
  sortBySeed,
} from "@rosegriffon/achillea-core";
import { UserAvatar } from "@/components/achillea/UserAvatar";
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@rosegriffon/ui";
import {
  Users,
  Shuffle,
  Trash2,
  RotateCcw,
  UserCheck,
  UserX,
  Loader2,
  Search,
  Pencil,
  Check,
  X,
  ArrowUp,
  TrendingUp,
} from "lucide-react";

interface EventParticipantsTableProps {
  eventId: number;
  eventName: string;
  participantsCount: number;
  internalState?: TournamentState;
  participants: ParticipantDTO[];
  canManage?: boolean;
  onReload?: () => void;
}

export function EventParticipantsTable({
  eventId,
  eventName,
  participantsCount,
  internalState = TournamentState.PREREGISTERING,
  participants,
  canManage = false,
  onReload,
}: EventParticipantsTableProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [editingParticipantId, setEditingParticipantId] = useState<number | null>(null);
  const [editingSeedValue, setEditingSeedValue] = useState<number>(1);
  const [savingSeed, setSavingSeed] = useState(false);
  const [bulkLoading, setBulkLoading] = useState(false);

  // Action confirmation modal state
  const [confirmAction, setConfirmAction] = useState<
    "seedRanked" | "seedRandom" | "clearSeeds" | "remove" | "disqualify" | "reinstate" | "promote" | null
  >(null);
  const [targetParticipant, setTargetParticipant] = useState<ParticipantDTO | null>(null);
  const [disqualifyReason, setDisqualifyReason] = useState("");

  const client = createAchilleaClient({ credentials: "include" });

  const active = useMemo(() => activeParticipants(participants), [participants]);
  const waiting = useMemo(() => waitlist(participants), [participants]);
  const dqCount = useMemo(() => disqualifiedCount(participants), [participants]);

  const canManageSeeding =
    canManage && (internalState === TournamentState.PREREGISTERING || internalState === TournamentState.PREPARING);

  const canDisqualify =
    canManage && internalState !== TournamentState.FINISHED && internalState !== TournamentState.CANCELED;

  const filteredParticipants = useMemo(() => {
    const sorted = sortBySeed(participants);
    if (!searchQuery.trim()) return sorted;
    const q = searchQuery.toLowerCase().trim();
    return sorted.filter(p => p.user?.username?.toLowerCase().includes(q));
  }, [participants, searchQuery]);

  const handleSaveSeed = async (p: ParticipantDTO) => {
    if (editingSeedValue < 1 || editingSeedValue > participantsCount) return;
    setSavingSeed(true);
    try {
      const res = await client.tournaments.setParticipantSeeding(eventId, {
        id: p.id,
        seed: editingSeedValue,
      });
      if (res.ok) {
        setEditingParticipantId(null);
        onReload?.();
      }
    } finally {
      setSavingSeed(false);
    }
  };

  const executeConfirmedAction = async () => {
    if (!confirmAction) return;
    setBulkLoading(true);

    try {
      let res: { ok: boolean } = { ok: false };

      switch (confirmAction) {
        case "seedRanked":
          res = await client.tournaments.seedByRanked(eventId);
          break;
        case "seedRandom":
          res = await client.tournaments.seedRandom(eventId);
          break;
        case "clearSeeds":
          res = await client.tournaments.clearSeeds(eventId);
          break;
        case "remove":
          if (targetParticipant?.user?.id) {
            res = await client.tournaments.removeParticipant(eventId, targetParticipant.user.id);
          }
          break;
        case "disqualify":
          if (targetParticipant?.user?.id && disqualifyReason.trim().length >= 3) {
            res = await client.tournaments.disqualifyParticipant(
              eventId,
              targetParticipant.user.id,
              disqualifyReason.trim(),
            );
          }
          break;
        case "reinstate":
          if (targetParticipant?.user?.id) {
            res = await client.tournaments.reinstateParticipant(eventId, targetParticipant.user.id);
          }
          break;
        case "promote":
          if (targetParticipant?.user?.id) {
            res = await client.tournaments.promoteParticipant(eventId, targetParticipant.user.id);
          }
          break;
      }

      if (res.ok) {
        setConfirmAction(null);
        setTargetParticipant(null);
        setDisqualifyReason("");
        onReload?.();
      }
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Overview stats header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 pb-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <Users className="size-5 text-primary" />
            <h2 className="text-lg font-bold text-on-surface">Participants</h2>
          </div>
          <Badge variant="default" className="text-lg font-semibold">
            {active.length} / {participantsCount} inscrits
          </Badge>
          {waiting.length > 0 && (
            <Badge variant="outline" className="text-lg font-semibold text-amber-400 border-amber-500/30">
              {waiting.length} en attente
            </Badge>
          )}
          {dqCount > 0 && (
            <Badge variant="destructive" className="text-lg font-semibold">
              {dqCount} disqualifié{dqCount > 1 ? "s" : ""}
            </Badge>
          )}
        </div>

        {/* Seeding Toolbar for TO */}
        {canManageSeeding && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmAction("seedRanked")}
              disabled={bulkLoading || participants.length === 0}
              className="min-h-11 text-lg gap-1.5"
            >
              <TrendingUp className="size-3.5 text-primary" />
              Seed par ELO
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmAction("seedRandom")}
              disabled={bulkLoading || participants.length === 0}
              className="min-h-11 text-lg gap-1.5"
            >
              <Shuffle className="size-3.5 text-sky-400" />
              Mélange aléatoire
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setConfirmAction("clearSeeds")}
              disabled={bulkLoading}
              className="min-h-11 text-lg gap-1 text-muted-foreground hover:text-rose-400"
            >
              <RotateCcw className="size-3.5" />
              Effacer
            </Button>
          </div>
        )}
      </div>

      {/* Search filter */}
      <div className="relative max-w-sm">
        <label htmlFor="participant-search" className="block mb-2 text-lg font-semibold">
          Rechercher un joueur
        </label>
        <Search aria-hidden="true" className="absolute left-3 bottom-3 size-5 text-muted-foreground" />
        <input
          id="participant-search"
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Rechercher un joueur..."
          className="w-full pl-9 pr-3 min-h-11 py-2 text-lg rounded-xl border border-border/60 bg-muted/20 focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-primary"
        />
      </div>

      {/* Participants Table */}
      {filteredParticipants.length === 0 ? (
        <div className="p-12 text-center border border-border/60 rounded-2xl bg-card/40 space-y-2">
          <Users className="size-8 text-muted-foreground mx-auto" />
          <div className="font-semibold text-lg">Aucun participant trouvé</div>
          <p className="text-lg text-muted-foreground">
            {searchQuery ? "Modifie tes critères de recherche." : "Les inscriptions sont encore ouvertes."}
          </p>
        </div>
      ) : (
        <section
          aria-label="Liste des participants, défilement horizontal sur petit écran"
          tabIndex={0}
          className="border border-border/60 rounded-2xl bg-card/40 overflow-x-auto focus-visible:outline-4 focus-visible:outline-primary"
        >
          <table className="w-full text-left text-lg">
            <thead>
              <tr className="border-b border-border/60 bg-muted/30 text-muted-foreground">
                <th className="p-3 font-semibold w-24">Seed</th>
                <th className="p-3 font-semibold">Joueur</th>
                <th className="p-3 font-semibold">Classement ELO</th>
                <th className="p-3 font-semibold">Statut</th>
                {canManage && <th className="p-3 font-semibold text-right">Actions</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/40">
              {filteredParticipants.map(p => {
                const st = participantStatus(p);
                const isEditingThisSeed = editingParticipantId === p.id;
                const elo = p.user?.soloRank?.elo ?? 0;
                const rankKey = p.user?.soloRank?.key ?? "Non classé";

                return (
                  <tr key={p.id} className="hover:bg-muted/20 transition-colors">
                    {/* Seed Column */}
                    <td className="p-3">
                      {isEditingThisSeed ? (
                        <div className="flex items-center gap-1.5">
                          <input
                            type="number"
                            min={1}
                            max={participantsCount}
                            value={editingSeedValue}
                            aria-label={`Seed de ${p.user?.username ?? "ce participant"}`}
                            onChange={e => setEditingSeedValue(Number(e.target.value))}
                            className="w-20 min-h-11 p-1 text-lg font-mono font-bold rounded border border-primary bg-background text-center"
                          />
                          <Button
                            variant="ghost"
                            size="sm"
                            className="min-h-11 min-w-11 p-0 text-emerald-400"
                            aria-label={`Enregistrer la seed de ${p.user?.username ?? "ce participant"}`}
                            onClick={() => handleSaveSeed(p)}
                            disabled={savingSeed}
                          >
                            {savingSeed ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3.5" />}
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="min-h-11 min-w-11 p-0 text-muted-foreground"
                            aria-label="Annuler la modification de la seed"
                            onClick={() => setEditingParticipantId(null)}
                          >
                            <X className="size-3.5" />
                          </Button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className={`font-mono font-bold ${p.seed ? "text-primary" : "text-muted-foreground"}`}>
                            {p.seed ? `#${p.seed}` : "—"}
                          </span>
                          {canManageSeeding && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditingParticipantId(p.id);
                                setEditingSeedValue(p.seed ?? 1);
                              }}
                              className="min-h-11 min-w-11 text-muted-foreground hover:text-primary focus-visible:outline-4 focus-visible:outline-primary"
                              aria-label={`Modifier la seed de ${p.user?.username ?? "ce participant"}`}
                              title="Modifier la seed"
                            >
                              <Pencil className="size-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Player Column */}
                    <td className="p-3">
                      <div className="flex items-center gap-2.5">
                        <UserAvatar
                          userId={p.user?.id}
                          avatar={p.user?.avatar}
                          name={p.user?.username ?? "Joueur"}
                          size="sm"
                        />
                        <div className="min-w-0">
                          <Link
                            href={`/achillea/users/${p.user?.id}`}
                            className="font-bold text-on-surface hover:text-primary transition-colors truncate block"
                          >
                            {p.user?.username ?? "Joueur anonyme"}
                          </Link>
                        </div>
                      </div>
                    </td>

                    {/* ELO Column */}
                    <td aria-label={`Classement : ${elo > 0 ? `${elo} ELO` : "Placement"}, ${rankKey}`} className="p-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-lg">{elo > 0 ? `${elo} ELO` : "Placement"}</span>
                        <Badge variant="outline" className="text-lg font-normal">
                          {rankKey}
                        </Badge>
                      </div>
                    </td>

                    {/* Status Column */}
                    <td className="p-3">
                      {st === ParticipantStatus.DISQUALIFIED ? (
                        <Badge variant="destructive" className="text-lg font-bold">
                          Disqualifié
                        </Badge>
                      ) : st === ParticipantStatus.WAITLISTED ? (
                        <Badge variant="outline" className="text-lg text-amber-400 border-amber-500/30">
                          Attente #{p.waitlistPosition ?? "—"}
                        </Badge>
                      ) : (
                        <Badge variant="secondary" className="text-lg font-semibold text-emerald-400">
                          Inscrit
                        </Badge>
                      )}
                    </td>

                    {/* Actions Column */}
                    {canManage && (
                      <td className="p-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {st === ParticipantStatus.WAITLISTED && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-lg min-h-11 px-2 text-emerald-400 border-emerald-500/30 gap-1"
                              onClick={() => {
                                setTargetParticipant(p);
                                setConfirmAction("promote");
                              }}
                            >
                              <ArrowUp className="size-3" />
                              Promouvoir
                            </Button>
                          )}

                          {st === ParticipantStatus.DISQUALIFIED && (
                            <Button
                              variant="outline"
                              size="sm"
                              className="text-lg min-h-11 px-2 text-sky-400 border-sky-500/30 gap-1"
                              onClick={() => {
                                setTargetParticipant(p);
                                setConfirmAction("reinstate");
                              }}
                            >
                              <UserCheck className="size-3" />
                              Réintégrer
                            </Button>
                          )}

                          {canDisqualify && st !== ParticipantStatus.DISQUALIFIED && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-lg min-h-11 px-2 text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10"
                              onClick={() => {
                                setTargetParticipant(p);
                                setConfirmAction("disqualify");
                              }}
                              title="Disqualifier"
                              aria-label={`Disqualifier ${p.user?.username ?? "ce participant"}`}
                            >
                              <UserX className="size-3.5" />
                            </Button>
                          )}

                          {canManageSeeding && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-lg min-h-11 px-2 text-muted-foreground hover:text-rose-400 hover:bg-rose-500/10"
                              onClick={() => {
                                setTargetParticipant(p);
                                setConfirmAction("remove");
                              }}
                              title="Retirer"
                              aria-label={`Retirer ${p.user?.username ?? "ce participant"}`}
                            >
                              <Trash2 className="size-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {/* Confirm Action Dialog */}
      <Dialog open={confirmAction !== null} onOpenChange={o => !o && setConfirmAction(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {confirmAction === "seedRanked" && "Attribuer les seeds par ELO"}
              {confirmAction === "seedRandom" && "Mélanger aléatoirement les seeds"}
              {confirmAction === "clearSeeds" && "Réinitialiser toutes les seeds"}
              {confirmAction === "remove" && "Retirer un participant"}
              {confirmAction === "disqualify" && "Disqualifier un participant"}
              {confirmAction === "reinstate" && "Réintégrer un participant"}
              {confirmAction === "promote" && "Promouvoir depuis la liste d'attente"}
            </DialogTitle>
            <DialogDescription>
              {confirmAction === "seedRanked" &&
                "Les participants seront classés de la seed #1 à la plus basse selon leur ELO en match classé."}
              {confirmAction === "seedRandom" &&
                "Toutes les seeds actuelles seront écrasées par un tirage au sort déterministe."}
              {confirmAction === "clearSeeds" && "Toutes les attributions de seeds seront effacées pour ce tournoi."}
              {confirmAction === "remove" &&
                `Es-tu sûr de vouloir retirer ${targetParticipant?.user?.username} du tournoi ${eventName} ?`}
              {confirmAction === "disqualify" &&
                `Indique le motif officiel de disqualification pour ${targetParticipant?.user?.username}.`}
              {confirmAction === "reinstate" &&
                `Réintégrer ${targetParticipant?.user?.username} en tant que participant actif ?`}
              {confirmAction === "promote" &&
                `Promouvoir ${targetParticipant?.user?.username} au sein de l'arbre principal ?`}
            </DialogDescription>
          </DialogHeader>

          {confirmAction === "disqualify" && (
            <div className="py-2 space-y-1.5">
              <label htmlFor="disqualify-reason" className="text-lg font-semibold">
                Motif de disqualification (min. 3 caractères)
              </label>
              <textarea
                id="disqualify-reason"
                rows={3}
                value={disqualifyReason}
                onChange={e => setDisqualifyReason(e.target.value)}
                placeholder="Ex: Absence répétée au check-in, triche avérée, forfait..."
                className="w-full p-2.5 rounded-xl border border-border/60 bg-muted/20 text-lg focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-destructive"
              />
            </div>
          )}

          <DialogFooter>
            <Button
              variant="ghost"
              className="min-h-11 text-lg"
              onClick={() => setConfirmAction(null)}
              disabled={bulkLoading}
            >
              Annuler
            </Button>
            <Button
              variant={
                confirmAction === "disqualify" || confirmAction === "remove" || confirmAction === "clearSeeds"
                  ? "destructive"
                  : "default"
              }
              onClick={executeConfirmedAction}
              className="min-h-11 text-lg"
              disabled={bulkLoading || (confirmAction === "disqualify" && disqualifyReason.trim().length < 3)}
            >
              {bulkLoading ? "Traitement..." : "Confirmer l'action"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
