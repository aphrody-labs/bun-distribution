import Link from "next/link";
import { Scan } from "@/components/icones";
import { AdminHeader } from "../_Header";
import { DbAddButton } from "@aphrody/admin-ui/components/admin/DbCrud";
import { DatabookAdminList } from "@aphrody/admin-ui/components/admin/DatabookAdminList";
import { listWikiSnake } from "@/lib/wiki-admin";
import { toMillis } from "@/lib/epoch";

export const dynamic = "force-dynamic";

const TABLE = "db_databooks";

type Databook = {
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

function pagesCount(pages: unknown): number {
  return Array.isArray(pages) ? pages.length : 0;
}

function publishedMs(v: number | null): number {
  if (!v) return 0;
  return toMillis(v);
}

const GROUPS: { key: string; label: string }[] = [
  { key: "databook", label: "Databooks" },
  { key: "interview", label: "Interviews" },
  { key: "artbook", label: "Art Books" },
  { key: "guidebook", label: "Saikyō Jump" },
];

function resolveKind(d: Databook): string {
  const cat = (d.category ?? "").trim();
  if (cat === "Interview") return "interview";
  if (cat === "Art Book") return "artbook";
  if (cat === "Saikyō Jump" || cat === "Guidebook") return "guidebook";
  if (cat === "Databook") return "databook";
  const k = (d.kind ?? "").toLowerCase();
  if (
    k === "interview" ||
    k === "artbook" ||
    k === "guidebook" ||
    k === "databook"
  )
    return k;
  return "databook";
}

export default async function AdminDatabooksPage() {
  const raw = (await listWikiSnake("db_databooks", {
    limit: 500,
  })) as Databook[];
  const items = raw
    .slice()
    .toSorted(
      (a, b) =>
        publishedMs(b.published_at) - publishedMs(a.published_at) ||
        a.id - b.id,
    );

  const normalizedItems = items.map((d) => ({
    ...d,
    category: resolveKind(d),
  }));

  const visibleCount = items.filter((d) => d.visible !== false).length;
  const withCover = items.filter((d) => !!d.cover).length;
  const withDesc = items.filter((d) => !!d.description?.trim()).length;
  const withPages = items.filter((d) => pagesCount(d.pages) > 0).length;
  const totalPages = items.reduce((n, d) => n + pagesCount(d.pages), 0);

  return (
    <div className="mx-auto w-full max-w-6xl">
      <AdminHeader
        title="Databooks & interviews"
        subtitle={
          items.length > 0
            ? `${items.length} entrée${items.length > 1 ? "s" : ""} · ${visibleCount} visible${visibleCount > 1 ? "s" : ""}`
            : undefined
        }
      />
      <p className="mb-4 text-sm text-white/50">
        Guides officiels, artbooks, daizenshuu et interviews. L&apos;édition se
        fait dans le <strong className="text-white/70">studio visuel</strong>{" "}
        (aperçu live, upload couverture, markdown) — comme pour les personnages.
        L&apos;index public triable est sur{" "}
        <code className="text-dbz-orange/80">/wiki/databooks</code>. Le texte
        des planches se relit dans le{" "}
        <Link
          href="/admin/databooks"
          className="text-dbz-orange hover:underline"
        >
          suivi des transcriptions
        </Link>
        .
      </p>

      {items.length > 0 && (
        <div className="mb-6 flex flex-wrap gap-3 text-[11px] uppercase tracking-wider text-white/50">
          <span className="rounded border border-dbz-border/50 bg-white/[0.03] px-2.5 py-1">
            {withCover}/{items.length} covers
          </span>
          <span className="rounded border border-dbz-border/50 bg-white/[0.03] px-2.5 py-1">
            {withDesc}/{items.length} descriptions
          </span>
          <span className="rounded border border-dbz-border/50 bg-white/[0.03] px-2.5 py-1">
            {withPages}/{items.length} avec pages · {totalPages} planches
          </span>
          <span className="rounded border border-dbz-border/50 bg-white/[0.03] px-2.5 py-1">
            {items.filter((d) => resolveKind(d) === "databook").length}{" "}
            databooks ·{" "}
            {items.filter((d) => resolveKind(d) === "interview").length}{" "}
            interviews ·{" "}
            {items.filter((d) => resolveKind(d) === "artbook").length} art books
            · {items.filter((d) => resolveKind(d) === "guidebook").length}{" "}
            guides
          </span>
        </div>
      )}

      <div className="mb-6 flex flex-wrap justify-end gap-2">
        <Link
          href="/admin/databooks"
          className="btn btn-ghost h-9 px-3 text-xs"
        >
          <Scan className="h-3.5 w-3.5" />
          Suivi des transcriptions
        </Link>
        <DbAddButton table={TABLE} label="Ajouter une entrée" />
      </div>

      {items.length === 0 ? (
        <div className="dbz-panel p-12 text-center">
          <p className="mb-1 font-saiyan text-xl uppercase text-white/50">
            Aucune entrée
          </p>
          <p className="text-sm text-white/50">
            Ajoutez un databook ou une interview pour commencer.
          </p>
        </div>
      ) : (
        <DatabookAdminList items={normalizedItems} groups={GROUPS} />
      )}
    </div>
  );
}
