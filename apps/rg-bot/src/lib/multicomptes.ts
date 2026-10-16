/**
 * Rapprochement de comptes — reconnaître les doubles comptes d'une même
 * personne, sans jamais prétendre les prouver.
 *
 * ── LE PROBLÈME, TEL QU'IL SE POSE VRAIMENT ────────────────────────────────
 * Discord ne donne AUCUN identifiant de personne. Pas d'adresse IP, pas
 * d'empreinte d'appareil, pas de courriel : l'API du bot ne voit qu'un flocon
 * par compte, et deux comptes d'une même personne y sont aussi étrangers l'un à
 * l'autre que deux inconnus. Tout ce qui suit part donc de ce qu'on observe
 * réellement — un pseudo, une image, deux dates, une trace d'activité — et
 * n'aboutit jamais à mieux qu'une PRÉSOMPTION.
 *
 * C'est pour ça que ce module compte, classe et résume, exactement comme
 * `lib/sanctions.ts` — et qu'il ne sanctionne rien, ne bannit rien, ne
 * recommande rien. « Deux comptes rapprochés ⇒ exclusion » est une règle de
 * communauté, pas une règle de code : l'écrire ici la rendrait invisible au
 * staff qui l'applique, et un bot qui affiche « à bannir » est lu comme un avis.
 *
 * ── CE QUI DISTINGUE UN INDICE D'UNE PREUVE ────────────────────────────────
 * Un seul indice est une COÏNCIDENCE (`liaison` mis à part, qui n'en est pas
 * une : deux comptes Discord rattachés au même compte du site, c'est la
 * personne elle-même qui l'a déclaré en se connectant). Le reste ne vaut qu'en
 * faisceau — un avatar partagé ET un pseudo voisin ET une arrivée à la minute
 * près. Les poids sont donc calibrés pour qu'aucun indice faible ne franchisse
 * seul le seuil de `fort`.
 *
 * Encore faut-il que les indices soient VRAIMENT distincts. Deux pièges, tous
 * deux relevés sur les données réelles et corrigés depuis :
 *
 *   - le même surnom était facturé DEUX fois (indice `surnom`, puis indice
 *     `pseudo` qui le retrouvait comme meilleure ressemblance) — 42 points,
 *     soit le seuil de `fort`, sur UNE seule observation ;
 *   - les trois indices de DATE (`creation`, `arrivee`, `jeune`) décrivent le
 *     même fait — deux personnes se sont inscrites en même temps. Ils partagent
 *     désormais un budget (`PLAFOND_TEMPOREL`), sans quoi 92 % des
 *     rapprochements reposaient sur eux seuls.
 *
 * ── LE PIÈGE QUI REND CE GENRE D'OUTIL INUTILISABLE ────────────────────────
 * La fréquence. Relevé sur la production le 29/8/2026 : 25 comptes portent la
 * MÊME URL d'avatar par défaut (`/embed/avatars/1.png` — Discord en sert cinq
 * pour tout le serveur), et une image personnalisée populaire est partagée par
 * huit comptes qui n'ont rien à voir. Un score qui traite « partagé par 2 » et
 * « partagé par 25 » de la même façon noie les vrais rapprochements sous des
 * centaines de faux. D'où deux garde-fous, tous deux vérifiés par les tests :
 *
 *   1. les avatars PAR DÉFAUT ne sont pas des empreintes (`empreinteAvatar`
 *      rend `null`) — ils ne disent rien d'autre que « ce compte n'a pas
 *      d'avatar » ;
 *   2. le poids d'un indice partagé DÉCROÎT avec la taille de sa grappe
 *      (`poidsDegressif`) : à huit comptes, une image commune ne vaut presque
 *      plus rien.
 *
 * ── CE QU'ON A REFUSÉ D'UTILISER ───────────────────────────────────────────
 * L'ADRESSE POSTALE. `profiles` porte les adresses de livraison des acheteurs
 * de la boutique, et deux commandes expédiées à la même adresse seraient un
 * indice puissant. Il est écarté, et pas pour une raison technique : son faux
 * positif le plus probable, ce sont deux frères et sœurs — c'est-à-dire
 * exactement le double compte LÉGITIME que l'outil doit épargner. Et l'afficher
 * au staff révélerait que deux membres vivent sous le même toit, ce qui est une
 * donnée personnelle qu'aucune question de modération ne justifie de divulguer
 * dans un salon Discord. Le rapprochement se fait sans elle.
 *
 * L'ADRESSE IP, pour mémoire, n'est pas un choix : Discord ne la donne pas.
 *
 * ── MODULE PUR ─────────────────────────────────────────────────────────────
 * Aucune E/S, aucun `discord.js`, aucun SQL. Les données arrivent en
 * `EmpreinteCompte`, montées par `services/multicomptes.ts`. C'est ce qui rend
 * le calibrage testable sans base ni passerelle.
 */

// ─── Le temps de Discord ────────────────────────────────────────────────────

/**
 * Origine des flocons Discord (1ᵉʳ janvier 2015, UTC).
 *
 * Elle vaut une donnée à elle seule : la date de création d'un compte est
 * ENCODÉE dans son identifiant, et c'est la seule information que le bot obtient
 * sans rien demander à personne. Deux comptes créés à quelques minutes
 * d'intervalle, c'est le premier signe d'un double compte préparé d'avance.
 */
export const EPOQUE_DISCORD = 1_420_070_400_000;

/** Date de création d'un compte, lue dans son flocon. `null` si l'identifiant n'en est pas un. */
export function dateDeCreation(flocon: string | null | undefined): Date | null {
	if (typeof flocon !== "string" || !/^\d{15,25}$/.test(flocon)) {
		return null;
	}
	const instant = Number(BigInt(flocon) >> 22n) + EPOQUE_DISCORD;
	// Un flocon valide ne peut pas décrire un compte antérieur à Discord.
	return instant >= EPOQUE_DISCORD ? new Date(instant) : null;
}

// ─── Normalisation des identités ────────────────────────────────────────────

