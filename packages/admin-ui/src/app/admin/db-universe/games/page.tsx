import { assetCdnUrl } from "../_lib";
import { AdminHeader } from "../_Header";
import { DbAddButton, DbRowActions } from "@aphrody/admin-ui/components/admin/DbCrud";
import { listWikiSnake } from "@/lib/wiki-admin";
import Image from "next/image";

export const dynamic = "force-dynamic";

const TABLE = "db_games";

type Game = {
  id: number;
  slug: string;
  title: string;
  title_ja: string | null;
  platforms: string | null;
  release_date: number | null;
  developer: string | null;
  publisher: string | null;
  official_url: string | null;
  cover: string | null;
};

export default async function AdminGamesPage() {
  const games = (await listWikiSnake("db_games")) as Game[];

  return (
    <div className="w-full max-w-6xl mx-auto">
      <AdminHeader
        title="Jeux vidéo"
        subtitle={
          games.length > 0
            ? `${games.length} jeu${games.length > 1 ? "x" : ""} catalogué${games.length > 1 ? "s" : ""}`
            : undefined
        }
      />

      <p className="text-sm text-white/50 mb-6">
        Catalogue des jeux vidéo Dragon Ball. Chaque fiche inclut les plateformes, la date de sortie
        et le studio de développement.
      </p>

      <div className="flex justify-end mb-6">
        <DbAddButton table={TABLE} label="Ajouter un jeu" />
      </div>

      {games.length === 0 ? (
        <div className="dbz-panel p-12 text-center">
          <p className="font-saiyan text-xl uppercase text-white/50 mb-1">Aucun jeu enregistré</p>
          <p className="text-white/50 text-sm">Les jeux s&apos;affichent ici une fois importés.</p>
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="border-b-2 border-dbz-border/60">
                <th className="p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light w-14">
                  Cover
                </th>
                <th className="p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light">
                  Titre
                </th>
                <th className="p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light w-48">
                  Plateformes
                </th>
                <th className="p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light w-24">
                  Sortie
                </th>
                <th className="p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light w-32">
                  Studio
                </th>
                <th className="p-2 text-right text-xs uppercase tracking-widest text-dbz-blue-light w-20">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {games.map((g) => {
                const coverUrl = g.cover
                  ? /^https?:\/\//.test(g.cover)
                    ? g.cover
                    : assetCdnUrl(g.cover)
                  : null;
                return (
                  <tr
                    key={g.id}
                    className="border-b border-dbz-border/30 hover:bg-dbz-blue-light/5 transition-colors"
                  >
                    <td className="p-2">
                      {coverUrl ? (
                        <a
                          href={coverUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="block"
                        >
                          <Image
                            src={coverUrl}
                            alt={g.title}
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
                      <div className="text-sm text-white font-medium">{g.title}</div>
                      {g.title_ja && (
                        <div className="font-jp text-xs text-dbz-yellow/75 mt-0.5">
                          {g.title_ja}
                        </div>
                      )}
                      {g.official_url && (
                        <a
                          href={g.official_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-dbz-orange hover:underline"
                        >
                          Site officiel
                        </a>
                      )}
                      <div className="text-[10px] text-white/50 font-mono mt-0.5">{g.slug}</div>
                    </td>
                    <td className="p-2">
                      <div className="flex flex-wrap gap-1">
                        {(g.platforms ?? "")
                          .split(",")
                          .map((p) => p.trim())
                          .filter(Boolean)
                          .map((p) => (
                            <span
                              key={p}
                              className="text-[10px] font-mono px-1.5 py-0.5 bg-dbz-orange/15 text-dbz-orange uppercase"
                            >
                              {p}
                            </span>
                          ))}
                      </div>
                    </td>
                    <td className="p-2 text-[11px] text-white/55">
                      {g.release_date
                        ? new Date(g.release_date * 1000).toLocaleDateString("fr-FR")
                        : "—"}
                    </td>
                    <td className="p-2 text-xs text-white/70">{g.developer ?? "—"}</td>
                    <td className="p-2">
                      <DbRowActions table={TABLE} id={g.id} />
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
