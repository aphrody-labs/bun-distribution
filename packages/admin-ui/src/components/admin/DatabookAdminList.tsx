"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LienExterne } from "@/components/icones";
import { DbRowActions } from "@aphrody/admin-ui/components/admin/DbCrud";
import { assetCdnUrl } from "@aphrody/admin-ui/app/admin/db-universe/_lib";
import { toMillis } from "@/lib/epoch";

const TABLE = "db_databooks";
const PAGE_SIZE = 40;

function fmtDate(v: number | null): string {
  if (!v) return "—";
  const d = new Date(toMillis(v));
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleDateString("fr-FR");
}

export type AdminDatabook = {
  id: number;
  kind: string;
  title: string;
  title_ja: string | null;
  author: string | null;
  published_at: number | null;
  cover: string | null;
  description: string | null;
  source_url: string | null;
  category?: string | null;
  pages?: unknown;
  visible?: boolean | null;
};

type Group = { key: string; label: string; items: AdminDatabook[] };

function pagesCount(pages: unknown): number {
  return Array.isArray(pages) ? pages.length : 0;
}

function categoryBadge(d: AdminDatabook): string {
  const cat = (d.category ?? "").trim();
  if (cat === "interview") return "Interview";
  if (cat === "artbook") return "Art Book";
  if (cat === "guidebook") return "Saikyō Jump";
  if (cat === "databook") return "Databook";
  if (cat) return cat;
  const kind = d.kind.toLowerCase();
  if (kind === "interview") return "Interview";
  if (kind === "artbook") return "Art Book";
  if (kind === "guidebook") return "Saikyō Jump";
  return "Databook";
}