/**
 * Substitutions « leet ». Elles ne sont pas décoratives : `m4rk_0`, `mark0` et
 * `MARK-O` sont le même pseudo pour qui le lit, et trois chaînes différentes
 * pour qui le compare. Sans cette table, la ruse la plus répandue — remplacer
 * une lettre par le chiffre qui lui ressemble — suffit à passer sous le radar.
 */
const LEET: Readonly<Record<string, string>> = Object.freeze({
	"0": "o",
	"1": "i",
	"3": "e",
	"4": "a",
	"5": "s",
	"7": "t",
	"8": "b",
	"@": "a",
	$: "s",
	"!": "i",
	"|": "l",
	"€": "e",
});

/**
 * Forme comparable d'un pseudo : minuscules, sans accent, sans ponctuation,
 * chiffres-lettres rétablis.
 *
 * `Éliàs_Ｍ4rk` donne `eliasmark`. La décomposition est NFKD et non NFD : elle
 * ramène AUSSI les caractères pleine largeur et les alphabets décoratifs
 * (gothique mathématique, petites capitales) à leur équivalent ASCII. C'est
 * exactement ce qu'il faut ici — un pseudo écrit en 𝓵𝓮𝓽𝓽𝓻𝓮𝓼 𝓭𝓮 𝓯𝓪𝓷𝓽𝓪𝓲𝓼𝓲𝓮 est
 * illisible pour une comparaison, et c'est souvent le but.
 */
export function normaliserPseudo(valeur: string | null | undefined): string {
	if (typeof valeur !== "string") {
		return "";
	}
	const brut = valeur
		.normalize("NFKD")
		// Diacritiques décomposés par NFKD.
		.replaceAll(/[\u0300-\u036f]/g, "")
		.toLowerCase();
	// Le pliage « leet » ne s'applique qu'à un pseudo qui contient de vraies
	// lettres. Sans cette garde, un pseudo entièrement numérique — il y en a sur
	// le serveur (`6953480392`, `062t`) — deviendrait une pseudo-chaîne de
	// lettres (`2024` → `2o2a`) qui ne ressemble à rien et se met à rapprocher
	// des comptes sur du bruit.
	const lettres = brut.match(/[a-z]/g)?.length ?? 0;
	const plie = lettres >= 2 ? brut.replaceAll(/[0134578@$!|€]/g, (c) => LEET[c] ?? c) : brut;
	return plie.replaceAll(/[^a-z0-9]/g, "");
}

/**
 * Suffixes qui ne distinguent pas deux comptes.
 *
 * Un double compte s'appelle presque toujours comme le premier, avec quelque
 * chose derrière : un chiffre, `alt`, `bis`, `2`. Les retirer fait tomber
 * `markevans` et `markevans_alt2` sur la même racine — c'est le rapprochement
 * le plus fréquent, et le plus facile à manquer.
 */
const SUFFIXES_DE_DOUBLE = [
	"alt",
	"altcompte",
	"bis",
	"ter",
	"second",
	"secondaire",
	"double",
	"backup",
	"bkp",
	"new",
	"nouveau",
	"reborn",
	"retour",
	"return",
	"real",
	"vrai",
	"officiel",
	"official",
	"off",
	"tv",
	"yt",
	"ttv",
	"fr",
] as const;

/**
 * Racine d'un pseudo : sa forme normalisée, débarrassée des chiffres et des
 * suffixes de queue, et dont les lettres répétées sont réduites.
 *
 * La réduction des répétitions (`marrrrk` → `mark`) traite l'autre ruse
 * courante — étirer une lettre pour changer la chaîne sans changer le mot lu.
 * Elle rapproche aussi des orthographes légitimement différentes (`emma` et
 * `ema`), ce qui est souhaitable ici : on cherche des candidats à examiner, pas
 * une égalité.
 *
 * Rend `""` quand il ne reste pas assez de matière pour discriminer : une
 * racine de deux caractères rapprocherait la moitié du serveur.
 */
export function racinePseudo(valeur: string | null | undefined): string {
	// Le retrait de queue se fait AVANT le pliage leet, sur une chaîne seulement
	// mise en minuscules et désaccentuée : après le pliage, un chiffre de queue
	// n'est plus reconnaissable comme tel — `christo931` vaut `christo9ei`, qui ne
	// finit plus par un chiffre et garderait son suffixe pour toujours.
	let queue =
		typeof valeur === "string"
			? valeur
					.normalize("NFKD")
					.replaceAll(/[\u0300-\u036f]/g, "")
					.toLowerCase()
			: "";
	// Un retrait à la fois, en boucle : `markalt2` perd d'abord son `2`, puis son
	// `alt` ; `markofficielfr` en porte deux.
	let coupe = true;
	while (coupe) {
		coupe = false;
		const sansChiffres = queue.replace(/[^a-z0-9]*\d+[^a-z0-9]*$/, "");
		if (sansChiffres.length > 0 && sansChiffres !== queue) {
			queue = sansChiffres;
			coupe = true;
			continue;
		}
		const normalisee = normaliserPseudo(queue);
		for (const suffixe of SUFFIXES_DE_DOUBLE) {
			if (normalisee.length > suffixe.length + 2 && normalisee.endsWith(suffixe)) {
				// Le suffixe est reconnu sur la forme normalisée, mais retranché de la
				// chaîne brute — seule à porter encore les chiffres non pliés.
				const position = queue.lastIndexOf(suffixe);
				if (position <= 0) {
					break;
				}
				queue = queue.slice(0, position);
				coupe = true;
				break;
			}
		}
	}
	const base = normaliserPseudo(queue).replace(/\d+$/, "");
	const reduite = base.replaceAll(/(.)\1+/g, "$1");
	return reduite.length >= 3 ? reduite : "";
}

// ─── Distance entre deux chaînes ────────────────────────────────────────────

