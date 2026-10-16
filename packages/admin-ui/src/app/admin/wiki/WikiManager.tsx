"use client";

/**
 * Tableau de bord CMS du wiki. Trois strates :
 *   1. Cartes de complétude par entité (comptes réels, contenu manquant, masqués)
 *      → parcourir la liste ou créer directement dans le studio ;
 *   2. Flux des dernières révisions (versioning) → historique complet ;
 *   3. Arborescence catégories → pages libres (markdown custom) avec recherche.
 * Reçoit stats + révisions + arbre sérialisés depuis le RSC parent.
 */
import Link from "next/link";
import { useMemo, useState } from "react";
import { Document, FlecheDroite, Historique, IllustrationAbsente, Oeil, Plus, Presse } from "@shenron/ui/icones";
import { TABLE_LABELS } from "../../../lib/db-labels";
import { isStudioTable } from "@/lib/wiki-fields";

type PageNode = { id: string; title: string; slug: string };
type CategoryNode = {
  id: string;
  name: string;
  slug: string;
  order: number;
  pages: PageNode[];
  children: { id: string; name: string; slug: string; pages: PageNode[] }[];
};

/** Miroir client de `CmsEntityStat` (lib/wiki-admin, server-only). */
interface CmsEntityStat {
  table: string;
  /** Toutes les lignes, masquées comprises. */
  total: number;
  hidden: number;
  /** Manques comptés sur les seules lignes PUBLIQUES. */
  missingImage: number;
  missingDesc: number;
  missingJa: number;
  imageCol: string | null;
  descCol: string | null;
  jaCol: string | null;
  hasVisibility: boolean;
}

interface RevisionLite {
  id: string;
  tableName: string;
  rowId: string;
  action: string;
  label: string | null;
  editorName: string | null;
  createdAt: string;
}

// Kanji filigrane par entité (clé = table) — cohérent avec la vitrine publique.
const ENTITY_KANJI: Record<string, string> = {
  db_characters: "人物",
  db_planets: "星",
  db_transformations: "変身",
  db_races: "種族",
  db_techniques: "技",
  db_sagas: "編",
  db_arcs: "章",
  db_episodes: "話",
  db_movies: "映画",
  db_games: "遊",
  db_manga_volumes: "巻",
};

// Outils/tables utilitaires (pas de complétude de contenu à suivre).
const TOOLS: { label: string; kanji: string; href: string }[] = [
  { label: "Chronologie", kanji: "年表", href: "/admin/chronologie" },
  { label: "Sources", kanji: "源", href: "/admin/db-universe/sources" },
  { label: "Images & médias", kanji: "画", href: "/admin/db-universe/assets" },
  { label: "Visibilité", kanji: "眼", href: "/admin/visibilite" },
  { label: "Actualités", kanji: "報", href: "/admin/database/db_news" },
];

const ACTION_LABEL: Record<string, { label: string; cls: string }> = {
  create: { label: "création", cls: "text-green-300" },
  update: { label: "édition", cls: "text-dbz-blue-light" },
  delete: { label: "suppression", cls: "text-red-300" },
  visibility: { label: "visibilité", cls: "text-dbz-yellow" },
  revert: { label: "retour arrière", cls: "text-purple-300" },
};

