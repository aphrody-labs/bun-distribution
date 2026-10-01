/**
 * Slugs internationaux du wiki Dragon Ball.
 *
 * Règles :
 *  1. Format international court, propre et standardisé (kebab-case, minuscules, sans accents).
 *  2. Nom mondial / canonique du contenu (ex: Celula -> cell, Freezer -> freezer / frieza, Goku -> son-goku).
 *  3. Prise en compte des différentes versions des personnages (futur, xeno, gt, daima, jr, etc.).
 *  4. Résolution bidirectionnelle id <-> slug pour préserver l'API et la DB.
 *  5. Rétrocompatibilité totale : résolution des anciens ID numériques pour redirection 301.
 */

import { slugify } from "./slug";

/**
 * Table des noms mondiaux / canoniques des personnages majeurs (ID -> Slug canonique).
 * Chaque id est vérifié contre `bot.db_characters` par `scripts/check-wiki-slugs.ts` :
 * le 2026-09-12, 26 slugs décalés servaient la mauvaise fiche (`/broly` → Dyspo).
 */
export const CHARACTER_CANONICAL_SLUGS: Record<number, string> = {
	1: "son-goku",
	2: "vegeta",
	3: "piccolo",
	4: "bulma",
	5: "freezer",
	6: "zarbon",
	7: "dodoria",
	8: "ginyu",
	9: "cell",
	10: "son-gohan",
	11: "krillin",
	12: "tenshinhan",
	13: "yamcha",
	14: "chichi",
	15: "gotenks",
	16: "trunks",
	17: "tortue-geniale",
	18: "baddack",
	19: "launch",
	20: "mr-satan",
	21: "dende",
	25: "dr-gero",
	30: "raditz",
	31: "babidi",
	32: "majin-buu",
	34: "whis",
	35: "zeno",
	37: "kibitoshin",
	38: "jiren",
	39: "toppo",
	40: "dyspo",
	42: "marcarita",
	43: "vermoudh",
	44: "grand-pretre",
	63: "kaio-du-nord",
	65: "gogeta",
	66: "vegetto",
	68: "broly",
	69: "kaio-du-sud",
	70: "kaio-de-lest",
	71: "kaio-de-louest",
	72: "grand-kaio",
	73: "kaioshin-de-lest",
	74: "kaioshin-du-nord",
	75: "kaioshin-du-sud",
	76: "kaioshin-de-louest",
	77: "grand-kaioshin",
	78: "kibito",
	79: "son-goten",
	80: "videl",
	82: "nappa",
	90: "kid-buu",
	91: "pan",
	107: "vieux-kaioshin",
	112: "vados",
	124: "paikuhan",
	180: "baby-vegeta",
	208: "beerus",
	253: "bra",
	276: "c-19",
	279: "c-17",
	280: "c-18",
	281: "c-16",
	298: "c-21",
	326: "chaozu",
	328: "champa",
	404: "copy-vegeta",
	412: "den-goku",
	538: "gokua",
	542: "goku-black",
	546: "gokuhan",
	684: "karin",
	784: "marron",
	853: "mr-popo",
	926: "oolong",
	945: "paragus",
	1018: "roi-vegeta",
	1141: "son-goku-jr",
	1146: "son-goku-futur",
	1258: "vegeta-jr",
};

/**
 * Redirections pour les entités dupliquées ou masquées (ID masqué -> ID conservé).
 * Évite les erreurs 404 sur les anciens liens, fiches d'anciennes versions et moteurs de recherche.
 */
export const CHARACTER_DUPLICATE_REDIRECTS: Record<number, number> = {
	1044: 1018, // Roi Vegeta (Xeno) -> Roi Vegeta
	1149: 1, // Son Goku (Xeno) -> Son Goku
	1158: 1, // Son Goku (SDBH) -> Son Goku
	1275: 2, // Vegeta (SDBH) -> Vegeta
	108: 542, // Son Goku Black (dummy XV2) -> Goku Black
	1139: 10, // Son Gohan (court) -> Son Gohan
	706: 11, // Krilin -> Krillin
	1236: 109, // Trunks (futur) -> Trunks du Futur
	102: 5, // Golden Freezer (dummy XV2) -> Freezer
	127: 3, // Piccolo Orange (dummy XV2) -> Piccolo
	89: 32, // Super Buu (dummy XV2) -> Majin Buu
	103: 398, // Metal Cooler (dummy XV2) -> Cooler
	95: 449, // Dieu démon Demigra (dummy XV2) -> Démigra
	123: 298, // C-21 (dummy XV2) -> C-21
	760: 90, // Majin Boo (pur) -> Kid Buu
	1259: 107, // Vieux Kaio Shin -> Vieux Kaïo Shin
	1343: 136, // Âbra -> Abra
};