/**
 * Distance de Levenshtein, avec abandon anticipé.
 *
 * Le plafond n'est pas une optimisation cosmétique : un balayage complet du
 * serveur compare des dizaines de milliers de paires de pseudos, et la seule
 * question posée est « sont-ils PROCHES ». Dès que la ligne courante dépasse le
 * plafond, la réponse est non et le calcul s'arrête.
 */
export function distance(a: string, b: string, plafond = Number.POSITIVE_INFINITY): number {
	if (a === b) {
		return 0;
	}
	if (a.length === 0 || b.length === 0) {
		return Math.max(a.length, b.length);
	}
	if (Math.abs(a.length - b.length) > plafond) {
		return plafond + 1;
	}

	let precedente = Array.from({ length: b.length + 1 }, (_, i) => i);
	let courante = Array.from<number>({ length: b.length + 1 });
	for (let i = 1; i <= a.length; i++) {
		courante[0] = i;
		let minimum = i;
		for (let j = 1; j <= b.length; j++) {
			const cout = a[i - 1] === b[j - 1] ? 0 : 1;
			const valeur = Math.min(
				(courante[j - 1] ?? 0) + 1,
				(precedente[j] ?? 0) + 1,
				(precedente[j - 1] ?? 0) + cout
			);
			courante[j] = valeur;
			if (valeur < minimum) {
				minimum = valeur;
			}
		}
		if (minimum > plafond) {
			return plafond + 1;
		}
		const echange = precedente;
		precedente = courante;
		courante = echange;
	}
	return precedente[b.length] ?? Math.max(a.length, b.length);
}

/** Ressemblance de deux chaînes, de 0 (rien de commun) à 1 (identiques). */
export function similarite(a: string, b: string): number {
	const longueur = Math.max(a.length, b.length);
	if (longueur === 0) {
		return 0;
	}
	// Au-delà de la moitié de la chaîne, la ressemblance ne nous intéresse plus :
	// le plafond épargne le calcul complet.
	const plafond = Math.ceil(longueur / 2);
	const d = distance(a, b, plafond);
	return d > plafond ? 0 : 1 - d / longueur;
}

// ─── Avatars ────────────────────────────────────────────────────────────────

/**
 * Empreinte d'un avatar : le condensat que Discord met dans l'URL.
 *
 * Il est dérivé du CONTENU de l'image — deux comptes qui téléversent le même
 * fichier obtiennent le même condensat. C'est l'indice le plus lisible qui
 * existe ici, et le seul qui se vérifie à l'œil.
 *
 * Rend `null` pour les avatars PAR DÉFAUT (`/embed/avatars/3.png`) : Discord
 * n'en sert que cinq pour toute la plateforme. Relevé sur la production le
 * 29/8/2026 : 122 membres se répartissaient ces cinq images, dont 25 sur la
 * même. Les compter comme une ressemblance produirait, à lui seul, plus de
 * fausses paires que le reste du module n'en produit de vraies.
 */
export function empreinteAvatar(url: string | null | undefined): string | null {
	if (typeof url !== "string" || url.length === 0) {
		return null;
	}
	if (url.includes("/embed/avatars/")) {
		return null;
	}
	const trouve = /\/([a-z0-9_]+)\.(?:png|webp|gif|jpg|jpeg)(?:\?|$)/i.exec(url);
	const condensat = trouve?.[1] ?? null;
	// Un condensat Discord fait 32 caractères hexadécimaux, préfixé `a_` quand
	// l'image est animée. Tout le reste (un nom de fichier, un identifiant de
	// membre) rapprocherait des comptes sur autre chose que leur image.
	return condensat && /^(a_)?[a-f0-9]{32}$/i.test(condensat) ? condensat.toLowerCase() : null;
}

// ─── Ce qu'on sait d'un compte ──────────────────────────────────────────────

/**
 * Tout ce que le bot peut observer d'un compte, réuni en un objet.
 *
 * Aucune donnée personnelle ne figure ici, et c'est une contrainte, pas un
 * hasard : `liaisons` porte des empreintes (`courriel:<condensat>`), jamais une
 * adresse. Un rapport de rapprochement s'affiche dans Discord — il ne doit pas
 * pouvoir y déverser l'adresse postale d'un acheteur de la boutique.
 */
export interface EmpreinteCompte {
	readonly discordId: string;
	/** `username` — l'identifiant public, unique sur Discord. */
	readonly pseudo: string;
	/** `global_name` — le nom d'affichage, libre et souvent recopié d'un compte à l'autre. */
	readonly nomAffiche: string | null;
	/** Surnom posé sur CE serveur. */
	readonly surnom: string | null;
	readonly avatar: string | null;
	readonly arriveeLe: Date | null;
	/** Date de départ du serveur, `null` s'il est présent. */
	readonly partiLe: Date | null;
	readonly roles: readonly string[];
	/** Nombre de messages archivés. Sert de garde : sans activité, pas d'analyse temporelle. */
	readonly messages: number;
	/**
	 * Identités déclarées par la personne elle-même, sous forme d'empreintes
	 * opaques : `profil:<uuid>`, `courriel:<condensat>`, `steam:<id>`,
	 * `adresse:<condensat>`. Deux comptes qui en partagent une ne se ressemblent
	 * pas — ils sont rattachés au même dossier.
	 */
	readonly liaisons: readonly string[];
}

/**
 * Ce que l'archive des messages dit d'un COUPLE de comptes.
 *
 * Calculé à la demande, pour les seules paires déjà candidates : croiser
 * l'activité de deux mille membres deux à deux n'a aucun sens quand la question
 * ne se pose que pour quelques dizaines de couples.
 */
export interface ActiviteCroisee {
	/** Créneaux de dix minutes où chacun a écrit. */
	readonly creneauxA: number;
	readonly creneauxB: number;
	/** Créneaux où les DEUX ont écrit. */
	readonly creneauxCommuns: number;
	/** Nombre de salons fréquentés par les deux. */
	readonly salonsCommuns: number;
}

// ─── Les indices ────────────────────────────────────────────────────────────

