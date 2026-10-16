import { AdminHeader } from "../_Header";
import {
  DbAddButton,
  DbRowActions,
} from "@aphrody/admin-ui/components/admin/DbCrud";
import { listSourcesWithLicense } from "@/lib/wiki-admin";

export const dynamic = "force-dynamic";

const TABLE = "db_sources";

type Source = {
  id: string;
  name: string;
  url: string;
  license_key: string;
  attribution_template: string | null;
  license_name: string;
  license_url: string | null;
};

export default async function AdminSourcesPage() {
  const sources = (await listSourcesWithLicense()) as Source[];

  return (
    <div className="w-full max-w-6xl mx-auto">
      <AdminHeader
        title="Sources & attributions"
        subtitle={
          sources.length > 0
            ? `${sources.length} source${sources.length > 1 ? "s" : ""} enregistrée${sources.length > 1 ? "s" : ""}`
            : undefined
        }
      />

      <p className="text-sm text-white/50 mb-6">
        Chaque image ou média de l&apos;encyclopédie est lié à une source et une
        licence. Cette page liste toutes les sources référencées, avec le modèle
        d&apos;attribution à utiliser et la licence applicable.
      </p>

      <div className="flex justify-end mb-6">
        <DbAddButton table={TABLE} label="Ajouter une source" />
      </div>

      {sources.length === 0 ? (
        <div className="dbz-panel p-12 text-center">
          <p className="font-saiyan text-xl uppercase text-white/50 mb-1">
            Aucune source enregistrée
          </p>
          <p className="text-white/50 text-sm">
            Les sources s&apos;affichent ici une fois que des assets ont été
            importés.
          </p>
        </div>
      ) : (
        <div className="dbz-panel overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead className="bg-dbz-border/50 border-b-2 border-dbz-border">
              <tr>
                <th className="p-3 text-left text-xs font-bold uppercase tracking-widest text-dbz-blue-light w-32">
                  Identifiant
                </th>
                <th className="p-3 text-left text-xs font-bold uppercase tracking-widest text-dbz-blue-light">
                  Source
                </th>
                <th className="p-3 text-left text-xs font-bold uppercase tracking-widest text-dbz-blue-light w-40">
                  Licence
                </th>
                <th className="p-3 text-left text-xs font-bold uppercase tracking-widest text-dbz-blue-light">
                  Modèle d&apos;attribution
                </th>
                <th className="p-3 text-right text-xs font-bold uppercase tracking-widest text-dbz-blue-light w-20">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr
                  key={s.id}
                  className="border-b border-dbz-border/40 hover:bg-dbz-blue-light/5 transition-colors"
                >
                  <td className="p-3 align-top">
                    <code className="text-dbz-orange text-xs font-mono">
                      {s.id}
                    </code>
                  </td>
                  <td className="p-3 align-top">
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-white hover:text-dbz-orange font-saiyan text-sm uppercase tracking-wider"
                    >
                      {s.name}
                    </a>
                    <p className="text-[11px] text-white/50 mt-0.5 font-mono truncate max-w-md">
                      {s.url}
                    </p>
                  </td>
                  <td className="p-3 align-top">
                    {s.license_url ? (
                      <a
                        href={s.license_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-dbz-yellow text-xs font-bold uppercase tracking-widest hover:underline"
                      >
                        {s.license_key}
                      </a>
                    ) : (
                      <span className="text-dbz-yellow text-xs font-bold uppercase tracking-widest">
                        {s.license_key}
                      </span>
                    )}
                    <p className="text-[10px] text-white/50 mt-1">
                      {s.license_name}
                    </p>
                  </td>
                  <td className="p-3 align-top text-xs text-white/75">
                    {s.attribution_template ? (
                      <code className="text-white/60 text-[11px] font-mono">
                        {s.attribution_template}
                      </code>
                    ) : (
                      <span className="text-white/25">—</span>
                    )}
                  </td>
                  <td className="p-3 align-top">
                    <DbRowActions table={TABLE} id={s.id} />
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
