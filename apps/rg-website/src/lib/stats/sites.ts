import "server-only";

import { pgQuery } from "@/lib/db/platform";
import { SITE_URL } from "@/lib/site-url";

/**
 * Inventaire de contenu et disponibilité, site par site.
 *
 * L'audience (`audience.ts`) dit combien de monde vient ; ceci dit ce qu'il y a
 * à voir. Les deux réunis font une page de statistiques utile plutôt qu'un
 * compteur de visites.
 *
 * Les chiffres viennent de la connexion Postgres directe : ce sont des
 * agrégats sur des tables que PostgREST n'exposerait pas toutes, et la page
 * doit rester affichable même si l'API REST est en panne — c'est précisément ce
 * qu'on veut diagnostiquer.
 */

export interface MetriqueSite {
  label: string;
  valeur: number | string;
  detail?: string;
}

export interface Site {
  nom: string;
  domaine: string;
  role: string;
  /** `false` = servi par le second VPS : audience collectée par SSH, pas lue en direct. */
  local: boolean;
  statut: { ok: boolean; code: number | null; latenceMs: number | null; erreur?: string };
  metriques: MetriqueSite[];
}

/** Sondes HTTP publiques, en parallèle et avec un plafond de temps court. */
async function sonder(url: string) {
  const debut = Date.now();
  try {
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(4_000) });
    return { code: res.status, latenceMs: Date.now() - debut, ok: res.status < 400 };
  } catch (error) {
    return {
      code: null,
      erreur: error instanceof Error ? error.message : "injoignable",
      latenceMs: null,
      ok: false,
    };
  }
}

async function compte(sql: string): Promise<number> {
  try {
    const rows = await pgQuery<{ n: string }>(sql);
    return Number.parseInt(rows[0]?.n ?? "0", 10) || 0;
  } catch (error) {
    console.error("[stats] comptage impossible", error);
    return 0;
  }
}

export async function lireSites(): Promise<Site[]> {
  const [
    statutSite,
    statutWiki,
    statutAchillea,
    statutApi,
    statutCdn,
    statutMcp,
    articles,
    chroniques,
    evenements,
    commandes,
    membresDiscord,
    profils,
    profilsPublics,
    personnages,
    techniques,
    objets,
    actualites,
    tweets,
  ] = await Promise.all([
    sonder(SITE_URL),
    sonder("https://azalee.rosegriffon.fr/"),
    sonder("https://achillea.rosegriffon.fr/"),
    sonder("https://api.rosegriffon.fr/health"),
    sonder("https://cdn.rosegriffon.fr/health"),
    sonder("https://mcp.rosegriffon.fr/"),
    compte("select count(*)::text n from articles where status = 'published'"),
    compte("select count(*)::text n from chronicles"),
    compte("select count(*)::text n from events"),
    compte("select count(*)::text n from orders"),
    compte("select count(*)::text n from discord_members where left_at is null and coalesce(is_bot,false) = false"),
    compte("select count(*)::text n from profiles"),
    compte("select count(*)::text n from profiles where claimed_at is not null"),
    compte("select count(*)::text n from inagle_characters"),
    compte("select count(*)::text n from inagle_skills"),
    compte("select count(*)::text n from inagle_items"),
    compte("select count(*)::text n from articles where app = 'azalee'"),
    compte("select count(*)::text n from tweets"),
  ]);

  return [
    {
      domaine: "rosegriffon.fr",
      local: true,
      metriques: [
        { label: "Comptes", valeur: profilsPublics, detail: `${profils} profils en base` },
        { label: "Membres Discord", valeur: membresDiscord, detail: "présents sur le serveur" },
        { label: "Chroniques", valeur: chroniques },
        { label: "Articles publiés", valeur: articles },
        { label: "Événements", valeur: evenements },
        { label: "Commandes boutique", valeur: commandes },
      ],
      nom: "Site principal",
      role: "Association Rose Griffon — actualités, boutique, événements",
      statut: statutSite,
    },
    {
      domaine: "azalee.rosegriffon.fr",
      local: true,
      metriques: [
        { label: "Personnages", valeur: personnages },
        { label: "Techniques", valeur: techniques },
        { label: "Objets", valeur: objets },
        { label: "Actualités du wiki", valeur: actualites },
        { label: "Tweets archivés", valeur: tweets },
      ],
      nom: "Wiki Azalée",
      role: "Base de données Inazuma Eleven: Victory Road",
      statut: statutWiki,
    },
    {
      domaine: "achillea.rosegriffon.fr",
      // Servi par la passerelle RG unifiée et son journal d'audience local.
      local: true,
      metriques: [],
      nom: "Achillea",
      role: "E-sport Achilléa — audience de la passerelle RG",
      statut: statutAchillea,
    },
    {
      domaine: "api.rosegriffon.fr",
      local: true,
      metriques: [],
      nom: "Passerelle API",
      role: "Outils internes : recherche sémantique, API headless du wiki",
      statut: statutApi,
    },
    {
      domaine: "cdn.rosegriffon.fr",
      local: true,
      metriques: [],
      nom: "CDN",
      role: "Images, décodage live des archives du jeu, modèles 3D",
      statut: statutCdn,
    },
    {
      domaine: "mcp.rosegriffon.fr",
      local: true,
      metriques: [],
      nom: "Serveur MCP",
      role: "Accès outillé aux données et à l'infrastructure",
      statut: statutMcp,
    },
  ];
}