export const CLES_INDICE = [
	"liaison",
	"avatar",
	"surnom",
	"racine",
	"pseudo",
	"releve",
	"creation",
	"arrivee",
	"jeune",
	"alternance",
	"simultaneite",
] as const;

export type CleIndice = (typeof CLES_INDICE)[number];

export interface Indice {
	readonly cle: CleIndice;
	readonly libelle: string;
	readonly icone: string;
	/** Points apportés au score. Négatif pour ce qui ÉLOIGNE (`simultaneite`). */
	readonly poids: number;
	/** La constatation, en une ligne affichable. */
	readonly detail: string;
}

/**
 * Poids maximum de chaque indice.
 *
 * ── COMMENT ILS SONT CALIBRÉS ──────────────────────────────────────────────
 * Le seuil de `fort` est 42. Aucun indice observable ne l'atteint seul : il
 * faut au moins deux constatations indépendantes. Seule `liaison` fait
 * exception, et pour une raison qui n'est pas de degré mais de nature — ce
 * n'est pas une ressemblance, c'est un rattachement que la personne a
 * elle-même établi en connectant ses deux comptes au même profil du site.
 */
export const POIDS: Readonly<Record<CleIndice, number>> = Object.freeze({
	liaison: 70,
	avatar: 34,
	surnom: 24,
	releve: 24,
	racine: 22,
	pseudo: 18,
	creation: 18,
	arrivee: 16,
	jeune: 8,
	alternance: 18,
	simultaneite: -8,
});

/**
 * Budget commun aux indices de DATE (`creation`, `arrivee`, `jeune`).
 *
 * Il vaut le seuil de « à examiner », et pas un point de plus : une cohorte
 * d'arrivée mérite un coup d'œil, jamais l'étiquette « faisceau d'indices ».
 * Sans plafond, leur somme atteignait 42 — le seuil de `fort` — sur deux
 * comptes n'ayant aucun trait d'identité commun.
 */
export const PLAFOND_TEMPOREL = 24;

/** Les indices qui ne parlent que de dates, et partagent donc un seul budget. */
const EST_TEMPOREL: ReadonlySet<CleIndice> = new Set<CleIndice>([
	"creation",
	"arrivee",
	"jeune",
]);

const ICONES_INDICE: Readonly<Record<CleIndice, string>> = Object.freeze({
	liaison: "🔗",
	avatar: "🖼️",
	surnom: "🏷️",
	racine: "🔤",
	pseudo: "🔤",
	releve: "🔁",
	creation: "🥚",
	arrivee: "🚪",
	jeune: "🌱",
	alternance: "🕰️",
	simultaneite: "👥",
});

/**
 * Poids d'un indice PARTAGÉ, décroissant avec la taille de sa grappe.
 *
 * Deux comptes avec la même image, c'est une piste. Huit comptes avec la même
 * image, c'est une image populaire — et c'est le cas réel relevé en
 * production. La décroissance est brutale exprès : au-delà de cinq, un partage
 * ne vaut plus qu'une note de bas de page.
 */
export function poidsDegressif(poidsMaximum: number, tailleGrappe: number): number {
	if (!Number.isFinite(tailleGrappe) || tailleGrappe <= 2) {
		return poidsMaximum;
	}
	const facteurs = [1, 1, 1, 0.55, 0.38, 0.26];
	const facteur = facteurs[tailleGrappe] ?? 0.12;
	return Math.round(poidsMaximum * facteur);
}

/** Nom lisible de chaque indice — l'en-tête d'une ligne de rapport. */
export const LIBELLES_INDICE: Readonly<Record<CleIndice, string>> = Object.freeze({
	liaison: "Même compte du site",
	avatar: "Même avatar",
	surnom: "Même surnom",
	racine: "Même racine de pseudo",
	pseudo: "Pseudos voisins",
	releve: "Relève",
	creation: "Créations rapprochées",
	arrivee: "Arrivées rapprochées",
	jeune: "Compte neuf",
	alternance: "Activités alternées",
	simultaneite: "Activités simultanées",
});

/** Ce que dit une liaison partagée, sans jamais dire sa valeur. */
const NATURE_LIAISON: Readonly<Record<string, string>> = Object.freeze({
	profil: "même profil du site",
	courriel: "même adresse de courriel",
	steam: "même compte Steam",
	patreon: "même compte Patreon",
});

// ─── Niveaux ────────────────────────────────────────────────────────────────

export const NIVEAUX = ["faible", "possible", "fort", "certain"] as const;

export type Niveau = (typeof NIVEAUX)[number];

/** Seuil d'entrée de chaque niveau, du plus haut au plus bas. */
export const SEUILS: ReadonlyArray<readonly [Niveau, number]> = Object.freeze([
	["certain", 65],
	["fort", 42],
	["possible", 24],
	["faible", 12],
] as const);

export function niveauDeScore(score: number): Niveau | null {
	for (const [niveau, seuil] of SEUILS) {
		if (score >= seuil) {
			return niveau;
		}
	}
	return null;
}

export const LIBELLES_NIVEAU: Readonly<Record<Niveau, string>> = Object.freeze({
	certain: "Rattachement établi",
	fort: "Faisceau d'indices",
	possible: "À examiner",
	faible: "Coïncidence",
});

export const ICONES_NIVEAU: Readonly<Record<Niveau, string>> = Object.freeze({
	certain: "🟥",
	fort: "🟧",
	possible: "🟨",
	faible: "⬜",
});

// ─── Un rapprochement ───────────────────────────────────────────────────────

export interface Rapprochement {
	/** Le compte le plus ANCIEN des deux (par date de création). */
	readonly compteA: string;
	/** Le plus RÉCENT — celui qui serait le double, si double il y a. */
	readonly compteB: string;
	readonly score: number;
	readonly niveau: Niveau;
	readonly indices: readonly Indice[];
}