function norm(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function Row({ d, fmtDate }: { d: AdminDatabook; fmtDate: (v: number | null) => string }) {
  const coverUrl = d.cover ? (/^https?:\/\//.test(d.cover) ? d.cover : assetCdnUrl(d.cover)) : null;
  const hasDesc = !!d.description?.trim();
  const isVisible = d.visible !== false;
  const pages = pagesCount(d.pages);
  return (
    <tr className="border-b border-dbz-border/30 transition-colors hover:bg-dbz-blue-light/5">
      <td className="p-2">
        {coverUrl ? (
          <Image
            src={coverUrl}
            alt={d.title}
            width={36}
            height={52}
            className="rounded border border-dbz-border object-cover"
            unoptimized
          />
        ) : (
          <div className="flex h-[52px] w-9 items-center justify-center rounded bg-dbz-border/30 text-[9px] uppercase text-white/25">
            n/a
          </div>
        )}
      </td>
      <td className="p-2">
        <Link
          href={`/admin/wiki/studio/${TABLE}/${d.id}`}
          className="text-sm font-medium text-white hover:text-dbz-orange"
        >
          {d.title}
        </Link>
        {d.title_ja && (
          <div className="font-jp mt-0.5 text-xs text-dbz-yellow/75">{d.title_ja}</div>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-mono uppercase text-dbz-orange">
            {categoryBadge(d)}
          </span>
          {d.source_url && (
            <a
              href={d.source_url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-dbz-orange/80 hover:underline"
            >
              Source
            </a>
          )}
          <a
            href={`/wiki/databooks/${d.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-0.5 text-[10px] text-white/50 hover:text-dbz-orange"
            title="Page publique"
          >
            <LienExterne className="h-2.5 w-2.5" />
            Public
          </a>
        </div>
      </td>
      <td className="p-2 text-[11px] text-white/55">{fmtDate(d.published_at)}</td>
      <td className="p-2 text-xs text-white/70">{d.author ?? "—"}</td>
      <td className="p-2 text-center">
        <span
          className={`inline-block h-2 w-2 rounded-full ${hasDesc ? "bg-green-400" : "bg-white/20"}`}
          title={hasDesc ? "Description renseignée" : "Description manquante"}
        />
        {pages > 0 && (
          <span className="ml-1 text-[10px] font-mono text-dbz-orange/80">{pages}p</span>
        )}
      </td>
      <td className="p-2 text-center">
        <span
          className={`inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${isVisible ? "bg-green-500/15 text-green-300" : "bg-white/5 text-white/50"}`}
        >
          {isVisible ? "ON" : "OFF"}
        </span>
      </td>
      <td className="p-2">
        <DbRowActions table={TABLE} id={d.id} />
      </td>
    </tr>
  );
}

function Table({ group }: { group: Group }) {
  return (
    <section className="mb-10" aria-labelledby={`databook-group-${group.key}`}>
      <h2
        id={`databook-group-${group.key}`}
        className="mb-3 border-b-2 border-dbz-yellow/30 pb-2 font-saiyan text-2xl uppercase text-dbz-yellow"
      >
        {group.label}{" "}
        <span className="font-sans text-sm font-normal normal-case text-white/50">
          {group.items.length}
        </span>
      </h2>
      <div className="overflow-x-auto rounded-lg border border-dbz-border/30">
        <table className="w-full min-w-[760px]">
          <caption className="sr-only">{group.label}</caption>
          <thead>
            <tr className="border-b-2 border-dbz-border/60">
              <th className="w-14 p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light">
                Cover
              </th>
              <th className="p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light">
                Titre
              </th>
              <th className="w-28 p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light">
                Date
              </th>
              <th className="w-32 p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light">
                Auteur
              </th>
              <th className="w-20 p-2 text-center text-xs uppercase tracking-widest text-dbz-blue-light">
                Contenu
              </th>
              <th className="w-16 p-2 text-center text-xs uppercase tracking-widest text-dbz-blue-light">
                Vis.
              </th>
              <th className="w-24 p-2 text-right text-xs uppercase tracking-widest text-dbz-blue-light">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {group.items.map((d) => (
              <Row key={d.id} d={d} fmtDate={fmtDate} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function DatabookAdminList({
  items,
  groups,
}: {
  items: AdminDatabook[];
  groups: { key: string; label: string }[];
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState("all");
  const [state, setState] = useState<
    "all" | "visible" | "hidden" | "missing-pages" | "missing-description"
  >("all");
  const [page, setPage] = useState(1);
  const filtered = useMemo(() => {
    const q = norm(query.trim());
    return items.filter((d) => {
      if (scope !== "all" && (d.category ?? "").toLowerCase() !== scope) return false;
      if (state === "visible" && d.visible === false) return false;
      if (state === "hidden" && d.visible !== false) return false;
      if (state === "missing-pages" && pagesCount(d.pages) > 0) return false;
      if (state === "missing-description" && d.description?.trim()) return false;
      return (
        !q ||
        norm(`${d.title} ${d.title_ja ?? ""} ${d.author ?? ""} ${d.category ?? ""}`).includes(q)
      );
    });
  }, [items, query, scope, state]);
  useEffect(() => setPage(1), [query, scope, state]);
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pages);
  const visible = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);
  const grouped = groups
    .map((g) => ({
      ...g,
      items: visible.filter((d) => (d.category ?? "").toLowerCase() === g.key),
    }))
    .filter((g) => g.items.length > 0);
  const other = visible.filter(
    (d) => !groups.some((g) => (d.category ?? "").toLowerCase() === g.key),
  );
  if (other.length) grouped.push({ key: "other", label: "Autres", items: other });
  return (
    <>
      <div className="dbz-panel mb-8 grid gap-3 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto] sm:items-center">
        <label className="relative block">
          <span className="sr-only">Rechercher dans les databooks</span>
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Titre, japonais, auteur…"
            className="input h-10 w-full"
          />
        </label>
        <label className="flex items-center gap-2 text-xs text-white/60">
          <span className="sr-only">Filtrer par catégorie</span>
          <select value={scope} onChange={(e) => setScope(e.target.value)} className="input h-10">
            <option value="all">Toutes catégories</option>
            {groups.map((g) => (
              <option key={g.key} value={g.key}>
                {g.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs text-white/60">
          <span className="sr-only">Filtrer par état</span>
          <select
            value={state}
            onChange={(e) => setState(e.target.value as typeof state)}
            className="input h-10"
          >
            <option value="all">Tous les états</option>
            <option value="visible">Visibles</option>
            <option value="hidden">Masqués</option>
            <option value="missing-pages">Sans planches</option>
            <option value="missing-description">Sans description</option>
          </select>
        </label>
        <p className="text-xs tabular-nums text-dbz-orange sm:col-span-3" aria-live="polite">
          {filtered.length} résultat{filtered.length > 1 ? "s" : ""} · page {current}/{pages}
        </p>
      </div>
      {grouped.length ? (
        grouped.map((g) => <Table key={g.key} group={g} />)
      ) : (
        <div className="dbz-panel p-12 text-center text-sm text-white/50">
          Aucune entrée ne correspond aux filtres.
        </div>
      )}
      {pages > 1 && (
        <nav
          className="mb-10 flex items-center justify-center gap-2"
          aria-label="Pagination des databooks"
        >
          <button
            type="button"
            className="btn btn-ghost h-9 px-3 text-xs"
            disabled={current === 1}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            Précédente
          </button>
          <span className="text-xs tabular-nums text-white/60">
            {current} / {pages}
          </span>
          <button
            type="button"
            className="btn btn-ghost h-9 px-3 text-xs"
            disabled={current === pages}
            onClick={() => setPage((p) => Math.min(pages, p + 1))}
          >
            Suivante
          </button>
        </nav>
      )}
    </>
  );
}
