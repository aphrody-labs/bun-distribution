"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Gift, RefreshCw, ExternalLink, FastForward, Users } from "lucide-react";
import { useState } from "react";
import { api } from "@aphrody/admin-ui/client";

interface GiveawayRow {
  id: number;
  messageId: string;
  channelId: string;
  hostId: string;
  title: string;
  reward: string;
  description: string | null;
  winners: number;
  endsAt: string;
  ended: boolean;
  winnerIds: string | null;
  entries: number;
}

function parseWinnerIds(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export default function GiveawaysPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "active" | "ended">("active");

  const giveaways = useQuery({
    queryKey: ["giveaways", filter],
    queryFn: () =>
      api.get<{ rows: GiveawayRow[]; total: number }>(
        filter === "all" ? "/giveaways" : `/giveaways?ended=${filter === "ended"}`,
      ),
  });

  const forceEnd = useMutation({
    mutationFn: (id: number) => api.post(`/giveaways/${id}/end`, {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["giveaways"] }),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-4xl font-saiyan text-dbz-orange mb-2">TIRAGES AU SORT</h1>
        <p className="text-sm text-white/60 mb-1">Gérez les tirages au sort actifs et passés sur votre serveur.</p>
        <p className="text-xs text-white/50 uppercase tracking-widest">
          Créés via la commande <strong>/giveaway</strong> · tirage automatique toutes les minutes
        </p>
      </header>

      <div className="dbz-panel p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Gift className="h-5 w-5 text-dbz-yellow" />
          <div className="flex gap-2">
            {(["active", "ended", "all"] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`dbz-button !text-xs !py-1 !px-3 ${filter === f ? "" : "opacity-50 hover:opacity-80"}`}
              >
                {f === "active" ? "En cours" : f === "ended" ? "Terminés" : "Tous"}
              </button>
            ))}
          </div>
          <span className="ml-auto text-xs text-white/50">
            {giveaways.data?.total ?? 0} tirage
            {(giveaways.data?.total ?? 0) !== 1 ? "s" : ""}
          </span>
          <button
            type="button"
            onClick={() => qc.invalidateQueries({ queryKey: ["giveaways"] })}
            className="dbz-button-ghost !py-1 !px-2"
            title="Actualiser"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      {giveaways.isLoading && (
        <div className="dbz-panel p-8 text-center">
          <p className="font-saiyan text-dbz-orange text-xl mb-2">CHARGEMENT…</p>
          <p className="text-sm text-white/50">Récupération des tirages au sort.</p>
        </div>
      )}

      {giveaways.isError && (
        <div className="dbz-panel p-6 text-center border-l-4 border-red-500">
          <p className="font-saiyan text-red-400 mb-2">Erreur de chargement</p>
          <p className="text-sm text-white/50">
            Impossible de récupérer les tirages. Vérifiez que le bot est en ligne.
          </p>
        </div>
      )}

      {!giveaways.isLoading && !giveaways.isError && giveaways.data?.rows.length === 0 && (
        <div className="dbz-panel p-8 text-center">
          <p className="font-saiyan text-dbz-yellow text-xl mb-2">AUCUN TIRAGE</p>
          <p className="text-sm text-white/50">
            {filter === "active"
              ? "Aucun tirage au sort en cours. Utilisez /giveaway sur Discord pour en créer un."
              : filter === "ended"
                ? "Aucun tirage terminé pour le moment."
                : "Aucun tirage au sort enregistré."}
          </p>
        </div>
      )}

      {forceEnd.isError && (
        <div className="dbz-panel p-3 border-l-4 border-red-500">
          <p className="text-sm text-red-400">
            Erreur lors de la clôture : {forceEnd.error instanceof Error ? forceEnd.error.message : "erreur inconnue"}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {giveaways.data?.rows.map(g => {
          const winnerIds = parseWinnerIds(g.winnerIds);
          const endsDate = new Date(g.endsAt);
          const discordLink = `https://discord.com/channels/@me/${g.channelId}/${g.messageId}`;

          return (
            <div key={g.id} className="dbz-panel p-5">
              <div className="flex items-start gap-4">
                <Gift className="h-6 w-6 text-dbz-yellow shrink-0 mt-0.5" />
                <div className="flex-1 min-w-0">
                  {/* Titre + état */}
                  <div className="flex items-center gap-2 flex-wrap mb-2">
                    <span className="font-saiyan text-white text-lg truncate">{g.title}</span>
                    <span className="text-xs text-white/50 font-mono">#{g.id}</span>
                    {g.ended ? (
                      <span className="px-2 py-0.5 text-xs font-bold bg-white/5 text-white/50 border border-white/10 rounded uppercase">
                        Terminé
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-xs font-bold bg-green-500/20 text-green-300 border border-green-500/40 rounded uppercase">
                        En cours
                      </span>
                    )}
                  </div>

                  {/* Récompense */}
                  <p className="text-sm mb-1">
                    <span className="text-white/50">Récompense : </span>
                    <strong className="text-dbz-yellow">{g.reward}</strong>
                  </p>

                  {/* Détails */}
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-white/50 mb-2">
                    <span>
                      <Users className="h-3 w-3 inline mr-0.5" />
                      {g.entries ?? 0} participant
                      {(g.entries ?? 0) !== 1 ? "s" : ""}
                    </span>
                    <span>
                      {g.winners} gagnant{g.winners !== 1 ? "s" : ""} tiré
                      {g.winners !== 1 ? "s" : ""}
                    </span>
                    <span>
                      {g.ended ? "Clôturé" : "Fin"} le{" "}
                      <time dateTime={g.endsAt}>
                        {endsDate.toLocaleDateString("fr-FR", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}{" "}
                        à{" "}
                        {endsDate.toLocaleTimeString("fr-FR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </span>
                  </div>

                  {/* Description */}
                  {g.description && (
                    <p className="text-sm text-white/50 whitespace-pre-wrap line-clamp-2 mb-2">{g.description}</p>
                  )}

                  {/* Gagnants */}
                  {g.ended && winnerIds.length > 0 && (
                    <div className="mt-2 p-2 rounded border border-dbz-yellow/20 bg-dbz-yellow/5">
                      <p className="text-xs text-white/50 uppercase tracking-widest mb-1">
                        Gagnant{winnerIds.length !== 1 ? "s" : ""}
                      </p>
                      <div className="flex flex-wrap gap-1">
                        {winnerIds.map(id => (
                          <span
                            key={id}
                            className="px-2 py-0.5 text-xs font-mono bg-dbz-yellow/10 text-dbz-yellow border border-dbz-yellow/30 rounded"
                            title={`ID Discord : ${id}`}
                          >
                            {id}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {g.ended && winnerIds.length === 0 && g.winnerIds !== null && (
                    <p className="text-sm text-white/50 mt-2">Aucun gagnant désigné.</p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <a
                    href={discordLink}
                    target="_blank"
                    rel="noreferrer"
                    className="dbz-button-ghost !py-1 !px-2 flex items-center gap-1 !text-xs"
                    title="Voir le message sur Discord"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Discord
                  </a>
                  {!g.ended && (
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          confirm(
                            `Clôturer le tirage "${g.title}" maintenant ?\n\nLe gagnant sera tiré au sort immédiatement.`,
                          )
                        )
                          forceEnd.mutate(g.id);
                      }}
                      disabled={forceEnd.isPending}
                      className="dbz-button !py-1 !px-2 !text-xs flex items-center gap-1 bg-dbz-orange/80 hover:bg-dbz-orange disabled:opacity-40"
                      title="Clôturer ce tirage et désigner le gagnant maintenant"
                    >
                      <FastForward className="h-3 w-3" />
                      Clôturer
                    </button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