export const TRANSFORMATION_DUPLICATE_REDIRECTS: Record<number, number> = {
	101: 34, // Son Gohan absorbé -> Majin Buu (Gohan)
	89: 16, // Forme finale -> Freezer forme parfaite
};

/** Alias mondiaux redirigés vers le slug canonique d'un personnage. */
export const CHARACTER_SLUG_ALIASES: Record<string, string> = {
	goku: "son-goku",
	sangoku: "son-goku",
	kakarot: "son-goku",
	kakarotto: "son-goku",
	"son-goku-black": "goku-black",
	"goku-black-xv2": "goku-black",
	frieza: "freezer",
	celula: "cell",
	gohan: "son-gohan",
	sangohan: "son-gohan",
	krilin: "krillin",
	kuririn: "krillin",
	tien: "tenshinhan",
	tienshinhan: "tenshinhan",
	"master-roshi": "tortue-geniale",
	roshi: "tortue-geniale",
	"kame-sennin": "tortue-geniale",
	buu: "majin-buu",
	boo: "majin-buu",
	"majin-boo": "majin-buu",
	vegito: "vegetto",
	bardock: "baddack",
	"king-vegeta": "roi-vegeta",
	"android-16": "c-16",
	"android-17": "c-17",
	"android-18": "c-18",
	"android-19": "c-19",
	"android-20": "dr-gero",
	"android-21": "c-21",
	"cyborg-16": "c-16",
	"cyborg-17": "c-17",
	"cyborg-18": "c-18",
	"cyborg-19": "c-19",
	"cyborg-20": "dr-gero",
	"cyborg-21": "c-21",
	// Anciens slugs de la table décalée (retirés le 2026-09-12) : liens externes préservés.
	plume: "launch",
	"mr-popoo": "mr-popo",
	kaioshin: "kaioshin-de-lest",
	"marcarita-angel": "marcarita",
	"paikuhan-alt": "paikuhan",
	"son-goku-classic": "son-goku",
	"super-buu": "majin-buu",
	"mr-buu": "majin-buu",
	vermoud: "vermoudh",
	bills: "beerus",
	birusu: "beerus",
};

/** Table des slugs cosmologie / planètes majeurs (ID -> Slug canonique). */
export const PLANET_CANONICAL_SLUGS: Record<number, string> = {
	1: "namek",
	2: "terre",
	3: "planete-vegeta",
	4: "freezer-no-79",
	5: "kanassa",
	6: "monmar",
	7: "yardrat",
	11: "planete-kaio",
	13: "makyo",
	14: "babari",
	15: "tsufur-univers-6",
	18: "autre-monde",
	19: "planete-beerus",
	20: "planete-grand-kaio",
	21: "noyau-du-monde",
	22: "planete-sacree",
	23: "nouvelle-planete-tsufru",
	24: "palais-zeno",
	25: "univers-11",
};

/** Alias cosmologie redirigés vers le slug canonique. */
export const PLANET_SLUG_ALIASES: Record<string, string> = {
	earth: "terre",
	"planet-vegeta": "planete-vegeta",
	"king-kais-planet": "planete-kaio",
	"beerus-planet": "planete-beerus",
	otherworld: "autre-monde",
	"sacred-world-of-the-kai": "planete-sacree",
	"zenos-palace": "palais-zeno",
};

/** Table des slugs des transformations majeures (ID -> Slug canonique). */
export const TRANSFORMATION_CANONICAL_SLUGS: Record<number, string> = {
	1: "super-saiyan",
	2: "super-saiyan-2",
	3: "super-saiyan-3",
	4: "super-saiyan-4",
	5: "super-saiyan-god",
	6: "super-saiyan-blue",
	8: "fusion-potara",
	10: "ultra-instinct",
	11: "ultra-ego",
	12: "beast",
	13: "transformation-par-absorption",
	15: "forme-finale",
	18: "golden-freezer",
	19: "black-freezer",
	24: "ozaru-grand-singe",
	26: "orange-piccolo",
	27: "potentiel-eveille-ultimate-gohan",
};

