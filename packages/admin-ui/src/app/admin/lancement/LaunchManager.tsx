"use client";

/**
 * Contrôle d'accès et classement des rubriques (catégories wiki + sections du
 * site). Chaque rubrique porte un mode — public / connectés / rôles Discord /
 * staff — appliqué par `proxy.ts`, et une position qui pilote l'ordre de la nav.
 *
 * Tout est persisté dans le jsonb `WikiLaunch.data` : ajouter une rubrique ou un
 * mode ne demande aucune migration SQL.
 */
import { useMemo, useState } from "react";
import { Cadenas, Chargement, Coche, Croix, FlecheBas, FlecheHaut, Groupe, Plus } from "@shenron/ui/icones";
import {
  ALL_ENTRIES,
  ALWAYS_OPEN_KEYS,
  orderedEntries,
  resolveAccess,
  type AccessMode,
  type AccessRule,
} from "@/lib/wiki-launch";
import { RoleBadge, RoleSelect } from "@aphrody/admin-ui/components/admin/RoleSelect";

const MODES: {
  value: AccessMode;
  label: string;
  hint: string;
  tone: string;
}[] = [
  {
    value: "public",
    label: "Public",
    hint: "Visible par tous, indexable",
    tone: "border-green-500/60 bg-green-500/10 text-green-300",
  },
  {
    value: "members",
    label: "Connectés",
    hint: "Compte Discord lié requis",
    tone: "border-sky-500/60 bg-sky-500/10 text-sky-300",
  },
  {
    value: "roles",
    label: "Rôles",
    hint: "Rôles Discord choisis",
    tone: "border-amber-500/60 bg-amber-500/10 text-amber-300",
  },
  {
    value: "admin",
    label: "Staff",
    hint: "Équipe du site seulement",
    tone: "border-red-500/60 bg-red-500/10 text-red-300",
  },
];

export interface LaunchConfigDto {
  openKeys: string[];
  order: string[];
  access: Record<string, AccessRule>;
}

