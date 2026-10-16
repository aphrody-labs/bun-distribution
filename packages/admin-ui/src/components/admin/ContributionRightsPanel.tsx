"use client";

/**
 * Réglage du droit de contribution — qui peut proposer une correction, et sur
 * quel périmètre (wiki / databooks).
 *
 * Deux blocs identiques, un par périmètre, parce que les deux ne se règlent pas
 * ensemble : le wiki peut rester ouvert à tous les membres pendant que les
 * databooks — dont 1 911 planches sur 11 778 portent une transcription fautive —
 * sont réservés à une équipe de relecture.
 */
import { useEffect, useState } from "react";
import { Chargement, Croix, Enregistrer, Plus } from "@/components/icones";
import {
  RoleSelect,
  RoleBadge,
} from "@aphrody/admin-ui/components/admin/RoleSelect";
import { UserSelect } from "@aphrody/admin-ui/components/admin/UserSelect";
import {
  CONTRIBUTION_SCOPES,
  DEFAULT_CONTRIBUTION_RIGHTS,
  MODE_LABELS,
  SCOPE_LABELS,
  type ContributionMode,
  type ContributionRights,
  type ContributionScope,
  type ScopeRule,
} from "@/lib/contribution-rights-shared";

const MODES: ContributionMode[] = ["members", "restricted", "admin"];

export function ContributionRightsPanel() {
  const [rights, setRights] = useState<ContributionRights>(
    DEFAULT_CONTRIBUTION_RIGHTS,
  );
  const [chargement, setChargement] = useState(true);
  const [envoi, setEnvoi] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    fetch("/api/admin/contribution-rights")
      .then((r) => r.json())
      .then((d) => {
        if (vivant && d?.ok && d.rights)
          setRights(d.rights as ContributionRights);
      })
      .catch(() => {})
      .finally(() => vivant && setChargement(false));
    return () => {
      vivant = false;
    };
  }, []);

  const majScope = (scope: ContributionScope, patch: Partial<ScopeRule>) =>
    setRights((r) => ({ ...r, [scope]: { ...r[scope], ...patch } }));

  const enregistrer = async () => {
    setEnvoi(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/contribution-rights", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ rights }),
      });
      const d = await res.json();
      if (!res.ok || !d?.ok) throw new Error("échec");
      setRights(d.rights as ContributionRights);
      setMessage("Droits enregistrés.");
    } catch {
      setMessage("Échec de l'enregistrement.");
    } finally {
      setEnvoi(false);
    }
  };

  if (chargement) {
    return (
      <div className="flex items-center gap-2 text-sm text-white/50">
        <Chargement className="h-4 w-4 animate-spin" /> Chargement des droits…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 lg:grid-cols-2">
        {CONTRIBUTION_SCOPES.map((scope) => (
          <BlocScope
            key={scope}
            scope={scope}
            rule={rights[scope]}
            onChange={(patch) => majScope(scope, patch)}
          />
        ))}
      </div>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={enregistrer}
          disabled={envoi}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-dbz-orange px-4 font-display text-sm font-semibold text-black transition-colors hover:bg-white disabled:opacity-60"
        >
          {envoi ? (
            <Chargement className="h-4 w-4 animate-spin" />
          ) : (
            <Enregistrer className="h-4 w-4" />
          )}
          Enregistrer
        </button>
        {message && <span className="text-sm text-white/60">{message}</span>}
      </div>
    </div>
  );
}

