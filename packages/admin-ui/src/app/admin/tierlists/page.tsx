import Link from "next/link";
import type { Metadata } from "next";
import { requireAdmin } from "@/lib/session";
import {
  listAllTierlistsAdmin,
  type TierlistAdminFilter,
} from "@/lib/tierlists";
import { toggleTierlistFlag, removeTierlist } from "./_actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tier lists" };

const FILTERS: { key: TierlistAdminFilter; label: string }[] = [
  { key: "all", label: "Toutes" },
  { key: "official", label: "Officielles" },
  { key: "community", label: "Communauté" },
  { key: "featured", label: "En avant" },
  { key: "hidden", label: "Masquées" },
];

function isFilter(v: string | undefined): v is TierlistAdminFilter {
  return !!v && FILTERS.some((f) => f.key === v);
}

const dateFmt = (d: Date) =>
  new Date(d).toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

/** Petit bouton-formulaire qui bascule un drapeau de la tier list. */
function FlagButton({
  id,
  flag,
  active,
  on,
  off,
}: {
  id: string;
  flag: "published" | "official" | "featured";
  active: boolean;
  on: string;
  off: string;
}) {
  return (
    <form action={toggleTierlistFlag} className="inline">
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="flag" value={flag} />
      <input type="hidden" name="value" value={(!active).toString()} />
      <button
        type="submit"
        className={`rounded border px-2 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors ${
          active
            ? "border-dbz-orange/60 bg-dbz-orange/15 text-dbz-orange hover:bg-dbz-orange/25"
            : "border-dbz-border text-white/55 hover:border-dbz-blue-light hover:text-dbz-blue-light"
        }`}
        title={active ? off : on}
      >
        {active ? on : off}
      </button>
    </form>
  );
}

