import { assetCdnUrl } from "../_lib";
import { AdminHeader } from "../_Header";
import { DbAddButton, DbRowActions } from "@aphrody/admin-ui/components/admin/DbCrud";
import { listWikiSnake } from "@/lib/wiki-admin";
import Image from "next/image";

const TABLE = "db_movies";

export const dynamic = "force-dynamic";

type Movie = {
  id: number;
  slug: string;
  title: string;
  title_ja: string | null;
  series: string;
  release_date: number | null;
  duration_min: number | null;
  poster: string | null;
  mal_id: number | null;
};

export default async function AdminFilmsPage() {
  const movies = ((await listWikiSnake("db_movies")) as Movie[]).toSorted(
    (a, b) => (a.release_date ?? 0) - (b.release_date ?? 0),
  );

  return (
    <div className="w-full max-w-6xl mx-auto">
      <AdminHeader
        title="Films"
        subtitle={
          movies.length > 0
            ? `${movies.length} long-métrage${movies.length > 1 ? "s" : ""} catalogué${movies.length > 1 ? "s" : ""} via Jikan`
            : undefined
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <p className="text-sm text-white/50 max-w-2xl">
          Liste de tous les films Dragon Ball. Modifiez ou supprimez une fiche via les actions à
          droite de chaque ligne, ou ajoutez-en une.
        </p>
        <DbAddButton table={TABLE} label="Ajouter un film" />
      </div>

      {movies.length === 0 ? (
        <div className="dbz-panel p-12 text-center">
          <p className="font-saiyan text-xl uppercase text-white/50 mb-1">Aucun film enregistré</p>
          <p className="text-white/50 text-sm">
            Les films s&apos;affichent ici une fois importés depuis Jikan.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-dbz-border/60">
                <th className="p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light w-14">
                  Affiche
                </th>
                <th className="p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light">
                  Titre
                </th>
                <th className="p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light w-24">
                  Série
                </th>
                <th className="p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light w-24">
                  Sortie
                </th>
                <th className="p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light w-20">
                  Durée
                </th>
                <th className="p-2 text-right text-xs uppercase tracking-widest text-dbz-blue-light w-20">
                  MAL
                </th>
                <th className="p-2 text-right text-xs uppercase tracking-widest text-dbz-blue-light w-20">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {movies.map((m) => {
                const posterUrl = m.poster
                  ? /^https?:\/\//.test(m.poster)
                    ? m.poster
                    : assetCdnUrl(m.poster)
                  : null;
                return (
                  <tr
                    key={m.id}
                    className="border-b border-dbz-border/30 hover:bg-dbz-blue-light/5 transition-colors"
                  >
                    <td className="p-2">
                      {posterUrl ? (
                        <a
                          href={posterUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <Image
                            src={posterUrl}
                            alt={m.title}
                            width={36}
                            height={52}
                            className="rounded object-cover border border-dbz-border"
                            unoptimized
                          />
                        </a>
                      ) : (
                        <div className="w-9 h-[52px] rounded bg-dbz-border/30 flex items-center justify-center text-[9px] text-white/25 uppercase">
                          n/a
                        </div>
                      )}
                    </td>
                    <td className="p-2">
                      <div className="text-sm text-white font-medium">{m.title}</div>
                      {m.title_ja && (
                        <div className="font-jp text-xs text-dbz-yellow/75 mt-0.5">
                          {m.title_ja}
                        </div>
                      )}
                      <div className="text-[10px] text-white/50 font-mono mt-0.5">{m.slug}</div>
                    </td>
                    <td className="p-2 font-mono text-xs text-dbz-orange">{m.series}</td>
                    <td className="p-2 text-[11px] text-white/55">
                      {m.release_date
                        ? new Date(m.release_date * 1000).toLocaleDateString("fr-FR")
                        : "—"}
                    </td>
                    <td className="p-2 text-xs text-white/70">
                      {m.duration_min ? `${m.duration_min} min` : "—"}
                    </td>
                    <td className="p-2 text-right">
                      {m.mal_id ? (
                        <a
                          href={`https://myanimelist.net/anime/${m.mal_id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] font-mono text-dbz-blue-light/70 hover:text-dbz-orange"
                        >
                          #{m.mal_id}
                        </a>
                      ) : (
                        <span className="text-[10px] text-white/25">—</span>
                      )}
                    </td>
                    <td className="p-2">
                      <DbRowActions table={TABLE} id={m.id} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
