/**
 * StaffRoutes — le catalogue des routes du bot, dans la page d'administration
 * `/api-docs`.
 *
 * Plus d'îlot client ni de garde `useMe()` : la page entière est réservée aux
 * administrateurs depuis qu'elle a cessé d'être publique (2026-09-12). Un
 * composant serveur suffit, et n'envoie aucun JavaScript.
 *
 * Ce n'est pas un contrôle d'accès : les routes listées sont protégées par leur
 * propre jeton côté bot.
 */
import Link from "next/link";
import { ADMIN_ROUTES, PUBLIC_ROUTES } from "./_bot-routes";

type Route = { method: string; path: string; desc: string };

function RouteTable({ rows, tone }: { rows: readonly Route[]; tone: "public" | "admin" }) {
  return (
    <div className="overflow-x-auto border-2 border-black bg-dbz-card/60">
      <table className="w-full min-w-[680px] border-collapse text-[0.8125rem]">
        <thead>
          <tr className="border-b-2 border-white/15 text-left font-display text-[0.625rem] uppercase tracking-[0.1em] text-white/45">
            <th className="w-28 p-2.5">Méthode</th>
            <th className="p-2.5">Chemin</th>
            <th className="p-2.5">Description</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.method}-${r.path}`} className="border-b border-white/[0.06]">
              <td className="p-2.5 align-top">
                <span
                  className={`border-2 px-1.5 py-0.5 font-mono text-[0.625rem] font-bold ${
                    tone === "public"
                      ? "border-emerald-400/60 text-emerald-300"
                      : "border-red-400/60 text-red-300"
                  }`}
                >
                  {r.method}
                </span>
              </td>
              <td className="p-2.5 align-top font-mono text-[0.75rem] text-dbz-orange">{r.path}</td>
              <td className="p-2.5 align-top text-white/60">{r.desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function StaffRoutes() {
  return (
    <section className="border-t-2 border-dbz-orange/40 pt-8">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-display text-[0.6875rem] font-bold uppercase tracking-[0.18em] text-dbz-orange">
            Staff
          </p>
          <h2 className="mt-1.5 font-serif text-[clamp(1.375rem,1.2rem+1vw,1.75rem)] font-semibold text-white">
            API du bot
          </h2>
          <p className="mt-2 max-w-[56ch] text-[0.9375rem] text-white/60">
            Routes servies par <code className="text-dbz-orange">shenron.service</code>. Les
            écritures passent par le proxy server-only{" "}
            <code className="text-dbz-orange">/api/bot-admin</code> : aucun jeton ne doit atteindre
            le navigateur.
          </p>
        </div>
        <Link href="/admin/agents" className="toriyama-btn-secondary !text-[0.75rem]">
          Gérer les clés d&apos;agent
        </Link>
      </header>

      <h3 className="mt-8 font-display text-[0.9375rem] font-bold text-emerald-300">
        Routes publiques du bot ({PUBLIC_ROUTES.length})
      </h3>
      <p className="mb-3 mt-1 text-[0.8125rem] text-white/45">
        CORS ouvert · 60 req/min/IP · cache 30 s à 1 h selon l&apos;endpoint · sans jeton.
      </p>
      <RouteTable rows={PUBLIC_ROUTES} tone="public" />

      <h3 className="mt-8 font-display text-[0.9375rem] font-bold text-red-300">
        Routes d&apos;administration ({ADMIN_ROUTES.length}+)
      </h3>
      <p className="mb-3 mt-1 text-[0.8125rem] text-white/45">
        <code className="text-dbz-orange">Authorization: Bearer $API_ADMIN_TOKEN</code> — ou le
        proxy site si <strong>roleAdmin</strong>.
      </p>
      <RouteTable rows={ADMIN_ROUTES} tone="admin" />
    </section>
  );
}