function relTime(iso: string): string {
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "à l'instant";
  const m = Math.round(s / 60);
  if (m < 60) return `il y a ${m} min`;
  const h = Math.round(m / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

/**
 * Score de richesse : part des champs suivis (image, texte, japonais) remplis
 * sur les fiches PUBLIQUES. Les manques étant comptés sur les seules lignes
 * visibles, le dénominateur l'est aussi — diviser par le total, masquées
 * comprises, gonflait le score des entités très masquées.
 */
function richness(s: CmsEntityStat): number {
  const publicRows = s.total - (s.hasVisibility ? s.hidden : 0);
  if (publicRows <= 0) return 0;
  const missing = (s.imageCol ? s.missingImage : 0) + (s.descCol ? s.missingDesc : 0) + (s.jaCol ? s.missingJa : 0);
  const slots = (s.imageCol ? 1 : 0) + (s.descCol ? 1 : 0) + (s.jaCol ? 1 : 0);
  if (!slots) return 100;
  return Math.max(0, Math.round(100 * (1 - missing / (slots * publicRows))));
}

function EntityCard({ s }: { s: CmsEntityStat }) {
  const label = TABLE_LABELS[s.table] ?? s.table;
  const kanji = ENTITY_KANJI[s.table] ?? "";
  const studio = isStudioTable(s.table);
  const pct = richness(s);
  const barColor = pct >= 80 ? "bg-green-400" : pct >= 50 ? "bg-dbz-yellow" : "bg-dbz-red";
  return (
    <div className="dbz-panel group relative overflow-hidden p-4">
      <span
        aria-hidden
        className="pointer-events-none absolute -right-2 -top-3 select-none font-jp text-6xl text-white/[0.04]"
      >
        {kanji}
      </span>
      <div className="relative z-10">
        <div className="flex items-baseline justify-between gap-2">
          <h3 className="font-saiyan text-lg uppercase tracking-wider text-white">{label}</h3>
          <span className="tabular-nums font-scouter text-2xl text-dbz-orange">{s.total}</span>
        </div>

        {/* Barre de richesse du contenu */}
        <div className="mt-3">
          <div className="mb-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-white/50">
            <span>Complétude</span>
            <span className="tabular-nums">{pct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded bg-dbz-bg">
            <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
          </div>
        </div>

        {/* Signaux de contenu manquant — cliquables vers la worklist */}
        <div className="mt-3 flex flex-wrap gap-1.5 text-[10px]">
          {s.imageCol && s.missingImage > 0 && (
            <Link
              href={`/admin/wiki/todo#${s.table}`}
              className="inline-flex items-center gap-1 rounded border border-dbz-border px-1.5 py-0.5 text-white/55 transition-colors hover:border-dbz-orange hover:text-dbz-orange"
            >
              <IllustrationAbsente className="h-3 w-3" />
              {s.missingImage} sans image
            </Link>
          )}
          {s.descCol && s.missingDesc > 0 && (
            <Link
              href={`/admin/wiki/todo#${s.table}`}
              className="inline-flex items-center gap-1 rounded border border-dbz-border px-1.5 py-0.5 text-white/55 transition-colors hover:border-dbz-orange hover:text-dbz-orange"
            >
              <Document className="h-3 w-3" />
              {s.missingDesc} sans texte
            </Link>
          )}
          {s.jaCol && s.missingJa > 0 && (
            <Link
              href={`/admin/wiki/todo#${s.table}`}
              className="inline-flex items-center gap-1 rounded border border-dbz-border px-1.5 py-0.5 text-white/55 transition-colors hover:border-dbz-orange hover:text-dbz-orange"
            >
              <span aria-hidden className="font-jp text-[11px] leading-none">
                日
              </span>
              {s.missingJa} sans japonais
            </Link>
          )}
          {s.hasVisibility && s.hidden > 0 && (
            <span className="inline-flex items-center gap-1 rounded border border-dbz-yellow/30 px-1.5 py-0.5 text-dbz-yellow/80">
              <Oeil className="h-3 w-3" />
              {s.hidden} masquée{s.hidden > 1 ? "s" : ""}
            </span>
          )}
          {s.total > 0 &&
            (!s.imageCol || s.missingImage === 0) &&
            (!s.descCol || s.missingDesc === 0) &&
            (!s.jaCol || s.missingJa === 0) &&
            (!s.hasVisibility || s.hidden === 0) && (
              <span className="rounded border border-green-500/30 px-1.5 py-0.5 text-green-300/80">Complet</span>
            )}
        </div>

        {/* Actions */}
        <div className="mt-4 flex items-center gap-2">
          <Link
            href={`/admin/database/${s.table}`}
            className="inline-flex flex-1 items-center justify-center gap-1 rounded border border-dbz-border px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-white/70 transition-colors hover:border-dbz-orange hover:text-dbz-orange"
          >
            Parcourir
            <FlecheDroite className="h-3 w-3" />
          </Link>
          <Link
            href={studio ? `/admin/wiki/studio/${s.table}/new` : `/admin/database/${s.table}`}
            className="inline-flex items-center justify-center gap-1 rounded border border-dbz-orange/40 bg-dbz-orange/10 px-2 py-1.5 text-[11px] font-bold uppercase tracking-wider text-dbz-orange transition-colors hover:bg-dbz-orange/20"
            title="Créer une entrée"
          >
            <Plus className="h-3 w-3" />
            Nouveau
          </Link>
        </div>
      </div>
    </div>
  );
}

export function WikiManager({
  categories,
  stats = [],
  recent = [],
}: {
  categories: CategoryNode[];
  stats?: CmsEntityStat[];
  recent?: RevisionLite[];
}) {
  const [q, setQ] = useState("");

  const totals = useMemo(() => {
    let cats = categories.length;
    let pages = 0;
    for (const c of categories) {
      cats += c.children.length;
      pages += c.pages.length;
      for (const sub of c.children) pages += sub.pages.length;
    }
    const entities = stats.reduce((n, s) => n + s.total, 0);
    return { cats, pages, entities };
  }, [categories, stats]);

  const needle = q.trim().toLowerCase();
  const match = (s: string) => !needle || s.toLowerCase().includes(needle);

  const filtered = useMemo(() => {
    if (!needle) return categories;
    return categories
      .map(c => {
        const pages = c.pages.filter(p => match(p.title) || match(p.slug));
        const children = c.children
          .map(sub => ({
            ...sub,
            pages: sub.pages.filter(p => match(p.title) || match(p.slug)),
          }))
          .filter(sub => match(sub.name) || sub.pages.length > 0);
        return { ...c, pages, children };
      })
      .filter(c => match(c.name) || c.pages.length > 0 || c.children.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categories, needle]);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <div className="mb-6 flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="font-saiyan text-4xl text-dbz-orange">GESTION DU WIKI</h1>
          <p className="mt-1 font-mono text-xs text-dbz-blue-light">
            {totals.entities.toLocaleString("fr-FR")} fiches · {totals.cats} catégorie
            {totals.cats > 1 ? "s" : ""} · {totals.pages} page
            {totals.pages > 1 ? "s" : ""} libre
            {totals.pages > 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Link href="/admin/wiki/todo" className="dbz-button-ghost inline-flex items-center gap-2">
            <Presse className="h-4 w-4" />À COMPLÉTER
          </Link>
          <Link href="/admin/wiki/history" className="dbz-button-ghost inline-flex items-center gap-2">
            <Historique className="h-4 w-4" />
            HISTORIQUE
          </Link>
          <Link href="/admin/wiki/category/new" className="dbz-button">
            + CATÉGORIE
          </Link>
          <Link href="/admin/wiki/page/new" className="dbz-button">
            + PAGE
          </Link>
        </div>
      </div>

      {/* Cartes de complétude par entité */}
      <section className="mb-10">
        <h2 className="mb-1 font-saiyan text-2xl uppercase tracking-widest text-dbz-yellow">Encyclopédie</h2>
        <p className="mb-4 text-sm text-gray-400">
          Complétude du contenu par type de fiche. Repère d'un coup d'œil ce qu'il reste à illustrer, rédiger ou
          publier.
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {stats.map(s => (
            <EntityCard key={s.table} s={s} />
          ))}
        </div>
      </section>

      {/* Dernières révisions */}
      {recent.length > 0 && (
        <section className="mb-10">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="font-saiyan text-2xl uppercase tracking-widest text-dbz-yellow">Dernières modifications</h2>
            <Link
              href="/admin/wiki/history"
              className="text-xs font-bold uppercase tracking-wider text-dbz-orange/80 hover:text-dbz-orange"
            >
              Tout l'historique →
            </Link>
          </div>
          <ul className="dbz-panel divide-y divide-dbz-border/40">
            {recent.map(r => {
              const meta = ACTION_LABEL[r.action] ?? {
                label: r.action,
                cls: "text-white/60",
              };
              const label = TABLE_LABELS[r.tableName] ?? r.tableName;
              const canStudio = isStudioTable(r.tableName) && !r.rowId.includes(":");
              return (
                <li key={r.id} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-2.5 text-sm">
                  <span className={`text-[11px] font-bold uppercase tracking-wider ${meta.cls}`}>{meta.label}</span>
                  {canStudio ? (
                    <Link
                      href={`/admin/wiki/studio/${r.tableName}/${encodeURIComponent(r.rowId)}`}
                      className="font-semibold text-white hover:text-dbz-orange"
                    >
                      {r.label || `#${r.rowId}`}
                    </Link>
                  ) : (
                    <span className="font-semibold text-white">{r.label || `#${r.rowId}`}</span>
                  )}
                  <span className="text-[11px] text-white/50">{label}</span>
                  <span className="ml-auto text-[11px] text-white/50">
                    {r.editorName ? <span className="text-white/60">{r.editorName}</span> : "système"} ·{" "}
                    {relTime(r.createdAt)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Outils & tables utilitaires */}
      <section className="mb-10">
        <h2 className="mb-3 font-saiyan text-2xl uppercase tracking-widest text-dbz-yellow">Outils</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {TOOLS.map(e => (
            <Link
              key={e.href}
              href={e.href}
              className="dbz-panel group flex items-center gap-3 p-4 transition-colors hover:border-dbz-orange"
            >
              <span className="text-2xl text-dbz-blue-light transition-colors group-hover:text-dbz-orange">
                {e.kanji}
              </span>
              <span className="font-saiyan text-sm uppercase tracking-wider text-gray-200 group-hover:text-white">
                {e.label}
              </span>
            </Link>
          ))}
        </div>
      </section>

      {/* Pages libres — table WikiPage (markdown + HTML + images custom). */}
      <div className="mb-4 flex items-baseline justify-between border-t border-dbz-border pt-8">
        <h2 className="font-saiyan text-2xl uppercase tracking-widest text-dbz-yellow">Pages libres</h2>
        <p className="text-xs text-gray-500">Articles 100% custom (markdown, mise en page, images)</p>
      </div>

      <input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="Rechercher une page ou une catégorie…"
        className="mb-6 w-full border-2 border-dbz-border bg-dbz-bg p-3 text-white outline-none focus:border-dbz-orange"
      />

      <div className="space-y-6">
        {filtered.length === 0 ? (
          <div className="dbz-panel p-8 text-center">
            <p className="font-saiyan text-2xl uppercase text-dbz-blue-light">
              {needle ? "Aucun résultat" : "Aucune catégorie. Créez la première."}
            </p>
          </div>
        ) : (
          filtered.map(cat => (
            <div key={cat.id} className="dbz-panel space-y-4 p-6">
              <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                <div>
                  <h2 className="font-saiyan text-2xl text-dbz-yellow">
                    {cat.name}
                    <span className="ml-2 font-mono text-sm text-gray-500">({cat.pages.length})</span>
                  </h2>
                  <p className="mt-1 font-mono text-xs text-dbz-blue-light">
                    /{cat.slug} · order: {cat.order}
                  </p>
                </div>
                <div className="flex gap-3">
                  <Link
                    href={`/admin/wiki/category/${cat.id}`}
                    className="font-saiyan text-sm uppercase tracking-wider text-dbz-blue-light hover:text-dbz-yellow"
                  >
                    ÉDITER
                  </Link>
                  <Link
                    href={`/admin/wiki/page/new?category=${cat.id}`}
                    className="font-saiyan text-sm uppercase tracking-wider text-dbz-orange hover:text-dbz-yellow"
                  >
                    + PAGE
                  </Link>
                </div>
              </div>

              {cat.pages.length > 0 && (
                <ul className="ml-4 space-y-1 border-l-2 border-dbz-border pl-4">
                  {cat.pages.map(p => (
                    <li key={p.id} className="group flex items-center justify-between gap-3">
                      <Link
                        href={`/wiki/${cat.slug}/${p.slug}`}
                        className="truncate text-sm text-gray-300 transition-colors hover:text-dbz-orange"
                      >
                        {p.title}
                      </Link>
                      <span className="flex shrink-0 gap-3 opacity-0 transition-opacity group-hover:opacity-100">
                        <Link
                          href={`/wiki/${cat.slug}/${p.slug}`}
                          className="font-saiyan text-xs uppercase text-gray-400 hover:text-dbz-yellow"
                        >
                          VOIR
                        </Link>
                        <Link
                          href={`/admin/wiki/page/${p.id}`}
                          className="font-saiyan text-xs uppercase text-dbz-blue-light hover:text-dbz-yellow"
                        >
                          ÉDITER
                        </Link>
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {cat.children.length > 0 && (
                <div className="ml-4 space-y-3">
                  {cat.children.map(sub => (
                    <div key={sub.id} className="border-l-2 border-dbz-blue/50 pl-4">
                      <div className="mb-2 flex items-center justify-between">
                        <h3 className="font-saiyan text-lg text-dbz-blue-light">
                          {sub.name}
                          <span className="ml-2 font-mono text-xs text-gray-500">({sub.pages.length})</span>
                        </h3>
                        <Link
                          href={`/admin/wiki/category/${sub.id}`}
                          className="text-xs uppercase text-gray-500 hover:text-dbz-yellow"
                        >
                          ÉDITER
                        </Link>
                      </div>
                      <ul className="space-y-1 text-sm">
                        {sub.pages.map(p => (
                          <li key={p.id} className="group flex justify-between gap-3">
                            <Link
                              href={`/wiki/${cat.slug}/${sub.slug}/${p.slug}`}
                              className="truncate text-gray-400 transition-colors hover:text-dbz-orange"
                            >
                              {p.title}
                            </Link>
                            <Link
                              href={`/admin/wiki/page/${p.id}`}
                              className="shrink-0 font-saiyan text-xs uppercase text-dbz-blue-light opacity-0 hover:text-dbz-yellow group-hover:opacity-100"
                            >
                              ÉDITER
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