export function LaunchManager({ initial }: { initial: LaunchConfigDto }) {
  // L'état d'édition part des règles EFFECTIVES (règle stockée sinon dérivée de
  // l'historique openKeys) : l'écran montre ce qui s'applique vraiment, pas un
  // formulaire vide qui laisserait croire que tout est public.
  const [access, setAccess] = useState<Record<string, AccessRule>>(() => {
    const out: Record<string, AccessRule> = {};
    for (const e of ALL_ENTRIES) out[e.key] = resolveAccess(e.key, initial);
    return out;
  });
  const [order, setOrder] = useState<string[]>(() => orderedEntries(initial.order).map(e => e.key));
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const always = useMemo(() => new Set(ALWAYS_OPEN_KEYS), []);
  const byKey = useMemo(() => new Map(ALL_ENTRIES.map(e => [e.key, e])), []);
  const rows = useMemo(() => order.map(k => byKey.get(k)).filter(e => e !== undefined), [order, byKey]);

  function setMode(key: string, mode: AccessMode) {
    if (always.has(key)) return;
    setAccess(prev => ({
      ...prev,
      [key]: { mode, roleIds: prev[key]?.roleIds ?? [] },
    }));
    setMsg(null);
  }

  function addRole(key: string, roleId: string) {
    if (!roleId) return;
    setAccess(prev => {
      const cur = prev[key] ?? { mode: "roles" as AccessMode, roleIds: [] };
      if (cur.roleIds.includes(roleId)) return prev;
      return { ...prev, [key]: { ...cur, roleIds: [...cur.roleIds, roleId] } };
    });
    setMsg(null);
  }

  function removeRole(key: string, roleId: string) {
    setAccess(prev => {
      const cur = prev[key];
      if (!cur) return prev;
      return {
        ...prev,
        [key]: { ...cur, roleIds: cur.roleIds.filter(r => r !== roleId) },
      };
    });
    setMsg(null);
  }

  function move(key: string, delta: number) {
    setOrder(prev => {
      const i = prev.indexOf(key);
      const j = i + delta;
      if (i < 0 || j < 0 || j >= prev.length) return prev;
      const next = [...prev];
      const current = next[i];
      const target = next[j];
      if (current === undefined || target === undefined) return prev;
      next[i] = target;
      next[j] = current;
      return next;
    });
    setMsg(null);
  }

  async function save() {
    setSaving(true);
    setMsg(null);
    try {
      // `openKeys` reste synchronisé sur les rubriques wiki publiques : la nav et
      // le teaser raisonnent encore en ouvert/fermé.
      const openKeys = ALL_ENTRIES.filter(e => e.scope !== "site" && access[e.key]?.mode === "public").map(e => e.key);

      const res = await fetch("/api/wiki-launch", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ openKeys, order, access }),
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setMsg({
          ok: true,
          text: "Enregistré — l'accès s'applique sous ~30 s (cache du proxy).",
        });
      } else {
        setMsg({ ok: false, text: data.error ?? "Échec de l'enregistrement." });
      }
    } catch {
      setMsg({ ok: false, text: "Erreur réseau." });
    } finally {
      setSaving(false);
    }
  }

  const publicCount = ALL_ENTRIES.filter(e => access[e.key]?.mode === "public").length;

  return (
    <div className="space-y-5">
      <div className="dbz-panel flex flex-wrap items-center justify-between gap-3 p-4">
        <div>
          <p className="text-sm text-white/70">
            <strong className="text-dbz-orange">{publicCount}</strong> / {ALL_ENTRIES.length} rubriques publiques
          </p>
          <p className="text-[11px] text-white/50">
            Le staff traverse toutes les restrictions. Les flèches changent l&apos;ordre de la navigation.
          </p>
        </div>
        <button type="button" onClick={save} disabled={saving} className="dbz-button gap-2 disabled:opacity-50">
          {saving ? <Chargement className="h-4 w-4 animate-spin" /> : <Coche className="h-4 w-4" />}
          Enregistrer
        </button>
      </div>

      <div className="space-y-2">
        {rows.map((entry, index) => {
          const key = entry.key;
          const locked = always.has(key);
          const rule = access[key] ?? {
            mode: "public" as AccessMode,
            roleIds: [],
          };
          return (
            <div key={key} className="dbz-panel space-y-3 p-3">
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex shrink-0 flex-col">
                  <button
                    type="button"
                    onClick={() => move(key, -1)}
                    disabled={index === 0}
                    className="rounded p-0.5 text-white/50 hover:text-white disabled:opacity-20"
                    aria-label={`Monter ${entry.label}`}
                  >
                    <FlecheHaut className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => move(key, 1)}
                    disabled={index === rows.length - 1}
                    className="rounded p-0.5 text-white/50 hover:text-white disabled:opacity-20"
                    aria-label={`Descendre ${entry.label}`}
                  >
                    <FlecheBas className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5 font-saiyan text-sm text-white">
                    {entry.label}
                    {locked && <Cadenas className="h-3 w-3 text-white/50" />}
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-[9px] uppercase tracking-wider text-white/50">
                      {entry.scope === "site" ? "site" : "wiki"}
                    </span>
                  </p>
                  <p className="truncate text-[10px] text-white/50">{entry.prefixes.join(" · ")}</p>
                </div>

                <div className="flex flex-wrap gap-1">
                  {MODES.map(m => (
                    <button
                      key={m.value}
                      type="button"
                      onClick={() => setMode(key, m.value)}
                      disabled={locked}
                      title={m.hint}
                      className={`rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                        rule.mode === m.value
                          ? m.tone
                          : "border-dbz-border bg-dbz-card/40 text-white/50 hover:border-dbz-orange/50"
                      } ${locked ? "cursor-not-allowed opacity-60" : ""}`}
                    >
                      {m.label}
                    </button>
                  ))}
                </div>
              </div>

              {rule.mode === "roles" && (
                <div className="space-y-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
                  <p className="flex items-center gap-1.5 text-[11px] text-amber-200/80">
                    <Groupe className="h-3 w-3" />
                    Rôles autorisés — un seul suffit pour accéder
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {rule.roleIds.map(rid => (
                      <span
                        key={rid}
                        className="inline-flex items-center gap-1.5 rounded-full border border-dbz-border bg-black/40 px-2 py-0.5 text-xs"
                      >
                        <RoleBadge roleId={rid} />
                        <button
                          type="button"
                          onClick={() => removeRole(key, rid)}
                          className="text-white/50 hover:text-red-400"
                          aria-label="Retirer ce rôle"
                        >
                          <Croix className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                    {rule.roleIds.length === 0 && (
                      <span className="text-[11px] text-amber-200/60">
                        Aucun rôle : personne ne passera (hors staff).
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Plus className="h-3 w-3 shrink-0 text-white/50" />
                    <RoleSelect
                      value=""
                      onChange={rid => addRole(key, rid)}
                      placeholder="— Ajouter un rôle —"
                      className="max-w-xs"
                    />
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {msg && <p className={`text-sm ${msg.ok ? "text-green-400" : "text-red-400"}`}>{msg.text}</p>}
      <p className="text-xs text-white/50">
        Les rubriques avec <Cadenas className="inline h-3 w-3" /> (Épisodes, Films, Chronologie, Manga) sont en ligne
        depuis la bêta et restent publiques.
      </p>
    </div>
  );
}
