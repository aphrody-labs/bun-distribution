/**
 * Ce que ces tests protègent : la prudence.
 *
 * L'import Noctaly parcourt ~1 834 membres en réseau. Rien de tout ça n'est
 * rejouable à volonté — un 429 coûte une heure de blocage et peut faire
 * blacklister l'application. Les tests portent donc sur les décisions qui
 * évitent ce 429, pas sur le fetch lui-même : lecture des en-têtes de quota,
 * calcul de l'attente, classement des statuts.
 */
import { describe, expect, test } from "bun:test";

import {
	attenteAvantSuivante,
	bilanVide,
	CADENCE_DEFAUT,
	classerReponse,
	CODE_MODULE_DESACTIVE,
	codeErreur,
	convertirMonnaie,
	distribution,
	extraireFluxRsc,
	extraireTableau,
	FENETRE_OBSERVEE,
	fusionnerClassements,
	lireClassement,
	lireProfil,
	lireProfilEconomie,
	lireQuota,
	MARGE_ATTENTE_MS,
	MARGE_QUOTA,
	meriteEcriture,
	meriteEcritureEconomie,
	PLAFOND_DOCUMENTE,
	resumerBilan,
	TRIS_CLASSEMENT,
	urlClassementPublic,
	urlCoffresGuilde,
	urlObjetsGuilde,
	urlProfilEconomie,
	urlProfilNiveau,
	type ProfilClasse,
	type Quota,
} from "./noctaly";

/** Fabrique une source d'en-têtes à partir d'un objet simple. */
function entetes(valeurs: Record<string, string>) {
	return {
		get: (nom: string) => valeurs[nom] ?? null,
	};
}

describe("urlProfilNiveau", () => {
	test("reprend le chemin documenté, sans slash surnuméraire", () => {
		expect(urlProfilNiveau("1400000000000000000", "1400000000000000001")).toBe(
			"https://noctaly.com/api/v1/guilds/1400000000000000000/users/1400000000000000001/level-profile"
		);
	});
});

describe("classerReponse", () => {
	test("200 est un profil", () => {
		expect(classerReponse(200)).toBe("ok");
	});

	// Le cas le plus fréquent de tout l'import : Noctaly n'a été activé que le
	// 11/3/2026, la grande majorité des membres n'a jamais rien gagné chez lui.
	// Le confondre avec une panne ferait un rapport final de 1 700 « erreurs ».
	test("404 est un membre sans profil, pas une panne", () => {
		expect(classerReponse(404)).toBe("absent");
	});

	test("401 et 403 disent que la clé est en cause", () => {
		expect(classerReponse(401)).toBe("refuse");
		expect(classerReponse(403)).toBe("refuse");
	});

	test("429 est traité à part — c'est lui qui coûte une heure", () => {
		expect(classerReponse(429)).toBe("quota");
	});

	test("le reste est une panne", () => {
		expect(classerReponse(500)).toBe("panne");
		expect(classerReponse(502)).toBe("panne");
	});
});

describe("lireProfil", () => {
	// L'exemple exact de la documentation (leveling/profile).
	const exempleDoc = {
		level: 15,
		xp: 974,
		neededXp: 726,
		totalXp: 11074,
		messages: 1983,
		voiceMinutes: 179,
		reactions: 32,
	};

	test("lit l'exemple de la documentation champ pour champ", () => {
		expect(lireProfil(exempleDoc)).toEqual({
			messages: 1983,
			minutesVocal: 179,
			niveau: 15,
			reactions: 32,
			xp: 974,
			xpRestante: 726,
			xpTotale: 11074,
		});
	});

	test("un champ annexe manquant retombe à zéro sans faire échouer la lecture", () => {
		const profil = lireProfil({ totalXp: 500, level: 6 });
		expect(profil).not.toBeNull();
		expect(profil?.xpTotale).toBe(500);
		expect(profil?.minutesVocal).toBe(0);
		expect(profil?.reactions).toBe(0);
	});

	// `totalXp` est la SEULE valeur qu'on écrit : elle, on ne la devine pas.
	test("sans totalXp exploitable, la réponse est illisible", () => {
		expect(lireProfil({ level: 15 })).toBeNull();
		expect(lireProfil({ totalXp: "11074" })).toBeNull();
		expect(lireProfil({ totalXp: -1 })).toBeNull();
		expect(lireProfil({ totalXp: Number.NaN })).toBeNull();
	});

	test("ni un corps vide ni une erreur JSON ne lèvent", () => {
		expect(lireProfil(null)).toBeNull();
		expect(lireProfil("erreur")).toBeNull();
		expect(lireProfil({ code: "unauthenticated" })).toBeNull();
	});

	test("un totalXp décimal est tronqué, jamais arrondi vers le haut", () => {
		expect(lireProfil({ totalXp: 11074.9 })?.xpTotale).toBe(11074);
	});
});