/** Alias transformations redirigés vers le slug canonique. */
export const TRANSFORMATION_SLUG_ALIASES: Record<string, string> = {
	ssj: "super-saiyan",
	ssj1: "super-saiyan",
	ssj2: "super-saiyan-2",
	ssj3: "super-saiyan-3",
	ssj4: "super-saiyan-4",
	ssjg: "super-saiyan-god",
	"super-saiyan-divin": "super-saiyan-god",
	ssjb: "super-saiyan-blue",
	ssgss: "super-saiyan-blue",
	"super-saiyan-god-super-saiyan": "super-saiyan-blue",
	"super-saiyan-rose": "super-saiyan-blue",
	"ssj-rose": "super-saiyan-blue",
	potara: "fusion-potara",
	metamol: "fusion-potara",
	"fusion-metamol": "fusion-potara",
	fusion: "fusion-potara",
	"migatte-no-gokui": "ultra-instinct",
	"wagama-no-gokui": "ultra-ego",
	"vegeta-ultra-ego": "ultra-ego",
	"gohan-beast": "beast",
	"golden-frieza": "golden-freezer",
	"black-frieza": "black-freezer",
	"forme-regressive": "forme-finale",
	"forme-100-full-power": "forme-finale",
	"forme-100": "forme-finale",
	"5eme-forme": "forme-finale",
	"cinquieme-forme": "forme-finale",
	"super-saiyan-rose-3": "super-saiyan-blue",
	"ssj-rose-3": "super-saiyan-blue",
	ozaru: "ozaru-grand-singe",
	"grand-singe": "ozaru-grand-singe",
	"ultimate-gohan": "potentiel-eveille-ultimate-gohan",
	"gohan-ultime": "potentiel-eveille-ultimate-gohan",
	"forme-geante": "orange-piccolo",
	"forme-mini": "super-saiyan",
	// Anciens slugs décalés (redirection préservée)
	"vegeta-ssj": "super-saiyan-blue",
	"vegeta-ssj2": "fusion-potara",
	"vegeta-ssj4": "fusion-potara",
	"vegeta-ssjb": "ultra-instinct",
	"piccolo-super-namek": "beast",
	"zarbon-monstre": "golden-freezer",
	"cell-imparfait": "black-freezer",
	"cell-parfait": "super-saiyan-blue",
};

/**
 * Normalise et convertit le nom d'un personnage en slug international propre.
 * Prend en compte les différentes versions (futur, xeno, gt, etc.).
 */
export function formatCharacterSlug(char: {
	id: number;
	name: string;
	nameRomaji?: string | null;
	nameJa?: string | null;
}): string {
	if (CHARACTER_CANONICAL_SLUGS[char.id]) {
		return CHARACTER_CANONICAL_SLUGS[char.id]!;
	}

	let raw = char.name.trim();

	// Remplacement des préfixes/suffixes de version pour internationalisation propre
	raw = raw
		.replace(/\(futur\)/gi, "-futur")
		.replace(/\(future\)/gi, "-futur")
		.replace(/\(xeno\)/gi, "-xeno")
		.replace(/\(gt\)/gi, "-gt")
		.replace(/\(daima\)/gi, "-daima")
		.replace(/\(sdbh\)/gi, "-sdbh")
		.replace(/\(dbs\)/gi, "-dbs")
		.replace(/\(dbz\)/gi, "-dbz");

	let slug = slugify(raw, 50);
	if (!slug) slug = `personnage-${char.id}`;
	return slug;
}

/**
 * Normalise et convertit le nom d'une planète/lieu en slug international.
 */
export function formatPlanetSlug(planet: {
	id: number;
	name: string;
	nameRomaji?: string | null;
}): string {
	if (PLANET_CANONICAL_SLUGS[planet.id]) {
		return PLANET_CANONICAL_SLUGS[planet.id]!;
	}
	let slug = slugify(planet.name, 50);
	if (!slug) slug = `cosmologie-${planet.id}`;
	return slug;
}

