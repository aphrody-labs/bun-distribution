/**
 * Hiérarchie d'un serveur Discord, déduite des FAITS.
 *
 * CE QUE CE MODULE REMPLACE
 * La page communauté classait les membres avec quatre identifiants de rôles
 * recopiés en dur et un barème inventé (« Admin = 10 000, Médaille = 5 000 »).
 * Deux conséquences : un rôle renommé ou créé sur Discord n'existait pas pour le
 * site tant que personne ne modifiait le code, et le classement affiché n'était
 * celui de personne — ni celui de Discord, ni celui de l'association.
 *
 * Ici, rien n'est codé en dur. Le rang vient de `position`, que Discord tient
 * lui-même ; l'appartenance au staff vient des PERMISSIONS réellement accordées
 * au rôle ; et les sections affichées sont les rôles `hoisted`, c'est-à-dire
 * exactement ceux que Discord détache dans sa propre liste de membres.
 *
 * MODULE PUR
 * Aucune E/S, aucune dépendance : il prend des lignes et rend un classement.
 * C'est ce qui permet de le couvrir sans base et de l'appeler des deux côtés.
 */

/**
 * Bits de permission Discord qui font d'un rôle un rôle de pouvoir.
 *
 * Valeurs de la documentation Discord (`BitwisePermissionFlags`). On les écrit
 * en `bigint` : le bitfield dépasse 2^53 depuis `MODERATE_MEMBERS` (1 << 40),
 * et le lire en `number` perdrait silencieusement les bits hauts.
 */
export const PERMISSIONS = {
  KICK_MEMBERS: 1n << 1n,
  BAN_MEMBERS: 1n << 2n,
  ADMINISTRATOR: 1n << 3n,
  MANAGE_GUILD: 1n << 5n,
  MANAGE_MESSAGES: 1n << 13n,
  MANAGE_ROLES: 1n << 28n,
  MODERATE_MEMBERS: 1n << 40n,
} as const;

/** Un rôle qui porte l'un de ces droits gouverne le serveur. */
const DROITS_ADMINISTRATION = PERMISSIONS.ADMINISTRATOR | PERMISSIONS.MANAGE_GUILD;

/** Un rôle qui porte l'un de ceux-là modère, sans gouverner. */
const DROITS_MODERATION =
  PERMISSIONS.KICK_MEMBERS |
  PERMISSIONS.BAN_MEMBERS |
  PERMISSIONS.MANAGE_MESSAGES |
  PERMISSIONS.MANAGE_ROLES |
  PERMISSIONS.MODERATE_MEMBERS;

/** Rang d'un membre dans la hiérarchie, du plus haut au plus bas. */
export type RangDiscord = "administration" | "moderation" | "communaute";

export interface RoleDiscord {
  role_id: string;
  name: string;
  /** Position Discord : plus le nombre est grand, plus le rôle est haut. */
  position: number;
  /** Couleur entière Discord ; `0` signifie « pas de couleur », pas « noir ». */
  color: number;
  /** Rôle détaché dans la liste des membres de Discord. */
  is_hoisted: boolean;
  /** Bitfield sérialisé en chaîne décimale, tel que Discord le rend. */
  permissions: string | null;
  icon_url?: string | null;
}

export interface MembreDiscord {
  discord_id: string;
  username: string;
  display_name?: string | null;
  nickname?: string | null;
  avatar_url?: string | null;
  joined_at?: string | null;
  premium_since?: string | null;
  roles: string[];
}

/**
 * Lit un bitfield de permissions sans jamais perdre de bits.
 *
 * Une valeur absente ou illisible vaut « aucun droit » : mieux vaut classer un
 * membre dans la communauté par erreur que lui prêter des pouvoirs qu'il n'a
 * pas.
 */
export function lirePermissions(brut: string | null | undefined): bigint {
  if (!brut) return 0n;
  try {
    return BigInt(brut);
  } catch {
    return 0n;
  }
}

/** Le rôle gouverne-t-il le serveur ? */
export function estRoleAdministration(role: RoleDiscord): boolean {
  return (lirePermissions(role.permissions) & DROITS_ADMINISTRATION) !== 0n;
}

