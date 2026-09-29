/**
 * Normalise le regroupement des sections wiki (PWS et similaires).
 *
 * Erreur fréquente en studio : le champ « sous-catégorie » est rempli avec le nom
 * de la sous-section (ex. « Puissance d'attaque ») et le titre avec « PWS » —
 * l'inverse de la hiérarchie attendue (onglet parent = PWS, enfants = Vitesse…).
 */

export const PWS_GROUP_NAME = "PWS";

/** Sous-sections PWS reconnues même si le groupe parent n'a pas été renseigné. */
const PWS_CHILD_LABEL_RE = /puissance\s*d['']?\s*attaque|^vitesse$|durabilit[eé]|endurance/i;

export interface GroupableSection {
	label: string;
	group?: string | null;
}

function trimGroup(g: string | null | undefined): string | null {
	const t = g?.trim();
	return t || null;
}

/**
 * Corrige les inversions label ↔ groupe et rattache les sous-sections PWS
 * orphelines au groupe parent « PWS ».
 */
export function normalizeWikiSectionGroups<T extends GroupableSection>(sections: T[]): T[] {
	let out = sections.map((s) => {
		const label = s.label.trim();
		const group = trimGroup(s.group);

		// Inversion classique : titre « PWS », groupe = nom de la sous-section.
		if (/^pws$/i.test(label) && group) {
			return { ...s, label: group, group: PWS_GROUP_NAME };
		}

		return { ...s, label, group };
	});

	const hasPwsGroup = out.some((s) => s.group?.toUpperCase() === PWS_GROUP_NAME);
	if (!hasPwsGroup) return out;

	out = out.map((s) => {
		if (s.group) return s;
		if (PWS_CHILD_LABEL_RE.test(s.label)) {
			return { ...s, group: PWS_GROUP_NAME };
		}
		return s;
	});

	return out;
}
