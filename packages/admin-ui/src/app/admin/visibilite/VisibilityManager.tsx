"use client";

/**
 * Gestionnaire de VISIBILITÉ du wiki : masque/affiche chaque entité (personnage,
 * technique, film, épisode…) du site public, une par une ou en masse, sans la
 * supprimer. Écrit la colonne PG-only `visible` via `/api/wiki-admin/:table?as=visibility`.
 *
 * Les lectures publiques (`shenron.ts`/`db-universe.ts`) filtrent `visible = true`
 * → une entité masquée disparaît des index et sa page détail renvoie 404 pour le
 * public, mais reste éditable ici et dans le studio.
 */
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Chargement, Oeil, OeilBarre, Recherche } from "@shenron/ui/icones";
import { apiAt } from "@aphrody/admin-ui/client";
import { assetUrl } from "@/lib/assets";

interface VisibilityRow {
  id: string;
  label: string;
  image: string | null;
  extra: string | null;
  visible: boolean;
}

const TABLES: { name: string; label: string }[] = [
  { name: "db_characters", label: "Personnages" },
  { name: "db_techniques", label: "Techniques" },
  { name: "db_transformations", label: "Transformations" },
  { name: "db_planets", label: "Cosmologie" },
  { name: "db_races", label: "Races" },
  { name: "db_sagas", label: "Sagas" },
  { name: "db_arcs", label: "Arcs" },
  { name: "db_episodes", label: "Épisodes" },
  { name: "db_movies", label: "Films" },
  { name: "db_games", label: "Jeux" },
  { name: "db_manga_volumes", label: "Tomes manga" },
  { name: "db_manga_chapters", label: "Chapitres manga" },
];

const client = apiAt("/api/wiki-admin");
const norm = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();

