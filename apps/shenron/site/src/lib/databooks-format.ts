/**
 * Transcriptions de databooks — règles pures de mise en forme et de diagnostic.
 *
 * Sans dépendance serveur : le module est importable depuis les composants
 * client (relecteur admin), les routes API et `bun test`. Même découpage que
 * `databooks-rules.ts`, pour la même raison — `databooks.ts` est `server-only`.
 *
 * Le corpus est produit par un modèle de vision lisant des scans japonais :
 * 11 775 planches, dont une part transcrite automatiquement. Mesuré le
 * 2026-08-22 sur les 5 302 planches déjà rendues, les défauts récurrents sont
 * de deux natures qu'il ne faut surtout pas confondre :
 *
 *   - la **mise en forme** (espaces multiples, lignes vides en rafale, espaces
 *     en fin de ligne) : bruit d'export, réparable sans risque — c'est le rôle
 *     de `nettoyerOcr` ;
 *   - la **qualité de lecture** (caractère de remplacement, texte d'un seul
 *     mot, lignes répétées) : le modèle a mal lu. Aucun nettoyage ne le répare,
 *     il faut un œil humain — c'est le rôle de `diagnostiquerPlanche`, qui
 *     signale sans jamais corriger.
 */

import {
	contientAlphabetEtranger,
	contientBoucle,
	estHanSansKana,
	SEUIL_COURT,
} from "./databooks-defauts";

/** Caractère de remplacement U+FFFD : l'OCR a rendu un glyphe qu'il n'a pas su lire. */
const REMPLACEMENT = "�";

/**
 * En deçà, une planche « transcrite » ne dit rien d'exploitable. La valeur
 * vient du juge commun : la redéfinir ici laissait les deux diverger en
 * silence, et l'admin ne signalait plus ce que le lecteur public voit.
 */
const LONGUEUR_SUSPECTE = SEUIL_COURT;

/**
 * Nettoie le bruit d'export d'une transcription, sans jamais toucher au sens.
 *
 * Volontairement conservateur : on ne réécrit pas la ponctuation, on ne fusionne
 * pas les lignes, on ne devine rien. Une transcription est une **proposition**
 * qu'un relecteur validera — un nettoyage trop zélé lui ferait relire un texte
 * que la machine a déjà réinterprété, et masquerait les vrais défauts.
 *
 * Ce qui est corrigé, et rien d'autre :
 *   - fins de ligne Windows/Mac → `\n` ;
 *   - espaces (y compris insécables) en fin de ligne ;
 *   - suites de 2 espaces ou plus → un seul, **hors indentation** (une liste ou
 *     un bloc de code markdown perdrait sa structure) ;
 *   - plus de 2 sauts de ligne consécutifs → 2 (un paragraphe vide suffit) ;
 *   - espaces en tête et en fin de texte.
 */
