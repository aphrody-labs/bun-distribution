/**
 * /admin/api-docs — documentation technique **interne**.
 *
 * Elle a été publique quelques heures le 2026-09-12, le temps d'un aller-retour
 * de décision, sous `/api-docs`. Elle décrit le fonctionnement interne du site —
 * clés d'écriture, portées, agents automatiques, routes du bot : rien de tout cela
 * n'intéresse un lecteur venu pour Dragon Ball, et l'exposer revient à publier la
 * carte de la salle des machines (règle 17). Les intégrations se demandent par le
 * formulaire de contact ; la clé et la documentation arrivent ensuite, en privé.
 *
 * **Pourquoi sous `/admin` et non un `notFound()` sur la route publique** : mesuré
 * en production le 2026-09-12, un garde appelé dans le composant rendait la page
 * `not-found` avec un statut **200** — la coquille du layout est déjà envoyée
 * quand la session est résolue, et Next ne peut plus changer le code de retour.
 * Ici le layout `/admin` tranche avant tout rendu (`requireAdmin()`), et la route
 * publique n'existe tout simplement plus : le 404 vient du routeur.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { PageShell, SectionHeading, Stack, Chip, ChipRow } from "@/components/kit";
import { Breadcrumbs } from "@/components/Breadcrumbs";
import { AGENT_SCOPES } from "@/db/schema";
import { SCOPE_DESCRIPTIONS, AGENT_API_VERSION } from "@/lib/agent-openapi";
import { SITE_URL } from "@/lib/config";
import { StaffRoutes } from "./StaffRoutes";

export const metadata: Metadata = {
  title: "API & agents",
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Endpoints de lecture ouverts — aucun jeton, aucune inscription.
 *
 * `mcp.dragonballfr.com` a été retiré le 2026-09-25 (shenron-mcp fusionné dans
 * les outils `aphrody-mcp` dragonball.*, sans équivalent HTTP public — voir
 * yolo `config/host/nginx/routes.json` et `config/service-catalog.json`.
 * Ne pas le remettre ici : ce n'est plus joignable.
 */
const OPEN_READ = [
  { path: "/api/agent/v1/openapi.json", desc: "Schéma OpenAPI 3.1 de l'API agents." },
  {
    path: "/llms.txt",
    desc: "Carte du site et règles éditoriales, au format attendu par les agents.",
  },
  { path: "/api/canon", desc: "Doctrine canon, corpus de preuves et verdicts." },
  { path: "/api/search?q=", desc: "Recherche transversale du wiki." },
  { path: "/api/databooks", desc: "Databooks, planches et transcriptions." },
  { path: "/news/rss.xml", desc: "Flux RSS des articles publiés." },
  { path: "/sitemap.xml", desc: "Toutes les URL publiques, dérivées du registre d'accès." },
];

/** Les trois gestes d'un agent, dans l'ordre où il les apprend. */
const EXAMPLES = [
  {
    title: "1. Vérifier sa clé et ses portées",
    code: `curl -s ${SITE_URL}/api/agent/v1/whoami \\
  -H "Authorization: Bearer $DBFR_AGENT_TOKEN"`,
  },
  {
    title: "2. Découvrir les cibles contributives du wiki",
    code: `curl -s ${SITE_URL}/api/agent/v1/wiki/contribution-schema \\
  -H "Authorization: Bearer $DBFR_AGENT_TOKEN"`,
  },
  {
    title: "3. Résoudre la fiche à corriger",
    code: `curl -s '${SITE_URL}/api/agent/v1/wiki/entities?table=db_characters&q=goku' \\
  -H "Authorization: Bearer $DBFR_AGENT_TOKEN"`,
  },
  {
    title: "4. Proposer une correction du wiki (rien n'est écrit sans relecture)",
    code: `curl -s -X POST ${SITE_URL}/api/agent/v1/wiki/contributions \\
  -H "Authorization: Bearer $DBFR_AGENT_TOKEN" \\
  -H "content-type: application/json" \\
  -d '{
    "table": "db_characters",
    "rowId": 42,
    "column": "article",
    "valueAfter": "Texte corrigé…",
    "sources": "Daizenshuu 7, p. 34"
  }'`,
  },
  {
    title: "5. Déposer un brouillon d'article",
    code: `curl -s -X POST ${SITE_URL}/api/agent/v1/articles \\
  -H "Authorization: Bearer $DBFR_AGENT_TOKEN" \\
  -H "content-type: application/json" \\
  -d '{
    "title": "Daima : ce que révèle l'"'"'épisode 12",
    "markdown": "## Ce qu'"'"'on apprend\\n\\nTexte…",
    "tags": ["Daima"],
    "status": "draft"
  }'`,
  },
];

