import type { MetadataRoute } from "next";

import { getInaglePgPool } from "@rosegriffon/db/pg";
import { SITE_URL } from "@/lib/site-url";
import { wikiService } from "@/lib/wiki-service";

/**
 * Plan de site DÉDIÉ au wiki (`/wiki/sitemap.xml`), séparé du plan de site
 * racine (`app/sitemap.ts`).
 *
 * Historique : le wiki vivait sur une app Next autonome (`apps/azalee`,
 * `azalee.rosegriffon.fr`) avec son propre `sitemap.ts`. Sa fusion dans
 * `apps/website` sous `/wiki` (commit `d74cee35`) a supprimé ce générateur
 * SANS le porter : ~11 600 fiches (personnages, techniques, objets, équipes,
 * quêtes, boutiques, entraîneurs, stades, succès, capsules, auras,
 * tactiques…) ont cessé d'être annoncées à quelque moteur que ce soit,
 * devenant découvrables uniquement par le maillage interne. Ce fichier
 * restaure cette couverture.
 *
 * Séparé plutôt que fusionné dans `app/sitemap.ts` : les deux volumes n'ont
 * ni le même rythme de mise à jour (le wiki suit les mises à jour du jeu, pas
 * le fil éditorial) ni le même coût (le wiki lit une quinzaine de requêtes
 * Postgres, dont plusieurs sur des tables à plusieurs milliers de lignes).
 * Les combiner forcerait soit à tout revalider au rythme du plus rapide, soit
 * à payer le coût du wiki à chaque hit de crawler sur le sitemap racine.
 *
 * Un seul fichier plutôt que `generateSitemaps()` (découpage en plusieurs
 * fichiers, supporté par Next 16) : mesuré le 21/09/2026, le total est
 * d'environ 11 600 URLs, largement sous le plafond du protocole (50 000 URLs
 * / 50 Mo par fichier). Même un doublement du contenu du jeu (~23 000) reste
 * confortablement dans la marge ; il faudrait un quadruplement pour
 * l'approcher. Si un audit futur rapproche le total de 30 000 URLs, découper
 * par famille (personnages / techniques-objets / reste) avec
 * `generateSitemaps()` redevient pertinent — pas avant.
 *
 * Lecture Postgres DIRECTE (`getInaglePgPool`, cf. `app/sitemap.ts`) plutôt que le
 * client Supabase/PostgREST utilisé par les pages via `wikiService` : ce
 * plan de site ne doit pas dépendre de la disponibilité du Data API, et
 * n'a besoin que d'identifiants + horodatages — pas des enrichissements
 * (images, textes résolus, jointures) que `wikiService` calcule pour
 * l'affichage. Chaque famille est isolée dans son propre bloc try/catch :
 * une table indisponible ne doit pas vider le plan de site des autres.
 */
export const revalidate = 3600;

const AURA_CATEGORIES = ["esprits-guerriers", "totems", "miximax", "eveil", "changement-mode"] as const;

/**
 * Pages de section du wiki. Chaque chemin a été vérifié un par un par `curl`
 * (200, pas de redirection) le 21/09/2026 — voir le rapport de migration.
 *
 * Volontairement absents :
 * - `/wiki/news` et `/wiki/search` : remontés à la racine du site depuis la
 *   fusion (`/news`, `/search`), déjà couverts par `app/sitemap.ts`.
 * - les pages légales : sous `/legal/`, déjà couvertes par `app/sitemap.ts`.
 * - `/wiki/gallery`, `/videos`, `/textures`, `/modeles`, `/tools/*`, `/save`,
 *   `/demo`, `/sons`, `/vroid`, `/keshin`, `/mode`, `/avatar` : navigateurs
 *   d'assets et outils internes, jamais listés par l'ancien plan de site
 *   (`apps/azalee/app/sitemap.ts`) et sans intérêt pour l'indexation.
 */
