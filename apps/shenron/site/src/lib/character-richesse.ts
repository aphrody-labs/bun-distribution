// SPDX-License-Identifier: Apache-2.0

/**
 * character-richesse — classer les personnages par ce que le wiki sait d'eux.
 *
 * La grille de `/wiki/personnages` servait les 1 307 fiches dans l'ordre où
 * Postgres les rendait, c'est-à-dire l'ordre d'insertion de l'ingest. Le
 * visiteur qui arrive sur la rubrique tombait donc d'abord sur ce que le wiki
 * connaît le moins : des entrées d'un seul chapitre, ou des figures de jeu vidéo
 * sans une ligne de texte. Goku, Vegeta et Piccolo étaient quelque part plus bas.
 *
 * Ce module note chaque fiche sur ce qui est **mesurable** : la longueur de ce
 * qui est rédigé, le nombre de rubriques, de versions par saga, de
 * transformations, et les champs d'identité renseignés. Aucune notoriété
 * saisie à la main — un classement éditorial se périme et se discute, un
 * classement mesuré se recalcule.
 *
 * Module **pur** : aucun import serveur, aucune requête. Les signaux sont
 * collectés par `dbUniverse.characterRichesse()` (une seule requête agrégée),
 * la note se calcule ici. Séparer les deux permet de tester les pondérations
 * sans base, et de les régler sans toucher au SQL.
 */

/** Ce que la base sait d'un personnage, en brut. */
export interface SignauxRichesse {
	/** Longueur de `db_characters.article`. */
	longueurArticle: number;
	/** Longueur de `db_characters.description`. */
	longueurDescription: number;
	/** Longueur cumulée des `db_wiki_sections.body` de la fiche. */
	longueurSections: number;
	/** Nombre de rubriques `db_wiki_sections`. */
	nbSections: number;
	/** Nombre de versions par saga (`db_character_variants`). */
	nbVariantes: number;
	/** Nombre de transformations rattachées. */
	nbTransformations: number;
	/** Nombre de liens `db_character_techniques`. */
	nbTechniques: number;
	aNomJa: boolean;
	aRace: boolean;
	aKi: boolean;
	aPlaneteOrigine: boolean;
	/**
	 * L'illustration vient d'ailleurs que des anciens ingests de wikis
	 * (`assets/wiki/characters/cNNN.png`). Ce n'est pas un jugement sur la
	 * qualité de l'image : c'est le seul signal disponible qui distingue une
	 * fiche dont quelqu'un s'est occupé d'une fiche moissonnée en masse.
	 */
	imagePropre: boolean;
	aDebutEpisode: boolean;
	aDebutChapitre: boolean;
}

/**
 * Pondérations, et leur plafond.
 *
 * Chaque terme sature : une fiche trois fois plus longue n'est pas trois fois
 * mieux documentée, et sans plafond le classement se réduirait au nombre de
 * caractères de l'article. Le plafond est atteint autour de 10 000 signes de
 * texte, 4 rubriques, 6 versions, 3 transformations — soit le volume d'une
 * fiche déjà complète.
 */
export const POIDS = {
	/** 1 point par tranche de 250 signes rédigés (article + rubriques). */
	texteParSigne: 1 / 250,
	texteMax: 40,
	/** 1 point par tranche de 40 signes de description. */
	descriptionParSigne: 1 / 40,
	descriptionMax: 10,
	sectionParUnite: 4,
	sectionMax: 16,
	varianteParUnite: 2,
	varianteMax: 12,
	transformationParUnite: 3,
	transformationMax: 9,
	/**
	 * Les liens perso↔technique sont un import de movesets de jeu, pas un savoir
	 * sur l'œuvre (Whis y porte 56 techniques, plus que Goku). Ils comptent, mais
	 * peu, et saturent vite : 10 liens suffisent au maximum.
	 */
	techniqueParUnite: 0.5,
	techniqueMax: 5,
	nomJa: 3,
	race: 2,
	ki: 2,
	planeteOrigine: 2,
	imagePropre: 3,
	debutEpisode: 1,
	debutChapitre: 1,
} as const;

/** Note maximale atteignable, utile pour normaliser un affichage. */
export const RICHESSE_MAX =
	POIDS.texteMax +
	POIDS.descriptionMax +
	POIDS.sectionMax +
	POIDS.varianteMax +
	POIDS.transformationMax +
	POIDS.techniqueMax +
	POIDS.nomJa +
	POIDS.race +
	POIDS.ki +
	POIDS.planeteOrigine +
	POIDS.imagePropre +
	POIDS.debutEpisode +
	POIDS.debutChapitre;

function plafonne(valeur: number, max: number): number {
	return valeur > max ? max : valeur;
}

/** Note de richesse d'une fiche, dans `[0, RICHESSE_MAX]`. */
export function scoreRichesse(s: SignauxRichesse): number {
	const texte = plafonne(
		(s.longueurArticle + s.longueurSections) * POIDS.texteParSigne,
		POIDS.texteMax
	);
	const description = plafonne(
		s.longueurDescription * POIDS.descriptionParSigne,
		POIDS.descriptionMax
	);
	const sections = plafonne(s.nbSections * POIDS.sectionParUnite, POIDS.sectionMax);
	const variantes = plafonne(s.nbVariantes * POIDS.varianteParUnite, POIDS.varianteMax);
	const transformations = plafonne(
		s.nbTransformations * POIDS.transformationParUnite,
		POIDS.transformationMax
	);
	const techniques = plafonne(s.nbTechniques * POIDS.techniqueParUnite, POIDS.techniqueMax);
	const identite =
		(s.aNomJa ? POIDS.nomJa : 0) +
		(s.aRace ? POIDS.race : 0) +
		(s.aKi ? POIDS.ki : 0) +
		(s.aPlaneteOrigine ? POIDS.planeteOrigine : 0) +
		(s.imagePropre ? POIDS.imagePropre : 0) +
		(s.aDebutEpisode ? POIDS.debutEpisode : 0) +
		(s.aDebutChapitre ? POIDS.debutChapitre : 0);

	return texte + description + sections + variantes + transformations + techniques + identite;
}

/**
 * Comparateur de tri « les mieux documentés d'abord ».
 *
 * Le nom départage à note égale : sans lui, les ~400 fiches vides (toutes à 0)
 * se rangeraient dans l'ordre d'insertion, et la fin de liste changerait d'ordre
 * à chaque déploiement — un classement instable donne l'impression d'un bug.
 */
export function comparerRichesse(
	a: { richesse?: number; name: string },
	b: { richesse?: number; name: string }
): number {
	const delta = (b.richesse ?? 0) - (a.richesse ?? 0);
	if (delta !== 0) return delta;
	return a.name.localeCompare(b.name, "fr");
}