describe("lireQuota", () => {
	test("lit les quatre en-têtes documentés", () => {
		const quota = lireQuota(
			entetes({
				"X-RateLimit-Limit": "120",
				"X-RateLimit-Remaining": "0",
				"X-RateLimit-Reset": "1747102972",
				"X-RateLimit-Reset-After": "50",
			})
		);
		expect(quota).toEqual({ dansSecondes: 50, limite: 120, restant: 0 });
	});

	test("des en-têtes absents rendent null, pas zéro", () => {
		// La nuance compte : `restant: 0` déclenche une attente longue,
		// `restant: null` veut dire « on ne sait pas » et laisse la cadence faire.
		expect(lireQuota(entetes({}))).toEqual({ dansSecondes: null, limite: null, restant: null });
	});

	test("une valeur non numérique est ignorée plutôt que propagée en NaN", () => {
		expect(lireQuota(entetes({ "X-RateLimit-Remaining": "inconnu" })).restant).toBeNull();
	});
});

describe("attenteAvantSuivante", () => {
	const sansInfo: Quota = { dansSecondes: null, limite: null, restant: null };

	test("en régime normal, l'attente est l'intervalle de la cadence", () => {
		expect(attenteAvantSuivante(sansInfo, 10)).toBe(100);
		expect(attenteAvantSuivante(sansInfo, 4)).toBe(250);
	});

	/**
	 * La cadence suit la fenêtre MESURÉE, pas la documentation.
	 *
	 * Relevé le 14/8/2026 avec une vraie clé : `X-RateLimit-Limit: 120` et
	 * `X-RateLimit-Reset-After: 60`, soit 2 req/s soutenues — vingt-cinq fois
	 * moins que les 50/s annoncés par la documentation. Régler la cadence sur la
	 * documentation vidait le quota en douze secondes puis passait le reste de
	 * l'import à attendre, en frôlant le 429 à chaque redémarrage de fenêtre.
	 */
	test("la cadence par défaut est le régime permanent de la fenêtre mesurée", () => {
		expect(CADENCE_DEFAUT).toBe(FENETRE_OBSERVEE.requetes / FENETRE_OBSERVEE.secondes);
		expect(CADENCE_DEFAUT).toBe(2);
		expect(attenteAvantSuivante(sansInfo)).toBe(500);
	});

	test("la documentation reste connue, mais comme borne haute seulement", () => {
		expect(PLAFOND_DOCUMENTE).toBeGreaterThan(CADENCE_DEFAUT);
		// Une cadence demandée au-delà du plafond documenté est ramenée à celui-ci.
		expect(attenteAvantSuivante(sansInfo, 1_000)).toBe(
			Math.ceil(1_000 / PLAFOND_DOCUMENTE)
		);
	});

	// Le cœur de la prudence : on n'attend pas d'être à 0, on attend d'être
	// à MARGE_QUOTA — une requête peut être en vol, son en-tête pas encore lu.
	test("au plancher du quota, on attend la remise à zéro annoncée", () => {
		const attente = attenteAvantSuivante({ dansSecondes: 50, limite: 120, restant: MARGE_QUOTA }, 10);
		expect(attente).toBe(50_000 + MARGE_ATTENTE_MS);
	});

	test("juste au-dessus de la marge, la cadence suffit encore", () => {
		const attente = attenteAvantSuivante(
			{ dansSecondes: 50, limite: 120, restant: MARGE_QUOTA + 1 },
			10
		);
		expect(attente).toBe(100);
	});

	// Si l'API dit d'attendre, elle a raison même quand la cadence dirait moins.
	test("l'attente annoncée l'emporte sur la cadence, jamais l'inverse", () => {
		expect(attenteAvantSuivante({ dansSecondes: 40, limite: 120, restant: 0 }, 50)).toBe(
			40_000 + MARGE_ATTENTE_MS
		);
	});

	test("un quota au plancher sans délai annoncé retombe sur la cadence", () => {
		// Rien à attendre de précis : on ne peut pas inventer une durée.
		expect(attenteAvantSuivante({ dansSecondes: null, limite: 120, restant: 0 }, 10)).toBe(100);
	});

	test("une cadence aberrante est ramenée entre 1 et le plafond documenté", () => {
		expect(attenteAvantSuivante(sansInfo, 0)).toBe(1_000);
		expect(attenteAvantSuivante(sansInfo, -5)).toBe(1_000);
		expect(attenteAvantSuivante(sansInfo, 5_000)).toBe(20); // 1000/50
	});
});