/**
 * Normalise et convertit le nom d'une transformation en slug international.
 */
export function formatTransformationSlug(transfo: {
	id: number;
	name: string;
}): string {
	if (TRANSFORMATION_CANONICAL_SLUGS[transfo.id]) {
		return TRANSFORMATION_CANONICAL_SLUGS[transfo.id]!;
	}
	let slug = slugify(transfo.name, 50);
	if (!slug) slug = `transformation-${transfo.id}`;
	return slug;
}

/**
 * Résout un paramètre de route (id numérique ou slug textuel) vers un identifiant
 * de personnage et son slug canonique.
 */
export function resolveCharacterParam(param: string): {
	id: number | null;
	canonicalSlug: string | null;
	isLegacyNumericId: boolean;
	isAlias: boolean;
} {
	// Cas 1: ID numérique d'origine
	if (/^(0|[1-9][0-9]*)$/.test(param)) {
		let id = Number(param);
		let isAlias = false;
		if (CHARACTER_DUPLICATE_REDIRECTS[id]) {
			id = CHARACTER_DUPLICATE_REDIRECTS[id]!;
			isAlias = true;
		}
		const canonicalSlug = CHARACTER_CANONICAL_SLUGS[id] || null;
		return {
			id,
			canonicalSlug,
			isLegacyNumericId: true,
			isAlias,
		};
	}

	// Cas 2: Alias international connu (ex: "goku" -> "son-goku")
	const normalizedParam = param.toLowerCase().trim();
	if (CHARACTER_SLUG_ALIASES[normalizedParam]) {
		const targetSlug = CHARACTER_SLUG_ALIASES[normalizedParam]!;
		// Retrouve l'ID associé au slug cible
		for (const [idStr, slug] of Object.entries(CHARACTER_CANONICAL_SLUGS)) {
			if (slug === targetSlug) {
				return {
					id: Number(idStr),
					canonicalSlug: targetSlug,
					isLegacyNumericId: false,
					isAlias: true,
				};
			}
		}
		return {
			id: null,
			canonicalSlug: targetSlug,
			isLegacyNumericId: false,
			isAlias: true,
		};
	}

	// Cas 3: Slug direct dans la table canonique
	for (const [idStr, slug] of Object.entries(CHARACTER_CANONICAL_SLUGS)) {
		if (slug === normalizedParam) {
			return {
				id: Number(idStr),
				canonicalSlug: slug,
				isLegacyNumericId: false,
				isAlias: false,
			};
		}
	}

	// Cas 4: Slug généré ou libre (doit être résolu en DB)
	return {
		id: null,
		canonicalSlug: normalizedParam,
		isLegacyNumericId: false,
		isAlias: false,
	};
}

/**
 * Résout un paramètre de route cosmologie (id numérique ou slug textuel).
 */
export function resolvePlanetParam(param: string): {
	id: number | null;
	canonicalSlug: string | null;
	isLegacyNumericId: boolean;
	isAlias: boolean;
} {
	if (/^(0|[1-9][0-9]*)$/.test(param)) {
		const id = Number(param);
		const canonicalSlug = PLANET_CANONICAL_SLUGS[id] || null;
		return {
			id,
			canonicalSlug,
			isLegacyNumericId: true,
			isAlias: false,
		};
	}

	const normalizedParam = param.toLowerCase().trim();
	if (PLANET_SLUG_ALIASES[normalizedParam]) {
		const targetSlug = PLANET_SLUG_ALIASES[normalizedParam]!;
		for (const [idStr, slug] of Object.entries(PLANET_CANONICAL_SLUGS)) {
			if (slug === targetSlug) {
				return {
					id: Number(idStr),
					canonicalSlug: targetSlug,
					isLegacyNumericId: false,
					isAlias: true,
				};
			}
		}
	}

	for (const [idStr, slug] of Object.entries(PLANET_CANONICAL_SLUGS)) {
		if (slug === normalizedParam) {
			return {
				id: Number(idStr),
				canonicalSlug: slug,
				isLegacyNumericId: false,
				isAlias: false,
			};
		}
	}

	return {
		id: null,
		canonicalSlug: normalizedParam,
		isLegacyNumericId: false,
		isAlias: false,
	};
}