function BlocScope({
  scope,
  rule,
  onChange,
}: {
  scope: ContributionScope;
  rule: ScopeRule;
  onChange: (patch: Partial<ScopeRule>) => void;
}) {
  const [roleEnCours, setRoleEnCours] = useState("");
  const [membreEnCours, setMembreEnCours] = useState("");
  const restreint = rule.mode === "restricted";

  const ajouterRole = (id: string) => {
    if (!id || rule.roleIds.includes(id)) return;
    onChange({ roleIds: [...rule.roleIds, id] });
    setRoleEnCours("");
  };
  const ajouterMembre = (id: string) => {
    if (!id || rule.discordIds.includes(id)) return;
    onChange({ discordIds: [...rule.discordIds, id] });
    setMembreEnCours("");
  };

  return (
    <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-5">
      <h3 className="font-display text-[15px] font-semibold text-white">
        {SCOPE_LABELS[scope].label}
      </h3>
      <p className="mt-1 text-[12px] leading-relaxed text-white/45">
        {SCOPE_LABELS[scope].hint}
      </p>

      <div className="mt-4 space-y-2">
        {MODES.map((m) => (
          <label
            key={m}
            className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-white/[0.04]"
          >
            <input
              type="radio"
              name={`mode-${scope}`}
              checked={rule.mode === m}
              onChange={() => onChange({ mode: m })}
              className="mt-1 accent-dbz-orange"
            />
            <span>
              <span className="block text-[14px] font-medium text-white/90">
                {MODE_LABELS[m].label}
              </span>
              <span className="block text-[12px] text-white/45">
                {MODE_LABELS[m].hint}
              </span>
            </span>
          </label>
        ))}
      </div>

      {restreint && (
        <div className="mt-5 space-y-5 border-t border-white/[0.08] pt-5">
          <div>
            <p className="mb-2 font-scouter text-[11px] uppercase tracking-[0.14em] text-white/45">
              Rôles autorisés
            </p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {rule.roleIds.length === 0 && (
                <span className="text-[12px] text-white/35">Aucun rôle.</span>
              )}
              {rule.roleIds.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] py-0.5 pl-1 pr-0.5"
                >
                  <RoleBadge roleId={id} />
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        roleIds: rule.roleIds.filter((r) => r !== id),
                      })
                    }
                    aria-label="Retirer ce rôle"
                    className="grid h-5 w-5 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
                  >
                    <Croix className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <RoleSelect
                value={roleEnCours}
                onChange={setRoleEnCours}
                className="flex-1"
              />
              <button
                type="button"
                onClick={() => ajouterRole(roleEnCours)}
                disabled={!roleEnCours}
                aria-label="Ajouter le rôle"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/[0.12] text-white/70 transition-colors hover:border-dbz-orange/60 hover:text-white disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div>
            <p className="mb-2 font-scouter text-[11px] uppercase tracking-[0.14em] text-white/45">
              Membres autorisés nommément
            </p>
            <div className="mb-2 flex flex-wrap gap-1.5">
              {rule.discordIds.length === 0 && (
                <span className="text-[12px] text-white/35">Aucun membre.</span>
              )}
              {rule.discordIds.map((id) => (
                <span
                  key={id}
                  className="inline-flex items-center gap-1 rounded-full bg-white/[0.06] px-2 py-0.5 font-mono text-[11px] text-white/70"
                >
                  {id}
                  <button
                    type="button"
                    onClick={() =>
                      onChange({
                        discordIds: rule.discordIds.filter((d) => d !== id),
                      })
                    }
                    aria-label="Retirer ce membre"
                    className="grid h-5 w-5 place-items-center rounded-full text-white/50 hover:bg-white/10 hover:text-white"
                  >
                    <Croix className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <UserSelect
                value={membreEnCours}
                onChange={setMembreEnCours}
                className="flex-1"
              />
              <button
                type="button"
                onClick={() => ajouterMembre(membreEnCours)}
                disabled={!membreEnCours}
                aria-label="Ajouter le membre"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/[0.12] text-white/70 transition-colors hover:border-dbz-orange/60 hover:text-white disabled:opacity-40"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>

          {rule.roleIds.length === 0 && rule.discordIds.length === 0 && (
            <p className="rounded-lg border border-dbz-red/30 bg-dbz-red/[0.06] px-3 py-2 text-[12px] text-white/70">
              Aucun rôle ni membre listé : ce périmètre est fermé à tout le
              monde sauf au staff.
            </p>
          )}
        </div>
      )}
    </section>
  );
}
