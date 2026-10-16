import "server-only";

import { pgQuery } from "@/lib/db/platform";

/**
 * Le classement de communauté, lu depuis le site.
 *
 * ── POURQUOI CETTE LECTURE VIT ICI ET NON DANS LE BOT ──────────────────────
 * `apps/bot/src/services/communaute.ts` sait déjà classer — mais il le fait
 * avec `Bun.SQL` et pour répondre à une slash command : il rend dix lignes
 * formatées pour un embed Discord. Le site a besoin d'autre chose : de la
 * pagination, un tri au choix, et la provenance de chaque XP. Recopier le
 * service aurait mélangé deux besoins ; l'appeler aurait tiré la connexion du
 * bot dans le processus Next.
 *
 * Les deux lectures partagent ce qui compte : la même table, les mêmes index
 * (`bot_profils_classement_xp_idx`, `bot_profils_classement_jetons_idx`) et la
 * même règle de rang.
 *
 * ── LA PROVENANCE EST UNE DONNÉE, PAS UN DÉTAIL ────────────────────────────
 * Toutes les XP ne se valent pas. Trois sources ont alimenté `bot_profils` :
 *   - l'API Noctaly (`profil_niveau` porte `totalXp`) : valeur EXACTE ;
 *   - le classement public (`profil_niveau` porte `userID`) : exacte aussi,
 *     mais datée du dernier rendu de la page ;
 *   - le dépouillement de l'historique des salons : un MINORANT (le seuil du
 *     palier annoncé par l'embed « Niveau supérieur »), pas la valeur réelle ;
 *   - l'activité sur notre propre bot depuis le 14/8/2026.
 * Afficher un classement sans dire d'où vient chaque ligne inviterait à
 * comparer des valeurs qui ne sont pas de même nature.
 */

import { PAR_PAGE, type PageMembres, type ProvenanceXp, type TriMembres } from "./membres-shared";

/**
 * Réexport de commodité : une page serveur importe `classementMembres` et
 * `estTriMembres` du même endroit, sans avoir à connaître la coupure.
 * Les îlots `"use client"`, eux, importent `./membres-shared` DIRECTEMENT —
 * passer par ici tirerait `server-only` dans le bundle navigateur.
 */
export {
  estTriMembres,
  LIBELLES_PROVENANCE,
  LIBELLES_TRI,
  PAR_PAGE,
  TRIS_MEMBRES,
  type LigneMembre,
  type PageMembres,
  type ProvenanceXp,
  type TriMembres,
} from "./membres-shared";

/**
 * Traduit un tri en clause `ORDER BY`.
 *
 * Écrit comme une correspondance FERMÉE et non par interpolation : la valeur
 * vient d'un paramètre d'URL, et une colonne concaténée dans du SQL est une
 * injection qui attend son tour. Un tri inconnu retombe sur l'XP.
 */
function clauseTri(tri: TriMembres): string {
  switch (tri) {
    case "jetons":
      return "p.jetons_gagnes DESC, p.xp DESC";
    case "messages":
      return "p.messages_comptes DESC, p.xp DESC";
    case "recent":
      return "p.dernier_gain_le DESC NULLS LAST, p.xp DESC";
    default:
      return "p.xp DESC, p.messages_comptes DESC";
  }
}

interface LigneBrute {
  discord_id: string;
  username: string | null;
  display_name: string | null;
  avatar_url: string | null;
  left_at: string | Date | null;
  xp: string;
  niveau: number;
  jetons: number;
  jetons_gagnes: string;
  messages_comptes: string;
  serie_quotidienne: number;
  dernier_gain_le: string | Date | null;
  titre: string | null;
  a_api: boolean;
  a_classement: boolean;
  rang: string;
}

/**
 * Une page du classement.
 *
 * Le rang vient de `row_number()` calculé sur le MÊME tri que l'affichage :
 * le calculer côté JavaScript à partir de l'index de page donnerait un rang
 * juste par accident, et faux dès qu'une ligne est filtrée.
 *
 * `bigint` arrive de Postgres en chaîne (le type dépasse `Number.MAX_SAFE_INTEGER`).
 * Nos valeurs tiennent largement, mais un `"1234" + 20` silencieux donnerait
 * `"123420"` et personne ne le verrait avant qu'un classement ne soit absurde.
 */
