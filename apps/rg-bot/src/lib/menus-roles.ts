/**
 * Menus de rôles en libre-service — le noyau, sans Discord ni base.
 *
 * ── CE QUE ÇA REMPLACE ─────────────────────────────────────────────────────
 * Les « rôles à réaction » d'un bot tiers : un message, des émojis, on clique
 * pour prendre un rôle. Le mécanisme a vieilli — une réaction ne dit pas ce
 * qu'elle donne, elle se retire par mégarde, et elle ne sait pas répondre. Un
 * menu déroulant Discord dit le nom du rôle, sa description, et confirme en
 * privé.
 *
 * ── LA RÈGLE QUI GOUVERNE TOUT ─────────────────────────────────────────────
 * Un menu de rôles est une distribution de pouvoir SANS AUCUN CONTRÔLE HUMAIN :
 * n'importe quel membre du serveur clique, et le rôle tombe. C'est la même
 * surface de danger qu'une récompense de niveau, en pire — il n'y a même pas
 * de niveau à atteindre. Les rôles proposables passent donc par exactement la
 * même garde stricte (`lib/hierarchie.ts`), et un menu qui contiendrait un rôle
 * sensible est refusé À LA CRÉATION comme AU CLIC.
 *
 * ── MODULE PUR ─────────────────────────────────────────────────────────────
 * Aucune E/S, aucun `discord.js`. Les identifiants de composants, les bornes de
 * l'API et la logique de bascule se testent ici.
 */
import { LIMITES } from "./ui/theme";

// ─── Formes ─────────────────────────────────────────────────────────────────

export const FORMES_MENU = ["menu", "boutons"] as const;

export type FormeMenu = (typeof FORMES_MENU)[number];

export function estFormeMenu(valeur: unknown): valeur is FormeMenu {
	return typeof valeur === "string" && (FORMES_MENU as readonly string[]).includes(valeur);
}

/**
 * Rôles proposables par forme.
 *
 * Un menu déroulant Discord accepte 25 options ; une rangée de boutons en
 * accepte 5 (`LIMITES.composantsParRangee`). On ne dépasse ni l'un ni l'autre :
 * au-delà, l'API refuse le message ENTIER et le staff voit un échec sans cause.
 */
export const ROLES_MAX: Readonly<Record<FormeMenu, number>> = Object.freeze({
	boutons: LIMITES.composantsParRangee,
	menu: 25,
});

// ─── Entrées ────────────────────────────────────────────────────────────────

export interface EntreeMenu {
	roleId: string;
	/** Libellé affiché. Par défaut le nom du rôle, mais il peut être réécrit. */
	libelle: string;
	/** Émoji Unicode, `null` si aucun. */
	emoji: string | null;
	/** Une ligne pour dire à quoi le rôle sert. `null` pour n'en pas mettre. */
	description: string | null;
}

/** Longueurs dures de l'API pour une option de menu déroulant. */
export const LONGUEURS = Object.freeze({
	libelle: 100,
	description: 100,
	titre: 100,
	texte: 500,
} as const);

function borner(valeur: unknown, limite: number): string | null {
	if (typeof valeur !== "string") {
		return null;
	}
	const propre = valeur.replaceAll(/\s+/g, " ").trim();
	if (propre.length === 0) {
		return null;
	}
	return propre.length <= limite ? propre : `${propre.slice(0, limite - 1)}…`;
}

/**
 * Nettoie une entrée. Le libellé est obligatoire : une option sans libellé est
 * refusée par l'API, et un menu à trous n'aide personne.
 */
export function entreePropre(brut: {
	roleId: string;
	libelle: unknown;
	emoji?: unknown;
	description?: unknown;
}): EntreeMenu | null {
	const libelle = borner(brut.libelle, LONGUEURS.libelle);
	if (!libelle || !/^\d{15,25}$/.test(brut.roleId)) {
		return null;
	}
	return {
		description: borner(brut.description, LONGUEURS.description),
		emoji: borner(brut.emoji, 8),
		libelle,
		roleId: brut.roleId,
	};
}

/** Relit la colonne `roles` d'une ligne de base, en écartant ce qui ne va pas. */
export function lireEntrees(brut: unknown): EntreeMenu[] {
	if (!Array.isArray(brut)) {
		return [];
	}
	const vues = new Set<string>();
	const entrees: EntreeMenu[] = [];
	for (const element of brut) {
		if (typeof element !== "object" || element === null) {
			continue;
		}
		const candidat = element as Record<string, unknown>;
		const entree = entreePropre({
			description: candidat.description,
			emoji: candidat.emoji,
			libelle: candidat.libelle,
			roleId: String(candidat.roleId ?? ""),
		});
		// Un rôle en double dans le même menu produit deux options identiques :
		// l'une des deux ne fait jamais rien, et personne ne sait laquelle.
		if (entree && !vues.has(entree.roleId)) {
			vues.add(entree.roleId);
			entrees.push(entree);
		}
	}
	return entrees;
}

// ─── Identifiants de composants ─────────────────────────────────────────────

export const PREFIXE_COMPOSANT = "roles";

/**
 * `roles:menu:<messageId>` — c'est le MESSAGE qu'on retrouve, pas les rôles.
 *
 * L'identifiant d'un composant est plafonné à 100 caractères : y encoder la
 * liste des rôles tiendrait au mieux quatre entrées. La ligne en base porte le
 * reste (cf. l'en-tête de la migration).
 */
