"use client";

/**
 * Gestion des relations N-N d'une entité wiki depuis le studio (édition) :
 * techniques d'un personnage, personnages d'un jeu, etc. Lier/délier par NOM
 * (jamais d'id brut), via la table de jointure (`/api/wiki-admin/<join>`).
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Chargement, Croix, Lien } from "@shenron/ui/icones";
import { useState } from "react";
import { apiAt } from "@aphrody/admin-ui/client";
import { entityRelations, type RelationSpec } from "@/lib/wiki-fields";
import { crudBase } from "@/lib/wiki-tables";

export function RelationsPanel({ table, entityId }: { table: string; entityId: string }) {
  const specs = entityRelations(table);
  if (specs.length === 0) return null;

  return (
    <div className="dbz-panel space-y-5 p-5">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light">
        <Lien className="h-3.5 w-3.5" /> Relations
      </div>
      {specs.map(spec => (
        <RelationEditor key={spec.joinTable + spec.selfCol} spec={spec} entityId={entityId} />
      ))}
    </div>
  );
}

function RelationEditor({ spec, entityId }: { spec: RelationSpec; entityId: string }) {
  const qc = useQueryClient();
  const joinClient = apiAt(crudBase(spec.joinTable));
  const [adding, setAdding] = useState("");

  const related = useQuery({
    queryKey: ["relations", spec.joinTable, spec.selfCol, entityId],
    queryFn: () =>
      joinClient.get<{ ids: string[] }>(
        `/${spec.joinTable}?as=relations&col=${spec.selfCol}&id=${encodeURIComponent(entityId)}&target=${spec.targetCol}`,
      ),
  });

  const options = useQuery({
    queryKey: ["fk-options", spec.targetTable],
    queryFn: () =>
      apiAt(crudBase(spec.targetTable)).get<{
        options: { value: string; label: string }[];
      }>(`/${spec.targetTable}?as=options`),
    staleTime: 5 * 60_000,
  });

  const invalidate = () =>
    qc.invalidateQueries({
      queryKey: ["relations", spec.joinTable, spec.selfCol, entityId],
    });

  const add = useMutation({
    mutationFn: (targetId: string) =>
      joinClient.post(`/${spec.joinTable}`, {
        [spec.selfCol]: entityId,
        [spec.targetCol]: targetId,
      }),
    onSuccess: invalidate,
  });

  const remove = useMutation({
    mutationFn: (targetId: string) => {
      // id composite DANS L'ORDRE pk de la jointure.
      const id = spec.pkOrder.map(k => (k === spec.selfCol ? entityId : targetId)).join(",");
      return joinClient.delete(`/${spec.joinTable}/${encodeURIComponent(id)}`);
    },
    onSuccess: invalidate,
  });

  const ids = related.data?.ids ?? [];
  const opts = options.data?.options ?? [];
  const labelFor = (id: string) => opts.find(o => o.value === id)?.label ?? `#${id}`;
  const idSet = new Set(ids);
  const available = opts.filter(o => !idSet.has(o.value)).toSorted((a, b) => a.label.localeCompare(b.label));
  const busy = add.isPending || remove.isPending;

  return (
    <div>
      <div className="mb-2 flex items-center gap-2">
        <h4 className="font-saiyan text-sm uppercase tracking-wider text-dbz-orange">{spec.label}</h4>
        <span className="text-xs text-white/50">({ids.length})</span>
        {(related.isLoading || busy) && <Chargement className="h-3 w-3 animate-spin text-white/50" />}
      </div>

      {related.isError ? (
        <p className="text-xs text-red-400">Chargement des relations échoué.</p>
      ) : (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {ids.length === 0 && <span className="text-xs italic text-white/50">Aucune relation.</span>}
          {ids.map(id => (
            <span
              key={id}
              className="inline-flex items-center gap-1 rounded border border-dbz-border bg-dbz-card/60 px-2 py-1 text-xs text-white/85"
            >
              {labelFor(id)}
              <button
                type="button"
                title="Délier"
                disabled={busy}
                onClick={() => remove.mutate(id)}
                className="text-red-400 hover:text-red-300 disabled:opacity-50"
              >
                <Croix className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <select
        className="input text-sm"
        value={adding}
        // Gate sur `related` aussi : sinon, pendant le chargement, `idSet` est
        // vide → la liste proposerait des paires déjà liées (doublon).
        disabled={busy || options.isLoading || related.isLoading || related.isError}
        onChange={e => {
          const v = e.target.value;
          setAdding("");
          if (v) add.mutate(v);
        }}
      >
        <option value="">{options.isLoading ? "Chargement…" : `+ Lier ${spec.label.toLowerCase()}…`}</option>
        {available.map(o => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {options.isError && (
        <p className="mt-1 text-xs text-red-400">
          Liste des « {spec.label.toLowerCase()} » indisponible (les noms ne s&apos;affichent pas).
        </p>
      )}
      {(add.isError || remove.isError) && <p className="mt-1 text-xs text-red-400">Action échouée. Réessaie.</p>}
    </div>
  );
}