const STATIC_PAGES: Array<{
  path: string;
  priority: number;
  changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"];
}> = [
  { changeFrequency: "weekly", path: "", priority: 0.8 },
  { changeFrequency: "weekly", path: "/chara", priority: 0.9 },
  { changeFrequency: "weekly", path: "/skill", priority: 0.9 },
  { changeFrequency: "weekly", path: "/item", priority: 0.8 },
  { changeFrequency: "weekly", path: "/aura", priority: 0.8 },
  { changeFrequency: "weekly", path: "/passive", priority: 0.7 },
  { changeFrequency: "weekly", path: "/tactic", priority: 0.7 },
  { changeFrequency: "weekly", path: "/patch-notes", priority: 0.7 },
  { changeFrequency: "weekly", path: "/equipe", priority: 0.7 },
  { changeFrequency: "weekly", path: "/quete", priority: 0.7 },
  { changeFrequency: "weekly", path: "/boutique", priority: 0.6 },
  { changeFrequency: "weekly", path: "/entraineur", priority: 0.6 },
  { changeFrequency: "weekly", path: "/stade", priority: 0.6 },
  { changeFrequency: "weekly", path: "/succes", priority: 0.6 },
  { changeFrequency: "weekly", path: "/capsule", priority: 0.6 },
  { changeFrequency: "weekly", path: "/drops", priority: 0.6 },
  { changeFrequency: "weekly", path: "/invocation", priority: 0.6 },
  { changeFrequency: "monthly", path: "/niveau", priority: 0.6 },
  { changeFrequency: "monthly", path: "/cross", priority: 0.5 },
  ...AURA_CATEGORIES.map(categorie => ({
    changeFrequency: "weekly" as const,
    path: `/aura/${categorie}`,
    priority: 0.7,
  })),
];

/** Exécute une requête `SELECT ... AS id` et renvoie la liste d'identifiants (non vides). */
async function idsDepuisSql(sql: string): Promise<string[]> {
  try {
    const pool = getInaglePgPool();
    const { rows } = await pool.query<{ id: string | null }>(sql);
    return rows.map(r => r.id).filter((id): id is string => Boolean(id));
  } catch (error) {
    console.error("wiki sitemap: idsDepuisSql impossible", error);
    return [];
  }
}

/**
 * Personnages — `base_slug` et non `slug` : la forme canonique est celle que
 * le site lie lui-même (~5 200 valeurs), pas la variante suffixée du hash
 * (~6 200) — publier la seconde donnait un plan de site dont aucune URL
 * n'était celle du maillage (raisonnement hérité de l'ancien générateur).
 *
 * Un `base_slug` est partagé par toutes les variantes d'un même personnage
 * (centaines de doublons) : sans déduplication la même URL serait annoncée
 * plusieurs fois. On garde la ligne la plus récemment mise à jour (tri
 * `updated_at DESC` en amont, on ne conserve que la première occurrence).
 */
async function personnages(baseUrl: string): Promise<MetadataRoute.Sitemap> {
  try {
    const pool = getInaglePgPool();
    const { rows } = await pool.query<{ base_slug: string | null; updated_at: string | null }>(
      "SELECT base_slug, updated_at FROM inagle_characters WHERE base_slug IS NOT NULL ORDER BY updated_at DESC NULLS LAST",
    );
    const vus = new Set<string>();
    const entries: MetadataRoute.Sitemap = [];
    for (const row of rows) {
      if (!row.base_slug || vus.has(row.base_slug)) continue;
      vus.add(row.base_slug);
      entries.push({
        changeFrequency: "monthly",
        lastModified: row.updated_at ? new Date(row.updated_at) : new Date(),
        priority: 0.8,
        url: `${baseUrl}/wiki/chara/${row.base_slug}`,
      });
    }
    return entries;
  } catch (error) {
    console.error("wiki sitemap: personnages indisponibles", error);
    return [];
  }
}

/**
 * Techniques — les identifiants suffixés `_or` sont écartés : ce sont des
 * doublons de technique jamais montrés par `getSkillsList` (raisonnement
 * hérité de l'ancien générateur), les publier produirait des URLs orphelines.
 */
async function techniques(baseUrl: string): Promise<MetadataRoute.Sitemap> {
  try {
    const pool = getInaglePgPool();
    const { rows } = await pool.query<{
      id: string;
      updated_at: string | null;
      created_at: string | null;
    }>(
      "SELECT id, updated_at, created_at FROM inagle_skills WHERE id NOT LIKE '%\\_or' ESCAPE '\\' ORDER BY created_at DESC NULLS LAST",
    );
    return rows.map(row => ({
      changeFrequency: "monthly" as const,
      lastModified: new Date(row.updated_at || row.created_at || Date.now()),
      priority: 0.7,
      url: `${baseUrl}/wiki/skill/${row.id}`,
    }));
  } catch (error) {
    console.error("wiki sitemap: techniques indisponibles", error);
    return [];
  }
}

