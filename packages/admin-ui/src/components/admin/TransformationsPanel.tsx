"use client";

/**
 * Transformations d'un personnage (relation 1-N via `character_id`) — gérées
 * depuis le studio du perso plutôt que via la table globale + picker de perso.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Chargement, Corbeille, Croix, Etincelle, LienExterne, Plus } from "@shenron/ui/icones";
import Link from "next/link";
import { useState } from "react";
import { ImageField } from "@aphrody/admin-ui/components/admin/ImageField";
import { apiAt } from "@aphrody/admin-ui/client";
import { assetUrl } from "@/lib/assets";
import { uploadSubdir } from "@/lib/wiki-fields";
import { crudBase } from "@/lib/wiki-tables";

interface TransfoRow {
  id: number;
  name: string;
  image: string | null;
  ki: string | null;
  characterId: number | null;
}

export function TransformationsPanel({ characterId }: { characterId: string }) {
  const qc = useQueryClient();
  const client = apiAt(crudBase("db_transformations"));
  const key = ["character-transformations", characterId];

  const list = useQuery({
    queryKey: key,
    queryFn: () =>
      client.get<{ rows: TransfoRow[] }>(
        `/db_transformations?as=byParent&col=characterId&id=${encodeURIComponent(characterId)}`,
      ),
  });

  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [ki, setKi] = useState("");
  const [image, setImage] = useState("");

  const invalidate = () => qc.invalidateQueries({ queryKey: key });

  const create = useMutation({
    mutationFn: () =>
      client.post<{ ok: boolean; row?: TransfoRow }>("/db_transformations", {
        name: name.trim(),
        characterId: Number(characterId),
        ...(ki.trim() ? { ki: ki.trim() } : {}),
        ...(image.trim() ? { image: image.trim() } : {}),
      }),
    onSuccess: () => {
      invalidate();
      setAdding(false);
      setName("");
      setKi("");
      setImage("");
    },
  });

  const remove = useMutation({
    mutationFn: (id: number) => client.delete(`/db_transformations/${id}`),
    onSuccess: invalidate,
  });

  const rows = list.data?.rows ?? [];
  const busy = create.isPending || remove.isPending;

  return (
    <div className="dbz-panel space-y-4 p-5">
      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light">
        <Etincelle className="h-3.5 w-3.5" /> Transformations
        <span className="text-white/50">({rows.length})</span>
        {(list.isFetching || busy) && <Chargement className="h-3 w-3 animate-spin text-white/50" />}
      </div>

      <p className="text-xs text-white/50">
        Formes et évolutions de ce personnage. Ajoutées ici, elles s&apos;affichent sur sa fiche publique et dans
        l&apos;index des transformations — plus besoin de créer une entrée globale puis de choisir le perso à la main.
      </p>

      {list.isError ? (
        <p className="text-xs text-red-400">Chargement des transformations échoué.</p>
      ) : rows.length === 0 && !adding ? (
        <p className="text-xs italic text-white/50">Aucune transformation pour l&apos;instant.</p>
      ) : (
        <div className="space-y-2">
          {rows.map(t => (
            <div key={t.id} className="flex items-center gap-3 rounded border border-dbz-border bg-dbz-card/60 p-2">
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded border border-dbz-border bg-dbz-bg">
                {t.image ? (
                  <img src={assetUrl(t.image)} alt={t.name} className="h-full w-full object-cover object-top" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-white/20">
                    <Etincelle className="h-4 w-4" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-white">{t.name}</p>
                {t.ki && <p className="scouter-text text-[10px] text-dbz-orange">KI {t.ki}</p>}
              </div>
              <Link
                href={`/admin/wiki/studio/db_transformations/${t.id}`}
                className="btn btn-ghost shrink-0 px-2 py-1 text-xs"
                title="Éditer en détail"
              >
                <LienExterne className="h-3.5 w-3.5" />
              </Link>
              <button
                type="button"
                title="Supprimer"
                disabled={busy}
                onClick={() => remove.mutate(t.id)}
                className="shrink-0 text-red-400 hover:text-red-300 disabled:opacity-50"
              >
                <Corbeille className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <div className="space-y-3 border-t border-white/10 pt-3">
          <label>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/50">
              Nom de la forme
            </span>
            <input
              className="input text-sm"
              placeholder="ex. Super Saiyan, Ultra Instinct…"
              value={name}
              onChange={e => setName(e.target.value)}
              autoFocus
            />
          </label>
          <label>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/50">
              Ki (optionnel)
            </span>
            <input
              className="input text-sm"
              placeholder="ex. 3 000 000 000"
              value={ki}
              onChange={e => setKi(e.target.value)}
            />
          </label>
          <div>
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-wider text-white/50">
              Image (optionnel)
            </span>
            <ImageField value={image} onChange={setImage} subdir={uploadSubdir("db_transformations")} column="image" />
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy || !name.trim()}
              onClick={() => create.mutate()}
              className="btn btn-primary flex-1"
            >
              <Plus className="h-4 w-4" />
              {create.isPending ? "Ajout…" : "Ajouter"}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                setAdding(false);
                setName("");
                setKi("");
                setImage("");
              }}
              className="btn btn-ghost"
            >
              <Croix className="h-4 w-4" />
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex w-full items-center justify-center gap-1 rounded border border-dbz-border bg-dbz-card/60 px-2 py-2 text-xs text-white/80 transition-colors hover:border-dbz-orange hover:text-white"
        >
          <Plus className="h-3 w-3" /> Ajouter une transformation
        </button>
      )}
    </div>
  );
}
