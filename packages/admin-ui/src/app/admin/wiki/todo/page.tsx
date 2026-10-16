import Link from "next/link";
import { CocheCercle, Document, FlecheGauche, IllustrationAbsente, OeilBarre, Presse } from "@shenron/ui/icones";
import { StatTiles } from "@/components/kit";
import { listIncompleteContent, type IncompleteGroup, type IncompleteRow } from "@/lib/wiki-admin";
import { assetUrl } from "@/lib/db-universe";
import { TABLE_LABELS } from "../../../../lib/db-labels";
import { GAP_LABELS } from "@/lib/wiki-gaps";
import { isStudioTable } from "@/lib/wiki-fields";

export const dynamic = "force-dynamic";

export const metadata = { title: "Fiches à compléter" };

/** Plafond d'affichage par entité ; les comptes annoncés, eux, sont réels. */
const PER_TABLE = 80;

const nf = new Intl.NumberFormat("fr-FR");

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | null {
  return typeof v === "string" ? v : Array.isArray(v) ? (v[0] ?? null) : null;
}

/**
 * Studio pour les entités qui en ont un ; sinon l'éditeur générique de la
 * table, pré-filtré sur la fiche (slug, sinon libellé).
 */
function editHref(row: IncompleteRow): string {
  return isStudioTable(row.table)
    ? `/admin/wiki/studio/${row.table}/${encodeURIComponent(row.id)}`
    : `/admin/database/${row.table}?q=${encodeURIComponent(row.searchTerm)}`;
}

/** URL de la page en conservant les options (masquées, table dépliée). */
function todoHref({ masquees, tout }: { masquees: boolean; tout: string | null }): string {
  const qs = new URLSearchParams();
  if (masquees) qs.set("masquees", "1");
  if (tout) qs.set("tout", tout);
  const s = qs.toString();
  return s ? `/admin/wiki/todo?${s}` : "/admin/wiki/todo";
}

function tableLabel(table: string): string {
  return TABLE_LABELS[table] ?? table;
}

function plural(n: number, singular: string, many: string): string {
  return `${nf.format(n)} ${n > 1 ? many : singular}`;
}

/** « fiche masquée, non publique » / « fiches masquées, non publiques ». */
function hiddenLabel(n: number): string {
  return n > 1 ? "fiches masquées, non publiques" : "fiche masquée, non publique";
}

/** Badge de manque : cadre 1 px, sans ombre, glyphe plutôt qu'emoji. */
function GapBadge({ kind }: { kind: "image" | "desc" | "ja" }) {
  return (
    <span className="inline-flex items-center gap-1 rounded border border-dbz-border px-1.5 py-0.5 text-[10px] text-white/55">
      {kind === "image" && <IllustrationAbsente className="h-3 w-3" />}
      {kind === "desc" && <Document className="h-3 w-3" />}
      {kind === "ja" && (
        <span aria-hidden className="font-jp text-[11px] leading-none">
          日
        </span>
      )}
      {GAP_LABELS[kind]}
    </span>
  );
}