/** Le rôle modère-t-il, sans gouverner ? */
export function estRoleModeration(role: RoleDiscord): boolean {
  if (estRoleAdministration(role)) return false;
  return (lirePermissions(role.permissions) & DROITS_MODERATION) !== 0n;
}

export interface MembreClasse extends MembreDiscord {
  rang: RangDiscord;
  /** Nom affiché : surnom de serveur, puis nom global, puis pseudo. */
  nomAffiche: string;
  /**
   * Rôle qui DÉTERMINE la place du membre : son rôle `hoisted` le plus haut,
   * exactement ce que Discord affiche comme section. À défaut, son rôle le plus
   * haut tout court — un membre peut n'avoir que des rôles discrets.
   */
  roleDeSection: RoleDiscord | null;
  /** Rôle le plus haut, quel qu'il soit : c'est lui qui donne la couleur. */
  roleLePlusHaut: RoleDiscord | null;
  /** Position du rôle le plus haut, pour trier. */
  position: number;
  estBooster: boolean;
}

/**
 * Classe un membre à partir des rôles réels du serveur.
 *
 * Les rôles inconnus du catalogue sont ignorés plutôt que devinés : la table des
 * rôles est réécrite à chaque synchronisation, un identifiant qui n'y est plus
 * désigne un rôle supprimé.
 */
export function classerMembre(membre: MembreDiscord, rolesParId: Map<string, RoleDiscord>): MembreClasse {
  const roles = membre.roles
    .map(id => rolesParId.get(id))
    .filter((role): role is RoleDiscord => role !== undefined)
    .sort((a, b) => b.position - a.position);

  const roleLePlusHaut = roles[0] ?? null;
  const roleDeSection = roles.find(role => role.is_hoisted) ?? roleLePlusHaut;

  const rang: RangDiscord = roles.some(estRoleAdministration)
    ? "administration"
    : roles.some(estRoleModeration)
      ? "moderation"
      : "communaute";

  return {
    ...membre,
    estBooster: Boolean(membre.premium_since),
    nomAffiche: membre.nickname || membre.display_name || membre.username,
    position: roleLePlusHaut?.position ?? 0,
    rang,
    roleDeSection,
    roleLePlusHaut,
  };
}

export interface SectionHierarchie {
  /** Rôle qui donne son nom à la section, `null` pour « sans rôle détaché ». */
  role: RoleDiscord | null;
  membres: MembreClasse[];
}

/**
 * Regroupe les membres par section, comme la liste de Discord.
 *
 * Discord regroupe par rôle `hoisted` le plus haut, puis place tout le reste
 * dans un bloc commun. On reproduit ce découpage : c'est le seul classement que
 * le visiteur a déjà sous les yeux ailleurs, donc le seul qu'il n'ait pas à
 * apprendre.
 *
 * Les sections vides sont omises — un rôle peut exister sans porteur.
 */
export function grouperParSection(membres: MembreClasse[]): SectionHierarchie[] {
  const sections = new Map<string, SectionHierarchie>();

  for (const membre of membres) {
    const role = membre.roleDeSection?.is_hoisted ? membre.roleDeSection : null;
    const cle = role?.role_id ?? "";
    const section = sections.get(cle) ?? { membres: [], role };
    section.membres.push(membre);
    sections.set(cle, section);
  }

  for (const section of sections.values()) {
    section.membres.sort(
      (a, b) => b.position - a.position || new Date(a.joined_at ?? 0).getTime() - new Date(b.joined_at ?? 0).getTime(),
    );
  }

  return [...sections.values()].sort((a, b) => (b.role?.position ?? -1) - (a.role?.position ?? -1));
}

/** Couleur CSS d'un rôle, ou `null` quand Discord n'en donne pas. */
export function couleurRole(role: RoleDiscord | null | undefined): string | null {
  // `0` n'est pas noir : c'est l'absence de couleur, et le membre hérite alors
  // de la couleur du texte. Le rendre en `#000000` écrivait en noir sur fond
  // sombre.
  if (!role || !role.color) return null;
  return `#${role.color.toString(16).padStart(6, "0")}`;
}
