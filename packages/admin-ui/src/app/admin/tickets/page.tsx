"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, Ticket as TicketIcon, RefreshCw, ExternalLink } from "lucide-react";
import { useState } from "react";
import { api } from "@aphrody/admin-ui/client";
import { TicketAccessPanel } from "./TicketAccessPanel";

interface TicketRow {
  id: number;
  channelId: string;
  ownerId: string;
  kind: "report" | "achat" | "shop" | "abus";
  context: string | null;
  closed: boolean;
  closedAt: string | null;
  closedBy: string | null;
  createdAt: string;
}

const KIND_LABEL: Record<TicketRow["kind"], { label: string; color: string; description: string }> = {
  report: {
    label: "Signalement",
    color: "text-red-400 border-red-500/40",
    description: "Signalement d'un problème ou d'un utilisateur",
  },
  achat: {
    label: "Achat",
    color: "text-blue-400 border-blue-500/40",
    description: "Demande liée à un achat dans la boutique",
  },
  shop: {
    label: "Boutique",
    color: "text-dbz-yellow border-dbz-yellow/40",
    description: "Question ou problème sur la boutique",
  },
  abus: {
    label: "Abus de permission",
    color: "text-orange-400 border-orange-500/40",
    description: "Signalement d'un abus de modération",
  },
};

