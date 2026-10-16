/**
 * /admin/agents — les clés d'accès des agents et le journal de leurs écritures.
 *
 * Pourquoi cet écran existe : le site doit pouvoir être alimenté par des agents
 * (ingest, traduction, rédaction assistée, MCP d'un tiers) sans leur confier
 * `SHENRON_ADMIN_TOKEN`, qui ouvre TOUT — Discord, économie, synchronisation. Une
 * clé d'agent porte des portées explicites, se révoque seule, et chacune de ses
 * écritures est journalisée ici.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { AGENT_SCOPES } from "@/db/schema";
import { listAgentAudit, listAgentKeys } from "@/lib/agent-keys";
import { SCOPE_DESCRIPTIONS } from "@/lib/agent-openapi";
import { AgentKeysManager } from "./AgentKeysManager";
import { AgentsLoadFailure } from "./AgentsLoadFailure";
import { loadSource } from "./agents-load";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Agents & API" };

const dateFormat = new Intl.DateTimeFormat("fr-FR", {
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export default async function AdminAgentsPage() {
  // Une lecture qui échoue n'est pas une liste vide : chaque source garde son état réel.
  const [keys, audit] = await Promise.all([
    loadSource("clés", listAgentKeys),
    loadSource("journal", () => listAgentAudit(60)),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl space-y-8">
      <header className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-[28px] font-bold tracking-tight text-white">
            Agents &amp; API
          </h1>
          <p className="mt-1 max-w-[60ch] text-[14px] text-white/50">
            Clés d&apos;accès des agents à l&apos;API d&apos;écriture. Une clé
            ne donne que ce qu&apos;on lui coche : proposer une correction,
            commenter, rédiger un brouillon. Publier est une portée distincte.
          </p>
        </div>
        <div className="flex flex-col items-start gap-1.5 sm:items-end">
          <Link
            href="/admin/api-docs"
            className="text-[13px] text-white/55 underline-offset-4 hover:text-white hover:underline"
          >
            Documentation interne ↗
          </Link>
          <Link
            href="/api/agent/v1/openapi.json"
            className="text-[13px] text-white/55 underline-offset-4 hover:text-white hover:underline"
          >
            Schéma OpenAPI ↗
          </Link>
        </div>
      </header>

      {keys.ok ? (
        <AgentKeysManager
          keys={keys.data}
          scopes={AGENT_SCOPES}
          scopeDescriptions={SCOPE_DESCRIPTIONS}
        />
      ) : (
        <AgentsLoadFailure
          title="Clés d'agent indisponibles"
          message="La lecture des clés a échoué : afficher une liste vide laisserait croire qu'aucune clé n'existe, et créer ou révoquer sans voir l'état réel serait risqué. Réessayez ; le détail est dans les journaux du serveur."
          code={keys.code}
        />
      )}

      {/* ---- Journal des appels ------------------------------------------ */}
      <section>
        <h2 className="text-[15px] font-semibold text-white">
          Derniers appels
        </h2>
        <p className="mt-1 text-[13px] text-white/50">
          Chaque appel d&apos;agent est journalisé — y compris les refus (jeton
          invalide, portée manquante, quota atteint). Aucun secret n&apos;y
          figure.
        </p>
        {!audit.ok ? (
          <div className="mt-3">
            <AgentsLoadFailure
              title="Journal indisponible"
              message="La lecture du journal a échoué : l'absence d'appels affichée serait fausse. Réessayez ; le détail est dans les journaux du serveur."
              code={audit.code}
            />
          </div>
        ) : audit.data.length === 0 ? (
          <p className="mt-3 text-[14px] text-white/45">
            Aucun appel pour l&apos;instant.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] border-collapse text-[13px]">
              <thead>
                <tr className="border-b border-white/10 text-left text-[11px] uppercase tracking-wider text-white/40">
                  <th className="py-2 pr-4 font-semibold">Quand</th>
                  <th className="py-2 pr-4 font-semibold">Agent</th>
                  <th className="py-2 pr-4 font-semibold">Requête</th>
                  <th className="py-2 pr-4 font-semibold">Statut</th>
                  <th className="py-2 font-semibold">Effet</th>
                </tr>
              </thead>
              <tbody>
                {audit.data.map((row) => (
                  <tr
                    key={row.id}
                    className="border-b border-white/[0.06] text-white/70"
                  >
                    <td className="whitespace-nowrap py-2 pr-4 tabular-nums text-white/45">
                      {dateFormat.format(new Date(row.createdAt))}
                    </td>
                    <td className="py-2 pr-4">{row.keyName ?? "—"}</td>
                    <td className="py-2 pr-4 font-mono text-[12px]">
                      {row.method} {row.path}
                    </td>
                    <td
                      className={`py-2 pr-4 tabular-nums ${
                        row.status >= 500
                          ? "text-red-400"
                          : row.status >= 400
                            ? "text-amber-300"
                            : "text-emerald-300"
                      }`}
                    >
                      {row.status}
                    </td>
                    <td className="py-2 text-white/55">{row.summary ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
