// SPDX-License-Identifier: Apache-2.0
/**
 * Rattachement personnage → race canonique.
 *
 * `bot.db_races` porte 18 races canoniques (slug + nom FR + nom japonais) ;
 * `bot.db_characters.race` est un **texte libre** hérité de plusieurs imports
 * (imports historiques de wikis de fans, jeux vidéo). Les deux vocabulaires ne se recouvrent
 * pas : la page `/wiki/races` comparait les deux chaînes à l'identique, si bien
 * que **13 races sur 18 affichaient « Aucun membre répertorié »** alors que la
 * base avait de quoi les remplir — 88 personnages en `Terrien` pendant que
 * « Humain (Terrien) » annonçait 0, 19 en `Namek` pendant que
 * « Namek (Namékien) » annonçait 0, 16 `Android` + 7 `Cyborg` pour
 * « Cyborg / Androïde » à 0.
 *
 * La table ci-dessous n'est pas devinée : elle vient du relevé des **70
 * graphies** réellement présentes dans la colonne (`select race, count(*) …`),
 * chacune rapprochée d'une race canonique quand le rapprochement est certain.
 *
 * Ce qu'on refuse délibérément de rattacher (cf. `AMBIGUËS`) : une graphie
 * fourre-tout ne devient pas un membre. Mieux vaut une race à 0 qu'un compte
 * gonflé par des personnages qui n'en sont pas.
 */

/** Casse, accents, ponctuation et pluriel : `Céréaliens` == `cerealien`. */
export function normaliserRace(valeur: string): string {
	return valeur
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.toLowerCase()
		.replace(/[’']/g, "'")
		.replace(/\s+/g, " ")
		.trim()
		.replace(/s$/, "");
}

/**
 * Graphies (normalisées) → slug de `bot.db_races`.
 *
 * Les graphies parenthésées sont conservées telles quelles : `namek (race)` est
 * une valeur réelle de la colonne, pas une variante théorique.
 */
const PAR_GRAPHIE: Record<string, string> = {};
const ALIAS: Record<string, string[]> = {
	saiyan: ["Saiyan", "Saiyan (corps)"],
	// « Terrien » et ses variantes de genre/parenthèse. `50%Terrienne` est une
	// valeur réelle (personnage hybride saisi ainsi côté import).
	human: [
		"Terrien",
		"Terrienne",
		"Humaine",
		"Human",
		"Terrien (type animal)",
		"Terrien (anciennement)",
		"Terrienne (anciennement)",
		"Humain",
		"50%Terrienne",
	],
	namekian: ["Namek", "Namekian", "Namek (race)"],
	// Les androïdes du manga sont des « humains artificiels » (人造人間) : c'est
	// le même peuple, pas trois races distinctes.
	android: ["Android", "Androïde", "Cyborg", "Humain Artificiel"],
	"frieza-race": ["Race de Freezer", "Frieza Race"],
	angel: ["Ange", "Angel", "Ange (anciennement)"],
	demon: ["Démon", "Diable"],
	majin: ["Majin", "Majin (race)"],
	cerealian: ["Cerealien", "Céréalien"],
	yardrat: ["Yardrat"],
	// Les Dieux de la Destruction n'ont pas de peuple nommé dans le manga : la
	// fiche les rattache à leur fonction, seule identité que la source donne.
	"god-of-destruction": ["Dieu de la Destruction"],
	// Vérifié sur les fiches : ce sont les Shinron (Shenron Noir et les sept
	// dragons maléfiques de GT, plus leurs doubles Xeno).
	"namek-shenron": ["Dragon", "Dragon Maléfique", "Dragon obscur Xeno"],
	// `Glind` ne ressemble à rien du nom canonique, mais les personnages qui la
	// portent sont Chronoa, Gowasu, Aeos, le Dai Kaïo Shin… : ce sont bien les
	// Kaïoshin. Rattachement établi sur les fiches, pas sur la graphie.
	kaioshin: ["Glind", "Glind type Kaiô Shin", "Glind de type Kaio", "Glind (anciennement)"],
};
for (const [slug, graphies] of Object.entries(ALIAS)) {
	for (const g of graphies) PAR_GRAPHIE[normaliserRace(g)] = slug;
}

/**
 * Graphies qui recouvrent DEUX races canoniques et qu'on ne peut trancher que
 * sur le nom du personnage.
 *
 * `Nucleico` / `Nucleico benigno` étiquette indifféremment les Kaïo (Kaito, le
 * Grand Kaïo…) et les Kaïoshin (Kaïo Shin de l'Est, Kibito…) — l'import a
 * repris une classification de jeu vidéo qui ne distingue pas les deux. Le
 * critère qui tranche est le titre porté par le personnage : « Shin » marque le
 * Kaïoshin. Kibito est la seule exception : Kaïoshin sans « Shin » au nom.
 */
const NUCLEICO = new Set(["nucleico", "nucleico benigno"]);

/**
 * Graphies volontairement laissées de côté, avec leur raison. Documentées pour
 * qu'on ne les « rattrape » pas un jour par inadvertance.
 */
export const AMBIGUËS: Record<string, string> = {
	extraterrestre: "fourre-tout : Butta, Ganos, Chevil… aucune race canonique commune",
	unknown: "valeur de remplissage d'import",
	evil: "qualificatif moral, pas une race",
	god: "mélange Dieux de la Destruction, Kaïoshin et Pride Troopers",
	saibaimen: "créature invoquée, pas un peuple",
	"neko majin": "parodie autonome de Toriyama, distincte des Majin",
	"race de zarbon": "peuple propre, distinct de la race de Freezer",
	"race de zabon": "même peuple que Zarbon, graphie « Zâbon » de l'import",
	// Machines à part entière : ni 人造人間 (humains modifiés), ni cyborgs.
	robot: "machine, pas un humain artificiel",
	"robots og": "machine, pas un humain artificiel",
	metalman: "machine, pas un humain artificiel",
	"machine mutante": "machine, pas un humain artificiel",
};

/**
 * Slug de race d'un personnage, ou `null` si le rattachement n'est pas sûr.
 *
 * @param brute Valeur de `db_characters.race` (texte libre, peut être nulle).
 * @param nom   Nom du personnage — sert uniquement à départager `Nucleico`.
 */
export function slugDeRace(brute: string | null | undefined, nom = ""): string | null {
	if (!brute) return null;
	// Une valeur qui énumère plusieurs races (« Terrien, Zombie, Humain
	// artificiel ») ne rattache à aucune : la compter partout gonflerait tous les
	// comptes à la fois.
	if (/[,/]/.test(brute)) return null;
	const cle = normaliserRace(brute);
	if (NUCLEICO.has(cle)) {
		const n = normaliserRace(nom);
		return n.includes("shin") || n.includes("kibito") ? "kaioshin" : "kaio";
	}
	return PAR_GRAPHIE[cle] ?? null;
}

/** Toutes les graphies brutes susceptibles d'appartenir à `slug`. */
export function graphiesDeRace(slug: string, nomCanonique?: string): string[] {
	const base = ALIAS[slug] ?? [];
	const nucleico = slug === "kaio" || slug === "kaioshin" ? ["Nucleico", "Nucleico benigno"] : [];
	// Le nom canonique reste candidat : une future race saisie à l'identique des
	// deux côtés se rattache sans passer par la table.
	const canon = nomCanonique ? [nomCanonique] : [];
	return [...new Set([...base, ...nucleico, ...canon])];
}