export default async function AdminTierlistsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; filter?: string }>;
}) {
  // Gating au niveau page (défense en profondeur) : la requête de modération ne
  // part pas pour un non-admin, même si le layout redirige en parallèle.
  await requireAdmin();
  const sp = await searchParams;
  const filter: TierlistAdminFilter = isFilter(sp.filter) ? sp.filter : "all";
  const q = (sp.q ?? "").trim();
  const { rows, total } = await listAllTierlistsAdmin({
    q,
    filter,
    limit: 200,
  });

  const buildHref = (next: Partial<{ q: string; filter: string }>) => {
    const params = new URLSearchParams();
    const f = next.filter ?? filter;
    const query = next.q ?? q;
    if (f && f !== "all") params.set("filter", f);
    if (query) params.set("q", query);
    const qs = params.toString();
    return qs ? `/admin/tierlists?${qs}` : "/admin/tierlists";
  };

  return (
    <div className="w-full max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-4xl font-saiyan text-dbz-orange">TIER LISTS</h1>
          <p className="text-sm text-white/50 mt-1">
            Modère les tier lists de la communauté, mets-en avant les meilleures
            et crée des tier lists officielles. {total} au total.
          </p>
        </div>
        <Link
          href="/admin/tierlists/new"
          className="dbz-button !text-base shrink-0"
        >
          Tier list officielle
        </Link>
      </div>

      {/* Filtres + recherche */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={buildHref({ filter: f.key })}
              className={`rounded-full border px-3 py-1.5 text-[12px] font-bold uppercase tracking-wider transition-colors ${
                filter === f.key
                  ? "border-dbz-orange bg-dbz-orange/15 text-dbz-orange"
                  : "border-dbz-border text-white/55 hover:border-dbz-blue-light hover:text-dbz-blue-light"
              }`}
            >
              {f.label}
            </Link>
          ))}
        </div>
        <form action="/admin/tierlists" method="get" className="flex gap-2">
          {filter !== "all" && (
            <input type="hidden" name="filter" value={filter} />
          )}
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Rechercher un titre…"
            className="h-9 w-full sm:w-56 rounded border-2 border-dbz-border bg-dbz-bg px-3 text-sm text-white outline-none focus:border-dbz-orange"
          />
          <button type="submit" className="dbz-button !text-sm">
            OK
          </button>
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="dbz-panel p-8 text-center">
          <p className="font-saiyan text-dbz-yellow text-xl mb-2">
            AUCUNE TIER LIST
          </p>
          <p className="text-sm text-white/50">
            {q || filter !== "all"
              ? "Aucun résultat pour ce filtre."
              : "Aucune tier list n'a encore été créée."}
          </p>
        </div>
      ) : (
        <div className="dbz-panel overflow-hidden overflow-x-auto w-full">
          <table className="w-full text-left min-w-[820px]">
            <thead className="bg-dbz-border/50 border-b-2 border-dbz-border">
              <tr className="text-[10px] font-bold uppercase tracking-widest text-dbz-blue-light">
                <th className="p-3">Titre</th>
                <th className="p-3">Auteur</th>
                <th className="p-3 text-center">Cartes</th>
                <th className="p-3 text-center">♥</th>
                <th className="p-3">Date</th>
                <th className="p-3">Curation</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y-2 divide-dbz-border">
              {rows.map((tl) => (
                <tr
                  key={tl.id}
                  className="align-top hover:bg-dbz-blue-light/5 transition-colors"
                >
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      {tl.official && (
                        <span className="rounded bg-dbz-yellow/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-dbz-yellow border border-dbz-yellow/40">
                          Officiel
                        </span>
                      )}
                      {tl.featured && (
                        <span className="rounded bg-dbz-orange/20 px-1.5 py-0.5 text-[9px] font-bold uppercase text-dbz-orange border border-dbz-orange/40">
                          ★
                        </span>
                      )}
                      {!tl.published && (
                        <span className="rounded bg-white/10 px-1.5 py-0.5 text-[9px] font-bold uppercase text-white/50 border border-white/20">
                          Masquée
                        </span>
                      )}
                    </div>
                    <Link
                      href={`/admin/tierlists/${tl.id}`}
                      className="mt-1 block font-bold text-white hover:text-dbz-orange transition-colors"
                    >
                      {tl.title}
                    </Link>
                    {tl.published && (
                      <Link
                        href={`/tierlists/${tl.slug}`}
                        className="text-[11px] text-dbz-blue-light/70 hover:text-dbz-blue-light"
                        target="_blank"
                      >
                        /tierlists/{tl.slug} ↗
                      </Link>
                    )}
                  </td>
                  <td className="p-3 text-sm text-white/70">
                    {tl.authorName ?? "—"}
                  </td>
                  <td className="p-3 text-center text-sm text-white/70">
                    {tl.itemCount}
                  </td>
                  <td className="p-3 text-center text-sm text-white/70">
                    {tl.likeCount}
                  </td>
                  <td className="p-3 text-sm text-gray-400 whitespace-nowrap">
                    {dateFmt(tl.createdAt)}
                  </td>
                  <td className="p-3">
                    <div className="flex flex-wrap gap-1.5">
                      <FlagButton
                        id={tl.id}
                        flag="official"
                        active={tl.official}
                        on="Officiel"
                        off="Officiel"
                      />
                      <FlagButton
                        id={tl.id}
                        flag="featured"
                        active={tl.featured}
                        on="En avant"
                        off="En avant"
                      />
                      <FlagButton
                        id={tl.id}
                        flag="published"
                        active={tl.published}
                        on="Publiée"
                        off="Masquée"
                      />
                    </div>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center justify-end gap-3">
                      <Link
                        href={`/admin/tierlists/${tl.id}`}
                        className="font-saiyan text-xs text-dbz-blue-light hover:text-dbz-yellow uppercase tracking-wider"
                      >
                        Éditer
                      </Link>
                      <form action={removeTierlist}>
                        <input type="hidden" name="id" value={tl.id} />
                        <button
                          type="submit"
                          className="font-saiyan text-xs text-red-400/80 hover:text-red-400 uppercase tracking-wider"
                        >
                          Suppr.
                        </button>
                      </form>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