export default function TicketsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<"all" | "open" | "closed">("open");

  const tickets = useQuery({
    queryKey: ["tickets", filter],
    queryFn: () =>
      api.get<{ rows: TicketRow[]; total: number }>(
        filter === "all" ? "/tickets" : `/tickets?closed=${filter === "closed"}`,
      ),
  });

  const close = useMutation({
    mutationFn: (channelId: string) => api.post(`/tickets/${channelId}/close`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["tickets"] }),
  });

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-4xl font-saiyan text-dbz-orange mb-2">TICKETS</h1>
        <p className="text-sm text-white/60 mb-1">
          Gérez les tickets d&apos;assistance ouverts par les membres du serveur.
        </p>
        <p className="text-xs text-white/50 uppercase tracking-widest">
          Un ticket = un salon Discord dédié entre le membre et les modérateurs
        </p>
      </header>

      <TicketAccessPanel />

      <div className="dbz-panel p-4">
        <div className="flex items-center gap-2 flex-wrap">
          <TicketIcon className="h-5 w-5 text-dbz-blue-light" />
          <div className="flex gap-2">
            {(["open", "closed", "all"] as const).map(f => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={`dbz-button !text-xs !py-1 !px-3 ${filter === f ? "" : "opacity-50 hover:opacity-80"}`}
              >
                {f === "open" ? "Ouverts" : f === "closed" ? "Fermés" : "Tous"}
              </button>
            ))}
          </div>
          <span className="ml-auto text-xs text-white/50">
            {tickets.data?.total ?? 0} ticket
            {(tickets.data?.total ?? 0) !== 1 ? "s" : ""}
          </span>
          <button
            type="button"
            onClick={() => qc.invalidateQueries({ queryKey: ["tickets"] })}
            className="dbz-button-ghost !py-1 !px-2"
            title="Actualiser"
          >
            <RefreshCw className="h-3 w-3" />
          </button>
        </div>
      </div>

      {tickets.isLoading && (
        <div className="dbz-panel p-8 text-center">
          <p className="font-saiyan text-dbz-orange text-xl mb-2">CHARGEMENT…</p>
          <p className="text-sm text-white/50">Récupération des tickets.</p>
        </div>
      )}

      {tickets.isError && (
        <div className="dbz-panel p-6 text-center border-l-4 border-red-500">
          <p className="font-saiyan text-red-400 mb-2">Erreur de chargement</p>
          <p className="text-sm text-white/50">
            Impossible de récupérer les tickets. Vérifiez que le bot est en ligne.
          </p>
        </div>
      )}

      {!tickets.isLoading && !tickets.isError && tickets.data?.rows.length === 0 && (
        <div className="dbz-panel p-8 text-center">
          <p className="font-saiyan text-dbz-yellow text-xl mb-2">AUCUN TICKET</p>
          <p className="text-sm text-white/50">
            {filter === "open"
              ? "Aucun ticket ouvert. Tout va bien !"
              : filter === "closed"
                ? "Aucun ticket fermé pour le moment."
                : "Aucun ticket enregistré."}
          </p>
        </div>
      )}

      {close.isError && (
        <div className="dbz-panel p-3 border-l-4 border-red-500">
          <p className="text-sm text-red-400">
            Erreur lors de la fermeture : {close.error instanceof Error ? close.error.message : "erreur inconnue"}
          </p>
        </div>
      )}

      <div className="space-y-3">
        {tickets.data?.rows.map(t => {
          const meta = KIND_LABEL[t.kind] ?? {
            label: t.kind,
            color: "text-white/50 border-white/10",
            description: "",
          };
          const createdDate = new Date(t.createdAt);
          const closedDate = t.closedAt ? new Date(t.closedAt) : null;
          // Lien Discord vers le salon du ticket (pas un DM)
          const discordLink = `https://discord.com/channels/@me/${t.channelId}`;

          return (
            <div key={t.id} className="dbz-panel p-5">
              <div className="flex items-start gap-4">
                {/* Badge type */}
                <div
                  className={`shrink-0 px-2 py-1 text-xs font-bold border rounded ${meta.color} bg-current/5 mt-0.5`}
                >
                  {meta.label.charAt(0)}
                </div>

                <div className="flex-1 min-w-0">
                  {/* En-tête */}
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`font-semibold text-sm ${meta.color.split(" ")[0]}`}>{meta.label}</span>
                    <span className="text-xs text-white/50 font-mono">#{t.id}</span>
                    {t.closed ? (
                      <span className="px-2 py-0.5 text-xs font-bold bg-white/5 text-white/50 border border-white/10 rounded uppercase">
                        Fermé
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 text-xs font-bold bg-green-500/20 text-green-300 border border-green-500/40 rounded uppercase">
                        Ouvert
                      </span>
                    )}
                  </div>

                  {meta.description && <p className="text-xs text-white/50 mb-2">{meta.description}</p>}

                  {/* Dates */}
                  <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-white/50 mb-2">
                    <span>
                      Ouvert le{" "}
                      {createdDate.toLocaleDateString("fr-FR", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })}{" "}
                      à{" "}
                      {createdDate.toLocaleTimeString("fr-FR", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    <span>
                      Membre :{" "}
                      <span className="font-mono text-white/60" title={`Identifiant Discord : ${t.ownerId}`}>
                        {t.ownerId}
                      </span>
                    </span>
                    {t.closed && closedDate && (
                      <span>
                        Fermé le{" "}
                        {closedDate.toLocaleDateString("fr-FR", {
                          day: "numeric",
                          month: "long",
                          year: "numeric",
                        })}
                        {t.closedBy && (
                          <>
                            {" "}
                            par{" "}
                            <span className="font-mono text-white/60" title={`Identifiant Discord : ${t.closedBy}`}>
                              {t.closedBy}
                            </span>
                          </>
                        )}
                      </span>
                    )}
                  </div>

                  {/* Contexte */}
                  {t.context && (
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-sm text-white/60 bg-white/5 rounded p-2">
                      {t.context}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex flex-col items-end gap-2 shrink-0">
                  <a
                    href={discordLink}
                    target="_blank"
                    rel="noreferrer"
                    className="dbz-button-ghost !py-1 !px-2 flex items-center gap-1 !text-xs"
                    title="Ouvrir le salon du ticket dans Discord"
                  >
                    <ExternalLink className="h-3 w-3" />
                    Discord
                  </a>
                  {!t.closed && (
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          confirm(
                            `Fermer le ticket #${t.id} ?\n\nLe salon Discord sera archivé et le membre ne pourra plus écrire dedans.`,
                          )
                        )
                          close.mutate(t.channelId);
                      }}
                      disabled={close.isPending}
                      className="dbz-button !py-1 !px-2 !text-xs flex items-center gap-1 bg-red-500/80 hover:bg-red-500 disabled:opacity-40"
                      title="Fermer ce ticket"
                    >
                      <Lock className="h-3 w-3" />
                      Fermer
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
