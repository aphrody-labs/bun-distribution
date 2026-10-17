import type { MetadataRoute } from "next";

import { getPgPool } from "@/lib/db/pg";
import { SITE_URL } from "@/lib/site-url";

// Le plan de site doit refléter les chroniques publiées, qui changent sans
// redéploiement : régénéré au plus toutes les heures (ISR). Même si le build
// le produisait sans chronique, la première visite après une heure le refait ;
// le servir à la demande faisait une invocation par passage de robot.
export const revalidate = 3600;

// Routes publiques réelles (hors auth/dashboard/admin/profil). Les chemins doivent exister
// — un sitemap qui pointe vers des 404 dégrade le crawl. Priorités/fréquences indicatives.
//
// `/notre-equipe` n'y figure plus : la page a fusionné dans `/community` et ne
// fait que rediriger. Annoncer une redirection dans un plan de site fait
// dépenser du crawl pour rien.
const ROUTES: Array<{
  path: string;
  priority: number;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
}> = [
  { path: "/", priority: 1, changeFrequency: "weekly" },
  { path: "/a-propos", priority: 0.7, changeFrequency: "monthly" },
  { path: "/a-propos/rejoindre-rg", priority: 0.7, changeFrequency: "monthly" },
  { path: "/a-propos/contact", priority: 0.5, changeFrequency: "yearly" },
  { path: "/projets", priority: 0.8, changeFrequency: "weekly" },
  { path: "/projets/nostalgie", priority: 0.7, changeFrequency: "monthly" },
  { path: "/projets/emotes", priority: 0.6, changeFrequency: "monthly" },
  { path: "/projets/muraux", priority: 0.6, changeFrequency: "monthly" },
  { path: "/projets/outils/pfp", priority: 0.6, changeFrequency: "monthly" },
  { path: "/evenements", priority: 0.8, changeFrequency: "weekly" },
  { path: "/news", priority: 0.9, changeFrequency: "daily" },
  { path: "/chroniques", priority: 0.8, changeFrequency: "weekly" },
  { path: "/posts-x", priority: 0.6, changeFrequency: "daily" },
  // Remontée à la racine depuis la fusion d'`apps/azalee` (l'ancien plan de
  // site du wiki l'annonçait sous `/search`, chemin qui n'existe plus).
  { path: "/search", priority: 0.5, changeFrequency: "weekly" },
  { path: "/community", priority: 0.8, changeFrequency: "weekly" },
  { path: "/notre-equipe", priority: 0.8, changeFrequency: "weekly" },
  { path: "/sondages", priority: 0.6, changeFrequency: "weekly" },
  { path: "/iergday", priority: 0.7, changeFrequency: "daily" },
  // Ces quatre pages publiques manquaient : aucune n'était annoncée nulle part.
  { path: "/rose-griffon-tv", priority: 0.7, changeFrequency: "daily" },
  { path: "/emotes-showcase", priority: 0.6, changeFrequency: "monthly" },
  { path: "/epita-map", priority: 0.4, changeFrequency: "yearly" },
  { path: "/design-system", priority: 0.3, changeFrequency: "monthly" },
  { path: "/achillea", priority: 0.8, changeFrequency: "weekly" },
  { path: "/achillea/clans", priority: 0.7, changeFrequency: "daily" },
  { path: "/achillea/casts", priority: 0.6, changeFrequency: "weekly" },
  { path: "/achillea/leagues/astral", priority: 0.7, changeFrequency: "weekly" },
  { path: "/achillea/guide", priority: 0.6, changeFrequency: "monthly" },
  { path: "/achillea/tournaments", priority: 0.8, changeFrequency: "daily" },
  { path: "/achillea/tournaments/circuit/ranking", priority: 0.7, changeFrequency: "daily" },
  { path: "/achillea/ranked", priority: 0.7, changeFrequency: "weekly" },
  { path: "/achillea/ranked/leaderboard", priority: 0.7, changeFrequency: "daily" },
  { path: "/achillea/ranked/tiers", priority: 0.5, changeFrequency: "monthly" },
  { path: "/nous-soutenir", priority: 0.7, changeFrequency: "monthly" },
  { path: "/charte-engagements", priority: 0.4, changeFrequency: "yearly" },
  { path: "/cellule-de-mediation", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/cgu", priority: 0.3, changeFrequency: "yearly" },
  { path: "/legal/confidentialite", priority: 0.3, changeFrequency: "yearly" },
];

type ChroniqueRow = { slug: string; app: string; updated_at: string | null; published_at: string | null };

/**
 * TOUS les articles publiés, chacun sous l'adresse de son corpus : le journal
 * d'Azalée (`app = 'azalee'`) sous `/news/<slug>`, les Chroniques du Bouquet
 * (`app = 'website'`) sous `/chroniques/<slug>`.
 *
 * Lecture Postgres directe (cf. `lib/db/pg.ts`) : le plan de site ne doit pas
 * dépendre de la disponibilité du Data API. Une erreur n'annule pas le plan —
 * on préfère un plan sans les articles à pas de plan du tout.
 */
async function articlesPublies(baseUrl: string): Promise<MetadataRoute.Sitemap> {
  try {
    const pool = getPgPool();
    const { rows } = await pool.query<ChroniqueRow>(
      "SELECT slug, app, updated_at, published_at FROM articles WHERE status = $1 AND app = ANY($2::text[]) ORDER BY published_at DESC NULLS LAST",
      ["published", ["azalee", "website"]],
    );
    return rows
      .filter(row => row.slug)
      .map(row => ({
        url: `${baseUrl}${row.app === "website" ? "/chroniques" : "/news"}/${row.slug}`,
        lastModified: new Date(row.updated_at || row.published_at || Date.now()),
        changeFrequency: "monthly" as const,
        priority: 0.7,
      }));
  } catch (error) {
    console.error("sitemap: lecture des articles impossible", error);
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Host canonique (apex, sans www) : doit correspondre au `metadataBase`
  // (https://rosegriffon.fr) du layout. next.config redirige www → apex en 301,
  // donc émettre des URLs www imposerait un saut de redirection aux crawlers et
  // brouillerait le signal canonique. `SITE_URL` (lib/site-url.ts) applique la
  // même normalisation ; ce fichier, `app/robots.ts` et `app/wiki/sitemap.ts`
  // la recopiaient chacun séparément.
  const baseUrl = SITE_URL;
  const lastModified = new Date();
  return [
    ...ROUTES.map(({ path, priority, changeFrequency }) => ({
      url: `${baseUrl}${path}`,
      lastModified,
      changeFrequency,
      priority,
    })),
    ...(await articlesPublies(baseUrl)),
  ];
}
