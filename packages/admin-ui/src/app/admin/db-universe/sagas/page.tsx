import { AdminHeader } from "../_Header";
import { DbAddButton, DbRowActions } from "@aphrody/admin-ui/components/admin/DbCrud";
import { listWikiSnake } from "@/lib/wiki-admin";

export const dynamic = "force-dynamic";

const TABLE = "db_sagas";

type Saga = {
  id: number;
  slug: string;
  name: string;
  name_ja: string | null;
  series: string;
  order_idx: number;
  description: string | null;
};

const SERIES_ORDER = ["DB", "DBZ", "DBGT", "DBS", "DBS_MANGA", "DBS_MOVIE", "DB_DAIMA"];

const SERIES_LABELS: Record<string, string> = {
  DB: "Dragon Ball",
  DBZ: "Dragon Ball Z",
  DBGT: "Dragon Ball GT",
  DBS: "Dragon Ball Super",
  DBS_MANGA: "DBS Manga",
  DBS_MOVIE: "DBS Films",
  DB_DAIMA: "Dragon Ball Daima",
};

export default async function AdminSagasPage() {
  const sagas = (await listWikiSnake("db_sagas")) as Saga[];

  const byseries = SERIES_ORDER.map(s => ({
    series: s,
    label: SERIES_LABELS[s] ?? s,
    items: sagas.filter(sg => sg.series === s).toSorted((a, b) => a.order_idx - b.order_idx),
  })).filter(g => g.items.length > 0);

  return (
    <div className="w-full max-w-6xl mx-auto">
      <AdminHeader
        title="Sagas"
        subtitle={
          sagas.length > 0
            ? `${sagas.length} saga${sagas.length > 1 ? "s" : ""} · ${byseries.length} série${byseries.length > 1 ? "s" : ""}`
            : undefined
        }
      />

      <p className="text-sm text-white/50 mb-6">
        Les sagas regroupent les grands arcs narratifs de chaque série Dragon Ball. L&apos;ordre d&apos;affichage
        correspond à l&apos;ordre chronologique de diffusion.
      </p>

      <div className="flex justify-end mb-6">
        <DbAddButton table={TABLE} label="Ajouter une saga" />
      </div>

      {sagas.length === 0 ? (
        <div className="dbz-panel p-12 text-center">
          <p className="font-saiyan text-xl uppercase text-white/50 mb-1">Aucune saga enregistrée</p>
          <p className="text-white/50 text-sm">Les sagas s&apos;affichent ici une fois importées.</p>
        </div>
      ) : (
        byseries.map(g => (
          <section key={g.series} className="mb-10">
            <h2 className="font-saiyan text-2xl text-dbz-yellow uppercase mb-3 border-b-2 border-dbz-yellow/30 pb-2">
              {g.label}{" "}
              <span className="text-white/50 text-sm font-sans normal-case">
                {g.items.length} saga{g.items.length > 1 ? "s" : ""}
              </span>
            </h2>
            <table className="w-full">
              <thead>
                <tr className="border-b border-dbz-border/40">
                  <th className="p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light w-12">Ordre</th>
                  <th className="p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light">Nom</th>
                  <th className="p-2 text-left text-xs uppercase tracking-widest text-dbz-blue-light w-28">
                    Nom japonais
                  </th>
                  <th className="p-2 text-right text-xs uppercase tracking-widest text-dbz-blue-light w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {g.items.map(s => (
                  <tr key={s.id} className="border-b border-dbz-border/30 hover:bg-dbz-blue-light/5 transition-colors">
                    <td className="p-2 font-mono text-xs text-dbz-orange tabular-nums">{s.order_idx}</td>
                    <td className="p-2">
                      <div className="text-sm text-white font-medium">{s.name}</div>
                      {s.description && (
                        <div className="text-[11px] text-white/55 mt-0.5 line-clamp-2">{s.description}</div>
                      )}
                      <div className="text-[10px] text-white/25 font-mono mt-0.5">{s.slug}</div>
                    </td>
                    <td className="p-2 font-jp text-sm text-dbz-yellow/85">
                      {s.name_ja ?? <span className="text-white/20">—</span>}
                    </td>
                    <td className="p-2">
                      <DbRowActions table={TABLE} id={s.id} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ))
      )}
    </div>
  );
}
