"use client";

/**
 * Panneau studio : stats custom d'un personnage (jsonb `stats`).
 * Affichées en cartes scouter à côté de Ki / Ki max sur la fiche publique.
 * Ajout / édition / suppression / réordonnancement ; save dédiée (jsonb non
 * supporté par SmartField / buildSubmitBody).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Chargement, ChevronBas, ChevronHaut, Corbeille, Enregistrer, Plus } from "@shenron/ui/icones";
import { useEffect, useState } from "react";
import { apiAt } from "@aphrody/admin-ui/client";
import { crudBase } from "@/lib/wiki-tables";

/** Miroir client de `CharacterStat` (bot-schema) — pas d'import Drizzle. */
interface CharacterStat {
  label: string;
  value: string;
  accent?: string;
}

const ACCENTS: { value: string; label: string }[] = [
  { value: "orange", label: "Orange" },
  { value: "red", label: "Rouge" },
  { value: "blue", label: "Bleu" },
  { value: "cyan", label: "Cyan" },
  { value: "gold", label: "Or" },
  { value: "purple", label: "Violet" },
  { value: "green", label: "Vert" },
];

function normalizeStats(raw: unknown): CharacterStat[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
    .map(s => ({
      label: String(s.label ?? "").trim(),
      value: String(s.value ?? "").trim(),
      accent: typeof s.accent === "string" && s.accent ? s.accent : undefined,
    }))
    .filter(s => s.label || s.value);
}

export function CharacterStatsPanel({ characterId }: { characterId: string }) {
  const client = apiAt(crudBase("db_characters"));
  const qc = useQueryClient();
  const [stats, setStats] = useState<CharacterStat[]>([]);
  const [toast, setToast] = useState<string | null>(null);

  const row = useQuery({
    queryKey: ["wiki-studio", "db_characters", characterId, "stats"],
    queryFn: () => client.get<Record<string, unknown>>(`/db_characters/${encodeURIComponent(characterId)}`),
    staleTime: 30_000,
  });

  useEffect(() => {
    if (row.data) setStats(normalizeStats(row.data.stats));
  }, [row.data]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(t);
  }, [toast]);

  const save = useMutation({
    mutationFn: async () => {
      const cleaned = stats
        .map(s => ({
          label: s.label.trim(),
          value: s.value.trim(),
          ...(s.accent ? { accent: s.accent } : {}),
        }))
        .filter(s => s.label && s.value);
      return client.put(`/db_characters/${encodeURIComponent(characterId)}`, {
        stats: cleaned,
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: ["wiki-studio", "db_characters", characterId],
      });
      setToast("Stats enregistrées.");
    },
    onError: (e: Error) => setToast(`Erreur : ${e.message}`),
  });

  const update = (i: number, patch: Partial<CharacterStat>) =>
    setStats(arr => arr.map((s, j) => (j === i ? { ...s, ...patch } : s)));

  const move = (i: number, dir: -1 | 1) =>
    setStats(arr => {
      const j = i + dir;
      if (j < 0 || j >= arr.length) return arr;
      const next = arr.slice();
      const current = next[i];
      const target = next[j];
      if (current === undefined || target === undefined) return arr;
      next[i] = target;
      next[j] = current;
      return next;
    });

  if (row.isLoading) {
    return (
      <div className="dbz-panel flex items-center gap-2 p-5 text-sm text-white/50">
        <Chargement className="h-4 w-4 animate-spin" /> Chargement des stats…
      </div>
    );
  }

  return (
    <div className="dbz-panel space-y-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light">Stats (cartes scouter)</p>
          <p className="mt-0.5 text-[11px] text-white/50">
            En plus du Ki / Ki max — ex. Vitesse, Rang, Puissance d&apos;attaque…
          </p>
        </div>
        <button
          type="button"
          onClick={() => setStats(s => [...s, { label: "", value: "", accent: "orange" }])}
          className="btn btn-ghost px-2 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          Ajouter
        </button>
      </div>

      {toast && <p className="text-xs text-dbz-orange">{toast}</p>}

      {stats.length === 0 ? (
        <p className="py-4 text-center text-xs italic text-white/50">
          Aucune stat custom. Ki / Ki max restent gérés dans le formulaire principal.
        </p>
      ) : (
        <ul className="space-y-2">
          {stats.map((s, i) => (
            <li
              key={i}
              className="flex flex-col gap-2 rounded-lg border border-dbz-border/50 bg-black/20 p-3 sm:flex-row sm:items-end"
            >
              <div className="grid flex-1 grid-cols-1 gap-2 sm:grid-cols-3">
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-white/50">
                  Libellé
                  <input
                    className="input mt-1 w-full text-sm"
                    value={s.label}
                    placeholder="Vitesse"
                    onChange={e => update(i, { label: e.target.value })}
                  />
                </label>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-white/50">
                  Valeur
                  <input
                    className="input mt-1 w-full font-mono text-sm"
                    value={s.value}
                    placeholder="60 000 000"
                    onChange={e => update(i, { value: e.target.value })}
                  />
                </label>
                <label className="block text-[10px] font-semibold uppercase tracking-wider text-white/50">
                  Accent
                  <select
                    className="input mt-1 w-full text-sm"
                    value={s.accent ?? "orange"}
                    onChange={e => update(i, { accent: e.target.value })}
                  >
                    {ACCENTS.map(a => (
                      <option key={a.value} value={a.value}>
                        {a.label}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex shrink-0 gap-1">
                <button
                  type="button"
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  className="btn btn-ghost px-2"
                  title="Monter"
                >
                  <ChevronHaut className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => move(i, 1)}
                  disabled={i === stats.length - 1}
                  className="btn btn-ghost px-2"
                  title="Descendre"
                >
                  <ChevronBas className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setStats(arr => arr.filter((_, j) => j !== i))}
                  className="btn btn-ghost px-2 text-red-400"
                  title="Supprimer"
                >
                  <Corbeille className="h-3.5 w-3.5" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <button type="button" onClick={() => save.mutate()} disabled={save.isPending} className="btn btn-primary w-full">
        {save.isPending ? <Chargement className="h-4 w-4 animate-spin" /> : <Enregistrer className="h-4 w-4" />}
        {save.isPending ? "Enregistrement…" : "Enregistrer les stats"}
      </button>
    </div>
  );
}