export function nettoyerOcr(texte: string): string {
	return texte
		.replace(/\r\n?/g, "\n")
		.split("\n")
		.map((ligne) => {
			const indentation = ligne.match(/^[ \t]*/)?.[0] ?? "";
			return (
				indentation +
				ligne
					.slice(indentation.length)
					.replace(/[ 　 \t]{2,}/g, " ")
					.replace(/[ 　 \t]+$/, "")
			);
		})
		.join("\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** `nettoyerOcr` changerait-il quelque chose ? Sert à ne pas proposer un no-op. */
export function aBesoinDeNettoyage(texte: string): boolean {
	return nettoyerOcr(texte) !== texte;
}

type CodeAnomalie =
	| "remplacement"
	| "tres-court"
	| "repetition"
	| "boucle"
	| "alphabet-etranger"
	| "han-sans-kana"
	| "mise-en-forme";

export interface Anomalie {
	code: CodeAnomalie;
	/** Phrase affichable telle quelle dans l'interface de relecture. */
	message: string;
	/** `true` si `nettoyerOcr` la corrige — sinon il faut relire la planche. */
	reparable: boolean;
}

/**
 * Répétition franche : une même ligne non triviale rendue plusieurs fois.
 *
 * Symptôme classique d'un modèle de vision qui boucle sur une zone de la page.
 * On ignore les lignes courtes (« 悟空 », un numéro, un titre de colonne) qui se
 * répètent légitimement dans un tableau ou une fiche technique.
 */
function ligneRepetee(texte: string): string | null {
	const vues = new Map<string, number>();
	for (const brute of texte.split("\n")) {
		const ligne = brute.trim();
		if (ligne.length < 12) continue;
		const n = (vues.get(ligne) ?? 0) + 1;
		if (n >= 3) return ligne;
		vues.set(ligne, n);
	}
	return null;
}

/**
 * Anomalies d'une planche transcrite, de la plus grave à la plus bénigne.
 *
 * Un tableau vide ne veut pas dire « transcription juste » — seulement « aucun
 * signal automatique de défaut ». La relecture reste la seule validation.
 */
export function diagnostiquerPlanche(texte: string | null | undefined): Anomalie[] {
	const t = (texte ?? "").trim();
	if (!t) return [];
	const out: Anomalie[] = [];

	const remplacements = t.split(REMPLACEMENT).length - 1;
	if (remplacements > 0) {
		out.push({
			code: "remplacement",
			message: `${remplacements} caractère${remplacements > 1 ? "s" : ""} illisible${
				remplacements > 1 ? "s" : ""
			} (${REMPLACEMENT}) — le modèle n'a pas su lire ces glyphes.`,
			reparable: false,
		});
	}

	if (t.length < LONGUEUR_SUSPECTE) {
		out.push({
			code: "tres-court",
			message: `${t.length} caractère${t.length > 1 ? "s" : ""} seulement — lecture probablement partielle.`,
			reparable: false,
		});
	}

	const repetee = ligneRepetee(t);
	if (repetee) {
		out.push({
			code: "repetition",
			message: `Ligne répétée au moins 3 fois : « ${repetee.slice(0, 60)}${repetee.length > 60 ? "…" : ""} ».`,
			reparable: false,
		});
	} else if (contientBoucle(t)) {
		// `ligneRepetee` ne voit que des lignes entières identiques. Le modèle
		// boucle aussi À L'INTÉRIEUR d'une ligne (« いるかといますいるかといます… »),
		// ce qui passait sous le radar du relecteur alors que la file de
		// relecture, elle, le comptait.
		out.push({
			code: "boucle",
			message: "Un même segment est répété en rafale — le modèle a bouclé.",
			reparable: false,
		});
	}

	// Les deux signatures les plus fréquentes du corpus, et les seules que le
	// diagnostic ignorait : 720 planches portent un alphabet qui n'a rien à
	// faire là, 154 sont en faux chinois. Sans elles, le back-office annonçait
	// « à vérifier » sur 116 planches au lieu de 1 911.
	if (contientAlphabetEtranger(t)) {
		out.push({
			code: "alphabet-etranger",
			message:
				"Contient du cyrillique, de l'arabe, du thaï ou du coréen — signes hallucinés par le modèle, jamais lus sur la planche.",
			reparable: false,
		});
	}

	if (estHanSansKana(t)) {
		out.push({
			code: "han-sans-kana",
			message:
				"Idéogrammes sans un seul kana : du chinois inventé plutôt que le japonais de la planche.",
			reparable: false,
		});
	}

	if (aBesoinDeNettoyage(texte ?? "")) {
		out.push({
			code: "mise-en-forme",
			message: "Espaces ou sauts de ligne superflus.",
			reparable: true,
		});
	}

	return out;
}

/** Un segment d'extrait : `correspond` marque la portion cherchée. */
export interface Segment {
	texte: string;
	correspond: boolean;
}

/**
 * Découpe un texte autour de chaque occurrence d'un terme, pour l'affichage
 * d'un résultat de recherche.
 *
 * Renvoie des **segments** plutôt que du HTML surligné : le rendu reste au
 * composant, et rien de ce qui vient de la base ne traverse `dangerouslySet…`.
 *
 * La comparaison est insensible à la casse via `toLocaleLowerCase()` — le
 * corpus est majoritairement japonais (où la casse n'existe pas), mais les
 * titres et les crédits latins, eux, en ont.
 */
export function extraireSegments(
	texte: string,
	terme: string,
	options: { contexte?: number; max?: number } = {}
): Segment[] {
	const contexte = options.contexte ?? 60;
	const max = options.max ?? 3;
	const cible = terme.trim();
	if (!cible) return [{ texte: texte.slice(0, contexte * 2), correspond: false }];

	// Repérage insensible à la casse SANS changer les longueurs : `İ` (U+0130)
	// devient deux unités en minuscule, et les offsets calculés sur la version
	// minuscule ne pointaient alors plus les bonnes positions dans le texte
	// d'origine — surlignage décalé. `toLowerCase()` par caractère préserve la
	// correspondance d'index quand la conversion s'allonge : on retombe sur le
	// caractère d'origine dans ce cas.
	const memeLongueur = (t: string) =>
		Array.from(t)
			.map((c) => {
				const bas = c.toLocaleLowerCase();
				return bas.length === c.length ? bas : c;
			})
			.join("");
	const foin = memeLongueur(texte);
	const aiguille = memeLongueur(cible);
	const positions: number[] = [];
	let i = foin.indexOf(aiguille);
	while (i !== -1 && positions.length < max) {
		positions.push(i);
		i = foin.indexOf(aiguille, i + aiguille.length);
	}
	if (positions.length === 0) {
		return [{ texte: texte.slice(0, contexte * 2), correspond: false }];
	}

	const segments: Segment[] = [];
	let curseur = Math.max(0, positions[0] - contexte);
	if (curseur > 0) segments.push({ texte: "…", correspond: false });

	for (const pos of positions) {
		// Les occurrences proches se rejoignent en un seul extrait continu ; les
		// éloignées sont séparées par une ellipse, sans jamais revenir en arrière.
		const debut = Math.max(curseur, pos - contexte);
		if (debut > curseur) segments.push({ texte: "…", correspond: false });
		if (debut < pos) segments.push({ texte: texte.slice(debut, pos), correspond: false });
		segments.push({ texte: texte.slice(pos, pos + cible.length), correspond: true });
		curseur = pos + cible.length;
	}

	const fin = Math.min(texte.length, curseur + contexte);
	if (fin > curseur) segments.push({ texte: texte.slice(curseur, fin), correspond: false });
	if (fin < texte.length) segments.push({ texte: "…", correspond: false });
	return segments;
}
