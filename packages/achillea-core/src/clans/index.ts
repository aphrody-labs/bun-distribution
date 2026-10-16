/**
 * Règles de clan — hiérarchie, distinctions, tri des membres, pouvoirs.
 */

import {
	ClanMemberDistinction,
	ClanMemberRole,
	ClanState,
	type ClanDTO,
	type ClanMemberDTO,
} from "@rosegriffon/achillea-types";

/**
 * Ordre d'affichage des distinctions (le plus petit passe en premier).
 *
 * Indexé par la **valeur** de l'enum, qui est la chaîne réellement stockée et
 * servie par l'API (`"Joueur"`, `"Créateur de contenu"`, …). C'est le piège
 * historique : la table côté web était indexée par le nom anglais du membre
 * d'enum, si bien qu'aucune distinction ne matchait sauf `Staff`, et que les
 * créateurs de contenu étaient triés en dernier.
 */
export const DISTINCTION_PRIORITY: Readonly<Record<ClanMemberDistinction, number>> = {
	[ClanMemberDistinction.Staff]: 1,
	[ClanMemberDistinction.Player]: 2,
	[ClanMemberDistinction.Artist]: 3,
	[ClanMemberDistinction.ContentCreator]: 4,
};

/**
 * Clés anglaises tolérées en entrée — d'anciens enregistrements et l'ancienne
 * table du front les utilisent. `"Content Creator"` (avec espace) y figure
 * parce que c'est exactement ce que produisait le front.
 */
const LEGACY_DISTINCTION_KEYS: Readonly<Record<string, ClanMemberDistinction>> = {
	Staff: ClanMemberDistinction.Staff,
	Player: ClanMemberDistinction.Player,
	Artist: ClanMemberDistinction.Artist,
	ContentCreator: ClanMemberDistinction.ContentCreator,
	"Content Creator": ClanMemberDistinction.ContentCreator,
};

export const DEFAULT_DISTINCTION_PRIORITY = 99;

/** Normalise une distinction (valeur d'enum ou clé anglaise) vers l'enum. */
export function toDistinction(value: string): ClanMemberDistinction | null {
	if ((Object.values(ClanMemberDistinction) as string[]).includes(value)) {
		return value as ClanMemberDistinction;
	}
	return LEGACY_DISTINCTION_KEYS[value] ?? null;
}

export function distinctionPriority(distinction: string): number {
	const known = toDistinction(distinction);
	return known === null ? DEFAULT_DISTINCTION_PRIORITY : DISTINCTION_PRIORITY[known];
}

/** Trie les distinctions d'un membre dans l'ordre d'affichage canonique. */
export function sortDistinctions<T extends string>(distinctions: readonly T[]): T[] {
	return distinctions.slice().sort((a, b) => distinctionPriority(a) - distinctionPriority(b));
}

/**
 * Priorité d'un membre = celle de sa distinction la plus haute.
 * Sans distinction connue, il passe après tous les membres qui en ont une.
 */
export function memberDistinctionPriority(distinctions: readonly string[]): number {
	if (distinctions.length === 0) return DEFAULT_DISTINCTION_PRIORITY;
	return Math.min(...distinctions.map(distinctionPriority));
}

/**
 * Poids hiérarchique d'un rôle de clan. Plus haut = plus de pouvoirs.
 * `ClanMemberRole` est un enum numérique croissant, mais on ne s'appuie pas
 * dessus : une réorganisation de l'enum ne doit pas changer les droits.
 */
export const CLAN_ROLE_WEIGHT: Readonly<Record<ClanMemberRole, number>> = {
	[ClanMemberRole.Trial]: 0,
	[ClanMemberRole.Member]: 1,
	[ClanMemberRole.SubCaptain]: 2,
	[ClanMemberRole.Captain]: 3,
};

export function clanRoleWeight(role: ClanMemberRole): number {
	return CLAN_ROLE_WEIGHT[role] ?? 0;
}

/** `true` si `role` est au moins aussi haut que `minimum`. */
export function hasClanRoleAtLeast(role: ClanMemberRole, minimum: ClanMemberRole): boolean {
	return clanRoleWeight(role) >= clanRoleWeight(minimum);
}

/** Seuls le président et son vice peuvent gérer le recrutement. */
export function canManageRecruitment(role: ClanMemberRole): boolean {
	return hasClanRoleAtLeast(role, ClanMemberRole.SubCaptain);
}

/** Seul le président peut dissoudre le clan ou transmettre la présidence. */
export function canDissolveClan(role: ClanMemberRole): boolean {
	return role === ClanMemberRole.Captain;
}

/**
 * Un membre ne peut agir que sur un rôle STRICTEMENT inférieur au sien —
 * sinon un vice-président pourrait exclure son homologue.
 */
export function canActOnMember(actor: ClanMemberRole, target: ClanMemberRole): boolean {
	return clanRoleWeight(actor) > clanRoleWeight(target);
}

/**
 * Tri canonique d'une liste de membres : rôle décroissant, puis distinction,
 * puis renommée apportée, puis nom.
 */
export function sortClanMembers(members: readonly ClanMemberDTO[]): ClanMemberDTO[] {
	return members.slice().sort((a, b) => {
		const byRole = clanRoleWeight(b.clanRole) - clanRoleWeight(a.clanRole);
		if (byRole !== 0) return byRole;

		const byDistinction =
			memberDistinctionPriority(a.distinctions) - memberDistinctionPriority(b.distinctions);
		if (byDistinction !== 0) return byDistinction;

		const byFame = b.clanFameContributed - a.clanFameContributed;
		if (byFame !== 0) return byFame;

		return (a.user.username ?? "").localeCompare(b.user.username ?? "", "fr-FR");
	});
}

/** Part de la renommée du clan apportée par un membre, dans `[0, 1]`. */
export function fameShare(member: ClanMemberDTO, clan: Pick<ClanDTO, "fame">): number {
	// `fame` est absent de `GET /clans` : sans renommée connue, aucune part ne
	// peut être calculée. Rendre 0 est la seule réponse honnête — inventer un
	// dénominateur produirait un pourcentage qui ne veut rien dire.
	const renommee = clan.fame ?? 0;
	if (renommee <= 0) return 0;
	return Math.min(1, Math.max(0, member.clanFameContributed / renommee));
}

/** Un clan n'apparaît publiquement que validé, visible et non dissous. */
export function isClanPubliclyVisible(clan: Pick<ClanDTO, "state" | "isHidden" | "isDisbanded">): boolean {
	return clan.state === ClanState.Approved && !clan.isHidden && !clan.isDisbanded;
}

/** Un clan accepte des candidatures s'il est visible ET en recrutement. */
export function isClanRecruiting(
	clan: Pick<ClanDTO, "state" | "isHidden" | "isDisbanded" | "isRecruiting" | "isInactive">
): boolean {
	return isClanPubliclyVisible(clan) && clan.isRecruiting && !clan.isInactive;
}

/** Distinctions reconnues — toute autre valeur est ignorée à l'affichage. */
export const KNOWN_DISTINCTIONS: readonly ClanMemberDistinction[] = [
	ClanMemberDistinction.Staff,
	ClanMemberDistinction.Player,
	ClanMemberDistinction.Artist,
	ClanMemberDistinction.ContentCreator,
];

export function isKnownDistinction(value: string): value is ClanMemberDistinction {
	return (KNOWN_DISTINCTIONS as readonly string[]).includes(value);
}
