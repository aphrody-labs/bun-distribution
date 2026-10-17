import { countEpisodesBySeries, listEpisodesBySeries } from "@/lib/wiki-admin";
import { AdminHeader } from "../_Header";
import { DbAddButton, DbRowActions } from "@aphrody/admin-ui/components/admin/DbCrud";
import Link from "next/link";

export const dynamic = "force-dynamic";

const TABLE = "db_episodes";

const SERIES = ["DB", "DBZ", "DBZ_KAI", "DBZ_KAI_FINAL", "DBGT", "DBS", "DB_DAIMA"];

const SERIES_LABELS: Record<string, string> = {
  DB: "Dragon Ball",
  DBZ: "Dragon Ball Z",
  DBZ_KAI: "DBZ Kai",
  DBZ_KAI_FINAL: "DBZ Kai Final",
  DBGT: "Dragon Ball GT",
  DBS: "Dragon Ball Super",
  DB_DAIMA: "DB Daima",
};

type Episode = {
  id: number;
  series: string;
  number_in_series: number;
  title: string;
  title_ja: string | null;
  air_date: number | null;
  mal_id: number | null;
};

export default async function AdminEpisodesPage({ searchParams }: { searchParams: Promise<{ series?: string }> }) {
  const sp = await searchParams;
  const series = sp.series ?? "DBZ";
  const [eps, total] = await Promise.all([
    listEpisodesBySeries(series, 500) as Promise<Episode[]>,
    countEpisodesBySeries(series),
  ]);

  return (
    <div className="w-full max-w-6xl mx-auto">
      <AdminHeader
        title="Épisodes"
        subtitle={
          total > 0
            ? `${SERIES_LABELS[series] ?? series} · ${total} épisode${total > 1 ? "s" : ""}`
            : (SERIES_LABELS[series] ?? series)
        }
      />

      <p className="text-sm text-white/50 mb-5">
        Consultez la liste des épisodes par série. Sélectionnez une série ci-dessous pour filtrer l&apos;affichage. Le
        numéro MAL renvoie vers la fiche MyAnimeList de l&apos;anime.
      </p>

      <div className="flex justify-end mb-4">
        <DbAddButton table={TABLE} label="Ajouter un épisode" />
      </div>

      {/* Filtre séries */}
      <nav className="mb-6 flex flex-wrap gap-2" aria-label="Choisir une série">
        {SERIES.map(s => (
          <Link
            key={s}
            href={`/admin/db-universe/episodes?series=${s}`}
            className={`px-3 py-1.5 border-2 font-saiyan tracking-widest text-xs uppercase transition-colors ${
              s === series
                ? "border-dbz-orange bg-dbz-orange/15 text-dbz-orange"
                : "border-dbz-blue-light/30 text-white/70 hover:border-dbz-orange/60 hover:text-white"
            }`}
          >
            {SERIES_LABELS[s] ?? s}
          </Link>
        ))}
      </nav>

      {eps.length === 0 ? (
        <div className="dbz-panel p-12 text-center">
          <p className="font-saiyan text-xl uppercase text-white/50 mb-1">Aucun épisode pour cette série</p>
          <p className="text-white/50 text-sm">
            Les épisodes de <strong className="text-white/60">{SERIES_LABELS[series] ?? series}</strong> n&apos;ont pas
            encore été importés.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-dbz-border/60">
                <th className="p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light w-16">N°</th>
                <th className="p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light">Titre</th>
                <th className="p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light w-32">Diffusion</th>
                <th className="p-2 text-right text-xs uppercase tracking-widest text-dbz-blue-light w-20">MAL</th>
                <th className="p-2 text-right text-xs uppercase tracking-widest text-dbz-blue-light w-20">Actions</th>
              </tr>
            </thead>
            <tbody>
              {eps.map(ep => (
                <tr key={ep.id} className="border-b border-dbz-border/30 hover:bg-dbz-blue-light/5 transition-colors">
                  <td className="p-2 font-mono text-xs text-dbz-orange tabular-nums">
                    {String(ep.number_in_series).padStart(3, "0")}
                  </td>
                  <td className="p-2">
                    <div className="text-sm text-white">{ep.title}</div>
                    {ep.title_ja && <div className="font-jp text-xs text-dbz-yellow/75 mt-0.5">{ep.title_ja}</div>}
                  </td>
                  <td className="p-2 text-[11px] text-white/55">
                    {ep.air_date ? new Date(ep.air_date * 1000).toLocaleDateString("fr-FR") : "—"}
                  </td>
                  <td className="p-2 text-right">
                    {ep.mal_id ? (
                      <a
                        href={`https://myanimelist.net/anime/${ep.mal_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] font-mono text-dbz-blue-light/70 hover:text-dbz-orange"
                      >
                        #{ep.mal_id}
                      </a>
                    ) : (
                      <span className="text-[10px] text-white/25">—</span>
                    )}
                  </td>
                  <td className="p-2">
                    <DbRowActions table={TABLE} id={ep.id} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Note de pagination */}
      {eps.length === 500 && total > 500 && (
        <p className="mt-4 text-center text-xs text-white/50">
          Affichage limité à 500 épisodes. {total - 500} épisode
          {total - 500 > 1 ? "s" : ""} supplémentaire
          {total - 500 > 1 ? "s" : ""} non affiché{total - 500 > 1 ? "s" : ""}.
        </p>
      )}
    </div>
  );
}