export default function ApiDocsPage() {
  return (
    <PageShell rhythm="loose">
      <Breadcrumbs className="mb-8" items={[{ label: "API & agents" }]} />

      <SectionHeading
        level={1}
        kicker={`API agents · v${AGENT_API_VERSION}`}
        title="Brancher un agent sur le site"
        standfirst="Le site est conçu pour être alimenté par des humains comme par des agents. La lecture est ouverte ; l'écriture passe par une clé à portées explicites, et tout ce qui touche au wiki entre dans une file de relecture humaine."
        actions={
          <>
            <Link href="/api/agent/v1/openapi.json" className="toriyama-btn !text-[0.75rem]">
              Schéma OpenAPI
            </Link>
            <Link href="/llms.txt" className="toriyama-btn-secondary !text-[0.75rem]">
              llms.txt
            </Link>
          </>
        }
      />

      <Stack className="mt-12">
        {/* ---- Règles ---------------------------------------------------- */}
        <section>
          <SectionHeading
            title="Les règles, avant les endpoints"
            standfirst="Elles ne sont pas décoratives : une proposition qui les ignore est refusée en relecture."
          />
          <ul className="mt-6 space-y-3 text-[0.9375rem] leading-relaxed text-white/70">
            <li className="border-l-2 border-dbz-orange/60 pl-4">
              <strong className="text-white">Ne jamais inventer une donnée éditoriale.</strong> Un
              champ vide vaut mieux qu&apos;une valeur plausible. C&apos;est la règle la plus
              souvent violée par une IA, et celle qui coûte le plus cher à réparer.
            </li>
            <li className="border-l-2 border-white/15 pl-4">
              <strong className="text-white">Citer sa source</strong> : tome et planche, databook et
              page, interview datée. Les wikis tiers ne sont pas une source.
            </li>
            <li className="border-l-2 border-white/15 pl-4">
              <strong className="text-white">Un agent propose, un humain tranche.</strong> Les
              corrections du wiki entrent dans la file de modération ; les articles sont des
              brouillons, sauf portée <code className="text-dbz-orange">publish:articles</code>.
            </li>
            <li className="border-l-2 border-white/15 pl-4">
              <strong className="text-white">Les écritures sont signées.</strong> Le nom de la clé
              apparaît publiquement à côté des commentaires et sur les brouillons. Aucun agent ne se
              fait passer pour un membre.
            </li>
          </ul>
        </section>

        {/* ---- Portées ---------------------------------------------------- */}
        <section>
          <SectionHeading
            title="Portées"
            standfirst="Une clé ne donne que ce qui a été coché. Demande le minimum : une clé d'ingest qui fuite ne doit pas pouvoir publier."
          />
          <dl className="mt-6 grid gap-3 sm:grid-cols-2">
            {AGENT_SCOPES.map((scope) => (
              <div key={scope} className="border border-white/[0.08] bg-dbz-card/80 p-4">
                <dt>
                  <code className="font-mono text-[0.875rem] text-dbz-orange">{scope}</code>
                </dt>
                <dd className="mt-1.5 text-[0.875rem] leading-relaxed text-white/60">
                  {SCOPE_DESCRIPTIONS[scope]}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-5 text-[0.875rem] text-white/55">
            Les clés sont créées par le staff depuis l&apos;espace d&apos;administration. Le jeton
            n&apos;est affiché qu&apos;une fois : seul son hachage SHA-256 est conservé.{" "}
            <Link
              href="/credits#contact"
              className="text-dbz-orange underline-offset-4 hover:underline"
            >
              Demander une clé
            </Link>
            .
          </p>
        </section>

        {/* ---- Exemples --------------------------------------------------- */}
        <section>
          <SectionHeading
            title="Les trois premiers appels"
            standfirst="Authentification par en-tête Bearer. Réponse toujours de la même forme : { ok, data } ou { ok: false, error, message }."
          />
          <div className="mt-6 space-y-5">
            {EXAMPLES.map((ex) => (
              <div key={ex.title}>
                <h3 className="font-display text-[0.9375rem] font-bold text-white">{ex.title}</h3>
                <pre className="mt-2 overflow-x-auto border-2 border-black bg-black/50 p-4 font-mono text-[0.8125rem] leading-relaxed text-white/80">
                  <code>{ex.code}</code>
                </pre>
              </div>
            ))}
          </div>
        </section>

        {/* ---- Lecture ouverte -------------------------------------------- */}
        <section>
          <SectionHeading
            title="Lecture ouverte, sans clé"
            standfirst="Tout ce qui est public sur le site est lisible par machine. Aucune inscription, aucun jeton."
          />
          <ul className="mt-6 divide-y divide-white/[0.08] border border-white/[0.08] bg-dbz-card/60">
            {OPEN_READ.map((row) => (
              <li
                key={row.path}
                className="flex flex-col gap-1 p-4 sm:flex-row sm:items-baseline sm:gap-4"
              >
                <code className="shrink-0 font-mono text-[0.8125rem] text-dbz-orange">
                  {row.path}
                </code>
                <span className="text-[0.875rem] leading-relaxed text-white/60">{row.desc}</span>
              </li>
            ))}
          </ul>
          <ChipRow className="mt-5">
            <Chip href="/plan-du-site">Plan du site</Chip>
            <Chip href="/news/fil">Fil d&apos;actualité</Chip>
            <Chip href="/wiki/contribuer">Contribuer (humain)</Chip>
          </ChipRow>
        </section>

        {/* ---- Quotas et erreurs ------------------------------------------ */}
        <section>
          <SectionHeading
            title="Quotas et erreurs"
            standfirst="Les lectures ne sont pas comptées ; les écritures le sont, par clé et par heure."
          />
          <div className="mt-6 overflow-x-auto">
            <table className="w-full min-w-[520px] border-collapse text-[0.875rem]">
              <thead>
                <tr className="border-b-2 border-white/15 text-left font-display text-[0.6875rem] uppercase tracking-[0.1em] text-white/45">
                  <th className="py-2 pr-4">Code</th>
                  <th className="py-2 pr-4">HTTP</th>
                  <th className="py-2">Ce qu&apos;il faut faire</th>
                </tr>
              </thead>
              <tbody className="text-white/70">
                {[
                  [
                    "auth_required",
                    "401",
                    "Vérifier l'en-tête Authorization et que la clé n'est pas révoquée.",
                  ],
                  ["scope_missing", "403", "Demander la portée manquante — le message la nomme."],
                  [
                    "rate_limited",
                    "429",
                    "Attendre la fin de l'heure glissante ; GET /whoami donne le reste.",
                  ],
                  ["bad_request", "400", "Lire `message` : il dit le champ fautif."],
                  ["not_found", "404", "La cible n'existe pas ou n'est pas publique."],
                  [
                    "server_error",
                    "500",
                    "Réessayer plus tard ; l'appel est journalisé côté site.",
                  ],
                ].map(([code, http, todo]) => (
                  <tr key={code} className="border-b border-white/[0.06]">
                    <td className="py-2 pr-4">
                      <code className="font-mono text-[0.8125rem] text-dbz-orange">{code}</code>
                    </td>
                    <td className="py-2 pr-4 tabular-nums">{http}</td>
                    <td className="py-2">{todo}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* ---- Staff ------------------------------------------------------ */}
        <StaffRoutes />
      </Stack>
    </PageShell>
  );
}
