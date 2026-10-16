"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alerte,
  Chargement,
  CocheCercle,
  Corbeille,
  Couronne,
  Croix,
  Enregistrer,
  FlecheBas,
  FlecheHaut,
  Plus,
} from "@/components/icones";
import { useEffect, useState } from "react";
import { api } from "@aphrody/admin-ui/client";
import {
  RoleSelect,
  RoleBadge,
} from "@aphrody/admin-ui/components/admin/RoleSelect";

/**
 * Éditeur visuel de la hiérarchie staff (paramètre `moderation.hierarchy`).
 *
 * Les niveaux vont du plus haut (index 0 — administrateur) au plus bas.
 * Un staff ne peut sanctionner qu'un membre dont le niveau est strictement
 * plus grand. Les owners et bot-dev passent toujours.
 */
export default function HierarchyPage() {
  const qc = useQueryClient();

  const hierarchy = useQuery({
    queryKey: ["moderation", "hierarchy"],
    queryFn: () =>
      api.get<{ levels: string[][]; raw: string }>("/moderation/hierarchy"),
  });

  const save = useMutation({
    mutationFn: (levels: string[][]) =>
      api.put<{ ok: boolean }>("/moderation/hierarchy", { levels }),
    onSuccess: () =>
      qc.invalidateQueries({ queryKey: ["moderation", "hierarchy"] }),
  });

  const [draft, setDraft] = useState<string[][]>([]);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (hierarchy.data) {
      setDraft(hierarchy.data.levels ?? []);
      setDirty(false);
    }
  }, [hierarchy.data]);

  const addLevel = () => {
    setDraft((d) => [...d, []]);
    setDirty(true);
  };
  const removeLevel = (idx: number) => {
    setDraft((d) => d.filter((_, i) => i !== idx));
    setDirty(true);
  };
  const moveLevel = (idx: number, delta: -1 | 1) => {
    const target = idx + delta;
    if (target < 0 || target >= draft.length) return;
    const copy = [...draft];
    [copy[idx], copy[target]] = [copy[target]!, copy[idx]!];
    setDraft(copy);
    setDirty(true);
  };
  const addRole = (idx: number, roleId: string) => {
    if (!roleId) return;
    if (draft.some((lvl) => lvl.includes(roleId))) return;
    setDraft((d) => d.map((lvl, i) => (i === idx ? [...lvl, roleId] : lvl)));
    setDirty(true);
  };
  const removeRole = (idx: number, roleId: string) => {
    setDraft((d) =>
      d.map((lvl, i) => (i === idx ? lvl.filter((r) => r !== roleId) : lvl)),
    );
    setDirty(true);
  };

  const reset = () => {
    setDraft(hierarchy.data?.levels ?? []);
    setDirty(false);
  };

  return (
    <div className="space-y-4">
      {/* En-tête */}
      <div className="card">
        <div className="flex items-center gap-2">
          <Couronne className="h-5 w-5 text-brand-400" />
          <h2 className="text-lg font-semibold">Hiérarchie du staff</h2>
        </div>
        <p className="mt-1 text-sm text-zinc-400">
          Définit qui peut sanctionner qui. Le niveau <strong>0</strong> est le
          plus haut (administrateurs), le niveau le plus bas est celui des
          modérateurs débutants. Un membre du staff ne peut sanctionner que des
          membres d&apos;un niveau <em>plus bas</em> que le sien. Les
          propriétaires du serveur et les développeurs du bot passent toujours.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-ghost" onClick={addLevel}>
            <Plus className="h-3 w-3" /> Ajouter un niveau hiérarchique
          </button>
          <button
            type="button"
            className="btn btn-primary"
            disabled={!dirty || save.isPending}
            onClick={() => save.mutate(draft)}
          >
            <Enregistrer className="h-3 w-3" />
            {save.isPending ? "Enregistrement…" : "Enregistrer la hiérarchie"}
          </button>
          {dirty && (
            <button
              type="button"
              className="btn btn-ghost text-zinc-400"
              onClick={reset}
            >
              <Croix className="h-3 w-3" /> Annuler les modifications
            </button>
          )}
          {save.isSuccess && !dirty && (
            <span className="flex items-center gap-1 text-xs text-emerald-400">
              <CocheCercle className="h-3 w-3" /> Hiérarchie enregistrée
            </span>
          )}
          {save.isError && (
            <span className="flex items-center gap-1 text-xs text-red-400">
              <Alerte className="inline h-3 w-3" />{" "}
              {(save.error as Error)?.message}
            </span>
          )}
        </div>
      </div>

      {/* Chargement */}
      {hierarchy.isLoading && (
        <div className="flex items-center gap-2 text-zinc-500 text-sm">
          <Chargement className="h-4 w-4 animate-spin" />
          Chargement de la hiérarchie…
        </div>
      )}

      {/* Erreur */}
      {hierarchy.isError && (
        <div className="flex items-center gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-400">
          <Alerte className="h-4 w-4 shrink-0" />
          Impossible de charger la hiérarchie. Réessayez.
        </div>
      )}

      {/* Liste des niveaux */}
      {!hierarchy.isLoading && draft.length === 0 ? (
        <div className="card text-center text-zinc-500">
          <p>Aucun niveau défini.</p>
          <p className="mt-1 text-xs">
            Sans hiérarchie configurée, les sanctions ne sont limitées que par
            la garde <code>ModOnly</code>.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {draft.map((lvl, idx) => (
            <LevelCard
              key={idx}
              index={idx}
              roles={lvl}
              total={draft.length}
              onAddRole={(r) => addRole(idx, r)}
              onRemoveRole={(r) => removeRole(idx, r)}
              onMove={(d) => moveLevel(idx, d)}
              onRemove={() => removeLevel(idx)}
            />
          ))}
        </div>
      )}

      {/* JSON brut */}
      {hierarchy.data?.raw && (
        <details className="card">
          <summary className="cursor-pointer text-xs text-zinc-500">
            Voir la configuration brute stockée dans la base de données
          </summary>
          <pre className="mt-2 overflow-auto rounded bg-zinc-950 p-3 text-xs">
            {JSON.stringify(draft, null, 2)}
          </pre>
        </details>
      )}
    </div>
  );
}