export interface OptionsComparaison {
	/** Nombre de comptes qui partagent l'avatar de la paire (1 si l'un des deux n'en a pas). */
	readonly tailleGrappeAvatar?: number;
	/** Nombre de comptes qui partagent la racine de pseudo de la paire. */
	readonly tailleGrappeRacine?: number;
	readonly activite?: ActiviteCroisee | null;
}

/** Fenêtres de temps, en millisecondes. */
const HEURE = 3_600_000;
const JOUR = 24 * HEURE;

/**
 * Barème dégressif d'un écart de temps : plus deux dates sont proches, plus
 * l'indice pèse. Rend `0` au-delà de la dernière borne.
 */
function poidsDEcart(
	ecartMs: number,
	bornes: ReadonlyArray<readonly [number, number]>
): number | null {
	for (const [limite, poids] of bornes) {
		if (ecartMs <= limite) {
			return poids;
		}
	}
	return null;
}

/** Écart en clair : « 4 min », « 3 h », « 12 j ». */
export function ecartLisible(ms: number): string {
	const absolu = Math.abs(ms);
	if (absolu < HEURE) {
		return `${Math.max(1, Math.round(absolu / 60_000))} min`;
	}
	if (absolu < JOUR) {
		return `${Math.round(absolu / HEURE)} h`;
	}
	return `${Math.round(absolu / JOUR)} j`;
}

/**
 * Toutes les chaînes d'identité d'un compte, normalisées et dédoublonnées.
 *
 * `exclure` retire une chaîne déjà comptée ailleurs. Sans elle, deux comptes
 * portant le MÊME surnom se voyaient facturer deux fois la même constatation —
 * l'indice `surnom` (24) puis l'indice `pseudo` (18), qui retrouvait forcément
 * ce surnom comme meilleure ressemblance. Total : 42, c'est-à-dire exactement
 * le seuil de « faisceau d'indices », atteint par UNE seule observation. Or
 * « Capitaine » ou « Coach » sont des surnoms de serveur que plusieurs membres
 * peuvent porter sans avoir le moindre rapport.
 */
function identites(compte: EmpreinteCompte, exclure?: string): string[] {
	return [
		...new Set(
			[compte.pseudo, compte.nomAffiche, compte.surnom]
				.map(normaliserPseudo)
				.filter((valeur) => valeur.length >= 3 && valeur !== exclure)
		),
	];
}

/**
 * Compare deux comptes et rend le rapprochement, ou `null` s'il n'atteint même
 * pas le niveau `faible`.
 *
 * L'ordre du couple est normalisé : `compteA` est toujours le compte créé en
 * premier. Sans ça, la même paire produirait deux entrées différentes selon
 * l'ordre de parcours, et un verdict posé sur l'une ne masquerait pas l'autre.
 */