/** Objets — toutes les lignes, sans filtre (parité avec l'ancien générateur). */
async function objets(baseUrl: string): Promise<MetadataRoute.Sitemap> {
  try {
    const pool = getInaglePgPool();
    const { rows } = await pool.query<{
      id: string;
      updated_at: string | null;
      created_at: string | null;
    }>("SELECT id, updated_at, created_at FROM inagle_items ORDER BY created_at DESC NULLS LAST");
    return rows.map(row => ({
      changeFrequency: "monthly" as const,
      lastModified: new Date(row.updated_at || row.created_at || Date.now()),
      priority: 0.6,
      url: `${baseUrl}/wiki/item/${row.id}`,
    }));
  } catch (error) {
    console.error("wiki sitemap: objets indisponibles", error);
    return [];
  }
}

/**
 * Auras — cinq familles aux tables et filtres distincts (`wikiService.getAurasList`) :
 * - esprits-guerriers : vue `inagle_keshins_clean`, en excluant les codes
 *   d'assets `wa*`/`wkt*` (Keshin Armé / Transformation-Lien) qui font
 *   doublon avec le Keshin de base. Les lignes sans `asset_code` sont EXCLUES
 *   elles aussi : c'est le comportement réel de la double exclusion
 *   PostgREST (`NOT (col ILIKE …)` vaut NULL, donc échoue le filtre, sur une
 *   valeur NULL) — vérifié en confrontant le total mesuré ici (58) au
 *   `total` réellement renvoyé par la page `/wiki/aura/esprits-guerriers`.
 * - totems : vue `inagle_souls_clean`, sans filtre.
 * - miximax : vue `inagle_miximax_clean`, sans filtre.
 * - éveil : combine `inagle_awakenings_clean` ET `inagle_auras` (le service
 *   fusionne les deux tables pour cette catégorie).
 * - changement-mode : vue `inagle_mode_changes_clean`, sans filtre.
 */
async function auras(baseUrl: string): Promise<MetadataRoute.Sitemap> {
  const requetes: Record<(typeof AURA_CATEGORIES)[number], string> = {
    "changement-mode": "SELECT id FROM inagle_mode_changes_clean",
    eveil: "SELECT id FROM inagle_awakenings_clean UNION ALL SELECT id FROM inagle_auras",
    "esprits-guerriers":
      "SELECT id FROM inagle_keshins_clean WHERE asset_code IS NOT NULL AND asset_code NOT ILIKE 'wa%' AND asset_code NOT ILIKE 'wkt%'",
    miximax: "SELECT id FROM inagle_miximax_clean",
    totems: "SELECT id FROM inagle_souls_clean",
  };

  const entries: MetadataRoute.Sitemap = [];
  for (const categorie of AURA_CATEGORIES) {
    try {
      const ids = await idsDepuisSql(requetes[categorie]);
      for (const id of ids) {
        entries.push({
          changeFrequency: "monthly",
          lastModified: new Date(),
          priority: 0.6,
          url: `${baseUrl}/wiki/aura/${categorie}/${encodeURIComponent(id)}`,
        });
      }
    } catch (error) {
      console.error(`wiki sitemap: auras ${categorie} indisponibles`, error);
    }
  }
  return entries;
}

/**
 * Tactiques — fusion `inagle_tactics` (base) + extras `inagle_special_tactics`
 * dont le code n'est pas déjà connu, en écartant les lignes placeholder
 * (`test_*` ou nom japonais générique `必殺タクティクス`) : réplique exacte
 * de la logique de dédoublonnage de `wikiService.getTacticsList`, dont
 * dépendent les pages détail (`itemId`).
 */