function LevelCard({
  index,
  roles,
  total,
  onAddRole,
  onRemoveRole,
  onMove,
  onRemove,
}: {
  index: number;
  roles: string[];
  total: number;
  onAddRole: (r: string) => void;
  onRemoveRole: (r: string) => void;
  onMove: (delta: -1 | 1) => void;
  onRemove: () => void;
}) {
  const [pick, setPick] = useState("");
  const levelLabel =
    index === 0
      ? "Niveau 0 — Administrateurs (le plus haut)"
      : index === total - 1
        ? `Niveau ${index} — Modérateurs débutants (le plus bas)`
        : `Niveau ${index}`;

  return (
    <div className="card">
      <div className="flex items-center gap-2">
        <span className="rounded bg-brand-500/20 px-2 py-1 text-sm font-semibold text-brand-300">
          {levelLabel}
        </span>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            className="btn btn-ghost px-2"
            disabled={index === 0}
            onClick={() => onMove(-1)}
            title="Monter ce niveau"
          >
            <FlecheHaut className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="btn btn-ghost px-2"
            disabled={index === total - 1}
            onClick={() => onMove(1)}
            title="Descendre ce niveau"
          >
            <FlecheBas className="h-3 w-3" />
          </button>
          <button
            type="button"
            className="btn btn-ghost px-2 text-red-400"
            onClick={onRemove}
            title="Supprimer ce niveau"
          >
            <Corbeille className="h-3 w-3" />
          </button>
        </div>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        Les rôles Discord assignés à ce niveau de staff :
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {roles.length === 0 && (
          <span className="text-xs italic text-zinc-500">
            Aucun rôle — ajoutez-en un ci-dessous.
          </span>
        )}
        {roles.map((r) => (
          <span
            key={r}
            className="inline-flex items-center gap-1 rounded border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs"
          >
            <RoleBadge roleId={r} />
            <button
              type="button"
              onClick={() => onRemoveRole(r)}
              className="ml-1 text-red-400 hover:text-red-300"
              title="Retirer ce rôle du niveau"
            >
              <Croix className="h-3 w-3" />
            </button>
          </span>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <RoleSelect value={pick} onChange={setPick} className="flex-1" />
        <button
          type="button"
          className="btn btn-primary"
          disabled={!pick}
          onClick={() => {
            onAddRole(pick);
            setPick("");
          }}
        >
          <Plus className="h-3 w-3" /> Ajouter le rôle
        </button>
      </div>
    </div>
  );
}