export function VisibilityManager() {
  const [table, setTable] = useState(TABLES[0]!.name);
  const [q, setQ] = useState("");
  const qc = useQueryClient();
  const queryKey = ["wiki-visibility", table] as const;

  const list = useQuery({
    queryKey,
    queryFn: () => client.get<{ items: VisibilityRow[] }>(`/${table}?as=visibility`),
    staleTime: 30_000,
  });

  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const filtered = useMemo(() => {
    const needle = norm(q.trim());
    if (!needle) return items;
    return items.filter(it => norm(it.label).includes(needle));
  }, [items, q]);

  const visibleCount = items.filter(i => i.visible).length;
  const hiddenCount = items.length - visibleCount;

  // Bascule d'une entité — mise à jour optimiste du cache pour un rendu instantané.
  const toggle = useMutation({
    mutationFn: (v: { id: string; visible: boolean }) => client.post(`/${table}?as=visibility`, v),
    onMutate: async v => {
      await qc.cancelQueries({ queryKey });
      const prev = qc.getQueryData<{ items: VisibilityRow[] }>(queryKey);
      qc.setQueryData<{ items: VisibilityRow[] }>(queryKey, old =>
        old
          ? {
              items: old.items.map(it => (it.id === v.id ? { ...it, visible: v.visible } : it)),
            }
          : old,
      );
      return { prev };
    },
    onError: (_e, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(queryKey, ctx.prev);
    },
  });

  // Bascule de masse (toute la table).
  const bulk = useMutation({
    mutationFn: (visible: boolean) => client.post(`/${table}?as=visibility`, { all: true, visible }),
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  const busyBulk = bulk.isPending;
  const labelTable = TABLES.find(t => t.name === table)?.label ?? table;

  // « Tout masquer » retire d'un clic une rubrique entière du site public (les
  // pages détail passent en 404) : on demande la même confirmation que les
  // autres opérations de masse de l'admin avant de partir en écriture.
  const basculeMasse = (visible: boolean) => {
    const verbe = visible ? "afficher" : "masquer";
    if (
      !confirm(
        `${visible ? "Afficher" : "Masquer"} les ${items.length} entrées de « ${labelTable} » sur le site public ?\n\n` +
          `Toutes les fiches de cette rubrique vont ${verbe === "masquer" ? "disparaître des index publics" : "réapparaître sur le site"}.`,
      )
    )
      return;
    bulk.mutate(visible);
  };

  return (
    <div className="space-y-6">
      {/* Sélecteur d'entité */}
      <div className="flex flex-wrap gap-2">
        {TABLES.map(t => (
          <button
            key={t.name}
            type="button"
            onClick={() => {
              setTable(t.name);
              setQ("");
            }}
            className={`rounded-lg px-3 py-1.5 text-[13px] font-display font-semibold transition-colors ${
              table === t.name
                ? "bg-dbz-orange text-black"
                : "bg-white/5 text-white/60 hover:bg-white/10 hover:text-white"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Barre d'actions : recherche + compteurs + bascule de masse */}
      <div className="dbz-panel flex flex-wrap items-center gap-3 p-4">
        <div className="relative min-w-[200px] flex-1">
          <Recherche className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-white/50" />
          <input
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            aria-label={`Rechercher dans ${labelTable.toLowerCase()}`}
            placeholder="Rechercher…"
            className="h-9 w-full rounded-lg border border-dbz-border bg-dbz-bg/70 pl-9 pr-3 text-[13px] text-white outline-none placeholder:text-white/50 focus:border-dbz-orange"
          />
        </div>
        <div className="flex items-center gap-3 text-[13px]">
          <span className="inline-flex items-center gap-1.5 text-namek">
            <Oeil className="h-4 w-4" /> {visibleCount}
          </span>
          <span className="inline-flex items-center gap-1.5 text-white/50">
            <OeilBarre className="h-4 w-4" /> {hiddenCount}
          </span>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => basculeMasse(true)}
            disabled={busyBulk || items.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-namek/40 bg-namek/10 px-3 py-1.5 text-[12px] font-semibold text-namek transition-colors hover:bg-namek/20 disabled:opacity-40"
          >
            {busyBulk ? <Chargement className="h-3.5 w-3.5 animate-spin" /> : <Oeil className="h-3.5 w-3.5" />}
            Tout afficher
          </button>
          <button
            type="button"
            onClick={() => basculeMasse(false)}
            disabled={busyBulk || items.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/15 bg-white/5 px-3 py-1.5 text-[12px] font-semibold text-white/70 transition-colors hover:bg-white/10 disabled:opacity-40"
          >
            {busyBulk ? <Chargement className="h-3.5 w-3.5 animate-spin" /> : <OeilBarre className="h-3.5 w-3.5" />}
            Tout masquer
          </button>
        </div>
      </div>

      {/* Grille d'entités */}
      {list.isLoading ? (
        <div className="dbz-panel flex items-center justify-center gap-2 py-16 text-white/50">
          <Chargement className="h-5 w-5 animate-spin" /> Chargement…
        </div>
      ) : list.isError ? (
        <p className="dbz-panel py-12 text-center text-red-400">Erreur de chargement. Réessaie.</p>
      ) : filtered.length === 0 ? (
        <p className="dbz-panel py-12 text-center text-white/50">
          {items.length === 0 ? "Aucune entité." : "Aucun résultat pour cette recherche."}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map(it => (
            <VisibilityCard key={it.id} row={it} onToggle={() => toggle.mutate({ id: it.id, visible: !it.visible })} />
          ))}
        </div>
      )}
    </div>
  );
}

function VisibilityCard({ row, onToggle }: { row: VisibilityRow; onToggle: () => void }) {
  const { label, image, extra, visible } = row;
  return (
    <button
      type="button"
      onClick={onToggle}
      // L'état visible/masqué n'était porté que par la couleur et l'opacité :
      // `aria-pressed` le rend audible, et la ligne de texte du bouton reste
      // son nom accessible.
      aria-pressed={visible}
      title={visible ? "Cliquer pour masquer" : "Cliquer pour afficher"}
      className={`group flex items-center gap-3 rounded-lg border px-3 py-2 text-left transition-all ${
        visible
          ? "border-dbz-border bg-white/[0.03] hover:border-dbz-orange/40"
          : "border-white/[0.06] bg-black/30 opacity-55 hover:opacity-90"
      }`}
    >
      <div className="h-12 w-12 shrink-0 overflow-hidden rounded bg-dbz-bg/60">
        {image ? (
          <img
            src={assetUrl(image)}
            alt=""
            loading="lazy"
            decoding="async"
            className={`h-full w-full object-cover ${visible ? "" : "grayscale"}`}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center text-white/20">
            <OeilBarre className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate font-display text-[14px] font-semibold text-white">{label}</p>
        <p className="truncate text-[11px] text-white/50">
          {extra ? `${extra} · ` : ""}#{row.id}
        </p>
      </div>
      <span
        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors ${
          visible
            ? "bg-namek/15 text-namek group-hover:bg-namek/25"
            : "bg-white/5 text-white/50 group-hover:bg-white/10"
        }`}
      >
        {visible ? <Oeil className="h-4 w-4" /> : <OeilBarre className="h-4 w-4" />}
      </span>
    </button>
  );
}
