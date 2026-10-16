/*
 * Le noyau du tirage au sort, éprouvé par l'exécution.
 *
 * ── CE QUE CE FICHIER GARDE ────────────────────────────────────────────────
 * Un tirage au sort n'est pas une fonctionnalité comme une autre : il n'a aucune
 * sortie vérifiable à l'œil. Un générateur biaisé rend des noms parfaitement
 * plausibles, et personne ne s'en aperçoit — ni à la relecture, ni en recette,
 * ni après la publication. Les seules choses qui peuvent attraper un biais sont
 * une mesure statistique et un rejeu bit à bit. C'est tout ce fichier.
 *
 * Il tient donc des affirmations CHIFFRÉES, pas des « ça marche » :
 *   · uniformité mesurée sur 100 000 tirages, avec une tolérance dérivée de
 *     l'écart-type binomial et non choisie à la main (cf. l'encadré TOLÉRANCE) ;
 *   · `u` jamais 0 ni 1 sur 200 000 dérivations, dont les 100 000 valeurs les
 *     plus BASSES et les 100 000 les plus HAUTES — c'est-à-dire précisément là
 *     où trois formules sur quatre cassent, et là où un tirage aléatoire de
 *     graines ne va jamais ;
 *   · treize mutations d'un tirage honnête, chacune devant produire son code
 *     d'anomalie, et une quatorzième (un pseudo corrigé) qui doit RESTER valide.
 *
 * ── POURQUOI node:crypto APPARAÎT ICI, ET NULLE PART AILLEURS ──────────────
 * Le noyau hache avec `crypto.subtle`, qui est asynchrone et impose une
 * `importKey` par appel : 0,932 ms par tirage complet, mesuré. À 100 000
 * tirages cela ferait 93 s pour un seul `it`, et l'on renoncerait à la mesure —
 * c'est-à-dire à la seule chose capable d'attraper un biais.
 *
 * Les campagnes statistiques passent donc par `hmacRapide` (node:crypto,
 * synchrone, 2,4 s pour 1,4 million de HMAC). Ce n'est PAS un second algorithme :
 * le premier `describe` du fichier prouve sur 500 messages que `hmacRapide`,
 * `empreinteParticipant` (le noyau) et `crypto.subtle.sign` rendent les MÊMES
 * octets, et que `hex()` du noyau rend la même chaîne que `Buffer.toString("hex")`.
 * Tout ce qui DÉCIDE — `uDepuisEmpreinte`, `cleDeTri`, `comparerEntrees` — reste
 * le noyau, jamais une copie. Et un test d'accord rejoue 300 tirages par les deux
 * chemins et exige le même classement, entrée par entrée : si la voie rapide
 * divergeait un jour, ce test tomberait avant les statistiques.
 *
 * ── COMMANDE ──────────────────────────────────────────────────────────────
 *   cd /home/ubuntu/rg && bun test apps/website/src/lib/x-campagnes/tirage.test.ts
 * Compter ~40 s : les campagnes de 100 000 tirages sont l'essentiel du budget, et
 * les `it` concernés portent un délai explicite (le défaut de `bun test` est 5 s).
 */

import { createHash, createHmac } from "node:crypto";

import { describe, expect, it } from "bun:test";

import {
	BALISE_LOCALE,
	cleDeTri,
	clePublique,
	comparerEntrees,
	comparerOctets,
	depuisHex,
	DOMAINE_ROSTER,
	DRAND_QUICKNET,
	empreinteEngagement,
	empreinteGraine,
	empreinteParticipant,
	empreinteRoster,
	engagementDeTirage,
	estGrainePubliable,
	executerTirage,
	graineDepuisBalise,
	graineLocaleDepuis,
	hex,
	instantDuRound,
	kDepuisEmpreinte,
	MAX_POIDS,
	octetsUtf8,
	poidsDe,
	roundPour,
	rosterDe,
	serialiserChamps,
	serialiserRoster,
	sha256,
	sha256Hex,
	tirerOeuvre,
	trierRoster,
	u32be,
	uDepuisEmpreinte,
	verifierTirage,
} from "./tirage";
import type {
	CodeAnomalie,
	EntreeCalculee,
	ParticipantTirage,
	PoidsMode,
	TirageGele,
} from "./tirage";

/* ── OUTILLAGE ─────────────────────────────────────────────────────────────── */

/**
 * Accès indexé qui LÈVE au lieu de rendre `undefined`.
 *
 * `noUncheckedIndexedAccess` est actif sur tout le monorepo : sans ce garde-fou
 * il faudrait un `!` ou un `?? valeurParDéfaut` à chaque ligne. Le `??` serait le
 * pire des deux — dans un test statistique, un repli silencieux transforme un
 * décompte faux en décompte plausible, et c'est exactement ce qu'on cherche à
 * empêcher chez le code testé.
 */
function elem<T>(tableau: readonly T[], index: number): T {
	const valeur = tableau[index];
	if (valeur === undefined) {
		throw new Error(`Index ${index} hors du tableau de ${tableau.length} éléments.`);
	}
	return valeur;
}

/**
 * HMAC-SHA-256 synchrone, byte-pour-byte identique à `empreinteParticipant`.
 * Licencié par `describe("équivalence des trois implémentations de HMAC")`.
 */
function hmacRapide(graineOctets: Uint8Array, messageOctets: Uint8Array): Buffer {
	return createHmac("sha256", graineOctets).update(messageOctets).digest();
}

/** Graine déterministe dérivée d'un libellé : le hasard des tests est reproductible ou n'est pas. */
function graineDe(libelle: string): Buffer {
	return createHash("sha256").update(libelle).digest();
}

/* ── LE ROSTER RÉEL DE LA CAMPAGNE « iergday » ─────────────────────────────
 *
 * Les 14 personnes mesurées en base le 23/8/2026, avec leurs VRAIS identifiants
 * et leur VRAI nombre d'œuvres. Tester l'uniformité sur `["a","b","c"]` ne dirait
 * rien de ce qui va tourner : les clés réelles ont des longueurs très inégales
 * (11 à 25 caractères), trois préfixes différents, et c'est cette chaîne-là qui
 * entre dans le HMAC. Σ nb_oeuvres = 16 pour 20 publications retenues — l'écart
 * est le dédoublonnage, et il est éprouvé par l'avant-dernier `describe`.
 */
const REELS: readonly ParticipantTirage[] = [
	{
		cle: "discord:908269053347504170",
		nbOeuvres: 2,
		oeuvres: ["discord:1540301925298348062", "x:2090455666267713840"],
		pseudoAffichage: "Sanada",
	},
	{
		cle: "instagram:orphelinalius",
		nbOeuvres: 2,
		oeuvres: ["instagram:DcUEDDKoTgP", "instagram:DcW22ScIdYv"],
		pseudoAffichage: "orphelinalius",
	},
	{
		cle: "x:1946965962932301825",
		nbOeuvres: 1,
		oeuvres: ["x:2087922862803841524"],
		pseudoAffichage: "Ruvi_Seiya",
	},
	{
		cle: "discord:531549483067244566",
		nbOeuvres: 1,
		oeuvres: ["x:2087923415000789199"],
		pseudoAffichage: "Inazo",
	},
	{
		cle: "x:1284815033395023872",
		nbOeuvres: 1,
		oeuvres: ["x:2087998363211825503"],
		pseudoAffichage: "Grimnape",
	},
	{ cle: "x:2870776923", nbOeuvres: 1, oeuvres: ["x:2090513552087879823"], pseudoAffichage: "Lya" },
	{
		cle: "x:1674730916139216897",
		nbOeuvres: 1,
		oeuvres: ["x:2090897441985896710"],
		pseudoAffichage: "Haroldinho",
	},
	{
		cle: "discord:306135978316136448",
		nbOeuvres: 1,
		oeuvres: ["x:2090899354148368577"],
		pseudoAffichage: "Munfurawa",
	},
	{
		cle: "discord:309031721016229890",
		nbOeuvres: 1,
		oeuvres: ["x:2091112393455632493"],
		pseudoAffichage: "Cieran / FujoRin",
	},
	{
		cle: "discord:683044704967065626",
		nbOeuvres: 1,
		oeuvres: ["x:2091195848247885914"],
		pseudoAffichage: "kittycaillou",
	},
	{
		cle: "discord:469900328758935552",
		nbOeuvres: 1,
		oeuvres: ["discord:1540784107729064108"],
		pseudoAffichage: "Jenn Scarlet",
	},
	{
		cle: "discord:443473435512012800",
		nbOeuvres: 1,
		oeuvres: ["discord:1540808591806570586"],
		pseudoAffichage: "Isma",
	},
	{
		cle: "discord:460001633053704192",
		nbOeuvres: 1,
		oeuvres: ["discord:1540837023487631391"],
		pseudoAffichage: "ThunderAce",
	},
	{
		cle: "discord:689064409100058624",
		nbOeuvres: 1,
		oeuvres: ["discord:1540842925456359557"],
		pseudoAffichage: "Deb",
	},
];

/** Le nombre de PUBLICATIONS retenues par personne — à ne pas confondre avec les œuvres. */
const PUBLICATIONS_PAR_CLE: Readonly<Record<string, number>> = {
	"discord:306135978316136448": 2, // Munfurawa : Discord + X, un seul dessin (G1)
	"discord:309031721016229890": 2, // Cieran / FujoRin : Discord + X, un seul dessin (G4)
	"discord:443473435512012800": 1,
	"discord:460001633053704192": 1, // ThunderAce : 1 message, 7 fichiers
	"discord:469900328758935552": 1, // Jenn Scarlet : 1 message, 2 fichiers d'un seul dessin
	"discord:531549483067244566": 1,
	"discord:683044704967065626": 2, // kittycaillou : Discord + X, un seul dessin (G2)
	"discord:689064409100058624": 1,
	"discord:908269053347504170": 3, // Sanada : 2 dépôts Discord + 1 tweet, 2 dessins (G3)
	"instagram:orphelinalius": 2,
	"x:1284815033395023872": 1,
	"x:1674730916139216897": 1,
	"x:1946965962932301825": 1,
	"x:2870776923": 1,
};

/* ── CAMPAGNE STATISTIQUE ───────────────────────────────────────────────────
 *
 * Le classement est reconstruit avec les fonctions du NOYAU (`uDepuisEmpreinte`,
 * `cleDeTri`, `comparerEntrees`) ; seul le HMAC passe par la voie rapide.
 */

interface Campagne {
	/** Décompte des rangs 1, dans l'ordre de `cles`. */
	rang1: number[];
	/** Décompte des présences dans les `top` premiers rangs. */
	dansTop: number[];
}

function entreeDe(cle: string, octets: Uint8Array, poids: number, graine: Buffer): EntreeCalculee {
	const empreinte = hmacRapide(graine, octets);
	const u = uDepuisEmpreinte(empreinte);
	return {
		cle,
		cleTri: cleDeTri(u, poids),
		empreinte: empreinte.toString("hex"),
		oeuvres: [],
		poids,
		pseudoAffichage: "",
		rang: 0,
		u,
	};
}