describe("meriteEcriture", () => {
	const profil = (xpTotale: number) => ({
		messages: 0,
		minutesVocal: 0,
		niveau: 1,
		reactions: 0,
		xp: 0,
		xpRestante: 0,
		xpTotale,
	});

	test("une XP nulle ne crée pas de ligne", () => {
		expect(meriteEcriture(profil(0))).toBe(false);
	});

	test("la moindre XP mérite une ligne", () => {
		expect(meriteEcriture(profil(1))).toBe(true);
		expect(meriteEcriture(profil(11_074))).toBe(true);
	});
});

describe("urlProfilEconomie", () => {
	// Les trois relations sont optionnelles côté API et perdues si on ne les
	// demande pas — or l'import ne se rejoue pas une fois Noctaly retiré.
	test("demande les trois relations optionnelles", () => {
		const url = urlProfilEconomie("1400000000000000000", "1400000000000000001");
		expect(url).toContain("/eco-profile?");
		expect(url).toContain("items=true");
		expect(url).toContain("chests=true");
		expect(url).toContain("dailyStreak=true");
	});

	test("les catalogues de guilde sont des routes de guilde, pas de membre", () => {
		expect(urlObjetsGuilde("1400000000000000000")).toBe(
			"https://noctaly.com/api/v1/guilds/1400000000000000000/items"
		);
		expect(urlCoffresGuilde("1400000000000000000")).toBe(
			"https://noctaly.com/api/v1/guilds/1400000000000000000/chests"
		);
	});
});

describe("lireProfilEconomie", () => {
	test("lit l'exemple de la documentation", () => {
		const profil = lireProfilEconomie({
			money: 12500,
			items: [{ id: "a" }, { id: "b" }],
			chests: [{ id: "c" }],
			dailyStreak: { streak: 7 },
		});
		expect(profil).toEqual({ coffres: 1, monnaie: 12500, objets: 2, serieQuotidienne: 7 });
	});

	// `money` est le seul champ garanti : les autres n'arrivent que si la query
	// les demande, et l'API peut les omettre.
	test("seul money est requis", () => {
		expect(lireProfilEconomie({ money: 300 })).toEqual({
			coffres: 0,
			monnaie: 300,
			objets: 0,
			serieQuotidienne: null,
		});
		expect(lireProfilEconomie({ items: [] })).toBeNull();
	});

	// La documentation dit explicitement « null if they have never claimed » —
	// à distinguer d'une série à 0, qui n'existe pas.
	test("une série jamais réclamée reste null, pas zéro", () => {
		expect(lireProfilEconomie({ money: 0, dailyStreak: null })?.serieQuotidienne).toBeNull();
	});

	test("un solde négatif est ramené à zéro plutôt que propagé", () => {
		// bot_profils.jetons porte un CHECK (jetons >= 0) : un solde négatif
		// ferait échouer l'INSERT au milieu de la boucle.
		expect(lireProfilEconomie({ money: -50 })?.monnaie).toBe(0);
	});
});

describe("convertirMonnaie", () => {
	test("le taux par défaut de l'import (0) ne convertit rien", () => {
		expect(convertirMonnaie(12_500, 0)).toBe(0);
	});

	test("convertit et tronque vers le bas", () => {
		expect(convertirMonnaie(12_500, 1)).toBe(12_500);
		expect(convertirMonnaie(12_500, 0.1)).toBe(1_250);
		expect(convertirMonnaie(199, 0.1)).toBe(19);
	});

	test("aucune valeur aberrante ne produit un NaN en base", () => {
		expect(convertirMonnaie(Number.NaN, 1)).toBe(0);
		expect(convertirMonnaie(100, Number.NaN)).toBe(0);
		expect(convertirMonnaie(-100, 1)).toBe(0);
	});
});