export function comparer(
	premier: EmpreinteCompte,
	second: EmpreinteCompte,
	options: OptionsComparaison = {}
): Rapprochement | null {
	if (premier.discordId === second.discordId) {
		return null;
	}
	const creationPremier = dateDeCreation(premier.discordId)?.getTime() ?? 0;
	const creationSecond = dateDeCreation(second.discordId)?.getTime() ?? 0;
	const [a, b] = creationPremier <= creationSecond ? [premier, second] : [second, premier];
	const creationA = Math.min(creationPremier, creationSecond);
	const creationB = Math.max(creationPremier, creationSecond);

	const indices: Indice[] = [];
	const poser = (cle: CleIndice, poids: number, detail: string, libelle?: string): void => {
		if (poids === 0) {
			return;
		}
		indices.push({
			cle,
			detail,
			icone: ICONES_INDICE[cle],
			libelle: libelle ?? LIBELLES_INDICE[cle],
			poids,
		});
	};

	// ── Rattachements déclarés ───────────────────────────────────────────────
	// Ce ne sont pas des ressemblances : la personne a relié elle-même ses deux
	// comptes Discord au même dossier. On les traite à part, et on ne les
	// affiche jamais autrement que par leur NATURE (« même profil du site »),
	// jamais par leur valeur — un condensat de courriel n'a rien à faire dans un
	// embed, et l'adresse encore moins.
	const rattachements = a.liaisons.filter((liaison) => b.liaisons.includes(liaison));
	if (rattachements.length > 0) {
		poser(
			"liaison",
			POIDS.liaison,
			[
				...new Set(
					rattachements.map(
						(liaison) => NATURE_LIAISON[liaison.split(":")[0] ?? ""] ?? "identité commune"
					)
				),
			].join(", ")
		);
	}

	// ── Avatar ───────────────────────────────────────────────────────────────
	const avatarA = empreinteAvatar(a.avatar);
	const avatarB = empreinteAvatar(b.avatar);
	if (avatarA && avatarA === avatarB) {
		const taille = options.tailleGrappeAvatar ?? 2;
		const poids = poidsDegressif(POIDS.avatar, taille);
		poser(
			"avatar",
			poids,
			taille > 2
				? `image identique — mais partagée par ${taille} comptes, donc peu discriminante`
				: "image de profil identique (même fichier téléversé)"
		);
	}

	// ── Identités ────────────────────────────────────────────────────────────
	const surnomA = normaliserPseudo(a.surnom);
	const surnomPartage = surnomA.length >= 3 && surnomA === normaliserPseudo(b.surnom);
	if (surnomPartage) {
		poser("surnom", POIDS.surnom, `même surnom sur le serveur (« ${a.surnom} »)`);
	}

	const racineA = racinePseudo(a.pseudo);
	const racineB = racinePseudo(b.pseudo);
	if (racineA.length > 0 && racineA === racineB) {
		const taille = options.tailleGrappeRacine ?? 2;
		poser(
			"racine",
			poidsDegressif(POIDS.racine, taille),
			taille > 2
				? `même racine de pseudo « ${racineA} » — portée par ${taille} comptes`
				: `même racine de pseudo (« ${a.pseudo} » / « ${b.pseudo} »)`
		);
	} else {
		// Aucune racine commune : on cherche la meilleure ressemblance entre TOUTES
		// les identités des deux comptes — un pseudo d'un côté vaut un nom
		// d'affichage de l'autre, c'est même le cas le plus fréquent.
		let meilleure = 0;
		let couple: [string, string] | null = null;
		// Le surnom déjà facturé par l'indice `surnom` est retiré des deux côtés :
		// une même constatation ne doit peser qu'une fois.
		const dejaCompte = surnomPartage ? surnomA : undefined;
		for (const gauche of identites(a, dejaCompte)) {
			for (const droite of identites(b, dejaCompte)) {
				const score = similarite(gauche, droite);
				if (score > meilleure) {
					meilleure = score;
					couple = [gauche, droite];
				}
			}
		}
		if (meilleure >= 0.72 && couple) {
			// De 0,72 (le seuil) à 1 (identique), étalé sur tout le poids.
			const poids = Math.round(POIDS.pseudo * ((meilleure - 0.72) / 0.28) ** 0.6);
			poser(
				"pseudo",
				Math.max(poids, 4),
				`identités voisines : « ${couple[0]} » ≈ « ${couple[1]} » (${Math.round(meilleure * 100)} %)`
			);
		}
	}

	// ── Dates ────────────────────────────────────────────────────────────────
	//
	// ⚠ CES TROIS INDICES NE SONT PAS INDÉPENDANTS, et les additionner à plein
	// poids était le principal défaut de calibrage de ce module. Deux amis
	// invités le même soir créent leur compte dans la même demi-heure ET
	// rejoignent dans la même minute ET sont neufs à l'arrivée : trois indices,
	// 42 points, c'est-à-dire « faisceau d'indices » sur deux personnes qui n'ont
	// fait que cliquer sur la même invitation.
	//
	// Mesuré sur la production du 29/8/2026 : 1 234 des 1 338 rapprochements
	// (92 %) ne reposaient QUE sur ces trois-là, dont `lord098861 ↔ ksar0075`
	// (37 points, avatars par défaut différents, pseudos sans rapport).
	//
	// La cohorte d'arrivée est un CONTEXTE, pas une preuve : le budget commun la
	// plafonne au niveau « à examiner », qu'elle ne peut plus dépasser seule.
	let budgetTemporel = PLAFOND_TEMPOREL;
	const poserTemporel = (cle: CleIndice, poids: number, detail: string): void => {
		const accorde = Math.min(poids, budgetTemporel);
		if (accorde <= 0) {
			return;
		}
		budgetTemporel -= accorde;
		poser(
			cle,
			accorde,
			accorde < poids ? `${detail} — plafonné, les dates ne sont pas des indices séparés` : detail
		);
	};

	if (creationA > 0 && creationB > 0) {
		const ecart = creationB - creationA;
		const poids = poidsDEcart(ecart, [
			[6 * HEURE, POIDS.creation],
			[3 * JOUR, 13],
			[14 * JOUR, 8],
			[45 * JOUR, 4],
		]);
		if (poids !== null) {
			poserTemporel("creation", poids, `comptes créés à ${ecartLisible(ecart)} d'intervalle`);
		}
	}

	if (a.arriveeLe && b.arriveeLe) {
		const ecart = Math.abs(b.arriveeLe.getTime() - a.arriveeLe.getTime());
		const poids = poidsDEcart(ecart, [
			[10 * 60_000, POIDS.arrivee],
			[HEURE, 11],
			[JOUR, 6],
			[3 * JOUR, 3],
		]);
		if (poids !== null) {
			poserTemporel("arrivee", poids, `arrivés sur le serveur à ${ecartLisible(ecart)} d'intervalle`);
		}
	}

	// ── La relève ────────────────────────────────────────────────────────────
	// Le motif du contournement de sanction : un compte quitte le serveur (ou en
	// est sorti), un autre arrive dans la foulée. C'est le seul indice qui porte
	// une ORIENTATION — il ne dit pas « ces comptes se ressemblent » mais « ce
	// compte-ci a pris la suite de celui-là ».
	if (a.partiLe && b.arriveeLe && b.arriveeLe.getTime() >= a.partiLe.getTime()) {
		const ecart = b.arriveeLe.getTime() - a.partiLe.getTime();
		const poids = poidsDEcart(ecart, [
			[2 * HEURE, POIDS.releve],
			[2 * JOUR, 15],
			[7 * JOUR, 7],
		]);
		if (poids !== null) {
			poser(
				"releve",
				poids,
				`arrivé ${ecartLisible(ecart)} après le départ de l'autre compte`
			);
		}
	}

	// ── Compte neuf à l'arrivée ──────────────────────────────────────────────
	// Attribut d'un seul des deux comptes, mais il ne vaut qu'en couple : un
	// compte créé la veille de son arrivée est banal ; créé la veille de son
	// arrivée ALORS QU'il ressemble à un membre déjà là, il l'est beaucoup moins.
	if (b.arriveeLe && creationB > 0) {
		const age = b.arriveeLe.getTime() - creationB;
		// Il faut un indice d'IDENTITÉ, pas seulement une date : « créé la veille
		// de son arrivée » décrit la moitié des nouveaux membres d'un serveur, et
		// l'accoler à « arrivé le même jour qu'un autre » ne dit rien de plus que
		// « deux personnes se sont inscrites en même temps ».
		if (age >= 0 && age <= 7 * JOUR && indices.some((indice) => !EST_TEMPOREL.has(indice.cle))) {
			poserTemporel(
				"jeune",
				POIDS.jeune,
				`le compte le plus récent a rejoint ${ecartLisible(age)} après sa création`
			);
		}
	}

	// ── Activité ─────────────────────────────────────────────────────────────
	// L'alternance parfaite — jamais actifs dans les mêmes dix minutes alors
	// qu'ils écrivent dans les mêmes salons — est la signature d'une seule
	// personne qui bascule d'un compte à l'autre.
	//
	// Le garde-fou est indispensable : l'archive ne couvre que les salons suivis
	// et un membre sur huit. Sans minimum d'activité des DEUX côtés, « aucun
	// créneau commun » ne veut dire qu'une chose — on n'a pas de données.
	const activite = options.activite ?? null;
	if (activite && activite.creneauxA >= 25 && activite.creneauxB >= 25 && activite.salonsCommuns >= 2) {
		const recouvrement =
			activite.creneauxCommuns / Math.max(1, Math.min(activite.creneauxA, activite.creneauxB));
		if (activite.creneauxCommuns === 0) {
			poser(
				"alternance",
				POIDS.alternance,
				`jamais actifs dans le même quart d'heure, sur ${activite.salonsCommuns} salons communs`
			);
		} else if (recouvrement <= 0.02) {
			poser("alternance", 10, `activités quasi disjointes (${Math.round(recouvrement * 100)} % de créneaux communs)`);
		} else if (recouvrement >= 0.25) {
			// Ce n'est PAS une preuve d'innocence — une personne tient très bien deux
			// comptes de front, sur deux appareils. Le poids négatif reste léger, et
			// l'indice s'affiche pour ce qu'il est : une constatation contraire.
			poser(
				"simultaneite",
				POIDS.simultaneite,
				`souvent actifs en même temps (${Math.round(recouvrement * 100)} % de créneaux communs)`
			);
		}
	}

	const score = Math.max(0, Math.min(100, indices.reduce((somme, indice) => somme + indice.poids, 0)));
	// Un rattachement déclaré n'est pas affaire de score : deux comptes reliés au
	// même dossier le sont, même si tout le reste diverge.
	const niveau = rattachements.length > 0 ? "certain" : niveauDeScore(score);
	if (!niveau) {
		return null;
	}
	return {
		compteA: a.discordId,
		compteB: b.discordId,
		indices: indices.toSorted((gauche, droite) => droite.poids - gauche.poids),
		niveau,
		score,
	};
}