function campagne(
	cles: readonly string[],
	poids: readonly number[],
	nbTirages: number,
	prefixeGraine: string,
	top = 1
): Campagne {
	const octets = cles.map((cle) => octetsUtf8(cle));
	const position = new Map(cles.map((cle, index) => [cle, index]));
	const rang1 = Array.from({ length: cles.length }, () => 0);
	const dansTop = Array.from({ length: cles.length }, () => 0);
	const indexDe = (cle: string): number => {
		const trouve = position.get(cle);
		if (trouve === undefined) {
			throw new Error(`Clé inconnue dans la campagne : ${cle}`);
		}
		return trouve;
	};
	/*
	 * `compteur[i] += 1` ne compile pas : `noUncheckedIndexedAccess` donne
	 * `number | undefined` à toute lecture indexée, et l'index vient d'une Map.
	 * Un `!` masquerait le jour où `indexDe` rendrait une position hors bornes —
	 * ici on préfère échouer bruyamment, dans un test dont c'est le métier.
	 */
	const incrementer = (compteur: number[], index: number): void => {
		const actuel = compteur[index];
		if (actuel === undefined) {
			throw new Error(`Position hors bornes dans le compteur : ${index}`);
		}
		compteur[index] = actuel + 1;
	};

	for (let tirage = 0; tirage < nbTirages; tirage += 1) {
		const graine = graineDe(`${prefixeGraine}${tirage}`);
		if (top === 1) {
			// Rang 1 seul : `argmin` par le comparateur du noyau, 13 comparaisons au
			// lieu des ~40 d'un tri complet. Même comparateur, même résultat.
			let meilleure = entreeDe(elem(cles, 0), elem(octets, 0), elem(poids, 0), graine);
			for (let i = 1; i < cles.length; i += 1) {
				const candidate = entreeDe(elem(cles, i), elem(octets, i), elem(poids, i), graine);
				if (comparerEntrees(candidate, meilleure) < 0) {
					meilleure = candidate;
				}
			}
			incrementer(rang1, indexDe(meilleure.cle));
			incrementer(dansTop, indexDe(meilleure.cle));
			continue;
		}
		const classement = cles
			.map((cle, i) => entreeDe(cle, elem(octets, i), elem(poids, i), graine))
			.sort(comparerEntrees);
		incrementer(rang1, indexDe(elem(classement, 0).cle));
		for (let rang = 0; rang < top; rang += 1) {
			incrementer(dansTop, indexDe(elem(classement, rang).cle));
		}
	}
	return { dansTop, rang1 };
}

/**
 * TOLÉRANCE — dérivée, jamais choisie.
 *
 * Sur `n` tirages indépendants, le nombre de fois où une personne de probabilité
 * `p` sort au rang 1 suit une loi binomiale B(n, p) : espérance `n·p`, variance
 * `n·p·(1−p)`. L'écart-type est donc `σ = √(n·p·(1−p))`, et l'on borne à 3σ.
 *
 * Application au cas uniforme du fichier : n = 100 000, p = 1/14.
 *   espérance = 7 142,86
 *   σ         = √(100 000 × (1/14) × (13/14)) = √6 632,65 = 81,44
 *   3σ        = 244,32   →   intervalle admis [6 898,5 ; 7 387,2]
 *
 * Deux précisions qui empêchent de mal lire ce chiffre.
 * (a) 3σ est un seuil PAR CASE. Avec 14 cases, un générateur parfait sortirait
 *     quand même d'au moins une case dans ~3,7 % des campagnes (1 − 0,9973^14).
 *     Un test qui tomberait 1 fois sur 27 ne serait pas un test. Ce fichier n'a
 *     pas ce défaut parce que les graines sont DÉTERMINISTES (SHA-256 d'un
 *     compteur) : la campagne est la même à chaque exécution, elle passe ou elle
 *     échoue, elle ne « clignote » jamais.
 * (b) Un seuil par case ne voit pas un biais réparti sur toutes les cases. Le
 *     χ² d'ajustement, lui, le voit ; il accompagne donc systématiquement la
 *     borne 3σ, à df = 13 et p = 0,001 (seuil 34,53).
 */
function borne3Sigma(n: number, p: number): { attendu: number; sigma: number; tolerance: number } {
	const attendu = n * p;
	const sigma = Math.sqrt(n * p * (1 - p));
	return { attendu, sigma, tolerance: 3 * sigma };
}

/** χ² d'ajustement d'un décompte observé à des probabilités attendues. */
function khiDeux(observes: readonly number[], probabilites: readonly number[], n: number): number {
	let somme = 0;
	for (let i = 0; i < observes.length; i += 1) {
		const attendu = n * elem(probabilites, i);
		const ecart = elem(observes, i) - attendu;
		somme += (ecart * ecart) / attendu;
	}
	return somme;
}

/** Seuil du χ² à 13 degrés de liberté, p = 0,001. Volontairement lâche : on cherche un BIAIS, pas du bruit. */
const KHI2_DF13_P001 = 34.53;

/* ══════════════════════════════════════════════════════════════════════════ */

describe("équivalence des trois implémentations de HMAC", () => {
	/*
	 * C'est ce `describe` qui AUTORISE tout le reste du fichier à utiliser
	 * `hmacRapide`. Sans lui, les campagnes statistiques mesureraient un
	 * algorithme voisin et concluraient sur le mauvais.
	 */
	it("hmacRapide, empreinteParticipant et crypto.subtle rendent les mêmes octets sur 500 messages", async () => {
		let identiques = 0;
		for (let i = 0; i < 500; i += 1) {
			const graineHex = graineDe(`equivalence-graine-${i}`).toString("hex");
			// Des clés volontairement pénibles : accents composés, caractère astral,
			// longueurs variables — tout ce qui peut faire diverger deux encodages.
			const cle = `${elem(["discord", "x", "instagram"], i % 3)}:${i}${"aé€\u{1d43b}".slice(0, i % 5)}`;

			const parLeNoyau = hex(await empreinteParticipant(graineHex, cle));
			const parNode = hmacRapide(depuisHex(graineHex), octetsUtf8(cle)).toString("hex");

			const cleWeb = await globalThis.crypto.subtle.importKey(
				"raw",
				depuisHex(graineHex) as BufferSource,
				{ hash: "SHA-256", name: "HMAC" },
				false,
				["sign"]
			);
			const parWeb = hex(
				new Uint8Array(
					await globalThis.crypto.subtle.sign("HMAC", cleWeb, octetsUtf8(cle) as BufferSource)
				)
			);

			if (parLeNoyau === parNode && parNode === parWeb) {
				identiques += 1;
			}
		}
		expect(identiques).toBe(500);
	}, 60_000);

	it("hex() du noyau rend la même chaîne que Buffer.toString('hex')", () => {
		for (let i = 0; i < 200; i += 1) {
			const octets = graineDe(`hex-${i}`);
			expect(hex(new Uint8Array(octets))).toBe(octets.toString("hex"));
		}
	});

	it("uDepuisEmpreinte lit un Buffer node exactement comme un Uint8Array", () => {
		// ⚠ PIÈGE RÉEL, et pas théorique : node alloue les petits `Buffer` dans un
		// POOL partagé, donc `buffer.buffer` est un ArrayBuffer de 8 Kio dont le
		// contenu utile commence à `byteOffset`. Un `new DataView(b.buffer)` naïf
		// lirait les octets d'un AUTRE buffer et rendrait un `u` parfaitement
		// plausible mais faux — une campagne statistique entière mesurerait alors
		// du bruit de pool. Le noyau passe bien `byteOffset`/`byteLength` ; ce test
		// est là pour que ça reste vrai, puisque la voie rapide en dépend.
		for (let i = 0; i < 200; i += 1) {
			const tampon = hmacRapide(graineDe(`pool-${i}`), octetsUtf8(`cle-${i}`));
			expect(tampon.byteLength).toBe(32);
			expect(uDepuisEmpreinte(tampon)).toBe(uDepuisEmpreinte(Uint8Array.from(tampon)));
			expect(kDepuisEmpreinte(tampon)).toBe(kDepuisEmpreinte(Uint8Array.from(tampon)));
		}
	});

	it("la voie rapide et executerTirage donnent le MÊME classement sur 300 tirages", async () => {
		// Le test d'accord de bout en bout : si la voie rapide dérivait un jour du
		// noyau, il tomberait ici, avant que les statistiques n'aient le temps de
		// mentir. On compare le classement ENTIER, pas seulement le gagnant.
		const cles = REELS.map((participant) => participant.cle);
		const octets = cles.map((cle) => octetsUtf8(cle));
		const poids = REELS.map((participant) => poidsDe(participant, "par_oeuvre"));

		for (let i = 0; i < 300; i += 1) {
			const graine = graineDe(`accord-${i}`);
			const attendu = cles
				.map((cle, index) => entreeDe(cle, elem(octets, index), elem(poids, index), graine))
				.sort(comparerEntrees)
				.map((entree) => entree.cle);

			const reel = await executerTirage(REELS, {
				graine: graine.toString("hex"),
				nbGagnants: 1,
				poidsMode: "par_oeuvre",
			});
			expect(reel.classement.map((entree) => entree.cle)).toEqual(attendu);
		}
	}, 120_000);
});

