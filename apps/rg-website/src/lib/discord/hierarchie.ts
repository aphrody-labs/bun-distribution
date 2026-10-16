import "server-only";

/**
 * Hiérarchie Discord des serveurs suivis, lue en Postgres DIRECT.
 *
 * La page communauté posait deux requêtes, chargeait les 2 126 lignes de
 * `discord_members` en mémoire à chaque rendu, paginait en JavaScript — et
 * affichait les 318 membres PARTIS au même titre que les présents, faute d'un
 * `left_at is null`. Elle classait par un barème de quatre identifiants recopiés
 * en dur, que personne ne mettait à jour.
 *
 * Ici, tout vient de la base : `discord_appartenances` (qui est membre de quel
 * serveur, avec quels rôles) jointe à `discord_roles` (position, permissions,
 * couleur). Le classement lui-même est fait par `@rosegriffon/types`, module pur
 * et testé.
 */

import {
  classerMembre,
  grouperParSection,
  type MembreClasse,
  type RoleDiscord,
  type SectionHierarchie,
} from "@rosegriffon/types/discord-hierarchie";

import { getPgPool } from "@/lib/db/pg";

/**
 * Les serveurs dont la hiérarchie est publiée.
 *
 * Mêmes identifiants que `GUILDES_SUIVIES` du démon cron — c'est lui qui les
 * alimente. Le libellé et la marque vivent ici parce qu'ils sont d'affichage.
 */
export const SERVEURS = [
  {
    cle: "rose-griffon",
    guildId: "1072991720268111892",
    invitation: "https://discord.com/invite/rosegriffon",
    nom: "Rose Griffon",
  },
  {
    cle: "achillea",
    guildId: "1055585286320554055",
    invitation: "https://discord.gg/achillea-competitif-inazuma-eleven-fr-1055585286320554055",
    nom: "Achilléa",
  },
] as const;

export type CleServeur = (typeof SERVEURS)[number]["cle"];

export function serveurParCle(cle: string): (typeof SERVEURS)[number] {
  return SERVEURS.find(serveur => serveur.cle === cle) ?? SERVEURS[0];
}

export interface HierarchieServeur {
  serveur: (typeof SERVEURS)[number];
  /** Membres qui gouvernent le serveur (permission `ADMINISTRATOR`/`MANAGE_GUILD`). */
  administration: MembreClasse[];
  /** Membres qui modèrent sans gouverner. */
  moderation: MembreClasse[];
  /** Le reste, groupé comme Discord le fait : par rôle détaché le plus haut. */
  sections: SectionHierarchie[];
  /** Nombre de membres non-bots présents. */
  total: number;
  /** Dernière écriture connue, pour dire au visiteur ce qu'il regarde. */
  misAJourLe: string | null;
}

interface LigneMembre {
  discord_id: string;
  username: string;
  display_name: string | null;
  nickname: string | null;
  avatar_url: string | null;
  joined_at: string | null;
  premium_since: string | null;
  roles: string[];
  updated_at: string | null;
}

/** Catalogue des rôles d'un serveur, indexé par identifiant. */
async function lireRoles(guildId: string): Promise<Map<string, RoleDiscord>> {
  const pool = getPgPool();
  const { rows } = await pool.query<RoleDiscord>(
    `SELECT role_id, name, position, color, is_hoisted, permissions, icon_url
		   FROM discord_roles
		  WHERE guild_id = $1`,
    [guildId],
  );
  return new Map(rows.map(role => [role.role_id, role]));
}

/**
 * Hiérarchie complète d'un serveur.
 *
 * Les bots sont exclus : ils portent souvent des permissions d'administration
 * et se seraient retrouvés en tête du staff, devant les personnes. Les membres
 * partis aussi — c'est l'annuaire du serveur, pas son histoire.
 */
export async function lireHierarchie(cle: CleServeur): Promise<HierarchieServeur> {
  const serveur = serveurParCle(cle);
  const pool = getPgPool();

  const [roles, { rows }] = await Promise.all([
    lireRoles(serveur.guildId),
    pool.query<LigneMembre>(
      `SELECT discord_id, username, display_name, nickname, avatar_url,
			        joined_at, premium_since, roles, updated_at
			   FROM discord_appartenances
			  WHERE guild_id = $1
			    AND left_at IS NULL
			    AND is_bot = false`,
      [serveur.guildId],
    ),
  ]);

  const membres = rows.map(ligne => classerMembre(ligne, roles));
  const administration = membres.filter(m => m.rang === "administration");
  const moderation = membres.filter(m => m.rang === "moderation");

  const trierParRang = (a: MembreClasse, b: MembreClasse) =>
    b.position - a.position || new Date(a.joined_at ?? 0).getTime() - new Date(b.joined_at ?? 0).getTime();

  administration.sort(trierParRang);
  moderation.sort(trierParRang);

  const misAJourLe = rows.reduce<string | null>(
    (plusRecent, ligne) =>
      !ligne.updated_at || (plusRecent && plusRecent >= ligne.updated_at) ? plusRecent : ligne.updated_at,
    null,
  );

  return {
    administration,
    misAJourLe,
    moderation,
    // Le staff n'est PAS retiré des sections : sur Discord, un administrateur
    // apparaît dans sa section « Administrateur », pas dans un ailleurs. La
    // vue « Staff » est une autre lecture des mêmes gens, pas une soustraction.
    sections: grouperParSection(membres),
    serveur,
    total: membres.length,
  };
}

/**
 * Recherche d'un membre dans un serveur.
 *
 * La recherche vit dans Postgres (`ILIKE`, index trigram), là où elle chargeait
 * la table entière pour filtrer en mémoire.
 */
export async function chercherMembres(cle: CleServeur, requete: string, limite = 48): Promise<MembreClasse[]> {
  const serveur = serveurParCle(cle);
  const pool = getPgPool();
  const motif = `%${requete}%`;

  const [roles, { rows }] = await Promise.all([
    lireRoles(serveur.guildId),
    pool.query<LigneMembre>(
      `SELECT discord_id, username, display_name, nickname, avatar_url,
			        joined_at, premium_since, roles, updated_at
			   FROM discord_appartenances
			  WHERE guild_id = $1
			    AND left_at IS NULL
			    AND is_bot = false
			    AND (username ILIKE $2 OR display_name ILIKE $2 OR nickname ILIKE $2)
			  ORDER BY joined_at ASC NULLS LAST
			  LIMIT $3`,
      [serveur.guildId, motif, limite],
    ),
  ]);

  return rows.map(ligne => classerMembre(ligne, roles)).sort((a, b) => b.position - a.position);
}