describe("meriteEcritureEconomie", () => {
	const eco = (monnaie: number, serieQuotidienne: number | null) => ({
		coffres: 0,
		monnaie,
		objets: 0,
		serieQuotidienne,
	});

	test("de la monnaie suffit", () => {
		expect(meriteEcritureEconomie(eco(1, null))).toBe(true);
	});

	test("une série en cours suffit, même sans un sou", () => {
		expect(meriteEcritureEconomie(eco(0, 12))).toBe(true);
	});

	test("un profil vide ne crée pas de ligne", () => {
		expect(meriteEcritureEconomie(eco(0, null))).toBe(false);
		expect(meriteEcritureEconomie(eco(0, 0))).toBe(false);
	});
});

describe("distribution", () => {
	// La médiane est ce qui décide du taux : une seule grosse fortune tire la
	// moyenne et ferait choisir un taux absurde pour tous les autres.
	test("médiane sur un nombre impair de valeurs", () => {
		expect(distribution([10, 1_000_000, 20])).toEqual({
			compte: 3,
			maximum: 1_000_000,
			median: 20,
			total: 1_000_030,
		});
	});

	test("médiane sur un nombre pair de valeurs", () => {
		expect(distribution([10, 20, 30, 40]).median).toBe(25);
	});

	test("les zéros sont exclus — ils ne sont pas des soldes", () => {
		expect(distribution([0, 0, 100]).compte).toBe(1);
	});

	test("une liste vide ne divise pas par zéro", () => {
		expect(distribution([])).toEqual({ compte: 0, maximum: 0, median: 0, total: 0 });
	});

	test("l'entrée n'est pas modifiée", () => {
		const valeurs = [30, 10, 20];
		distribution(valeurs);
		expect(valeurs).toEqual([30, 10, 20]);
	});
});