// ─── Balayage ───────────────────────────────────────────────────────────────

/**
 * Taille au-delà de laquelle une grappe ne SERT PLUS à fabriquer des candidats.
 *
 * Une clé partagée par soixante comptes (un jour de création chargé, un pseudo
 * ultra-courant) produirait 1 770 paires à elle seule, toutes sans intérêt. La
 * clé continue d'exister pour PONDÉRER une paire trouvée autrement — elle cesse
 * seulement d'en engendrer.
 */
export const GRAPPE_MAXIMALE = 25;

/**
 * Plafond par NATURE de clé.
 *
 * Un préfixe de quatre lettres est de loin la clé la moins discriminante : sur
 * un serveur francophone, treize comptes commençant par `mark` ne disent rien
 * du tout, alors que treize comptes portant la même image en disent beaucoup.
 * Un plafond unique obligeait à choisir entre laisser passer 78 paires vides
 * par préfixe courant et perdre les grappes d'avatars légitimes.
 *
 * `liaison` n'a pas de plafond : un rattachement déclaré ne se dilue pas.
 */
const PLAFONDS_GRAPPE: Readonly<Record<string, number>> = Object.freeze({
	arrivee: GRAPPE_MAXIMALE,
	avatar: GRAPPE_MAXIMALE,
	creation: GRAPPE_MAXIMALE,
	liaison: Number.POSITIVE_INFINITY,
	prefixe: 12,
	racine: GRAPPE_MAXIMALE,
});

function plafondDeGrappe(cle: string): number {
	return PLAFONDS_GRAPPE[cle.slice(0, cle.indexOf(":"))] ?? GRAPPE_MAXIMALE;
}

export interface OptionsBalayage {
	/** Niveau minimum retenu. `faible` par défaut. */
	readonly niveauMinimum?: Niveau;
	/** Activité croisée d'une paire, si elle est connue. */
	readonly activite?: (a: string, b: string) => ActiviteCroisee | null;
	/** Paires déjà tranchées par le staff, à écarter (`"a:b"`, ordre normalisé). */
	readonly ecartees?: ReadonlySet<string>;
}

export interface Balayage {
	readonly rapprochements: readonly Rapprochement[];
	/** Comptes examinés. */
	readonly comptes: number;
	/** Paires réellement comparées — la mesure du travail évité par le regroupement. */
	readonly pairesExaminees: number;
	/** Décompte par niveau. */
	readonly parNiveau: Readonly<Record<Niveau, number>>;
}

/** Clé canonique d'une paire, indépendante de l'ordre. */
export function clePaire(a: string, b: string): string {
	return a < b ? `${a}:${b}` : `${b}:${a}`;
}

const RANG_NIVEAU: Readonly<Record<Niveau, number>> = Object.freeze({
	faible: 0,
	possible: 1,
	fort: 2,
	certain: 3,
});

/**
 * Balaye une population et rend les rapprochements, du plus fort au plus faible.
 *
 * ── POURQUOI ON NE COMPARE PAS TOUT AVEC TOUT ──────────────────────────────
 * Deux mille membres, c'est deux millions de paires — et sur chacune, une
 * distance de Levenshtein entre plusieurs identités. Le balayage complet
 * tiendrait à peine dans les trois secondes d'une interaction Discord, et
 * n'apporterait rien : deux comptes sans AUCUN point commun observable ne
 * peuvent pas franchir le seuil, quel que soit le détail du calcul.
 *
 * On fabrique donc des candidats par REGROUPEMENT — même avatar, même racine de
 * pseudo, même surnom, même jour de création, même jour d'arrivée, même
 * liaison. Une paire qui ne partage aucune de ces clés est écartée sans être
 * calculée. C'est ce qui fait tenir le balayage en quelques dizaines de
 * millisecondes au lieu de plusieurs minutes.
 */
