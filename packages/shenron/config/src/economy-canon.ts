// SPDX-License-Identifier: Apache-2.0
/**
 * L'économie de Dragon Ball telle que les sources officielles la chiffrent.
 *
 * Ces montants ne sont PAS des estimations de fan : chacun renvoie à la planche
 * transcrite qui l'imprime, consultable sur dragonballfr.com. Ils servent de
 * repères à la boutique (« cet objet vaut deux courses de taxi ») et d'ancrage
 * à l'inflation du serveur.
 *
 * Deux faits structurent tout le module :
 *  - Toriyama : 1 zéni ≈ 1 yen (Super Exciting Guide, planche 93) ;
 *  - le prix du Tenkaichi Budokai passe de 500 000 à 1,48 million de zénis au
 *    fil de la série (Chōzenshū 4, planche 40) : l'inflation est canon, d'un
 *    facteur 2,96. C'est ce facteur qui borne l'indice des prix du serveur.
 */

export type CanonSource = {
	title: string;
	url: string;
};

export type CanonPrice = {
	key: string;
	label: string;
	zeni: number;
	source: CanonSource;
};

const CHOZENSHU_4_PL40: CanonSource = {
	title: "Dragon Ball Chōzenshū 4, planche 40",
	url: "https://dragonballfr.com/wiki/databooks/19#planche-40",
};

export const ZENI_YEN_PARITY: { ratio: number; source: CanonSource } = {
	ratio: 1,
	source: {
		title: "Dragon Ball Super Exciting Guide — Character Volume, planche 93",
		url: "https://dragonballfr.com/wiki/databooks/6#planche-93",
	},
};

/** Grille de prix de l'univers, du moins cher au plus cher. */
export const CANON_PRICES: readonly CanonPrice[] = [
	{ key: "taxi", label: "une course de taxi", zeni: 65, source: CHOZENSHU_4_PL40 },
	{
		key: "capsule",
		label: "l'intégration au système Capsule",
		zeni: 200_000,
		source: CHOZENSHU_4_PL40,
	},
	{
		key: "house",
		label: "une maison individuelle (Capsule incluse)",
		zeni: 500_000,
		source: CHOZENSHU_4_PL40,
	},
	{
		key: "budokai",
		label: "le prix du Tenkaichi Budokai",
		zeni: 500_000,
		source: CHOZENSHU_4_PL40,
	},
	{
		key: "budokai_late",
		label: "le prix du Budokai en fin de série",
		zeni: 1_480_000,
		source: CHOZENSHU_4_PL40,
	},
	{
		key: "aircar",
		label: "un aircar quatre places",
		zeni: 10_000_000,
		source: CHOZENSHU_4_PL40,
	},
	{
		key: "baba",
		label: "une consultation chez Baba la voyante",
		zeni: 10_000_000,
		source: CHOZENSHU_4_PL40,
	},
	{
		key: "taopaipai",
		label: "un contrat de Tao Pai Pai",
		zeni: 100_000_000,
		source: CHOZENSHU_4_PL40,
	},
];

/** Inflation canon : prix du Budokai en fin de série ÷ prix initial. */
export const CANON_INFLATION_FACTOR = 1_480_000 / 500_000;

/**
 * Repère canon le plus parlant pour un montant : le plus cher des repères qui
 * ne dépasse pas le montant, avec le nombre de fois qu'il y tient. En dessous
 * du plus petit repère, `null` (« 12 Ƶ = 0,18 course de taxi » n'aide personne).
 */
export function canonEquivalent(zeni: number): { price: CanonPrice; times: number } | null {
	if (!Number.isFinite(zeni) || zeni <= 0) return null;
	let best: CanonPrice | null = null;
	for (const p of CANON_PRICES) {
		if (p.zeni <= zeni && (!best || p.zeni >= best.zeni)) best = p;
	}
	if (!best) return null;
	return { price: best, times: Math.floor(zeni / best.zeni) };
}