async function tactiques(baseUrl: string): Promise<MetadataRoute.Sitemap> {
  try {
    const pool = getInaglePgPool();
    const [base, special] = await Promise.all([
      pool.query<{ internal_code: string | null }>(
        "SELECT internal_code FROM inagle_tactics WHERE internal_code IS NOT NULL",
      ),
      pool.query<{ internal_code: string | null; name_fr: string | null; name_en: string | null }>(
        "SELECT internal_code, name_fr, name_en FROM inagle_special_tactics WHERE internal_code IS NOT NULL",
      ),
    ]);

    const isPlaceholder = (code: string, nameFr: string | null, nameEn: string | null): boolean => {
      if (!code || code.startsWith("test_")) return true;
      return (nameFr ?? "").includes("必殺タクティクス") || (nameEn ?? "").includes("必殺タクティクス");
    };

    const connus = new Set(base.rows.map(r => r.internal_code).filter(Boolean));
    const codes = new Set<string>();
    for (const code of connus) {
      if (code) codes.add(code);
    }
    for (const row of special.rows) {
      const code = row.internal_code;
      if (!code || connus.has(code) || isPlaceholder(code, row.name_fr, row.name_en)) continue;
      codes.add(code);
    }

    return Array.from(codes).map(id => ({
      changeFrequency: "monthly" as const,
      lastModified: new Date(),
      priority: 0.6,
      url: `${baseUrl}/wiki/tactic/${encodeURIComponent(id)}`,
    }));
  } catch (error) {
    console.error("wiki sitemap: tactiques indisponibles", error);
    return [];
  }
}

/**
 * Familles servies par des tables simples (un identifiant par fiche, sans
 * enrichissement ni fusion) : équipes, entraîneurs (coordinateurs), stades,
 * quêtes, succès, capsules, boutiques. Chaque source est isolée : une table
 * indisponible ne doit pas vider le plan de site des autres.
 */
const FAMILLES_SIMPLES: Array<{ path: string; priority: number; sql: string }> = [
  { path: "/equipe", priority: 0.6, sql: "SELECT id FROM inagle_teams" },
  {
    path: "/entraineur",
    priority: 0.5,
    sql: "SELECT id::text AS id FROM inagle_coordinators",
  },
  { path: "/stade", priority: 0.5, sql: "SELECT id FROM inagle_stadiums" },
  { path: "/quete", priority: 0.6, sql: "SELECT id FROM inagle_quests" },
  {
    path: "/succes",
    priority: 0.5,
    sql: "SELECT COALESCE(code, trophy_id) AS id FROM inagle_trophies",
  },
  { path: "/capsule", priority: 0.4, sql: "SELECT id FROM inagle_capsules" },
  {
    path: "/boutique",
    priority: 0.5,
    sql: "SELECT DISTINCT shop_id::text AS id FROM inagle_shops",
  },
];

async function famillesSimples(baseUrl: string): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = [];
  for (const famille of FAMILLES_SIMPLES) {
    try {
      const ids = await idsDepuisSql(famille.sql);
      for (const id of ids) {
        entries.push({
          changeFrequency: "monthly",
          lastModified: new Date(),
          priority: famille.priority,
          url: `${baseUrl}/wiki${famille.path}/${encodeURIComponent(id)}`,
        });
      }
    } catch (error) {
      console.error(`wiki sitemap: ${famille.path} indisponible`, error);
    }
  }
  return entries;
}

/**
 * Passifs — projection SQL `inagle_passives`
 * projection SQL canonique.
 */
async function passifs(baseUrl: string): Promise<MetadataRoute.Sitemap> {
  try {
    const { data } = await wikiService.getPassivesList({ limit: 5000, page: 1 });
    return data
      .filter(p => p.passive_id)
      .map(p => ({
        changeFrequency: "monthly" as const,
        lastModified: new Date(),
        priority: 0.5,
        url: `${baseUrl}/wiki/passive/${encodeURIComponent(p.passive_id)}`,
      }));
  } catch (error) {
    console.error("wiki sitemap: passifs indisponibles", error);
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // Host canonique (apex, sans www) — même normalisation que `app/sitemap.ts`,
  // désormais partagée via `SITE_URL` (lib/site-url.ts).
  const baseUrl = SITE_URL;
  const lastModified = new Date();

  const [personnagesUrls, techniquesUrls, objetsUrls, aurasUrls, tactiquesUrls, famillesUrls, passifsUrls] =
    await Promise.all([
      personnages(baseUrl),
      techniques(baseUrl),
      objets(baseUrl),
      auras(baseUrl),
      tactiques(baseUrl),
      famillesSimples(baseUrl),
      passifs(baseUrl),
    ]);

  return [
    ...STATIC_PAGES.map(({ path, priority, changeFrequency }) => ({
      changeFrequency,
      lastModified,
      priority,
      url: `${baseUrl}/wiki${path}`,
    })),
    ...personnagesUrls,
    ...techniquesUrls,
    ...objetsUrls,
    ...aurasUrls,
    ...tactiquesUrls,
    ...famillesUrls,
    ...passifsUrls,
  ];
}