describe("resumerBilan", () => {
	test("les catégories vides n'apparaissent pas dans le résumé", () => {
		const bilan = { ...bilanVide(), absents: 1_700, ecrits: 120, interroges: 1_834, vides: 14 };
		const texte = resumerBilan(bilan);
		expect(texte).toBe(
			"1834 membre(s) interrogé(s) · 120 profil(s) importé(s) · 14 sans XP · 1700 inconnu(s) de Noctaly"
		);
		expect(texte).not.toContain("illisible");
		expect(texte).not.toContain("réseau");
	});

	test("économies et archives apparaissent dès qu'il y en a", () => {
		const texte = resumerBilan({ ...bilanVide(), archives: 200, economies: 42 });
		expect(texte).toContain("42 économie(s)");
		expect(texte).toContain("200 archive(s) brute(s)");
	});

	test("une panne, elle, est toujours dite", () => {
		const texte = resumerBilan({ ...bilanVide(), illisibles: 2, pannes: 3 });
		expect(texte).toContain("2 réponse(s) illisible(s)");
		expect(texte).toContain("3 erreur(s) réseau");
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// LE MODULE ÉTEINT
// ─────────────────────────────────────────────────────────────────────────────

describe("classerReponse — module désactivé", () => {
	/**
	 * Ce cas fait gagner la moitié d'un import.
	 *
	 * L'économie est un module optionnel, éteint sur la guilde Rose Griffon
	 * (relevé le 14/8/2026 : `GET /items` → `400 {"code":"module_disabled"}`).
	 * Le distinguer d'une panne permet d'abandonner la passe entière au lieu de
	 * poser mille huit cents fois une question dont la réponse est connue.
	 */
	test("un 400 « module_disabled » n'est pas une panne", () => {
		expect(classerReponse(400, { code: CODE_MODULE_DESACTIVE })).toBe("module-desactive");
	});

	test("un 400 sans ce code reste une panne", () => {
		expect(classerReponse(400, { code: "bad_request" })).toBe("panne");
		expect(classerReponse(400, null)).toBe("panne");
		expect(classerReponse(400)).toBe("panne");
	});

	test("le corps ne change rien aux autres statuts", () => {
		expect(classerReponse(200, { code: CODE_MODULE_DESACTIVE })).toBe("ok");
		expect(classerReponse(404, { code: CODE_MODULE_DESACTIVE })).toBe("absent");
		expect(classerReponse(429, { code: CODE_MODULE_DESACTIVE })).toBe("quota");
	});

	test("codeErreur ne lève sur aucune forme de corps", () => {
		expect(codeErreur({ code: "x" })).toBe("x");
		expect(codeErreur({ code: 42 })).toBeNull();
		expect(codeErreur(null)).toBeNull();
		expect(codeErreur("texte")).toBeNull();
		expect(codeErreur(undefined)).toBeNull();
	});
});

// ─────────────────────────────────────────────────────────────────────────────
// LE CLASSEMENT PUBLIC
// ─────────────────────────────────────────────────────────────────────────────

/** Fabrique une page Next porteuse d'un classement, comme le fait noctaly.com. */
function pageClassement(entrees: unknown[]): string {
	const charge = JSON.stringify({ initProfiles: entrees, autre: true });
	// Next dépose sa charge échappée dans un littéral de chaîne JavaScript.
	const echappe = JSON.stringify(`3:${charge}\n`).slice(1, -1);
	return `<!DOCTYPE html><body><script>self.__next_f.push([1,"${echappe}"])</script></body>`;
}

const ENTREE_TYPE = {
	userID: "435479810731409408",
	username: "Mioleen_",
	avatarID: "a_732ce41fa793f5e5f340b6b2abedf99b",
	level: 26,
	xp: 44_480,
	messages: 4_977,
	reactions: 231,
	voiceMinutes: 298,
};

describe("urlClassementPublic", () => {
	test("sans tri, l'URL est nue", () => {
		expect(urlClassementPublic("123")).toBe("https://noctaly.com/fr/leaderboard/123");
	});

	test("les quatre tris sont ceux que la page accepte", () => {
		expect(TRIS_CLASSEMENT).toEqual(["level", "messages", "voice", "reactions"]);
		expect(urlClassementPublic("123", "voice")).toBe(
			"https://noctaly.com/fr/leaderboard/123?sort=voice"
		);
	});
});

describe("extraireFluxRsc", () => {
	test("les fragments sont recollés dans l'ordre", () => {
		const html =
			'<script>self.__next_f.push([1,"deb"])</script>' +
			'<script>self.__next_f.push([1,"ut"])</script>';
		expect(extraireFluxRsc(html)).toBe("debut");
	});

	/**
	 * Un objet coupé entre deux fragments doit rester lisible : c'est le cas
	 * NORMAL sur une vraie page (100 profils font 40 Ko, largement de quoi être
	 * découpé). Chercher dans chaque fragment séparément en perdrait la moitié.
	 */
	test("un objet coupé en deux fragments se relit entier", () => {
		const html =
			'<script>self.__next_f.push([1,"{\\"initProfiles\\":[{\\"userID\\":\\"1"])</script>' +
			'<script>self.__next_f.push([1,"11111111111111111\\",\\"xp\\":5}]}"])</script>';
		expect(lireClassement(html)).toHaveLength(1);
	});

	test("les appels d'un autre type sont ignorés", () => {
		const html = '<script>self.__next_f.push([2,"parasite"])</script>';
		expect(extraireFluxRsc(html)).toBe("");
	});

	test("un fragment illisible n'emporte pas les autres", () => {
		const html =
			'<script>self.__next_f.push([1,"\\u"])</script>' +
			'<script>self.__next_f.push([1,"sain"])</script>';
		expect(extraireFluxRsc(html)).toContain("sain");
	});
});

describe("extraireTableau", () => {
	test("rend le tableau demandé, pas un bout de page", () => {
		expect(extraireTableau('{"a":[1,2],"b":[3]}', "a")).toBe("[1,2]");
	});

	/**
	 * Les pseudonymes sont arbitraires. Un membre nommé « [RG] Yoyo » ferait
	 * fermer le tableau trop tôt à qui compte les crochets sans savoir qu'il est
	 * dans une chaîne — et le classement se lirait tronqué, sans erreur.
	 */
	test("un crochet DANS un pseudo ne ferme pas le tableau", () => {
		const source = '{"initProfiles":[{"username":"[RG] Yoyo"},{"username":"b]"}],"apres":1}';
		expect(extraireTableau(source, "initProfiles")).toBe(
			'[{"username":"[RG] Yoyo"},{"username":"b]"}]'
		);
	});

	test("un guillemet échappé dans un pseudo ne casse rien", () => {
		const source = String.raw`{"p":[{"username":"a\"b]"}]}`;
		expect(JSON.parse(extraireTableau(source, "p")!)).toEqual([{ username: 'a"b]' }]);
	});

	test("une clef absente ou un tableau non fermé rendent null", () => {
		expect(extraireTableau('{"a":[1]}', "b")).toBeNull();
		expect(extraireTableau('{"a":[1,2', "a")).toBeNull();
	});
});

describe("lireClassement", () => {
	test("lit les champs que l'API rend aussi", () => {
		const [profil] = lireClassement(pageClassement([ENTREE_TYPE]));
		expect(profil?.discordId).toBe("435479810731409408");
		expect(profil?.pseudo).toBe("Mioleen_");
		expect(profil?.profil.xpTotale).toBe(44_480);
		expect(profil?.profil.messages).toBe(4_977);
		expect(profil?.profil.minutesVocal).toBe(298);
		expect(profil?.profil.reactions).toBe(231);
		expect(profil?.profil.niveau).toBe(26);
	});

	/**
	 * `xp` du classement EST l'XP totale, pas l'XP intra-niveau.
	 *
	 * Vérifié en croisant les deux sources sur le même membre le 14/8/2026 :
	 * le classement annonce `xp: 44480`, l'API répond `totalXp: 44480` et
	 * `xp: 3855`. Confondre les deux diviserait l'XP importée par dix.
	 */
	test("l'XP lue est bien la totale, et l'intra-niveau reste à zéro", () => {
		const [profil] = lireClassement(pageClassement([ENTREE_TYPE]));
		expect(profil?.profil.xpTotale).toBe(44_480);
		expect(profil?.profil.xp).toBe(0);
		expect(profil?.profil.xpRestante).toBe(0);
	});

	test("une entrée sans identifiant valide est ignorée, pas fatale", () => {
		const profils = lireClassement(
			pageClassement([{ ...ENTREE_TYPE, userID: "pas-un-flocon" }, ENTREE_TYPE])
		);
		expect(profils).toHaveLength(1);
	});

	test("une entrée sans XP numérique est ignorée", () => {
		expect(lireClassement(pageClassement([{ ...ENTREE_TYPE, xp: "beaucoup" }]))).toHaveLength(0);
		expect(lireClassement(pageClassement([{ ...ENTREE_TYPE, xp: -1 }]))).toHaveLength(0);
	});

	test("un pseudo manquant retombe sur l'identifiant, jamais sur du vide", () => {
		const [profil] = lireClassement(pageClassement([{ ...ENTREE_TYPE, username: null }]));
		expect(profil?.pseudo).toBe("435479810731409408");
	});

	/**
	 * Une page d'erreur, un défi Cloudflare ou une guilde sans module de niveaux
	 * rendent tous du HTML parfaitement valide. L'appelant doit pouvoir les
	 * distinguer d'une panne : c'est le nombre de profils qui le dit, pas une
	 * exception.
	 */
	test("une page sans classement rend zéro profil sans lever", () => {
		expect(lireClassement("<html>Just a moment...</html>")).toEqual([]);
		expect(lireClassement(pageClassement([]))).toEqual([]);
		expect(lireClassement("")).toEqual([]);
	});
});

describe("fusionnerClassements", () => {
	const base: ProfilClasse = {
		avatarId: null,
		brut: { source: "a" },
		discordId: "111111111111111111",
		profil: {
			messages: 10,
			minutesVocal: 0,
			niveau: 1,
			reactions: 0,
			xp: 0,
			xpRestante: 0,
			xpTotale: 100,
		},
		pseudo: "Un",
	};

	test("le même membre vu deux fois ne compte qu'une", () => {
		expect(fusionnerClassements([[base], [base]])).toHaveLength(1);
	});

	/**
	 * Les quatre tris sont quatre instantanés du même état. Ils devraient
	 * coïncider — mais si l'un est plus ancien, prendre le maximum garantit
	 * qu'aucun compteur ne régresse. Même règle que le `GREATEST` du SQL.
	 */
	test("chaque compteur garde son maximum", () => {
		const autre: ProfilClasse = {
			...base,
			brut: { source: "b" },
			profil: { ...base.profil, messages: 4, minutesVocal: 99, xpTotale: 80 },
		};
		const [fusion] = fusionnerClassements([[base], [autre]]);
		expect(fusion?.profil.messages).toBe(10);
		expect(fusion?.profil.minutesVocal).toBe(99);
		expect(fusion?.profil.xpTotale).toBe(100);
		// L'archive retenue est celle de l'instantané le plus riche en XP.
		expect(fusion?.brut).toEqual({ source: "a" });
	});

	test("le résultat est trié par XP décroissante", () => {
		const petit: ProfilClasse = {
			...base,
			discordId: "222222222222222222",
			profil: { ...base.profil, xpTotale: 5 },
		};
		expect(fusionnerClassements([[petit, base]]).map((p) => p.profil.xpTotale)).toEqual([100, 5]);
	});

	test("aucune source rend une liste vide", () => {
		expect(fusionnerClassements([])).toEqual([]);
		expect(fusionnerClassements([[], []])).toEqual([]);
	});
});