/**
 * Résout un paramètre de route transformation (id numérique ou slug textuel).
 */
export function resolveTransformationParam(param: string): {
	id: number | null;
	canonicalSlug: string | null;
	isLegacyNumericId: boolean;
	isAlias: boolean;
} {
	if (/^(0|[1-9][0-9]*)$/.test(param)) {
		let id = Number(param);
		let isAlias = false;
		if (TRANSFORMATION_DUPLICATE_REDIRECTS[id]) {
			id = TRANSFORMATION_DUPLICATE_REDIRECTS[id]!;
			isAlias = true;
		}
		const canonicalSlug = TRANSFORMATION_CANONICAL_SLUGS[id] || null;
		return {
			id,
			canonicalSlug,
			isLegacyNumericId: true,
			isAlias,
		};
	}

	const normalizedParam = param.toLowerCase().trim();
	if (TRANSFORMATION_SLUG_ALIASES[normalizedParam] && TRANSFORMATION_SLUG_ALIASES[normalizedParam] !== normalizedParam) {
		const targetSlug = TRANSFORMATION_SLUG_ALIASES[normalizedParam]!;
		for (const [idStr, slug] of Object.entries(TRANSFORMATION_CANONICAL_SLUGS)) {
			if (slug === targetSlug) {
				return {
					id: Number(idStr),
					canonicalSlug: targetSlug,
					isLegacyNumericId: false,
					isAlias: true,
				};
			}
		}
	}

	for (const [idStr, slug] of Object.entries(TRANSFORMATION_CANONICAL_SLUGS)) {
		if (slug === normalizedParam) {
			return {
				id: Number(idStr),
				canonicalSlug: slug,
				isLegacyNumericId: false,
				isAlias: false,
			};
		}
	}

	return {
		id: null,
		canonicalSlug: normalizedParam,
		isLegacyNumericId: false,
		isAlias: false,
	};
}

/**
 * Tente de résoudre le nom d'un personnage (ou variante textuelle) vers son slug wiki canonique.
 */