export function balayer(
	empreintes: readonly EmpreinteCompte[],
	options: OptionsBalayage = {}
): Balayage {
	const parId = new Map(empreintes.map((compte) => [compte.discordId, compte]));

	// ── Regroupements ────────────────────────────────────────────────────────
	const grappes = new Map<string, string[]>();
	const ajouter = (cle: string | null, id: string): void => {
		if (!cle) {
			return;
		}
		const existante = grappes.get(cle);
		if (existante) {
			existante.push(id);
		} else {
			grappes.set(cle, [id]);
		}
	};

	for (const compte of empreintes) {
		const avatar = empreinteAvatar(compte.avatar);
		ajouter(avatar && `avatar:${avatar}`, compte.discordId);
		const racine = racinePseudo(compte.pseudo);
		ajouter(racine && `racine:${racine}`, compte.discordId);
		// Le nom d'affichage et le surnom entrent par leur propre racine : un
		// double compte garde souvent le même nom d'affichage en changeant de
		// pseudo, parce que c'est celui que les autres lisent.
		for (const secondaire of [compte.nomAffiche, compte.surnom]) {
			const racineSecondaire = racinePseudo(secondaire);
			if (racineSecondaire && racineSecondaire !== racine) {
				ajouter(`racine:${racineSecondaire}`, compte.discordId);
			}
		}
		// Un préfixe de quatre lettres rattrape ce que la racine manque
		// (`markevans` / `markévanss2`, qui ne tombent pas sur la même racine).
		if (racine.length >= 4) {
			ajouter(`prefixe:${racine.slice(0, 4)}`, compte.discordId);
		}
		const creation = dateDeCreation(compte.discordId);
		if (creation) {
			ajouter(`creation:${Math.floor(creation.getTime() / JOUR)}`, compte.discordId);
		}
		if (compte.arriveeLe) {
			ajouter(`arrivee:${Math.floor(compte.arriveeLe.getTime() / JOUR)}`, compte.discordId);
		}
		for (const liaison of compte.liaisons) {
			ajouter(`liaison:${liaison}`, compte.discordId);
		}
	}

	// Tailles des grappes qui servent à PONDÉRER (elles restent valables même
	// quand la grappe est trop grosse pour engendrer des candidats).
	const taillesAvatar = new Map<string, number>();
	const taillesRacine = new Map<string, number>();
	for (const [cle, membres] of grappes) {
		if (cle.startsWith("avatar:")) {
			taillesAvatar.set(cle.slice(7), membres.length);
		} else if (cle.startsWith("racine:")) {
			taillesRacine.set(cle.slice(7), membres.length);
		}
	}

	// ── Candidats ────────────────────────────────────────────────────────────
	const candidats = new Set<string>();
	for (const [cle, membres] of grappes) {
		if (membres.length < 2) {
			continue;
		}
		// Une liaison partagée est un rattachement, pas une coïncidence : son
		// plafond est infini, elle engendre ses paires quelle que soit sa taille.
		if (membres.length > plafondDeGrappe(cle)) {
			continue;
		}
		for (let i = 0; i < membres.length; i++) {
			for (let j = i + 1; j < membres.length; j++) {
				candidats.add(clePaire(membres[i]!, membres[j]!));
			}
		}
	}

	// ── Comparaison ──────────────────────────────────────────────────────────
	const ecartees = options.ecartees ?? new Set<string>();
	const minimum = RANG_NIVEAU[options.niveauMinimum ?? "faible"];
	const rapprochements: Rapprochement[] = [];
	let pairesExaminees = 0;

	for (const paire of candidats) {
		if (ecartees.has(paire)) {
			continue;
		}
		const [gauche, droite] = paire.split(":") as [string, string];
		const a = parId.get(gauche);
		const b = parId.get(droite);
		if (!a || !b) {
			continue;
		}
		pairesExaminees++;
		const avatar = empreinteAvatar(a.avatar);
		const racine = racinePseudo(a.pseudo);
		const rapprochement = comparer(a, b, {
			activite: options.activite?.(gauche, droite) ?? null,
			tailleGrappeAvatar: avatar ? (taillesAvatar.get(avatar) ?? 2) : 2,
			tailleGrappeRacine: racine ? (taillesRacine.get(racine) ?? 2) : 2,
		});
		if (rapprochement && RANG_NIVEAU[rapprochement.niveau] >= minimum) {
			rapprochements.push(rapprochement);
		}
	}

	rapprochements.sort((gauche, droite) => droite.score - gauche.score);

	const parNiveau: Record<Niveau, number> = { certain: 0, faible: 0, fort: 0, possible: 0 };
	for (const rapprochement of rapprochements) {
		parNiveau[rapprochement.niveau]++;
	}

	return {
		comptes: empreintes.length,
		pairesExaminees,
		parNiveau,
		rapprochements,
	};
}

/**
 * Phrase de tête d'un balayage — un état, jamais un jugement.
 *
 * Comme `libelleResume` dans `lib/sanctions.ts` : elle dit ce qu'on a trouvé et
 * s'arrête là. Aucune suggestion de sanction, aucune formulation qui laisse
 * entendre qu'un rapprochement est établi.
 */
export function libelleBalayage(balayage: Balayage): string {
	if (balayage.rapprochements.length === 0) {
		return `${balayage.comptes} comptes examinés — aucun rapprochement au-dessus du seuil.`;
	}
	// Le décompte est refait SUR LA LISTE, jamais lu dans `parNiveau` : un
	// appelant qui filtre les rapprochements (`balayerServeur` le fait pour
	// l'option `jours`) laisserait sinon la phrase décrire une liste qu'il ne
	// montre pas — « 32 rapprochements — 3 faisceaux » sous une page qui n'en
	// contient aucun.
	const compte = new Map<Niveau, number>(NIVEAUX.map((niveau) => [niveau, 0]));
	for (const rapprochement of balayage.rapprochements) {
		compte.set(rapprochement.niveau, (compte.get(rapprochement.niveau) ?? 0) + 1);
	}
	const morceaux = NIVEAUX.toReversed()
		.filter((niveau) => (compte.get(niveau) ?? 0) > 0)
		.map((niveau) => `${compte.get(niveau)} ${LIBELLES_NIVEAU[niveau].toLowerCase()}`);
	return `${balayage.comptes} comptes · ${balayage.rapprochements.length} rapprochements — ${morceaux.join(", ")}.`;
}
