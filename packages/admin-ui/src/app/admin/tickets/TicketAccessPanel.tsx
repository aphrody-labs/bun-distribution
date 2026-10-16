"use client";

/**
 * Configuration du système de tickets, éditable sans toucher au code.
 *
 * Les rôles staff par type de ticket vivent dans les réglages du bot sous la clé
 * `tickets.access.<kind>.<roleId>` = "1" (présence = accès accordé) : ajouter un
 * rôle est donc une écriture clé/valeur, jamais une migration. Le bot applique
 * ces droits **à la création** d'un ticket — d'où le bouton « Appliquer aux
 * tickets ouverts », qui rejoue la config sur les salons déjà existants.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Bouclier,
  Chargement,
  Croix,
  Plus,
  Rafraichir,
} from "@/components/icones";
import { api } from "@aphrody/admin-ui/client";
import {
  RoleBadge,
  RoleSelect,
} from "@aphrody/admin-ui/components/admin/RoleSelect";

const TICKET_ACCESS_PREFIX = "tickets.access.";

const TICKET_KINDS = ["report", "achat", "shop", "abus"] as const;
export type TicketKind = (typeof TICKET_KINDS)[number];

const KIND_META: Record<TicketKind, { label: string; hint: string }> = {
  report: { label: "Signalement", hint: "Problème ou utilisateur signalé" },
  achat: { label: "Achat", hint: "Demande liée à un achat" },
  shop: { label: "Boutique", hint: "Question sur la boutique" },
  abus: { label: "Abus de permission", hint: "Abus de modération signalé" },
};

interface SettingRow {
  key: string;
  value: string;
}

export function TicketAccessPanel() {
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);

  // Les réglages sont des lignes de `guild_settings` : on lit la table via le
  // CRUD générique plutôt que d'inventer un endpoint dédié.
  const settings = useQuery({
    queryKey: ["settings", "current"],
    queryFn: () =>
      api.get<{ rows: SettingRow[] }>("/database/guild_settings?limit=500"),
  });

  const rolesByKind = useMemo(() => {
    const out: Record<string, string[]> = {};
    for (const k of TICKET_KINDS) out[k] = [];
    for (const row of settings.data?.rows ?? []) {
      if (!row.key?.startsWith(TICKET_ACCESS_PREFIX)) continue;
      const rest = row.key.slice(TICKET_ACCESS_PREFIX.length); // "<kind>.<roleId>"
      const dot = rest.indexOf(".");
      if (dot === -1) continue;
      const kind = rest.slice(0, dot);
      const roleId = rest.slice(dot + 1);
      if (kind in out) out[kind].push(roleId);
    }
    return out;
  }, [settings.data]);

  const invalidate = () =>
    qc.invalidateQueries({ queryKey: ["settings", "current"] });

  const grant = useMutation({
    mutationFn: ({ kind, roleId }: { kind: TicketKind; roleId: string }) =>
      api.post(`/settings/${TICKET_ACCESS_PREFIX}${kind}.${roleId}`, {
        value: "1",
      }),
    onSuccess: () => {
      setMsg("Rôle ajouté — actif sur les prochains tickets de ce type.");
      invalidate();
    },
    onError: (e: unknown) => setMsg(`Échec : ${String(e)}`),
  });

  const revoke = useMutation({
    mutationFn: ({ kind, roleId }: { kind: TicketKind; roleId: string }) =>
      api.delete(`/settings/${TICKET_ACCESS_PREFIX}${kind}.${roleId}`),
    onSuccess: () => {
      setMsg("Rôle retiré.");
      invalidate();
    },
    onError: (e: unknown) => setMsg(`Échec : ${String(e)}`),
  });

  const syncOpen = useMutation({
    mutationFn: () =>
      api.post<{ ok: boolean; updated: number; skipped: number }>(
        "/tickets/sync-access",
      ),
    onSuccess: (r) =>
      setMsg(
        `Tickets ouverts mis à jour : ${r.updated} · inchangés : ${r.skipped}.`,
      ),
    onError: (e: unknown) => setMsg(`Échec : ${String(e)}`),
  });

  return (
    <section className="dbz-panel space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-saiyan text-lg text-dbz-orange">
            <Bouclier className="h-4 w-4" />
            Accès staff par type de ticket
          </h2>
          <p className="text-[11px] text-white/50">
            Ces rôles voient et écrivent dans les tickets du type concerné dès
            leur ouverture. Sans rôle configuré, seul l&apos;auteur du ticket et
            le staff y ont accès.
          </p>
        </div>
        <button
          type="button"
          onClick={() => syncOpen.mutate()}
          disabled={syncOpen.isPending}
          className="btn btn-ghost gap-1.5 text-xs disabled:opacity-50"
          title="Rejoue la configuration sur les tickets déjà ouverts"
        >
          {syncOpen.isPending ? (
            <Chargement className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Rafraichir className="h-3.5 w-3.5" />
          )}
          Appliquer aux tickets ouverts
        </button>
      </div>

      {settings.isLoading ? (
        <p className="text-sm text-white/50">Chargement…</p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {TICKET_KINDS.map((kind) => {
            const roles = rolesByKind[kind] ?? [];
            return (
              <div
                key={kind}
                className="space-y-2 rounded-lg border border-dbz-border bg-black/30 p-3"
              >
                <div>
                  <p className="font-saiyan text-sm text-white">
                    {KIND_META[kind].label}
                  </p>
                  <p className="text-[10px] text-white/50">
                    {KIND_META[kind].hint}
                  </p>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {roles.map((rid) => (
                    <span
                      key={rid}
                      className="inline-flex items-center gap-1.5 rounded-full border border-dbz-border bg-black/40 px-2 py-0.5 text-xs"
                    >
                      <RoleBadge roleId={rid} />
                      <button
                        type="button"
                        onClick={() => revoke.mutate({ kind, roleId: rid })}
                        className="text-white/50 hover:text-red-400"
                        aria-label="Retirer ce rôle"
                      >
                        <Croix className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  {roles.length === 0 && (
                    <span className="text-[11px] text-white/50">
                      Aucun rôle configuré
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-2">
                  <Plus className="h-3 w-3 shrink-0 text-white/50" />
                  <RoleSelect
                    value=""
                    onChange={(roleId) =>
                      roleId && grant.mutate({ kind, roleId })
                    }
                    placeholder="— Ajouter un rôle —"
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {msg && <p className="text-xs text-white/60">{msg}</p>}
    </section>
  );
}