export function resolveCharacterSlugByName(name: string | null | undefined): string | null {
	if (!name) return null;
	const clean = name.trim().toLowerCase();
	const normalized = clean
		.replace(/\s*\(.*?\)/g, "")
		.replace(/[\u2019']/g, "-")
		.replace(/\s+/g, "-")
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");

	if (CHARACTER_SLUG_ALIASES[normalized]) {
		return CHARACTER_SLUG_ALIASES[normalized]!;
	}

	for (const slug of Object.values(CHARACTER_CANONICAL_SLUGS)) {
		if (slug === normalized) return slug;
	}

	// Correspondances courantes
	if (normalized.includes("goku") && !normalized.includes("black")) return "son-goku";
	if (normalized.includes("black")) return "goku-black";
	if (normalized.includes("vegeta") && !normalized.includes("roi")) return "vegeta";
	if (normalized.includes("piccolo") || normalized.includes("ma-junior")) return "piccolo";
	if (normalized.includes("gohan")) return "son-gohan";
	if (normalized.includes("krilin") || normalized.includes("krillin")) return "krillin";
	if (normalized.includes("tenshinhan") || normalized.includes("tien")) return "tenshinhan";
	if (normalized.includes("yamcha")) return "yamcha";
	if (
		normalized.includes("kame-sennin") ||
		normalized.includes("tortue-geniale") ||
		normalized.includes("roshi") ||
		normalized.includes("jackie-chun")
	)
		return "tortue-geniale";
	if (normalized.includes("bulma")) return "bulma";
	if (normalized.includes("chaozu")) return "chaozu";
	if (normalized.includes("trunks")) return "trunks";
	if (normalized.includes("freezer") || normalized.includes("frieza")) return "freezer";
	if (normalized.includes("cell")) return "cell";
	if (normalized.includes("buu") || normalized.includes("boo")) return "majin-buu";
	if (normalized.includes("dende")) return "dende";
	if (normalized.includes("oolong")) return "oolong";
	if (normalized.includes("karin")) return "karin";
	if (normalized.includes("mr-popo") || normalized.includes("m-popo") || normalized.includes("popo"))
		return "mr-popo";
	if (normalized.includes("gero")) return "dr-gero";
	if (normalized.includes("babidi")) return "babidi";
	if (normalized.includes("beerus")) return "beerus";
	if (normalized.includes("whis")) return "whis";
	if (normalized.includes("jiren")) return "jiren";
	if (normalized.includes("toppo")) return "toppo";
	if (normalized.includes("broly")) return "broly";
	if (normalized.includes("gogeta")) return "gogeta";
	if (normalized.includes("vegetto") || normalized.includes("vegito")) return "vegetto";
	if (normalized.includes("chichi")) return "chichi";
	if (normalized.includes("videl")) return "videl";
	if (normalized.includes("gotenks")) return "gotenks";
	if (normalized.includes("goten")) return "son-goten";
	if (normalized.includes("nappa")) return "nappa";
	if (normalized.includes("raditz")) return "raditz";
	if (normalized.includes("baddack") || normalized.includes("bardock")) return "baddack";
	if (normalized.includes("satan")) return "mr-satan";
	if (normalized.includes("c-16") || normalized.includes("cyborg-16")) return "c-16";
	if (normalized.includes("c-17") || normalized.includes("cyborg-17")) return "c-17";
	if (normalized.includes("c-18") || normalized.includes("cyborg-18")) return "c-18";
	if (normalized.includes("c-19") || normalized.includes("cyborg-19")) return "c-19";
	if (normalized.includes("c-21") || normalized.includes("cyborg-21")) return "c-21";

	return null;
}

/**
 * Tente de résoudre le nom d'un lieu vers son slug wiki canonique dans `db_locations`.
 */
export function resolveLocationSlugByName(name: string | null | undefined): string | null {
	if (!name) return null;
	const clean = name.trim().toLowerCase();
	const normalized = clean
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");

	if (normalized.includes("kame house")) return "kame-house";
	if (normalized.includes("tour karin")) return "tour-karin";
	if (normalized.includes("sanctuaire") || normalized.includes("palais de kami") || normalized.includes("palais de dieu"))
		return "sanctuaire-de-dieu";
	if (normalized.includes("esprit et du temps") || normalized.includes("chambre du temps"))
		return "salle-esprit-temps";
	if (normalized.includes("capsule corporation") || normalized.includes("capsule corp"))
		return "capsule-corporation";
	if (normalized.includes("tenkaichi") || normalized.includes("papaye"))
		return "arene-tenkaichi-budokai";
	if (normalized.includes("cell game")) return null; // Le Cell Game a eu lieu dans un désert (arène détruite)
	if (normalized.includes("namek")) return "planete-namek";
	if (normalized.includes("vegeta")) return "planete-vegeta";
	if (normalized.includes("kaio")) return "planete-kaio";
	if (normalized.includes("enma")) return "palais-enma";
	if (normalized.includes("kaioshin")) return "domaine-kaioshin";
	if (normalized.includes("beerus")) return "planete-beerus";
	if (normalized.includes("monde du vide") || normalized.includes("pouvoir"))
		return "monde-du-vide";
	if (normalized.includes("zeno")) return "palais-zeno";
	if (normalized.includes("yardrat")) return "planete-yardrat";

	return null;
}

/**
 * Tente de résoudre le nom d'une technique vers son slug wiki canonique dans `db_techniques`.
 */
export function resolveTechniqueSlugByName(name: string | null | undefined): string | null {
	if (!name) return null;
	const clean = name.trim().toLowerCase();
	const normalized = clean
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "");

	if (normalized.includes("kamehameha")) return "kamehameha";
	if (normalized.includes("genkidama")) return "genkidama";
	if (normalized.includes("makankosappo")) return "makankosappo";
	if (normalized.includes("kikoho")) return "kikoho";
	if (normalized.includes("kaioken") || normalized.includes("kaio-ken")) return "kaioken";
	if (normalized.includes("final flash")) return "final-flash";
	if (normalized.includes("big bang")) return "big-bang";
	if (normalized.includes("kienzan")) return "kienzan";
	if (normalized.includes("morsure du soleil") || normalized.includes("taioken"))
		return "morsure-du-soleil";
	if (normalized.includes("teleportation")) return "teleportation";
	if (normalized.includes("vol") || normalized.includes("flight")) return "flight";

	return null;
}