export function identifiantMenu(messageId: string): string {
	return `${PREFIXE_COMPOSANT}:menu:${messageId}`.slice(0, LIMITES.identifiantComposant);
}

/** `roles:bouton:<messageId>:<roleId>` — une rangée de boutons, un rôle chacun. */
export function identifiantBouton(messageId: string, roleId: string): string {
	return `${PREFIXE_COMPOSANT}:bouton:${messageId}:${roleId}`.slice(
		0,
		LIMITES.identifiantComposant
	);
}

export interface ComposantMenu {
	forme: FormeMenu;
	messageId: string;
	/** Rôle visé, pour la forme `boutons` seulement. */
	roleId: string | null;
}

/** Relit un identifiant de composant. `null` si ce n'en est pas un des nôtres. */
export function lireComposant(identifiant: unknown): ComposantMenu | null {
	if (typeof identifiant !== "string") {
		return null;
	}
	const morceaux = identifiant.split(":");
	if (morceaux[0] !== PREFIXE_COMPOSANT || morceaux.length < 3) {
		return null;
	}
	const genre = morceaux[1];
	const messageId = morceaux[2] as string;
	if (!/^\d{15,25}$/.test(messageId)) {
		return null;
	}
	if (genre === "menu") {
		return { forme: "menu", messageId, roleId: null };
	}
	if (genre === "bouton" && /^\d{15,25}$/.test(morceaux[3] ?? "")) {
		return { forme: "boutons", messageId, roleId: morceaux[3] as string };
	}
	return null;
}

// ─── Bascule ────────────────────────────────────────────────────────────────

export interface PlanBascule {
	/** Rôles du menu à POSER sur le membre. */
	aPoser: string[];
	/** Rôles du menu à RETIRER du membre. */
	aRetirer: string[];
	/** Vrai quand la sélection dépassait `choixMax` et a été refusée. */
	tropDeChoix: boolean;
}

/**
 * Ce qu'il faut changer, à partir de la sélection et de ce que le membre porte
 * déjà.
 *
 * ── LA SUBTILITÉ QUI COMPTE ────────────────────────────────────────────────
 * Un menu déroulant Discord rend la sélection COMPLÈTE, pas le changement : un
 * membre qui retire une option envoie la liste sans elle. Le calcul se fait
 * donc toujours par différence, et il ne touche QUE les rôles du menu — un rôle
 * porté par ailleurs (récompense de niveau, rôle de staff) n'est jamais
 * retiré parce qu'il n'était pas coché ici.
 */
export function planDeBascule(
	entrees: readonly EntreeMenu[],
	selection: readonly string[],
	rolesDuMembre: readonly string[],
	choixMax = 0
): PlanBascule {
	const duMenu = new Set(entrees.map((entree) => entree.roleId));
	const voulus = new Set(selection.filter((roleId) => duMenu.has(roleId)));
	const portes = new Set(rolesDuMembre.filter((roleId) => duMenu.has(roleId)));

	if (choixMax > 0 && voulus.size > choixMax) {
		return { aPoser: [], aRetirer: [], tropDeChoix: true };
	}

	return {
		aPoser: [...voulus].filter((roleId) => !portes.has(roleId)),
		aRetirer: [...portes].filter((roleId) => !voulus.has(roleId)),
		tropDeChoix: false,
	};
}

/**
 * Bascule d'un bouton : un seul rôle, pris ou rendu.
 *
 * `choixMax` s'applique aussi : sur un menu « choisis une seule couleur », le
 * bouton d'une deuxième couleur remplace la première plutôt que de refuser —
 * c'est ce qu'un membre attend d'un bouton, contrairement à un menu où il voit
 * sa sélection.
 */
export function planDeBouton(
	entrees: readonly EntreeMenu[],
	roleId: string,
	rolesDuMembre: readonly string[],
	choixMax = 0
): PlanBascule {
	const duMenu = new Set(entrees.map((entree) => entree.roleId));
	if (!duMenu.has(roleId)) {
		return { aPoser: [], aRetirer: [], tropDeChoix: false };
	}
	const portes = rolesDuMembre.filter((identifiant) => duMenu.has(identifiant));
	if (portes.includes(roleId)) {
		return { aPoser: [], aRetirer: [roleId], tropDeChoix: false };
	}
	const aRetirer =
		choixMax > 0 && portes.length >= choixMax
			? portes.slice(0, portes.length - choixMax + 1)
			: [];
	return { aPoser: [roleId], aRetirer, tropDeChoix: false };
}

/** Phrase de confirmation, en éphémère. Dit ce qui a changé, rien d'autre. */
export function resumeBascule(plan: PlanBascule): string {
	if (plan.tropDeChoix) {
		return "Trop de rôles sélectionnés pour ce menu.";
	}
	const morceaux: string[] = [];
	if (plan.aPoser.length > 0) {
		morceaux.push(`Ajouté : ${plan.aPoser.map((roleId) => `<@&${roleId}>`).join(", ")}`);
	}
	if (plan.aRetirer.length > 0) {
		morceaux.push(`Retiré : ${plan.aRetirer.map((roleId) => `<@&${roleId}>`).join(", ")}`);
	}
	return morceaux.length > 0 ? morceaux.join("\n") : "Rien n'a changé.";
}