function RowItem({ row }: { row: IncompleteRow }) {
  return (
    <li>
      <Link href={editHref(row)} className="flex items-center gap-3 px-3 py-2 transition-colors hover:bg-dbz-orange/5">
        <span className="relative flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded border border-dbz-border bg-dbz-bg">
          {row.image ? (
            <img src={assetUrl(row.image)} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <IllustrationAbsente className="h-4 w-4 text-white/25" />
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate font-semibold text-white">{row.label}</span>
          <span className="font-mono text-[10px] text-white/50">
            #{row.id}
            {row.context ? ` · ${row.context}` : ""}
          </span>
        </span>
        <span className="flex shrink-0 flex-wrap justify-end gap-1.5">
          {row.hidden && (
            <span className="inline-flex items-center gap-1 rounded border border-dbz-yellow/30 px-1.5 py-0.5 text-[10px] text-dbz-yellow/80">
              <OeilBarre className="h-3 w-3" />
              masquée
            </span>
          )}
          {row.missingImage && <GapBadge kind="image" />}
          {row.missingDesc && <GapBadge kind="desc" />}
          {row.missingJa && <GapBadge kind="ja" />}
        </span>
      </Link>
    </li>
  );
}

function GroupSection({ group, masquees, tout }: { group: IncompleteGroup; masquees: boolean; tout: string | null }) {
  const { counts } = group;
  const truncated = group.rows.length < counts.total;
  const hiddenTruncated = masquees && group.hiddenRows.length < counts.hidden;
  // Déjà dépliée : seul le garde-fou `WORKLIST_EXPAND_LIMIT` peut encore tronquer.
  const expandLink =
    tout !== group.table ? (
      <Link
        href={`${todoHref({ masquees, tout: group.table })}#${group.table}`}
        className="font-semibold text-dbz-orange underline-offset-2 hover:underline"
      >
        Tout afficher
      </Link>
    ) : null;
  const notes = [group.note, group.jaScopeReason, group.jaExemptReason].filter((n): n is string => Boolean(n));
  const unchecked = (["image", "desc", "ja"] as const).filter(k => !group.checks[k]);

  return (
    <section id={group.table} className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="font-saiyan text-xl uppercase tracking-widest text-dbz-yellow">{tableLabel(group.table)}</h2>
        <span className="text-sm text-white/60">
          <span className="font-bold tabular-nums text-dbz-orange">{nf.format(counts.total)}</span> publique
          {counts.total > 1 ? "s" : ""} à compléter
        </span>
        <span className="text-xs text-white/45">
          {[
            group.checks.image ? `${nf.format(counts.image)} sans image` : null,
            group.checks.desc ? `${nf.format(counts.desc)} sans texte` : null,
            group.checks.ja ? `${nf.format(counts.ja)} sans japonais` : null,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
        {counts.hidden > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-dbz-yellow/70">
            <OeilBarre className="h-3 w-3" />
            {plural(counts.hidden, "masquée, non publique", "masquées, non publiques")}
          </span>
        )}
      </div>

      {(notes.length > 0 || unchecked.length > 0) && (
        <ul className="space-y-0.5 text-xs text-white/45">
          {notes.map(n => (
            <li key={n}>{n}</li>
          ))}
          {unchecked.length > 0 && (
            <li>Non vérifié sur cette table (colonne absente) : {unchecked.map(k => GAP_LABELS[k]).join(", ")}.</li>
          )}
        </ul>
      )}

      {group.rows.length > 0 && (
        <ul className="divide-y divide-white/[0.08] overflow-hidden rounded-xl border border-white/[0.08] bg-dbz-card/80">
          {group.rows.map(r => (
            <RowItem key={`${group.table}-${r.id}`} row={r} />
          ))}
        </ul>
      )}
      {truncated && (
        <p className="text-xs text-white/50">
          {nf.format(group.rows.length)} affichée
          {group.rows.length > 1 ? "s" : ""} sur {nf.format(counts.total)}. {expandLink}
        </p>
      )}

      {masquees && group.hiddenRows.length > 0 && (
        <div className="space-y-2">
          <h3 className="flex flex-wrap items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-dbz-yellow/80">
            <OeilBarre className="h-3.5 w-3.5" />
            Masquées, non publiques
            <span className="font-mono font-normal text-white/45">
              {hiddenTruncated
                ? `${nf.format(group.hiddenRows.length)} sur ${nf.format(counts.hidden)}`
                : nf.format(counts.hidden)}
            </span>
            {hiddenTruncated && !truncated && (
              <span className="font-normal normal-case tracking-normal">{expandLink}</span>
            )}
          </h3>
          <ul className="divide-y divide-white/[0.08] overflow-hidden rounded-xl border border-white/[0.08] bg-dbz-card/80 opacity-80">
            {group.hiddenRows.map(r => (
              <RowItem key={`${group.table}-masquee-${r.id}`} row={r} />
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

export default async function WikiTodoPage({ searchParams }: { searchParams: SearchParams }) {
  const params = await searchParams;
  const masquees = one(params.masquees) === "1";
  const tout = one(params.tout);
  const { groups, totals } = await listIncompleteContent({
    perTable: PER_TABLE,
    includeHidden: masquees,
    expand: tout,
  });
  const visibleGroups = groups.filter(g => g.counts.total > 0 || (masquees && g.counts.hidden > 0));
  const hiddenGroups = groups.filter(g => g.counts.hidden > 0);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/admin/wiki" className="btn btn-ghost">
          <FlecheGauche className="h-4 w-4" />
          <span className="sr-only">Retour au wiki</span>
        </Link>
        <div className="flex-1">
          <h1 className="flex items-center gap-2 font-saiyan text-3xl uppercase text-dbz-orange">
            <Presse className="h-6 w-6" />
            Fiches à compléter
          </h1>
          <p className="mt-1 text-sm text-white/50">
            Les fiches publiées dont l'image, le texte ou le nom japonais manque encore. Clique pour ouvrir la fiche
            dans son éditeur et la compléter.
          </p>
        </div>
      </div>

      <StatTiles
        items={[
          {
            label: "Fiches publiques à compléter",
            value: totals.total,
            hint: "comptes réels",
          },
          { label: "Sans image", value: totals.image },
          { label: "Sans texte", value: totals.desc },
          { label: "Sans japonais", value: totals.ja },
        ]}
      />

      {totals.hidden > 0 && (
        <div className="rounded-xl border border-white/[0.08] bg-dbz-card/80 p-4 text-sm">
          <div className="flex flex-wrap items-start gap-3">
            <OeilBarre className="mt-0.5 h-4 w-4 shrink-0 text-dbz-yellow/80" />
            <div className="min-w-0 flex-1 space-y-2">
              <p className="text-white/70">
                <span className="font-bold tabular-nums text-dbz-yellow">{nf.format(totals.hidden)}</span>{" "}
                <strong>{hiddenLabel(totals.hidden)}</strong> {totals.hidden > 1 ? "ont" : "a"} aussi des manques.{" "}
                {masquees
                  ? "Elles sont listées sous chaque rubrique, à part des fiches publiques."
                  : "Elles ne sont pas listées : les compléter ne change rien au site tant qu'elles restent masquées."}
              </p>
              <p className="text-xs text-white/45">
                {hiddenGroups.map(g => `${tableLabel(g.table)} ${nf.format(g.counts.hidden)}`).join(" · ")}
              </p>
            </div>
            <Link
              href={todoHref({ masquees: !masquees, tout })}
              className="shrink-0 rounded-xl border border-white/[0.08] px-3 py-1.5 text-xs font-bold uppercase tracking-wider text-white/70 transition-colors hover:border-dbz-orange/60 hover:text-dbz-orange"
            >
              {masquees ? "Ne plus les lister" : "Les lister"}
            </Link>
          </div>
        </div>
      )}

      {totals.total === 0 && (
        <div className="card py-16 text-center">
          <CocheCercle className="mx-auto mb-3 h-10 w-10 text-green-400" />
          <p className="font-saiyan text-2xl uppercase text-white">Tout est complet</p>
          <p className="mt-1 text-sm text-white/50">
            Chaque fiche publiée possède son image, son texte et son nom japonais.
          </p>
        </div>
      )}

      {visibleGroups.length > 0 && (
        <>
          <nav aria-label="Rubriques à compléter" className="flex flex-wrap gap-1.5">
            {visibleGroups.map(g => (
              <a
                key={g.table}
                href={`#${g.table}`}
                className="inline-flex items-center gap-1.5 rounded-xl border border-white/[0.08] px-2.5 py-1 text-xs text-white/70 transition-colors hover:border-dbz-orange/60 hover:text-dbz-orange"
              >
                {tableLabel(g.table)}
                <span className="font-mono tabular-nums text-dbz-orange">{nf.format(g.counts.total)}</span>
              </a>
            ))}
          </nav>
          {visibleGroups.map(g => (
            <GroupSection key={g.table} group={g} masquees={masquees} tout={tout} />
          ))}
        </>
      )}
    </div>
  );
}