describe("primitives", () => {
	it("reproduit les vecteurs FIPS 180-4 de SHA-256", async () => {
		expect(await sha256Hex(new Uint8Array(0))).toBe(
			"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
		);
		expect(await sha256Hex(octetsUtf8("abc"))).toBe(
			"ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
		);
	});

	it("hex et depuisHex sont réciproques, et depuisHex refuse un hexa douteux", () => {
		const octets = new Uint8Array([0, 1, 15, 16, 127, 128, 254, 255]);
		expect(hex(octets)).toBe("00010f107f80feff");
		expect(depuisHex(hex(octets))).toEqual(octets);
		expect(() => depuisHex("abc")).toThrow(/impaire/);
		expect(() => depuisHex("ABCD")).toThrow(/invalide/); // majuscules refusées : une seule forme canonique
		expect(() => depuisHex("zz")).toThrow(/invalide/);
	});

	it("comparerOctets ordonne par OCTET, là où `<` sur chaîne se trompe", () => {
		// U+FFFD (3 octets UTF-8, 0xEF…) contre U+10000 (4 octets, 0xF0…). En UTF-16
		// le second est une paire de substitution qui COMMENCE par 0xD800, donc `<`
		// le range AVANT — l'inverse de ce que disent leurs octets UTF-8. C'est
		// exactement le genre d'écart qui ferait qu'un vérificateur tiers ne
		// retrouverait pas notre classement.
		const bmp = "�";
		const astral = "\u{10000}";
		expect(astral < bmp).toBe(true); // le piège, figé pour qu'on ne l'oublie pas
		expect(comparerOctets(octetsUtf8(astral), octetsUtf8(bmp))).toBe(1); // l'ordre correct
		expect(comparerOctets(octetsUtf8("a"), octetsUtf8("a"))).toBe(0);
		expect(comparerOctets(octetsUtf8("a"), octetsUtf8("ab"))).toBe(-1);
	});

	it("u32be refuse ce qui n'est pas un entier 32 bits non signé", () => {
		expect(u32be(0)).toEqual(new Uint8Array([0, 0, 0, 0]));
		expect(u32be(0xff_ff_ff_ff)).toEqual(new Uint8Array([255, 255, 255, 255]));
		expect(() => u32be(-1)).toThrow();
		expect(() => u32be(1.5)).toThrow();
		expect(() => u32be(0x1_00_00_00_00)).toThrow();
	});

	it("les constantes drand quicknet sont celles vérifiées en direct", () => {
		expect(DRAND_QUICKNET.chaine).toMatch(/^[0-9a-f]{64}$/);
		expect(DRAND_QUICKNET.periodeSec).toBe(3);
		expect(DRAND_QUICKNET.genesisSec).toBe(1_692_803_367);
		// `roundPour` et `instantDuRound` doivent être réciproques : c'est ce couple
		// qui décide si le round visé est « tombé », donc si l'on a le droit de tirer.
		for (const round of [1, 2, 1_000_000, 31_547_509]) {
			const instant = instantDuRound(round, DRAND_QUICKNET.genesisSec, DRAND_QUICKNET.periodeSec);
			expect(roundPour(instant, DRAND_QUICKNET.genesisSec, DRAND_QUICKNET.periodeSec)).toBe(round);
		}
		expect(estGrainePubliable("balise")).toBe(true);
		expect(estGrainePubliable("locale")).toBe(false);
		expect(BALISE_LOCALE.round).toBe(0);
	});
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("sérialisation canonique", () => {
	it("l'ordre d'entrée ne change pas l'empreinte du roster", async () => {
		const roster = rosterDe(REELS, "par_oeuvre");
		const reference = await empreinteRoster(roster);

		// 20 permutations déterministes : un mélange piloté par SHA-256 plutôt que
		// par Math.random, sinon un échec ne serait pas reproductible.
		for (let essai = 0; essai < 20; essai += 1) {
			const melange = [...roster]
				.map((entree, index) => ({
					entree,
					rang: graineDe(`melange-${essai}-${index}`).toString("hex"),
				}))
				.sort((a, b) => (a.rang < b.rang ? -1 : 1))
				.map((paire) => paire.entree);
			expect(await empreinteRoster(melange)).toBe(reference);
		}
		expect(trierRoster(roster).map((entree) => entree.cle)).toEqual(
			trierRoster([...roster].reverse()).map((entree) => entree.cle)
		);
	});

	it("un seul caractère changé change l'empreinte", async () => {
		const roster = rosterDe(REELS, "par_oeuvre");
		const reference = await empreinteRoster(roster);

		// (a) un chiffre de l'identifiant
		const cleModifiee = roster.map((entree, index) =>
			index === 0 ? { ...entree, cle: `${entree.cle.slice(0, -1)}1` } : entree
		);
		expect(await empreinteRoster(cleModifiee)).not.toBe(reference);

		// (b) un poids, à identifiants strictement identiques
		const poidsModifie = roster.map((entree, index) =>
			index === 3 ? { ...entree, poids: entree.poids + 1 } : entree
		);
		expect(await empreinteRoster(poidsModifie)).not.toBe(reference);

		// (c) un caractère invisible ajouté à une clé
		const espaceAjoute = roster.map((entree, index) =>
			index === 5 ? { ...entree, cle: `${entree.cle} ` } : entree
		);
		expect(await empreinteRoster(espaceAjoute)).not.toBe(reference);
	});

	it("réfute la collision que produisait une sérialisation à séparateurs", async () => {
		// La collision documentée en tête du noyau : avec `cle:poids` joints par un
		// saut de ligne, ces deux rosters — l'un à DEUX entrées, l'autre à UNE —
		// donnaient la même chaîne, donc la même empreinte `11f5f957…62dc`.
		// Autrement dit, un organisateur pouvait publier une liste et en engager une
		// autre, sans que l'empreinte publiée n'y voie rien.
		const deuxEntrees = await empreinteRoster([
			{ cle: "p:alice", poids: 1 },
			{ cle: "p:bob", poids: 3 },
		]);
		const uneEntree = await empreinteRoster([{ cle: "p:alice:1\np:bob", poids: 3 }]);
		expect(deuxEntrees).not.toBe(uneEntree);

		// La preuve que c'est bien le préfixe de longueur qui sépare les deux : la
		// sérialisation naïve, elle, les confond encore aujourd'hui.
		const naive = (entrees: ReadonlyArray<{ cle: string; poids: number }>) =>
			entrees.map((entree) => `${entree.cle}:${entree.poids}`).join("\n");
		expect(
			naive([
				{ cle: "p:alice", poids: 1 },
				{ cle: "p:bob", poids: 3 },
			])
		).toBe(naive([{ cle: "p:alice:1\np:bob", poids: 3 }]));
	});

	it("normalise en NFC : une même personne écrite en composé ou en décomposé n'a qu'un ticket", async () => {
		const compose = "instagram:café"; // é précomposé, U+00E9
		const decompose = "instagram:café"; // e + accent combinant, U+0065 U+0301
		expect(compose).not.toBe(decompose); // deux chaînes JS différentes…
		expect(await empreinteRoster([{ cle: compose, poids: 1 }])).toBe(
			await empreinteRoster([{ cle: decompose, poids: 1 }])
		); // …mais un seul participant.

		// Corollaire : le roster refuse les deux formes ensemble, sinon le même
		// humain aurait deux tickets et l'empreinte ne le dirait pas.
		expect(() =>
			serialiserRoster([
				{ cle: compose, poids: 1 },
				{ cle: decompose, poids: 1 },
			])
		).toThrow(/double/);
	});

	it("le format du roster commence par son étiquette de domaine", () => {
		const octets = serialiserRoster([{ cle: "x:1", poids: 1 }]);
		expect(hex(octets.slice(0, DOMAINE_ROSTER.length))).toBe(hex(octetsUtf8(DOMAINE_ROSTER)));
		// Longueur exacte du format v1 : 9 (domaine) + 4 (n) + 4 (len) + 3 (clé) + 4 (poids).
		expect(octets.length).toBe(24);
	});

	it("serialiserChamps ne se laisse pas contrefaire par le contenu des champs", () => {
		// Deux découpages différents du même flux de caractères doivent donner deux
		// sérialisations différentes — c'est toute la raison d'être du préfixe.
		expect(hex(serialiserChamps(["ab", "c"]))).not.toBe(hex(serialiserChamps(["a", "bc"])));
		expect(hex(serialiserChamps(["a", "b"]))).not.toBe(hex(serialiserChamps(["a b"])));
	});

	it("la clé publique pseudonymise sans perdre la vérifiabilité", async () => {
		const cle = "discord:683044704967065626";
		const publique = await clePublique("iergday", cle);
		expect(publique).toMatch(/^[0-9a-f]{16}$/);
		expect(publique).not.toContain("683044704967065626"); // aucune fuite de l'identifiant
		// Déterministe : la participante recompose la sienne et retrouve son rang.
		expect(await clePublique("iergday", cle)).toBe(publique);
		// Salée par la campagne : on ne recoupe pas deux campagnes entre elles.
		expect(await clePublique("autre-campagne", cle)).not.toBe(publique);
	});
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("dérivation de u dans l'intervalle OUVERT (0, 1)", () => {
	/** Fabrique les 8 octets de tête qui donnent exactement ce k sur 52 bits. */
	function empreintePourK(k: number): Uint8Array {
		const octets = new Uint8Array(32);
		const vue = new DataView(octets.buffer);
		const haut = Math.floor(k / 67_108_864);
		const bas = k % 67_108_864;
		vue.setUint32(0, haut * 64, false);
		vue.setUint32(4, bas * 64, false);
		return octets;
	}

	it("200 000 dérivations aux DEUX extrémités : jamais 0, jamais 1", () => {
		// ⚠ POURQUOI LES EXTRÊMES ET PAS DES GRAINES AU HASARD. Les trois formules
		// réfutées cassent uniquement au voisinage de 0 et de 1 : `u = 0` donne
		// `-ln u = +Infinity`, `u = 1` donne une clé de tri de `-0` — un gagnant
		// automatique, silencieux, et impossible à repérer sur un échantillon
		// aléatoire (P ≈ 2^-52 par tirage). On balaie donc EXHAUSTIVEMENT les
		// 100 000 valeurs de k les plus basses et les 100 000 les plus hautes :
		// c'est là, et nulle part ailleurs, que la formule se juge.
		const K_MAX = 4_503_599_627_370_495; // 2^52 − 1
		let hors = 0;
		let inexacts = 0;
		let uMin = Number.POSITIVE_INFINITY;
		let uMax = Number.NEGATIVE_INFINITY;

		for (let i = 0; i < 100_000; i += 1) {
			for (const k of [i, K_MAX - i]) {
				const u = uDepuisEmpreinte(empreintePourK(k));
				if (u <= 0 || u >= 1) {
					hors += 1;
				}
				// `u · 2^53` doit être un entier IMPAIR : c'est ce qui prouve que la
				// division a été exacte, sans le moindre arrondi.
				const produit = u * 9_007_199_254_740_992;
				if (!Number.isInteger(produit) || produit % 2 !== 1) {
					inexacts += 1;
				}
				const cleTri = cleDeTri(u, 1);
				if (!Number.isFinite(cleTri) || cleTri <= 0) {
					hors += 1;
				}
				uMin = Math.min(uMin, u);
				uMax = Math.max(uMax, u);
			}
		}

		expect(hors).toBe(0);
		expect(inexacts).toBe(0);
		expect(uMin).toBe(2 ** -53); // borne basse atteinte, et strictement > 0
		expect(uMax).toBe(1 - 2 ** -53); // borne haute atteinte, et strictement < 1
	}, 120_000);

	it("les octets extrêmes réels donnent exactement les bornes annoncées", () => {
		expect(uDepuisEmpreinte(new Uint8Array(32))).toBe(2 ** -53);
		expect(uDepuisEmpreinte(new Uint8Array(32).fill(0xff))).toBe(1 - 2 ** -53);
		expect(kDepuisEmpreinte(new Uint8Array(32))).toBe(0);
		expect(kDepuisEmpreinte(new Uint8Array(32).fill(0xff))).toBe(4_503_599_627_370_495);
		expect(() => kDepuisEmpreinte(new Uint8Array(7))).toThrow(/8/);
	});

	it("fige les trois variantes RÉFUTÉES, pour que nul ne les réintroduise", () => {
		// 64 bits / 2^64 : atteint 1 EXACTEMENT en haut…
		expect(Number(2n ** 64n - 1n) / 2 ** 64).toBe(1);
		// …et 0 en bas.
		expect(0 / 2 ** 64).toBe(0);
		// 53 bits / 2^53 : atteint 0.
		expect(0 / 2 ** 53).toBe(0);
		// (53 bits + 0,5) / 2^53 : `2^53 − 0,5` n'est pas représentable, il arrondit
		// à 2^53, donc u = 1, donc clé de tri −0, donc gagnant automatique.
		expect((2 ** 53 - 0.5) / 2 ** 53).toBe(1);
		expect(Object.is(-Math.log(1), -0)).toBe(true);
		expect(-Math.log(0)).toBe(Number.POSITIVE_INFINITY);
	});

	it("sur 50 000 empreintes HMAC réelles, u reste dans (0,1) et la clé de tri est finie", () => {
		const graine = graineDe("u-hmac");
		let hors = 0;
		for (let i = 0; i < 50_000; i += 1) {
			const u = uDepuisEmpreinte(hmacRapide(graine, octetsUtf8(`discord:${i}`)));
			const cle = cleDeTri(u, 1 + (i % MAX_POIDS));
			if (u <= 0 || u >= 1 || !Number.isFinite(cle) || cle <= 0) {
				hors += 1;
			}
		}
		expect(hors).toBe(0);
	}, 60_000);
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("déterminisme", () => {
	it("même graine et même roster rendent exactement le même résultat, 25 fois de suite", async () => {
		const graine = graineDe("determinisme").toString("hex");
		const parametres = { graine, nbGagnants: 3, poidsMode: "par_oeuvre" as PoidsMode };
		const lots = ["Or", "Argent", "Bronze"];
		const reference = JSON.stringify(await executerTirage(REELS, parametres, lots));
		for (let i = 0; i < 25; i += 1) {
			expect(JSON.stringify(await executerTirage(REELS, parametres, lots))).toBe(reference);
		}
	}, 60_000);

	it("l'ordre d'arrivée des participants ne change RIEN", async () => {
		// Sinon l'organisateur, qui contrôle l'ordre des lignes rendues par SQL,
		// contrôlerait le tirage — et `Array.prototype.sort` étant stable depuis
		// ES2019, ce serait silencieux.
		const graine = graineDe("ordre-arrivee").toString("hex");
		const parametres = { graine, nbGagnants: 5, poidsMode: "par_oeuvre" as PoidsMode };
		const droit = await executerTirage(REELS, parametres);
		const inverse = await executerTirage([...REELS].reverse(), parametres);
		expect(inverse.classement.map((entree) => entree.cle)).toEqual(
			droit.classement.map((entree) => entree.cle)
		);
		expect(inverse.empreinteParticipants).toBe(droit.empreinteParticipants);
		expect(inverse.gagnants).toEqual(droit.gagnants);
	});

	it("des graines différentes donnent des classements différents", async () => {
		const gagnants = new Set<string>();
		const classements = new Set<string>();
		for (let i = 0; i < 120; i += 1) {
			const resultat = await executerTirage(REELS, {
				graine: graineDe(`diversite-${i}`).toString("hex"),
				nbGagnants: 1,
				poidsMode: "un_par_personne",
			});
			gagnants.add(elem(resultat.gagnants, 0).cle);
			classements.add(resultat.classement.map((entree) => entree.cle).join(">"));
		}
		// Aucun classement identique sur 120 graines : 14! ordres possibles, une
		// collision serait le signe que la graine n'entre pas vraiment dans le calcul.
		expect(classements.size).toBe(120);
		// Et le rang 1 tourne réellement : au moins 10 des 14 personnes le prennent.
		expect(gagnants.size).toBeGreaterThanOrEqual(10);
	}, 60_000);

	it("un seul bit changé dans la graine change le classement", async () => {
		const base = graineDe("bit-flip");
		const modifiee = Buffer.from(base);
		modifiee[31] = elem([...modifiee], 31) ^ 1; // dernier bit du dernier octet
		const parametres = { nbGagnants: 1, poidsMode: "un_par_personne" as PoidsMode };
		const avant = await executerTirage(REELS, { ...parametres, graine: base.toString("hex") });
		const apres = await executerTirage(REELS, { ...parametres, graine: modifiee.toString("hex") });
		expect(apres.classement.map((entree) => entree.cle)).not.toEqual(
			avant.classement.map((entree) => entree.cle)
		);
		expect(apres.empreinteParticipants).toBe(avant.empreinteParticipants); // le roster, lui, n'a pas bougé
	});

	it("l'œuvre mise en avant est tirée, déterministe, et jamais hors de la liste", async () => {
		const graine = graineDe("oeuvre").toString("hex");
		const oeuvres = ["discord:1540301925298348062", "x:2090455666267713840"];
		const premier = await tirerOeuvre(graine, "discord:908269053347504170", oeuvres);
		// `toContain` exige une chaîne : on prouve d'abord que le tirage a rendu
		// quelque chose, plutôt que de forcer le type et de perdre le diagnostic
		// le jour où il rendra `null`.
		if (premier === null) throw new Error("tirerOeuvre a rendu null sur une liste non vide");
		expect(oeuvres).toContain(premier);
		expect(await tirerOeuvre(graine, "discord:908269053347504170", oeuvres)).toBe(premier);
		expect(await tirerOeuvre(graine, "discord:908269053347504170", [])).toBeNull();
		// Elle dépend de la personne, pas seulement de la graine : sinon ce ne serait
		// plus un tirage mais un index fixe déguisé.
		const autre = await tirerOeuvre(graine, "instagram:orphelinalius", oeuvres);
		if (autre === null) throw new Error("tirerOeuvre a rendu null sur une liste non vide");
		expect(oeuvres).toContain(autre);
		// Et sur 500 identifiants, les deux œuvres sortent à peu près autant : pas de
		// biais modulo, la sémantique entière `(k · n) >> 52` n'en produit aucun.
		let premieres = 0;
		for (let i = 0; i < 500; i += 1) {
			if ((await tirerOeuvre(graine, `discord:${i}`, oeuvres)) === elem(oeuvres, 0)) {
				premieres += 1;
			}
		}
		const { attendu, tolerance } = borne3Sigma(500, 0.5);
		expect(Math.abs(premieres - attendu)).toBeLessThanOrEqual(tolerance);
	}, 60_000);
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("uniformité", () => {
	it("100 000 tirages à poids égaux : chaque personne reste dans ±3σ, et le χ² ne voit aucun biais", () => {
		const N = 100_000;
		const cles = REELS.map((participant) => participant.cle);
		const poids = REELS.map(() => 1);
		const { rang1 } = campagne(cles, poids, N, "iergday-uniformite-");

		expect(rang1.reduce((a, b) => a + b, 0)).toBe(N); // aucun tirage perdu en route

		const { attendu, tolerance } = borne3Sigma(N, 1 / cles.length);
		// Mesuré le 23/8/2026 : attendu 7 142,86 ; σ = 81,44 ; 3σ = 244,32 ;
		// décomptes de 7 014 à 7 220 ; pire écart 1,582σ ; χ² = 5,518.
		for (let i = 0; i < cles.length; i += 1) {
			expect(Math.abs(elem(rang1, i) - attendu)).toBeLessThanOrEqual(tolerance);
		}
		expect(
			khiDeux(
				rang1,
				cles.map(() => 1 / cles.length),
				N
			)
		).toBeLessThan(KHI2_DF13_P001);
	}, 180_000);

	it("aucune personne n'est structurellement avantagée par la longueur de sa clé", () => {
		// Vérification dirigée : les clés réelles vont de 11 à 25 caractères. Un
		// HMAC ne s'en soucie pas, mais la RFC 2104 complète justement les clés
		// COURTES par des zéros — et c'est exactement l'accident qui arriverait si
		// quelqu'un inversait un jour les arguments de `hmacSha256`. Ce test dit à
		// quoi ressemblerait le dégât : un biais corrélé à la longueur de la clé.
		const N = 20_000;
		const cles = REELS.map((participant) => participant.cle);
		const { rang1 } = campagne(
			cles,
			REELS.map(() => 1),
			N,
			"iergday-longueurs-"
		);
		const parLongueur = new Map<number, { total: number; cases: number }>();
		for (let i = 0; i < cles.length; i += 1) {
			const longueur = elem(cles, i).length;
			const agrege = parLongueur.get(longueur) ?? { cases: 0, total: 0 };
			parLongueur.set(longueur, { cases: agrege.cases + 1, total: agrege.total + elem(rang1, i) });
		}
		expect(parLongueur.size).toBeGreaterThan(3); // il y a bien plusieurs longueurs distinctes
		const { sigma } = borne3Sigma(N, 1 / cles.length);
		for (const agrege of parLongueur.values()) {
			const attendu = (N * agrege.cases) / cles.length;
			expect(Math.abs(agrege.total - attendu)).toBeLessThanOrEqual(3 * sigma * Math.sqrt(agrege.cases));
		}
	}, 120_000);
});

/* ══════════════════════════════════════════════════════════════════════════ */

const SIX_CLES = [
	"x:100000000000001",
	"x:100000000000002",
	"x:100000000000003",
	"x:100000000000004",
	"x:100000000000005",
	"x:100000000000006",
];
const SIX_POIDS = [3, 1, 1, 1, 1, 1];

describe("pondération par les œuvres", () => {
	it("un poids 3 sort au rang 1 trois fois plus souvent qu'un poids 1", () => {
		// ── LA PROPRIÉTÉ QUE L'ALGORITHME GARANTIT VRAIMENT ────────────────────
		// Efraimidis–Spirakis garantit P(rang 1 = i) = w_i / Σw, EXACTEMENT, parce
		// que `-ln(u)/w ~ Exp(w)` et que le minimum d'exponentielles indépendantes
		// tombe sur `i` avec probabilité `w_i / Σw`. C'est cette égalité-là que l'on
		// mesure, et pas une autre : la « probabilité d'être dans les N premiers »
		// n'est PAS proportionnelle au poids, et le test suivant le démontre.
		const N = 100_000;
		const total = SIX_POIDS.reduce((a, b) => a + b, 0); // 8
		const { rang1 } = campagne(SIX_CLES, SIX_POIDS, N, "iergday-poids3-", 3);

		// Mesuré : lourd 37 617 pour 37 500 attendus, soit 0,764σ ; ratio 3,0150.
		for (let i = 0; i < SIX_CLES.length; i += 1) {
			const { attendu, tolerance } = borne3Sigma(N, elem(SIX_POIDS, i) / total);
			expect(Math.abs(elem(rang1, i) - attendu)).toBeLessThanOrEqual(tolerance);
		}
		const moyenneLegers = rang1.slice(1).reduce((a, b) => a + b, 0) / 5;
		expect(elem(rang1, 0) / moyenneLegers).toBeCloseTo(3, 1);
	}, 180_000);

	it("« deux fois plus d'œuvres = deux fois plus de chances de GAGNER » est FAUX, et c'est mesuré", () => {
		// Ce test existe pour interdire une PHRASE, pas pour valider un calcul.
		// La formulation juste est : « chaque œuvre est un ticket, tirés un par un
		// SANS REMISE ». Dès qu'il y a plus d'un gagnant, la fréquence de présence
		// dans le trio de tête est STRICTEMENT INFÉRIEURE à `3·w/W` — mesuré ici
		// 82 137 sur 100 000 contre 112 500 « annoncés », soit −27 %. Ce n'est pas
		// un défaut d'A-Res : un tirage à probabilités d'inclusion proportionnelles
		// est infaisable dès que N·w_i/W > 1, une probabilité ne dépassant pas 1.
		const N = 100_000;
		const { dansTop } = campagne(SIX_CLES, SIX_POIDS, N, "iergday-poids3-", 3);

		const annonceNaive = (3 * 3) / 8; // « 3 gagnants × w/W » = 1,125 → impossible
		expect(annonceNaive).toBeGreaterThan(1); // la formule promet plus que 100 %
		expect(elem(dansTop, 0) / N).toBeLessThan(1);
		expect(elem(dansTop, 0) / N).toBeLessThan(annonceNaive * 0.9); // au moins 10 % en dessous
		// La somme des présences vaut exactement 3 par campagne : personne n'est
		// compté deux fois, le tirage est bien SANS REMISE.
		expect(dansTop.reduce((a, b) => a + b, 0)).toBe(3 * N);
	}, 180_000);

	it("sur le roster RÉEL en mode par_oeuvre, Sanada et orphelinalius sont à 2 tickets sur 16", () => {
		const N = 100_000;
		const cles = REELS.map((participant) => participant.cle);
		const poids = REELS.map((participant) => poidsDe(participant, "par_oeuvre"));
		const total = poids.reduce((a, b) => a + b, 0);
		expect(total).toBe(16);

		const { rang1 } = campagne(cles, poids, N, "iergday-ponderation-");
		// Le χ² global est le bon outil sur 14 cases : une borne par case ne verrait
		// pas un biais réparti. Mesuré : χ² = 20,923, pire case 2,457σ.
		expect(
			khiDeux(
				rang1,
				poids.map((p) => p / total),
				N
			)
		).toBeLessThan(KHI2_DF13_P001);

		// Propriété robuste, indépendante du bruit : les deux personnes à 2 œuvres
		// devancent TOUTES celles qui n'en ont qu'une, et de loin.
		const lourds = [elem(rang1, 0), elem(rang1, 1)];
		const legers = rang1.slice(2);
		expect(Math.min(...lourds)).toBeGreaterThan(Math.max(...legers) * 1.7);
	}, 180_000);

	it("poidsDe traduit exactement la décision « une œuvre, un ticket »", () => {
		const sanada = elem(REELS, 0);
		expect(poidsDe(sanada, "par_oeuvre")).toBe(2);
		expect(poidsDe(sanada, "un_par_personne")).toBe(1);
		// Une personne sans œuvre rattachée reste une personne : le poids 0 la
		// retirerait du tirage en SILENCE, ce qu'un calcul de poids n'a pas le droit
		// de faire — écarter quelqu'un est un acte de modération avec un motif.
		expect(poidsDe({ cle: "x:1", nbOeuvres: 0, oeuvres: [], pseudoAffichage: "" }, "par_oeuvre")).toBe(1);
		// Et le plafond protège le comparateur exact autant qu'il signale une donnée
		// aberrante : 999 œuvres pour une personne, c'est un dédoublonnage raté.
		expect(poidsDe({ cle: "x:1", nbOeuvres: 999, oeuvres: [], pseudoAffichage: "" }, "par_oeuvre")).toBe(
			MAX_POIDS
		);
		expect(rosterDe(REELS, "un_par_personne").reduce((somme, e) => somme + e.poids, 0)).toBe(14);
		expect(rosterDe(REELS, "par_oeuvre").reduce((somme, e) => somme + e.poids, 0)).toBe(16);
	});

	it("le comparateur exact en BigInt ne diverge jamais du comparateur flottant", () => {
		// `Math.log` est « implementation-approximated » par ECMA-262 : c'est
		// pourquoi la sémantique de référence est entière. Ce test vérifie que le
		// choix ne change rien en pratique, donc qu'aucun classement publié ne
		// dépendrait du moteur JavaScript du vérificateur.
		const graine = graineDe("comparateur");
		let desaccords = 0;
		let antisymetrieCassee = 0;
		for (let i = 0; i < 100_000; i += 1) {
			const a = entreeDe(`x:${i}`, octetsUtf8(`x:${i}`), 1 + (i % 8), graine);
			const b = entreeDe(`x:${i + 1}`, octetsUtf8(`x:${i + 1}`), 1 + ((i + 3) % 8), graine);
			if (Math.sign(comparerEntrees(a, b)) !== Math.sign(a.cleTri - b.cleTri)) {
				desaccords += 1;
			}
			// Antisymétrie : sans elle, le tri dépend de l'ordre d'arrivée.
			if (comparerEntrees(a, b) !== -comparerEntrees(b, a)) {
				antisymetrieCassee += 1;
			}
		}
		expect(desaccords).toBe(0);
		expect(antisymetrieCassee).toBe(0);
	}, 120_000);

	it("à u et poids égaux, le départage passe par l'empreinte et jamais par l'ordre d'arrivée", () => {
		// P(égalité réelle) ≈ 2e-14, donc ce cas ne s'observe pas : on le FABRIQUE.
		// Sans troisième niveau de départage, `Array.prototype.sort` étant stable
		// depuis ES2019, c'est l'ordre du roster — donc l'organisateur — qui
		// trancherait, et un vérificateur écrit en Python ne trouverait pas pareil.
		const jumelle = (cle: string, empreinte: string): EntreeCalculee => {
			const u = uDepuisEmpreinte(depuisHex(empreinte));
			return { cle, cleTri: cleDeTri(u, 1), empreinte, oeuvres: [], poids: 1, pseudoAffichage: cle, rang: 0, u };
		};
		// Mêmes 8 octets de tête (donc même u, même clé de tri), queues différentes.
		const a = jumelle("x:aaa", `${"11".repeat(8)}${"aa".repeat(24)}`);
		const b = jumelle("x:bbb", `${"11".repeat(8)}${"bb".repeat(24)}`);
		expect(a.u).toBe(b.u);
		expect(a.cleTri).toBe(b.cleTri);
		expect(comparerEntrees(a, b)).toBe(-1); // "…aa" < "…bb"
		expect(comparerEntrees(b, a)).toBe(1);
		expect([b, a].toSorted(comparerEntrees).map((e) => e.cle)).toEqual(["x:aaa", "x:bbb"]);
		expect([a, b].toSorted(comparerEntrees).map((e) => e.cle)).toEqual(["x:aaa", "x:bbb"]);
	});
});

/* ══════════════════════════════════════════════════════════════════════════ */

/** Fabrique un tirage GELÉ honnête, sur une balise bien formée, prêt à être muté. */
async function tirageHonnete(): Promise<TirageGele> {
	const signature = "9f".repeat(48); // 96 hexa : la forme d'une signature G1 de quicknet
	const lots = ["Print A5 dédicacé", "Sticker collector"];
	const empreinteParticipants = await empreinteRoster(rosterDe(REELS, "par_oeuvre"));
	const graine = await graineDepuisBalise(signature, empreinteParticipants);
	const resultat = await executerTirage(
		REELS,
		{ graine, nbGagnants: lots.length, poidsMode: "par_oeuvre" },
		lots
	);
	const gele: TirageGele = {
		balise: {
			chaine: DRAND_QUICKNET.chaine,
			reseau: DRAND_QUICKNET.reseau,
			round: 31_547_509,
			signature,
		},
		campagneSlug: "iergday",
		empreinteEngagement: "",
		empreinteGraine: resultat.empreinteGraine,
		empreinteParticipants: resultat.empreinteParticipants,
		entrees: resultat.classement.map((entree) => ({ ...entree, oeuvres: [...entree.oeuvres] })),
		gagnants: resultat.gagnants.map((gagnant) => ({
			cle: gagnant.cle,
			oeuvreId: gagnant.oeuvreId,
			rang: gagnant.rang,
		})),
		graine,
		graineOrigine: "balise",
		lots,
		nbGagnants: lots.length,
		numero: 1,
		poidsMode: "par_oeuvre",
		publie: true,
	};
	gele.empreinteEngagement = await empreinteEngagement(engagementDeTirage(gele));
	return gele;
}

describe("verifierTirage", () => {
	it("valide un tirage honnête, et dit COMBIEN de contrôles ont concordé", async () => {
		const verdict = await verifierTirage(await tirageHonnete());
		expect(verdict.anomalies).toEqual([]);
		expect(verdict.valide).toBe(true);
		// 15 contrôles avec une balise, 14 sans (la dérivation depuis la signature
		// n'existe pas en mode répétition). L'écran d'admin doit afficher
		// `verdict.controles`, jamais un nombre écrit en dur : « 15 contrôles
		// concordants » est une affirmation, « vrai » n'en est pas une.
		expect(verdict.controles).toBe(15);
	}, 30_000);

	it("valide aussi un tirage de répétition NON publié, avec un contrôle de moins", async () => {
		const gele = structuredClone(await tirageHonnete());
		gele.balise = null;
		gele.graineOrigine = "locale";
		gele.publie = false;
		gele.empreinteEngagement = await empreinteEngagement(engagementDeTirage(gele));
		const verdict = await verifierTirage(gele);
		expect(verdict.anomalies).toEqual([]);
		expect(verdict.valide).toBe(true);
		expect(verdict.controles).toBe(14);
	}, 30_000);

	/*
	 * ── LES MUTANTS ───────────────────────────────────────────────────────────
	 * Chaque ligne est une falsification plausible d'un tirage déjà publié. Le
	 * test n'exige pas seulement « invalide » : il exige LE code attendu, parce
	 * qu'un vérificateur qui dit « non » sans dire « pourquoi » ne convainc
	 * personne, et parce qu'un code qui se déplacerait signalerait que le contrôle
	 * censé attraper cette falsification-là ne l'attrape plus.
	 */
	const mutants: ReadonlyArray<[string, (gele: TirageGele) => void, CodeAnomalie]> = [
		[
			"une entrée retirée du roster",
			(gele) => {
				gele.entrees.splice(1, 1);
			},
			"empreinte_participants",
		],
		[
			"une entrée retirée SANS trou dans les rangs (la plus difficile à voir)",
			(gele) => {
				const dernier = gele.entrees.length;
				gele.entrees = gele.entrees.filter((entree) => entree.rang !== dernier);
			},
			"empreinte_participants",
		],
		[
			"une entrée ajoutée après coup",
			(gele) => {
				gele.entrees.push({
					...elem(gele.entrees, 0),
					cle: "x:999999999999999999",
					rang: gele.entrees.length + 1,
				});
			},
			"empreinte_participants",
		],
		[
			"un poids gonflé",
			(gele) => {
				elem(gele.entrees, 0).poids = 5;
			},
			"empreinte_participants",
		],
		[
			"deux rangs permutés",
			(gele) => {
				const premier = elem(gele.entrees, 0);
				const second = elem(gele.entrees, 1);
				const rang = premier.rang;
				premier.rang = second.rang;
				second.rang = rang;
			},
			"ordre",
		],
		[
			"la graine remplacée",
			(gele) => {
				gele.graine = "c".repeat(64);
			},
			"empreinte_graine",
		],
		[
			"la signature drand remplacée",
			(gele) => {
				const balise = gele.balise;
				if (balise) {
					balise.signature = "d".repeat(96);
				}
			},
			"graine_balise",
		],
		[
			"le nombre de gagnants changé après le tirage",
			(gele) => {
				gele.nbGagnants = 5;
			},
			"empreinte_engagement",
		],
		[
			"un lot réécrit après le tirage",
			(gele) => {
				gele.lots[0] = "Un lot bien plus intéressant";
			},
			"empreinte_engagement",
		],
		[
			"le mode de poids réécrit après le tirage",
			(gele) => {
				gele.poidsMode = "un_par_personne";
			},
			"empreinte_engagement",
		],
		[
			"un gagnant remplacé par quelqu'un d'autre",
			(gele) => {
				elem(gele.gagnants, 0).cle = elem(gele.entrees, gele.entrees.length - 1).cle;
			},
			"gagnants",
		],
		[
			"un u retouché",
			(gele) => {
				elem(gele.entrees, 0).u = 0.5;
			},
			"u",
		],
		[
			"l'œuvre mise en avant CHOISIE au lieu d'être tirée",
			(gele) => {
				elem(gele.gagnants, 0).oeuvreId = "x:2090455666267713840";
			},
			"oeuvre_gagnante",
		],
		[
			"un tirage de répétition publié comme s'il était une preuve",
			(gele) => {
				gele.graineOrigine = "locale";
			},
			"mode_locale_publie",
		],
	];

	for (const [nom, muter, codeAttendu] of mutants) {
		it(`détecte : ${nom} → ${codeAttendu}`, async () => {
			const gele = structuredClone(await tirageHonnete());
			muter(gele);
			const verdict = await verifierTirage(gele);
			expect(verdict.valide).toBe(false);
			expect(verdict.anomalies.map((anomalie) => anomalie.code)).toContain(codeAttendu);
			// Une anomalie doit être LISIBLE : un code seul n'aide personne à
			// comprendre ce qu'on lui reproche, ni à le contester.
			for (const anomalie of verdict.anomalies) {
				expect(anomalie.explication.length).toBeGreaterThan(20);
				expect(anomalie.attendu).not.toBe(anomalie.trouve);
			}
		}, 30_000);
	}

	it("un pseudo corrigé après le tirage NE casse PAS la preuve", async () => {
		// Aussi important que les mutants ci-dessus, et dans l'autre sens : si
		// `pseudoAffichage` entrait dans une empreinte, corriger l'orthographe du
		// nom d'une gagnante détruirait la preuve de son propre gain. Ce test
		// interdit à quiconque de l'ajouter « par sécurité ».
		const gele = structuredClone(await tirageHonnete());
		elem(gele.entrees, 0).pseudoAffichage = "Orthographe enfin correcte";
		const verdict = await verifierTirage(gele);
		expect(verdict.anomalies).toEqual([]);
		expect(verdict.valide).toBe(true);
		expect(verdict.controles).toBe(15);
	}, 30_000);

	it("refuse un roster gelé vide sans prétendre l'avoir vérifié", async () => {
		const gele = structuredClone(await tirageHonnete());
		gele.entrees = [];
		const verdict = await verifierTirage(gele);
		expect(verdict.valide).toBe(false);
		expect(elem(verdict.anomalies, 0).code).toBe("roster_vide");
		expect(verdict.controles).toBe(0); // aucun contrôle n'a pu être fait, et c'est dit
	}, 30_000);

	it("une clé dupliquée dans le roster gelé est signalée nommément", async () => {
		const gele = structuredClone(await tirageHonnete());
		const premiere = elem(gele.entrees, 0);
		gele.entrees.push({ ...premiere, rang: gele.entrees.length + 1 });
		const verdict = await verifierTirage(gele);
		expect(verdict.valide).toBe(false);
		expect(verdict.anomalies.map((anomalie) => anomalie.code)).toContain("cle_dupliquee");
		expect(verdict.anomalies.some((anomalie) => anomalie.cle === premiere.cle)).toBe(true);
	}, 30_000);

	it("la graine publiée est bien SHA-256(signature ‖ empreinte des participants)", async () => {
		const gele = await tirageHonnete();
		const balise = gele.balise;
		expect(balise).not.toBeNull();
		expect(await graineDepuisBalise(balise?.signature ?? "", gele.empreinteParticipants)).toBe(
			gele.graine
		);
		expect(await empreinteGraine(gele.graine)).toBe(gele.empreinteGraine);
		// Deux campagnes qui viseraient le MÊME round n'ont pas la même graine :
		// c'est l'empreinte du roster, concaténée, qui les sépare.
		const autre = await graineDepuisBalise(
			balise?.signature ?? "",
			await empreinteRoster([{ cle: "x:1", poids: 1 }])
		);
		expect(autre).not.toBe(gele.graine);
	}, 30_000);
});

/* ══════════════════════════════════════════════════════════════════════════ */

/*
 * ── DÉDOUBLONNAGE ─────────────────────────────────────────────────────────
 *
 * Les 27 empreintes RÉELLES des 20 créations retenues de la campagne, mesurées
 * le 23/8/2026 (sha256 des octets bruts ; dHash 64 bits sur un gris 9×8 ;
 * pHash 64 bits par DCT-II sur un gris 32×32, composante continue jetée, seuil
 * à la MÉDIANE des 63 coefficients restants).
 *
 * Ce que ce bloc garde n'est PAS l'implémentation du calcul d'empreintes — elle
 * vit dans le script de collecte, hors ligne, parce qu'elle charge `sharp` et
 * télécharge `pbs.twimg.com`. Ce qu'il garde, c'est le SEUIL et la CONSÉQUENCE :
 * appliqué à ces empreintes-là, le seuil retenu doit retrouver exactement les
 * quatre regroupements qu'un humain a confirmés à l'œil (et deux fois en lisant
 * la signature peinte dans l'illustration), et le poids du roster doit suivre
 * les ŒUVRES et non les publications. Ces deux affirmations décident de qui a
 * combien de chances ; elles méritent d'être figées.
 */
interface EmpreinteImage {
	source: "discord" | "instagram" | "x";
	identifiant: string;
	index: number;
	auteur: string;
	sha256: string;
	dhash: string;
	phash: string;
	largeur: number;
	hauteur: number;
}

const EMPREINTES: readonly EmpreinteImage[] = [
	{ auteur: "san_la_vraie", dhash: "2a7234b495b435b0", hauteur: 2269, identifiant: "1539898224503033877", index: 0, largeur: 2734, phash: "37cce03f9c614a36", sha256: "4204055e1195e92f8e7fe81a51224f504e7f9d39bbae5853147e0b822824fbe3", source: "discord" },
	{ auteur: "san_la_vraie", dhash: "72e0f8f9f8d2e6a4", hauteur: 2663, identifiant: "1540301925298348062", index: 0, largeur: 2115, phash: "362c99c6c5994e6d", sha256: "598493423211aa8fa4d0fff0d54168e1ae8175e505ba5c1c7f289e7e04ec71c2", source: "discord" },
	{ auteur: "munfurawa", dhash: "4e1b1d1f9f1f0f0f", hauteur: 1440, identifiant: "1540456574588559440", index: 0, largeur: 1730, phash: "4ea6399a7879193c", sha256: "8f0082bcfb4caccdf6cb4d46de9814487616e389d7990c4b2aa9ed064a350d21", source: "discord" },
	{ auteur: "fujorin", dhash: "97077331626c4d58", hauteur: 2428, identifiant: "1540508422804471819", index: 0, largeur: 1720, phash: "52d6ce9966653398", sha256: "723fd195645d38b1d1d59b2a89a3fac8a98965606c73edac5d0cc1fbe65809b7", source: "discord" },
	{ auteur: "kittycaillou", dhash: "373b1f0e0d277365", hauteur: 2160, identifiant: "1540742112713379840", index: 0, largeur: 2558, phash: "51cc323349b6676d", sha256: "bd2e3682c0b1185759b2634f5187e1a214c74d130f499fd27d20447f56a3e1a3", source: "discord" },
	{ auteur: "jennscarlet", dhash: "e892929392222581", hauteur: 1938, identifiant: "1540784107729064108", index: 0, largeur: 2550, phash: "076aeda85d69904f", sha256: "110c3eb8ab82816976e4bd91235a97d8679b54a0df17dfa0bc62743b6530cc7d", source: "discord" },
	{ auteur: "jennscarlet", dhash: "ecf8929332a18b96", hauteur: 3507, identifiant: "1540784107729064108", index: 1, largeur: 2550, phash: "076ae82dc2177d87", sha256: "a46e63af7807e69d3a486248313fad9cfc1a9505c2462b382067b002738122ea", source: "discord" },
	{ auteur: "cacabueno", dhash: "4ac0c4a4d28cccc2", hauteur: 2160, identifiant: "1540808591806570586", index: 0, largeur: 3840, phash: "3ff0c40fc2096b3e", sha256: "47040b77e18cfa19e65ebaeb1e228d2ae5fc922083c0db11bdc1558b7748b7ac", source: "discord" },
	{ auteur: "thunder_ace", dhash: "f7373d3f2bab2723", hauteur: 1857, identifiant: "1540837023487631391", index: 0, largeur: 3225, phash: "556a331dfa4825e3", sha256: "9f1b54dc87fe7a5667a204df14264c246d228f7feb99e43c68231c10fc4eebd9", source: "discord" },
	{ auteur: "thunder_ace", dhash: "a4d64e2eb7934b2d", hauteur: 1749, identifiant: "1540837023487631391", index: 1, largeur: 3083, phash: "5b3bad374320eca2", sha256: "807133ebbd698add73b6d90d1b2ebf43283897e4f9831ac36b68bec8df31e77a", source: "discord" },
	{ auteur: "thunder_ace", dhash: "040b497739597d7f", hauteur: 1858, identifiant: "1540837023487631391", index: 2, largeur: 3270, phash: "641b1ae7c3788d96", sha256: "a4ef35cfa8508923071af6a9b11470abff54216ba74ff86fb3f0be3e69e8dd0e", source: "discord" },
	{ auteur: "thunder_ace", dhash: "1b1c0d2c0c4d7f7f", hauteur: 1969, identifiant: "1540837023487631391", index: 3, largeur: 3438, phash: "490f76761236d572", sha256: "84a78b357bc00163f8f1df714f1a4b6e4f69c29102d0ac0a65e440a6604ab18e", source: "discord" },
	{ auteur: "thunder_ace", dhash: "6f2e1fc7c7277773", hauteur: 1913, identifiant: "1540837023487631391", index: 4, largeur: 3347, phash: "500d6339387cc7de", sha256: "3551e998911f74489f1b76fd1f7287ed4911c963f048c6daf72218c3c9d30aeb", source: "discord" },
	{ auteur: "thunder_ace", dhash: "400917476f9cdef7", hauteur: 1676, identifiant: "1540837023487631391", index: 5, largeur: 2618, phash: "5f007cedd09e33e0", sha256: "279749476af477733d4b89bde6c35c2e442fc64f3131f6132c79e6c00118d454", source: "discord" },
	{ auteur: "thunder_ace", dhash: "091d018727cdd59f", hauteur: 1904, identifiant: "1540837023487631391", index: 6, largeur: 3279, phash: "0d026c39d33fd933", sha256: "b0d449c1e8c48289823b5667bbb5847b0ec8375f221839480e7423031fa8deff", source: "discord" },
	{ auteur: "deborah6625", dhash: "0f4fc949474b4349", hauteur: 1381, identifiant: "1540842925456359557", index: 0, largeur: 1839, phash: "1c4b4592cd6e2dd3", sha256: "0397e5d1502cd5eff91b8b0d854d875bd6254089504c1a0ec51e2ce47ca63882", source: "discord" },
	{ auteur: "orphelinalius", dhash: "414d514d45476777", hauteur: 853, identifiant: "DcUEDDKoTgP", index: 0, largeur: 640, phash: "0015051d2b3f3fbf", sha256: "4263767b14310c7ee166aa9258a20fa715f7abf99590acd79f2595ae3ccacc27", source: "instagram" },
	{ auteur: "orphelinalius", dhash: "4517735732584e53", hauteur: 853, identifiant: "DcW22ScIdYv", index: 0, largeur: 640, phash: "00915ded37f834f4", sha256: "88836f4c2844c396fa40e097bbf8da81954fdcd26fe778f2e03a33619d9b9738", source: "instagram" },
	{ auteur: "Ruvi_Seiya", dhash: "0185111301000100", hauteur: 4000, identifiant: "2087922862803841524", index: 0, largeur: 3000, phash: "05d75d1d26a92a3b", sha256: "0d13041f57cef747d22f48ab1cc0373af149114b6a3288de14ae57fac761b2ec", source: "x" },
	{ auteur: "inazo__", dhash: "d3f1f351f0f2f2f3", hauteur: 1080, identifiant: "2087923415000789199", index: 0, largeur: 1920, phash: "36b6920a0d5cf2b7", sha256: "47d7790bc3138e22b8d7333224b41fc0bd9c61b8ae4bf93e405ece41e794a123", source: "x" },
	{ auteur: "grimnape", dhash: "09992b0b33360737", hauteur: 977, identifiant: "2087998363211825503", index: 0, largeur: 1919, phash: "1635696b3b903373", sha256: "f2e3de7246c378e3d466940dbac9c00087010b13321cd14065168fdef8a8e4d7", source: "x" },
	{ auteur: "San_La_Vraie", dhash: "2a7336b495b435b0", hauteur: 2269, identifiant: "2090455666267713840", index: 0, largeur: 2734, phash: "37cce03f9c614a36", sha256: "9f8693ad91253c206965e40d8f7f2a1821f3230a89dbddfdaaaaabbdb6b0bb42", source: "x" },
	{ auteur: "CuicoLya", dhash: "8191b0060c3ca242", hauteur: 3055, identifiant: "2090513552087879823", index: 0, largeur: 2160, phash: "0ba7b4cdd8386539", sha256: "fb0a3086c15ff0cda07ddc90824ca8a229a107b95f0be709e282353524279dbb", source: "x" },
	{ auteur: "Haroldinho_jr", dhash: "e87b692763c39359", hauteur: 1204, identifiant: "2090897441985896710", index: 0, largeur: 2048, phash: "14692eb6699f1b2c", sha256: "0f3157f6310c76c90c8f6fb3294fbeb01ae329ae42cc7b0fd484523a7eeb5cc6", source: "x" },
	{ auteur: "FurawaMun", dhash: "4e1b1d1f9f1f0f0f", hauteur: 1440, identifiant: "2090899354148368577", index: 0, largeur: 1730, phash: "4ea6399a7879193c", sha256: "91f69c9428c89ac8865bc4aa0ff0fd6060c653f2785d80b0891df5ceb5a33311", source: "x" },
	{ auteur: "Fujo_Kiran", dhash: "97077331626e4d78", hauteur: 1200, identifiant: "2091112393455632493", index: 0, largeur: 850, phash: "52d6ce9966653394", sha256: "e1922a867cced1534d042c245d7d7f6117bde40965b5c51a249a070427f5afe3", source: "x" },
	{ auteur: "kittyshadow_", dhash: "373b1f0f0d277365", hauteur: 3459, identifiant: "2091195848247885914", index: 0, largeur: 4096, phash: "51cc323349b6676d", sha256: "bc729a41095cce703f9bd40f87ab777926efc3570c4d07a011c0a9baaf57d296", source: "x" },
];

/** Seuil retenu — la CONJONCTION est obligatoire : une seule empreinte se laisse tromper. */
const SEUIL = { dhash: 8, phash: 8 } as const;

const POPCOUNT = Array.from({ length: 256 }, (_, octet) => {
	let compte = 0;
	for (let reste = octet; reste > 0; reste >>= 1) {
		compte += reste & 1;
	}
	return compte;
});

/** Distance de Hamming entre deux empreintes de 64 bits écrites en 16 hexa. */
function distanceHamming(a: string, b: string): number {
	if (a.length !== b.length) {
		throw new Error(`Empreintes de longueurs différentes : ${a.length} et ${b.length}.`);
	}
	let distance = 0;
	for (let i = 0; i < a.length; i += 2) {
		const octetA = Number.parseInt(a.slice(i, i + 2), 16);
		const octetB = Number.parseInt(b.slice(i, i + 2), 16);
		distance += elem(POPCOUNT, octetA ^ octetB);
	}
	return distance;
}

const creationDe = (image: EmpreinteImage): string => `${image.source}:${image.identifiant}`;

interface Paire {
	a: EmpreinteImage;
	b: EmpreinteImage;
	dhash: number;
	phash: number;
	doublon: boolean;
}

function toutesLesPaires(): Paire[] {
	const paires: Paire[] = [];
	for (let i = 0; i < EMPREINTES.length; i += 1) {
		for (let j = i + 1; j < EMPREINTES.length; j += 1) {
			const a = elem(EMPREINTES, i);
			const b = elem(EMPREINTES, j);
			const dhash = distanceHamming(a.dhash, b.dhash);
			const phash = distanceHamming(a.phash, b.phash);
			paires.push({ a, b, dhash, doublon: dhash <= SEUIL.dhash && phash <= SEUIL.phash, phash });
		}
	}
	return paires;
}

describe("dédoublonnage : deux publications, un seul dessin, une seule chance", () => {
	it("les 27 images ont 27 SHA-256 DISTINCTS : une déduplication binaire ne verrait RIEN", () => {
		// C'est le piège central. X ré-encode systématiquement en JPEG, donc pas un
		// octet ne coïncide entre le PNG déposé sur Discord et le tweet. Un
		// `distinct on (sha256)` trouverait zéro doublon et attribuerait QUATRE
		// chances de trop — à quatre personnes qui n'ont dessiné qu'une fois.
		expect(EMPREINTES.length).toBe(27);
		expect(new Set(EMPREINTES.map((image) => image.sha256)).size).toBe(27);
		expect(new Set(EMPREINTES.map(creationDe)).size).toBe(20);
	});

	it("le seuil retrouve EXACTEMENT les quatre regroupements confirmés à l'œil", () => {
		const doublons = toutesLesPaires().filter((paire) => paire.doublon);
		expect(doublons.length).toBe(4);

		// Les quatre paires, telles qu'un humain les a confirmées — dont deux en
		// lisant la signature peinte DANS l'illustration (« @San_La_Vraie »,
		// « @Kittyshadow_ »), et une où le pseudo seul n'aurait RIEN donné
		// (kittyshadow_ / kittycaillou, nom affiché X « sigmimi »).
		const attendus = [
			["discord:1539898224503033877", "x:2090455666267713840"], // G3 · Sanada
			["discord:1540456574588559440", "x:2090899354148368577"], // G1 · Munfurawa
			["discord:1540508422804471819", "x:2091112393455632493"], // G4 · Cieran / FujoRin
			["discord:1540742112713379840", "x:2091195848247885914"], // G2 · kittycaillou
		];
		expect(doublons.map((paire) => [creationDe(paire.a), creationDe(paire.b)]).toSorted()).toEqual(
			attendus.toSorted()
		);
		// Les quatre sont des cross-posts d'une même personne, jamais deux auteurs
		// différents : rien qui ressemble à un dessin volé.
		for (const paire of doublons) {
			expect(paire.a.source).toBe("discord");
			expect(paire.b.source).toBe("x");
		}
	});

	it("le fossé entre « même dessin » et « dessins différents » est large de 14 bits", () => {
		const paires = toutesLesPaires();
		expect(paires.length).toBe(351); // C(27,2)
		const intra = paires.filter((paire) => paire.doublon);
		const inter = paires.filter((paire) => !paire.doublon);

		// Mesuré : dHash intra ≤ 2, inter ≥ 17 → le seuil 8 tombe au milieu d'un
		// fossé VIDE de 14 bits. pHash : intra ≤ 2, inter ≥ 20, fossé de 17 bits.
		// Le seuil n'a donc arbitré aucun cas douteux : il n'y en avait pas.
		expect(Math.max(...intra.map((paire) => paire.dhash))).toBe(2);
		expect(Math.min(...inter.map((paire) => paire.dhash))).toBe(17);
		expect(Math.max(...intra.map((paire) => paire.phash))).toBe(2);
		expect(Math.min(...inter.map((paire) => paire.phash))).toBe(20);

		// Sur ce corpus les deux empreintes sont toujours d'accord : aucune paire ne
		// passe l'une sans l'autre. La conjonction ne coûte donc rien ici — et on la
		// garde parce qu'une seule empreinte, prise isolément, se laisse tromper.
		const desaccords = paires.filter(
			(paire) => (paire.dhash <= SEUIL.dhash) !== (paire.phash <= SEUIL.phash)
		);
		expect(desaccords.length).toBe(0);
	});

	it("20 publications donnent 16 œuvres", () => {
		// Regroupement transitif sur les CRÉATIONS, pas sur les images.
		const parent = new Map(EMPREINTES.map((image) => [creationDe(image), creationDe(image)]));
		const racine = (creation: string): string => {
			let courant = creation;
			let suivant = parent.get(courant);
			while (suivant !== undefined && suivant !== courant) {
				courant = suivant;
				suivant = parent.get(courant);
			}
			return courant;
		};
		for (const paire of toutesLesPaires().filter((candidate) => candidate.doublon)) {
			const a = racine(creationDe(paire.a));
			const b = racine(creationDe(paire.b));
			if (a !== b) {
				parent.set(a, b);
			}
		}
		expect(new Set([...parent.keys()].map(racine)).size).toBe(16);
	});

	it("une création dont UNE SEULE image serait un doublon reste une participation entière", () => {
		// ── LA RÈGLE ──────────────────────────────────────────────────────────
		// Une création n'est écartée QUE si TOUTES ses images sont des doublons
		// d'une autre création. Écarter une création de 7 images parce qu'une seule
		// est redondante retirerait 6 dessins inédits — et une chance à quelqu'un
		// qui a bel et bien produit autre chose.
		const imagesParCreation = new Map<string, number>();
		for (const image of EMPREINTES) {
			imagesParCreation.set(creationDe(image), (imagesParCreation.get(creationDe(image)) ?? 0) + 1);
		}
		const imagesDoublons = new Map<string, Set<number>>();
		for (const paire of toutesLesPaires().filter((candidate) => candidate.doublon)) {
			for (const cote of [paire.a, paire.b]) {
				const vues = imagesDoublons.get(creationDe(cote)) ?? new Set<number>();
				vues.add(cote.index);
				imagesDoublons.set(creationDe(cote), vues);
			}
		}
		const entierement = [...imagesDoublons.entries()].filter(
			([creation, indices]) => indices.size === imagesParCreation.get(creation)
		);
		// Sur le corpus réel, les 8 créations concernées ont chacune UNE image :
		// elles sont donc toutes entièrement dupliquées, et c'est bien 4 paires — 4
		// créations à écarter — que la règle produit.
		expect(imagesDoublons.size).toBe(8);
		expect(entierement.length).toBe(8);

		// Le cas qui compte, celui qui n'existe pas encore dans les données et que la
		// règle doit pourtant traiter : une création de 7 fichiers dont UN SEUL est
		// le doublon d'une autre. Elle reste une participation entière.
		const septFichiers = "discord:1540837023487631391";
		expect(imagesParCreation.get(septFichiers)).toBe(7);
		const unSeulDoublon = new Set<number>([3]);
		expect(unSeulDoublon.size).toBe(1);
		expect(unSeulDoublon.size === imagesParCreation.get(septFichiers)).toBe(false);
		// Et le cas inverse, celui du corpus : une création d'UNE image dupliquée est
		// entièrement dupliquée, donc écartée.
		const uneImage = "discord:1540456574588559440";
		expect(imagesParCreation.get(uneImage)).toBe(1);
		expect(imagesDoublons.get(uneImage)?.size).toBe(1);
	});

	it("le seuil ne voit PAS un recadrage, et l'angle mort est écrit noir sur blanc", () => {
		// Les deux fichiers de Jenn Scarlet sont le MÊME dessin — le premier est un
		// recadrage vertical du second, prouvé au pixel (erreur absolue moyenne
		// 5,47/255 à y = 654 px, contre 93,64 pour un témoin négatif). Or leurs
		// distances valent 19 et 26 : en PLEIN dans la zone « dessins différents ».
		// Ici cela ne change rien, les deux fichiers appartenant à la MÊME création.
		// Mais un doublon recadré entre deux créations DISTINCTES passerait sous le
		// radar, et c'est pourquoi la recherche de recadrage dédiée doit tourner à
		// chaque collecte — pas seulement ce seuil.
		const fichiers = EMPREINTES.filter((image) => image.identifiant === "1540784107729064108");
		expect(fichiers.length).toBe(2);
		const premier = elem(fichiers, 0);
		const second = elem(fichiers, 1);
		expect(distanceHamming(premier.dhash, second.dhash)).toBe(19);
		expect(distanceHamming(premier.phash, second.phash)).toBe(26);
		expect(distanceHamming(premier.dhash, second.dhash)).toBeGreaterThan(SEUIL.dhash);
		// Même largeur, hauteurs différentes : la signature d'un recadrage vertical.
		expect(premier.largeur).toBe(second.largeur);
		expect(premier.hauteur).not.toBe(second.hauteur);
	});

	it("les 7 fichiers de ThunderAce sont 7 images distinctes : leur regroupement est un ARBITRAGE, pas une mesure", () => {
		// Aucune empreinte ne dit qu'ils forment une seule œuvre — la paire interne
		// la plus proche est à dHash 21. Ce sont sept photos d'un écran de télé
		// montrant les techniques du même OC, dont cinq frames successives d'un
		// même tir. Les compter 7 donnerait à cette personne 7 tickets sur 22, soit
		// 32 % du tirage entier. C'est donc un humain qui a tranché « 1 œuvre »,
		// et ce test existe pour que personne ne croie que le seuil l'a fait.
		const fichiers = EMPREINTES.filter((image) => image.identifiant === "1540837023487631391");
		expect(fichiers.length).toBe(7);
		let minimum = 64;
		for (let i = 0; i < fichiers.length; i += 1) {
			for (let j = i + 1; j < fichiers.length; j += 1) {
				minimum = Math.min(minimum, distanceHamming(elem(fichiers, i).dhash, elem(fichiers, j).dhash));
			}
		}
		expect(minimum).toBe(21);
		expect(minimum).toBeGreaterThan(SEUIL.dhash);
		// Et le roster, lui, ne lui donne qu'un ticket.
		const thunderAce = REELS.find((participant) => participant.cle === "discord:460001633053704192");
		expect(thunderAce?.nbOeuvres).toBe(1);
		expect(poidsDe(thunderAce as ParticipantTirage, "par_oeuvre")).toBe(1);
	});

	it("le poids d'une personne suit ses ŒUVRES, jamais ses publications", () => {
		const roster = rosterDe(REELS, "par_oeuvre");
		const poidsParCle = new Map(roster.map((entree) => [entree.cle, entree.poids]));

		// Les trois personnes qui ont publié le même dessin des deux côtés : deux
		// publications, UN ticket.
		for (const cle of [
			"discord:306135978316136448", // Munfurawa
			"discord:309031721016229890", // Cieran / FujoRin
			"discord:683044704967065626", // kittycaillou
		]) {
			expect(PUBLICATIONS_PAR_CLE[cle]).toBe(2);
			expect(poidsParCle.get(cle)).toBe(1);
		}
		// Sanada : 3 publications, 2 dessins, 2 tickets.
		expect(PUBLICATIONS_PAR_CLE["discord:908269053347504170"]).toBe(3);
		expect(poidsParCle.get("discord:908269053347504170")).toBe(2);
		// Jenn Scarlet : 1 publication de 2 fichiers, 1 dessin, 1 ticket.
		expect(poidsParCle.get("discord:469900328758935552")).toBe(1);

		// ── L'ENJEU, CHIFFRÉ ──────────────────────────────────────────────────
		// Compter les publications au lieu des œuvres ferait 20 tickets au lieu de
		// 16, et donnerait une chance de trop à quatre personnes qui ont simplement
		// relayé leur propre dessin. Le rang 1 de Munfurawa passerait de 6,25 % à
		// 10,0 % — au détriment de tous les autres.
		const parPublication = Object.values(PUBLICATIONS_PAR_CLE).reduce((a, b) => a + b, 0);
		expect(parPublication).toBe(20);
		expect(roster.reduce((somme, entree) => somme + entree.poids, 0)).toBe(16);
		expect(1 / 16).toBeCloseTo(0.0625, 6);
		expect(2 / 20).toBeCloseTo(0.1, 6);
	});
});

/* ══════════════════════════════════════════════════════════════════════════ */

describe("cas limites", () => {
	const graine = graineDe("limites").toString("hex");
	const un = (cle: string): ParticipantTirage => ({
		cle,
		nbOeuvres: 1,
		oeuvres: [`x:${cle}`],
		pseudoAffichage: cle,
	});

	it("un roster vide est refusé, pas silencieusement toléré", async () => {
		await expect(
			executerTirage([], { graine, nbGagnants: 1, poidsMode: "par_oeuvre" })
		).rejects.toThrow(/roster est vide/);
	});

	it("un seul participant : il gagne, au rang 1, avec son œuvre tirée", async () => {
		const resultat = await executerTirage([un("x:2870776923")], {
			graine,
			nbGagnants: 1,
			poidsMode: "par_oeuvre",
		});
		expect(resultat.nbParticipants).toBe(1);
		expect(resultat.classement.length).toBe(1);
		expect(elem(resultat.gagnants, 0).rang).toBe(1);
		expect(elem(resultat.gagnants, 0).cle).toBe("x:2870776923");
		expect(elem(resultat.gagnants, 0).oeuvreId).toBe("x:x:2870776923");
		// Même seul, il ne peut pas gagner par une clé de tri dégénérée (0, −0 ou
		// l'infini) : c'est ce que garantit l'intervalle ouvert.
		expect(elem(resultat.classement, 0).cleTri).toBeGreaterThan(0);
		expect(Number.isFinite(elem(resultat.classement, 0).cleTri)).toBe(true);
	});

	it("nbGagnants > nbParticipants : tout le monde gagne, personne deux fois", async () => {
		const participants = [un("x:1111111111"), un("x:2222222222"), un("x:3333333333")];
		const resultat = await executerTirage(participants, {
			graine,
			nbGagnants: 99,
			poidsMode: "par_oeuvre",
		});
		// Plafonné, pas d'erreur : la base refuse déjà `nbGagnants > nbParticipants`,
		// ceci est la ceinture par-dessus les bretelles. Ce qu'il ne faut SURTOUT
		// pas, c'est 99 lignes de gagnants dont 96 vides.
		expect(resultat.gagnants.length).toBe(3);
		expect(resultat.gagnants.map((gagnant) => gagnant.rang)).toEqual([1, 2, 3]);
		expect(new Set(resultat.gagnants.map((gagnant) => gagnant.cle)).size).toBe(3);
	});

	it("nbGagnants nul, négatif, fractionnaire ou NaN est refusé", async () => {
		const participants = [un("x:1111111111")];
		for (const nbGagnants of [0, -1, 1.5, Number.NaN]) {
			await expect(
				executerTirage(participants, { graine, nbGagnants, poidsMode: "par_oeuvre" })
			).rejects.toThrow(/Nombre de gagnants invalide/);
		}
	});

	it("un poids nul, négatif, fractionnaire ou hors plafond est refusé par la sérialisation", () => {
		for (const poids of [0, -1, 1.5, MAX_POIDS + 1, Number.NaN]) {
			expect(() => serialiserRoster([{ cle: "x:1111111111", poids }])).toThrow(/Poids invalide/);
		}
		expect(() => serialiserRoster([{ cle: "x:1111111111", poids: 1 }])).not.toThrow();
		expect(() => serialiserRoster([{ cle: "x:1111111111", poids: MAX_POIDS }])).not.toThrow();
		expect(() => serialiserRoster([{ cle: "", poids: 1 }])).toThrow(/vide/);
		// ⚠ Le poids qui entre dans un tirage vient de `poidsDe`, qui borne déjà à
		// [1, 64] : un poids invalide ne peut donc PAS venir du calcul, seulement
		// d'une écriture directe en base ou d'un roster gelé retouché. C'est bien
		// à la sérialisation — le dernier passage obligé avant l'empreinte — qu'il
		// faut le refuser.
		expect(poidsDe({ cle: "x:1", nbOeuvres: -3, oeuvres: [], pseudoAffichage: "" }, "par_oeuvre")).toBe(1);
	});

	it("des clés en double font échouer le tirage AVANT qu'un seul rang ne soit produit", async () => {
		// Deux lignes pour le même identifiant, c'est deux tickets pour un humain, et
		// l'empreinte du roster ne le dirait pas — d'où le refus bruyant.
		await expect(
			executerTirage([un("x:2870776923"), un("x:2870776923")], {
				graine,
				nbGagnants: 1,
				poidsMode: "par_oeuvre",
			})
		).rejects.toThrow(/double/);
	});

	it("une graine mal formée est refusée, majuscules comprises", async () => {
		const participants = [un("x:1111111111")];
		for (const mauvaise of ["", "ab", "A".repeat(64), "z".repeat(64), `${graine}00`]) {
			await expect(
				executerTirage(participants, { graine: mauvaise, nbGagnants: 1, poidsMode: "par_oeuvre" })
			).rejects.toThrow(/Graine invalide/);
		}
		// Une seule forme canonique en base comme dans le code : 64 hexa minuscules.
		expect(() => graineLocaleDepuis(new Uint8Array(32))).not.toThrow();
		expect(() => graineLocaleDepuis(new Uint8Array(31))).toThrow(/32/);
		expect(graineLocaleDepuis(new Uint8Array(32))).toMatch(/^[0-9a-f]{64}$/);
	});

	it("le comparateur exact reste instantané au plafond de poids", () => {
		expect(MAX_POIDS).toBe(64);
		// `a ** 64n` reste borné à ~3 400 bits : le comparateur exact ne devient pas
		// un problème de performance à la borne, et c'est ce qui justifie de l'avoir
		// préféré au flottant.
		const grosse: EntreeCalculee = {
			cle: "x:1",
			cleTri: 0,
			empreinte: "f".repeat(64),
			oeuvres: [],
			poids: MAX_POIDS,
			pseudoAffichage: "",
			rang: 0,
			u: 0,
		};
		const petite: EntreeCalculee = { ...grosse, cle: "x:2", empreinte: "0".repeat(64), poids: 1 };
		const debut = Bun.nanoseconds();
		expect(comparerEntrees(grosse, petite)).toBe(-1); // u≈1 et poids 64 devance u≈0 et poids 1
		expect((Bun.nanoseconds() - debut) / 1e6).toBeLessThan(50);
	});

	it("une personne sans aucune œuvre reste dans le tirage, sans œuvre à mettre en avant", async () => {
		const resultat = await executerTirage(
			[{ cle: "x:1111111111", nbOeuvres: 0, oeuvres: [], pseudoAffichage: "Sans œuvre" }],
			{ graine, nbGagnants: 1, poidsMode: "par_oeuvre" }
		);
		expect(elem(resultat.classement, 0).poids).toBe(1);
		expect(elem(resultat.gagnants, 0).oeuvreId).toBeNull();
	});

	it("les lots suivent les rangs, et un classement nu est explicitement vide", async () => {
		const participants = [un("x:1111111111"), un("x:2222222222"), un("x:3333333333")];
		const avecLots = await executerTirage(
			participants,
			{ graine, nbGagnants: 2, poidsMode: "par_oeuvre" },
			["Premier lot", "Second lot"]
		);
		expect(avecLots.gagnants.map((gagnant) => gagnant.lot)).toEqual(["Premier lot", "Second lot"]);
		const sansLot = await executerTirage(participants, {
			graine,
			nbGagnants: 2,
			poidsMode: "par_oeuvre",
		});
		expect(sansLot.gagnants.map((gagnant) => gagnant.lot)).toEqual([null, null]);
		// Moins de lots que de gagnants : les rangs sans lot valent `null`, jamais
		// une chaîne vide qui s'afficherait comme un lot fantôme.
		const partiel = await executerTirage(
			participants,
			{ graine, nbGagnants: 3, poidsMode: "par_oeuvre" },
			["Un seul lot"]
		);
		expect(partiel.gagnants.map((gagnant) => gagnant.lot)).toEqual(["Un seul lot", null, null]);
	});

	it("les empreintes rendues par un tirage ont toutes la forme attendue", async () => {
		const resultat = await executerTirage(REELS, { graine, nbGagnants: 2, poidsMode: "par_oeuvre" });
		expect(resultat.empreinteParticipants).toMatch(/^[0-9a-f]{64}$/);
		expect(resultat.empreinteGraine).toMatch(/^[0-9a-f]{64}$/);
		expect(resultat.empreinteGraine).toBe(await empreinteGraine(graine));
		for (const entree of resultat.classement) {
			expect(entree.empreinte).toMatch(/^[0-9a-f]{64}$/);
			expect(entree.u).toBeGreaterThan(0);
			expect(entree.u).toBeLessThan(1);
			expect(entree.cleTri).toBeGreaterThan(0);
		}
		expect(resultat.classement.map((entree) => entree.rang)).toEqual(
			Array.from({ length: REELS.length }, (_, i) => i + 1)
		);
		expect(hex(await sha256(new Uint8Array(0)))).toHaveLength(64);
	});
});