export async function classementMembres(
  guildId: string,
  options: { page?: number; tri?: TriMembres; inclurePartis?: boolean } = {},
): Promise<PageMembres> {
  const tri = options.tri ?? "xp";
  const page = Math.max(1, Math.floor(options.page ?? 1));
  const decalage = (page - 1) * PAR_PAGE;
  const filtreParti = options.inclurePartis ? "" : "AND m.left_at IS NULL";

  const lignes = await pgQuery<LigneBrute>(
    `WITH classe AS (
			 SELECT p.*, row_number() OVER (ORDER BY ${clauseTri(tri)}) AS rang
			   FROM public.bot_profils p
			   LEFT JOIN public.discord_members m ON m.discord_id = p.discord_id
			  WHERE p.guild_id = $1 AND p.xp > 0 ${filtreParti}
		 )
		 SELECT c.discord_id, m.username, m.display_name, m.avatar_url, m.left_at,
		        c.xp, c.niveau, c.jetons, c.jetons_gagnes, c.messages_comptes,
		        c.serie_quotidienne, c.dernier_gain_le, c.titre, c.rang,
		        (i.profil_niveau ? 'totalXp') AS a_api,
		        (i.profil_niveau ? 'userID') AS a_classement
		   FROM classe c
		   LEFT JOIN public.discord_members m ON m.discord_id = c.discord_id
		   LEFT JOIN public.bot_import_noctaly i
		          ON i.guild_id = $1 AND i.discord_id = c.discord_id
		  ORDER BY c.rang
		  LIMIT $2 OFFSET $3`,
    [guildId, PAR_PAGE, decalage],
  );

  const [compte] = await pgQuery<{ total: string }>(
    `SELECT count(*) AS total
		   FROM public.bot_profils p
		   LEFT JOIN public.discord_members m ON m.discord_id = p.discord_id
		  WHERE p.guild_id = $1 AND p.xp > 0 ${filtreParti}`,
    [guildId],
  );

  const total = Number(compte?.total ?? 0);
  return {
    lignes: lignes.map(ligne => ({
      avatarUrl: ligne.avatar_url,
      dernierGainLe: ligne.dernier_gain_le ? new Date(ligne.dernier_gain_le).toISOString() : null,
      discordId: ligne.discord_id,
      jetons: Number(ligne.jetons ?? 0),
      jetonsGagnes: Number(ligne.jetons_gagnes ?? 0),
      messages: Number(ligne.messages_comptes ?? 0),
      niveau: Number(ligne.niveau ?? 0),
      parti: ligne.left_at !== null,
      provenance: provenanceDe(ligne),
      pseudo: ligne.display_name ?? ligne.username ?? ligne.discord_id,
      rang: Number(ligne.rang),
      serieQuotidienne: Number(ligne.serie_quotidienne ?? 0),
      titre: ligne.titre,
      xp: Number(ligne.xp ?? 0),
    })),
    page,
    pages: Math.max(1, Math.ceil(total / PAR_PAGE)),
    total,
    tri,
  };
}

/**
 * D'où vient l'XP de cette ligne.
 *
 * L'archive `bot_import_noctaly.profil_niveau` est auto-descriptive : la
 * réponse d'API porte `totalXp`, l'entrée de classement porte `userID`. Aucune
 * archive du tout veut dire que la ligne vient d'ailleurs — le dépouillement de
 * l'historique des salons, ou l'activité sur notre propre bot.
 *
 * On ne peut pas distinguer ces deux derniers cas en base : `import-xp-tiers`
 * n'a pas laissé de trace par membre. « historique » est donc rendu pour les
 * profils antérieurs, ce qui reste la lecture honnête — c'est la seule XP qui
 * soit un minorant plutôt qu'une mesure.
 */
function provenanceDe(ligne: Pick<LigneBrute, "a_api" | "a_classement">): ProvenanceXp {
  if (ligne.a_api) {
    return "api";
  }
  if (ligne.a_classement) {
    return "classement";
  }
  return "historique";
}

export interface CouvertureImport {
  /** Membres humains encore présents sur le serveur. */
  humains: number;
  /** Profils porteurs d'XP. */
  avecXp: number;
  /** Lignes d'archive Noctaly, toutes sources confondues. */
  archives: number;
  archivesApi: number;
  archivesClassement: number;
  /** ISO 8601 du dernier import, `null` si aucun. */
  dernierImportLe: string | null;
  xpTotale: number;
  niveauMax: number;
}

/**
 * L'état de couverture de l'import — la question « où en est-on ? ».
 *
 * Chaque agrégat est tenté séparément : les tables `bot_*` datent du
 * 14/8/2026, et un environnement qui n'a pas appliqué toutes les migrations ne
 * doit pas rendre la page blanche.
 */
export async function couvertureImport(guildId: string): Promise<CouvertureImport> {
  const [humains, profils, archives] = await Promise.all([
    essayer<{ n: string }>("SELECT count(*) AS n FROM public.discord_members WHERE NOT is_bot AND left_at IS NULL", []),
    essayer<{ n: string; xp: string; niveau: number | null }>(
      `SELECT count(*) FILTER (WHERE xp > 0) AS n,
			        coalesce(sum(xp), 0) AS xp,
			        max(niveau) AS niveau
			   FROM public.bot_profils WHERE guild_id = $1`,
      [guildId],
    ),
    essayer<{ n: string; api: string; classement: string; dernier: string | Date | null }>(
      `SELECT count(*) AS n,
			        count(*) FILTER (WHERE profil_niveau ? 'totalXp') AS api,
			        count(*) FILTER (WHERE profil_niveau ? 'userID') AS classement,
			        max(importe_le) AS dernier
			   FROM public.bot_import_noctaly WHERE guild_id = $1`,
      [guildId],
    ),
  ]);

  return {
    archives: Number(archives?.n ?? 0),
    archivesApi: Number(archives?.api ?? 0),
    archivesClassement: Number(archives?.classement ?? 0),
    avecXp: Number(profils?.n ?? 0),
    dernierImportLe: archives?.dernier ? new Date(archives.dernier).toISOString() : null,
    humains: Number(humains?.n ?? 0),
    niveauMax: Number(profils?.niveau ?? 0),
    xpTotale: Number(profils?.xp ?? 0),
  };
}

async function essayer<T>(sql: string, params: unknown[]): Promise<T | null> {
  try {
    const lignes = await pgQuery<T>(sql, params);
    return lignes[0] ?? null;
  } catch (erreur) {
    console.warn("[bot/membres] agrégat indisponible :", erreur instanceof Error ? erreur.message : erreur);
    return null;
  }
}
