/**
 * Tests de `commands/staff/format.ts`.
 *
 * Aucun réseau, aucune base, aucun client Discord : ce module est pur, et c'est
 * précisément pour qu'il soit vérifiable ici plutôt que « en cliquant dans un
 * salon » qu'il a été extrait des commandes.
 *
 * Les valeurs de référence sont RÉELLES : identifiants de version relevés dans
 * les fichiers `state.json` de `/home/ubuntu/rg-releases` le 13/8/2026, charges
 * de posts X et de `scrape.recon` relevées sur le pont IPC le même jour.
 */
import { describe, expect, test } from "bun:test";

import type { DescriptionService, SondeService } from "../../lib/services";
import {
	analyserRelease,
	blocJson,
	borner,
	decouperEnChamps,
	echapperMarkdown,
	formaterDuree,
	formaterEnTetes,
	formaterLatence,
	formaterNombre,
	formaterOctets,
	formaterPortee,
	horodatageAbsolu,
	horodatageRelatif,
	lignePostX,
	ligneResultatWeb,
	ligneSonde,
	listeCourte,
	normaliserPseudoX,
	pastilleEtat,
	trierPostsParDate,
} from "./format";
import { analyserLiveEnv } from "./deploiement";

const SERVICE_FICTIF: DescriptionService = {
	nom: "rg-api",
	titre: "API unifiée (Azalée inclus)",
	base: "http://127.0.0.1:8800",
	sante: "/health",
	publique: "https://api.rosegriffon.fr",
	unite: "rg-api.service",
	role: "API unifiée",
};

describe("pastilleEtat", () => {
	test("distingue vert et rouge", () => {
		expect(pastilleEtat(true)).toBe("🟢");
		expect(pastilleEtat(false)).toBe("🔴");
	});
});

describe("formaterLatence", () => {
	test("reste en millisecondes sous la seconde", () => {
		expect(formaterLatence(11)).toBe("11 ms");
		expect(formaterLatence(999)).toBe("999 ms");
	});

	test("passe aux secondes au-delà, virgule française", () => {
		expect(formaterLatence(1_000)).toBe("1,0 s");
		expect(formaterLatence(2_676)).toBe("2,7 s");
	});

	test("refuse les valeurs impossibles plutôt que d'afficher NaN", () => {
		expect(formaterLatence(Number.NaN)).toBe("—");
		expect(formaterLatence(-1)).toBe("—");
	});
});

describe("formaterDuree", () => {
	test("échelonne millisecondes, secondes, minutes", () => {
		expect(formaterDuree(430)).toBe("430 ms");
		expect(formaterDuree(2_500)).toBe("2,5 s");
		expect(formaterDuree(185_000)).toBe("3 min 5 s");
	});

	test("une durée absente n'est pas rendue comme une durée nulle", () => {
		expect(formaterDuree(null)).toBe("—");
		expect(formaterDuree(undefined)).toBe("—");
	});
});

describe("formaterNombre", () => {
	test("groupe les milliers à la française", () => {
		// Espace insécable étroite (U+202F) posée par Intl : on normalise pour
		// comparer, comme partout ailleurs dans le dépôt.
		expect(formaterNombre(264_461).replace(/\s+/g, " ")).toBe("264 461");
		expect(formaterNombre(0)).toBe("0");
	});

	test("une valeur absente devient un tiret", () => {
		expect(formaterNombre(null)).toBe("—");
		expect(formaterNombre(Number.NaN)).toBe("—");
	});
});

describe("formaterOctets", () => {
	test("choisit l'unité binaire", () => {
		expect(formaterOctets(512)).toBe("512 o");
		// 65 911 octets = le poids réel de la page inazuma.jp mesuré par scrape.recon.
		// Une décimale seulement sous 10, règle unifiée de `lib/ui/nombres.ts`.
		expect(formaterOctets(65_911)).toBe("64 Ko");
		expect(formaterOctets(2_000_000)).toBe("1,9 Mo");
	});

	test("zéro reste zéro, l'absence reste un tiret", () => {
		expect(formaterOctets(0)).toBe("0 o");
		expect(formaterOctets(null)).toBe("—");
	});
});

describe("horodatages Discord", () => {
	test("produit la balise relative avec l'instant en secondes", () => {
		expect(horodatageRelatif("2026-08-13T00:34:03.769Z")).toBe("<t:1786581243:R>");
	});

	test("produit la balise absolue", () => {
		expect(horodatageAbsolu(new Date("2026-08-13T00:34:03.769Z"))).toBe("<t:1786581243:f>");
	});

	test("une date illisible ne fabrique jamais « maintenant »", () => {
		expect(horodatageRelatif("pas une date")).toBe("—");
		expect(horodatageRelatif(null)).toBe("—");
		expect(horodatageAbsolu(undefined)).toBe("—");
	});
});

describe("analyserRelease", () => {
	test("décompose l'identifiant réel du slot azalee", () => {
		const version = analyserRelease("2026-08-13T00-34-03-769-Va8uc-iExl92JKgLHQVQ0");
		expect(version?.buildId).toBe("Va8uc-iExl92JKgLHQVQ0");
		expect(version?.assembleeLe?.toISOString()).toBe("2026-08-13T00:34:03.769Z");
	});

	test("garde le tiret initial du BUILD_ID du site (double tiret réel)", () => {
		// Relevé dans /home/ubuntu/rg-releases/website/state.json : le BUILD_ID de
		// Next commence par un tiret. Découper sur le dernier « - » le tronquerait.
		const version = analyserRelease("2026-08-13T04-30-50-225--vqFzJdyvSX8PnQUwsi1a");
		expect(version?.buildId).toBe("-vqFzJdyvSX8PnQUwsi1a");
		expect(version?.assembleeLe?.toISOString()).toBe("2026-08-13T04:30:50.225Z");
	});

	test("un identifiant hors format reste affichable, sans date inventée", () => {
		const version = analyserRelease("version-maison");
		expect(version).toEqual({
			identifiant: "version-maison",
			assembleeLe: null,
			buildId: "version-maison",
		});
	});

	test("l'absence de version ne renvoie pas d'objet vide", () => {
		expect(analyserRelease(null)).toBeNull();
		expect(analyserRelease("   ")).toBeNull();
	});
});

describe("ligneSonde", () => {
	test("un service qui répond affiche sa latence, son unité et son détail", () => {
		const sonde: SondeService = {
			service: SERVICE_FICTIF,
			ok: true,
			latenceMs: 11,
			detail: "cpkFiles : 250800",
			erreur: null,
		};
		expect(ligneSonde(sonde)).toBe(
			"🟢 `rg-api` — API unifiée (Azalée inclus) · 11 ms · `rg-api.service`\n   └ cpkFiles : 250800"
		);
	});

	test("un service en panne affiche la raison, pas une latence trompeuse", () => {
		const sonde: SondeService = {
			service: SERVICE_FICTIF,
			ok: false,
			latenceMs: 3_000,
			detail: null,
			erreur: "aucune réponse en 3000 ms",
		};
		const ligne = ligneSonde(sonde);
		expect(ligne).toContain("🔴");
		expect(ligne).toContain("aucune réponse en 3000 ms");
		expect(ligne).not.toContain("3,0 s");
	});
});

describe("decouperEnChamps", () => {
	test("un texte court tient dans un seul champ", () => {
		expect(decouperEnChamps("une ligne\ndeux lignes", 1_024)).toEqual(["une ligne\ndeux lignes"]);
	});

	test("coupe sur les sauts de ligne et respecte la limite dure", () => {
		const texte = Array.from({ length: 40 }, (_, i) => `ligne ${i} ${"x".repeat(40)}`).join("\n");
		const champs = decouperEnChamps(texte, 200, 10);
		expect(champs.length).toBeGreaterThan(1);
		for (const champ of champs) {
			expect(champ.length).toBeLessThanOrEqual(200);
		}
	});

	test("une ligne seule plus longue que la limite est tronquée, jamais rejetée", () => {
		const champs = decouperEnChamps("y".repeat(500), 100);
		expect(champs).toHaveLength(1);
		expect(champs[0]!.length).toBe(100);
		expect(champs[0]!.endsWith("…")).toBe(true);
	});

	test("le nombre de champs est plafonné", () => {
		const texte = Array.from({ length: 200 }, (_, i) => `ligne ${i}`).join("\n");
		expect(decouperEnChamps(texte, 40, 3)).toHaveLength(3);
	});
});

describe("blocJson", () => {
	test("enveloppe la charge dans un bloc json", () => {
		expect(blocJson({ ok: true })).toBe('```json\n{\n  "ok": true\n}\n```');
	});

	test("ne dépasse jamais la limite, clôture comprise", () => {
		const bloc = blocJson({ contenu: "z".repeat(5_000) }, 300);
		expect(bloc.length).toBeLessThanOrEqual(300);
		expect(bloc.endsWith("```")).toBe(true);
	});

	test("une valeur cyclique ne fait pas lever la commande", () => {
		const cyclique: Record<string, unknown> = {};
		cyclique.moi = cyclique;
		expect(() => blocJson(cyclique)).not.toThrow();
	});
});

describe("borner", () => {
	test("laisse passer ce qui tient", () => {
		expect(borner("court", 10)).toBe("court");
	});

	test("tronque avec une ellipse, sans dépasser", () => {
		const coupe = borner("abcdefghij", 5);
		expect(coupe).toBe("abcd…");
		expect(coupe.length).toBe(5);
	});

	test("une valeur absente devient une chaîne vide", () => {
		expect(borner(null, 10)).toBe("");
		expect(borner(undefined, 10)).toBe("");
	});
});

describe("echapperMarkdown", () => {
	test("neutralise un faux lien injecté par une page distante", () => {
		expect(echapperMarkdown("[clique](https://mechant.example)")).toBe(
			"\\[clique\\]\\(https://mechant.example\\)"
		);
	});

	test("neutralise gras, italique et code", () => {
		expect(echapperMarkdown("**gras** _italique_ `code`")).toBe(
			"\\*\\*gras\\*\\* \\_italique\\_ \\`code\\`"
		);
	});
});

describe("ligneResultatWeb", () => {
	test("rend un résultat DuckDuckGo réel en lien cliquable", () => {
		const ligne = ligneResultatWeb(
			{
				titre: "INAZUMA ELEVEN: Victory Road on Steam",
				url: "https://store.steampowered.com/app/2799860/INAZUMA_ELEVEN_Victory_Road/",
				extrait: "Relive past Inazuma Eleven matches with Victorio.",
			},
			2
		);
		expect(ligne).toContain("**2.**");
		expect(ligne).toContain(
			"(https://store.steampowered.com/app/2799860/INAZUMA_ELEVEN_Victory_Road/)"
		);
		expect(ligne).toContain("Relive past Inazuma Eleven matches");
	});

	test("sans titre, l'URL sert de libellé", () => {
		expect(ligneResultatWeb({ url: "https://exemple.fr" }, 1)).toBe(
			"**1.** [https://exemple.fr](https://exemple.fr)"
		);
	});
});

describe("lignePostX et formaterPortee", () => {
	const POST_REEL = {
		id: "2087460043658821924",
		url: "https://x.com/inazuma_project/status/2087460043658821924",
		auteur: "inazuma_project",
		auteurNom: "イナズマイレブン公式",
		date: "2026-08-12T08:43:52.000Z",
		texte: "【掲載情報】",
		likes: 1085,
		retweets: 183,
		reponses: 1,
		vues: 166_445,
		medias: 1,
	};

	test("compose auteur, lien, date relative et portée", () => {
		const ligne = lignePostX(POST_REEL);
		expect(ligne).toContain(
			"[@inazuma_project](https://x.com/inazuma_project/status/2087460043658821924)"
		);
		expect(ligne).toContain("<t:1786524232:R>");
		expect(ligne.replace(/\s+/g, " ")).toContain("❤ 1 085");
	});

	test("un post sans texte le dit au lieu d'afficher une ligne vide", () => {
		expect(lignePostX({ auteur: "essai", texte: "" })).toContain("*(sans texte)*");
	});

	test("les compteurs absents ne sont pas affichés à zéro", () => {
		expect(formaterPortee({ likes: 3 }).replace(/\s+/g, " ")).toBe("❤ 3");
		expect(formaterPortee({})).toBe("");
	});
});

describe("normaliserPseudoX", () => {
	test("accepte les écritures réelles d'un même compte", () => {
		expect(normaliserPseudoX("inazuma_project")).toBe("inazuma_project");
		expect(normaliserPseudoX("@inazuma_project")).toBe("inazuma_project");
		expect(normaliserPseudoX(" https://x.com/inazuma_project/status/2087 ")).toBe(
			"inazuma_project"
		);
	});

	test("refuse ce qui ne peut pas être un pseudo X", () => {
		// Une espace ferait lever `setURL` et emporterait TOUT l'embed.
		expect(normaliserPseudoX("toto tata")).toBe("");
		expect(normaliserPseudoX("a".repeat(16))).toBe("");
		expect(normaliserPseudoX("")).toBe("");
		expect(normaliserPseudoX(undefined)).toBe("");
		expect(normaliserPseudoX(42)).toBe("");
	});
});

describe("trierPostsParDate", () => {
	test("remet le post épinglé à sa vraie place chronologique", () => {
		// Ordre RÉEL rendu par `x.posts` sur @inazuma_project le 13/8/2026 :
		// l'épinglé du 6 juillet arrivait AVANT le post du 12 août.
		const trie = trierPostsParDate([
			{ id: "2074045952747548797", date: "2026-07-06T08:21:03.000Z" },
			{ id: "2087460043658821924", date: "2026-08-12T08:43:52.000Z" },
		]);
		expect(trie.map((post) => post.id)).toEqual(["2087460043658821924", "2074045952747548797"]);
	});

	test("une date absente ou illisible ne passe pas pour la plus récente", () => {
		const trie = trierPostsParDate([
			{ id: "sans-date" },
			{ id: "recent", date: "2026-08-12T08:43:52.000Z" },
			{ id: "illisible", date: "hier" },
		]);
		expect(trie[0]?.id).toBe("recent");
		expect(trie.map((post) => post.id)).toHaveLength(3);
	});

	test("ne modifie pas le tableau reçu", () => {
		const source = [
			{ id: "a", date: "2026-07-06T08:21:03.000Z" },
			{ id: "b", date: "2026-08-12T08:43:52.000Z" },
		];
		trierPostsParDate(source);
		expect(source.map((post) => post.id)).toEqual(["a", "b"]);
	});
});

describe("analyserLiveEnv", () => {
	test("lit le live.env du slot Website unifié", () => {
		expect(
			analyserLiveEnv(
				"# Généré par scripts/ops/deploy.ts — slot actuellement servi par nginx.\n" +
					"LIVE_SLOT=a\n" +
					"LIVE_UNIT=website-web.service\n" +
					"LIVE_PORT=3004\n" +
					"LIVE_RELEASE=2026-08-13T00-34-03-769-Va8uc-iExl92JKgLHQVQ0\n"
			)
		).toEqual({
			LIVE_SLOT: "a",
			LIVE_UNIT: "website-web.service",
			LIVE_PORT: "3004",
			LIVE_RELEASE: "2026-08-13T00-34-03-769-Va8uc-iExl92JKgLHQVQ0",
		});
	});

	test("garde les « = » d'une valeur et ignore les lignes sans clé", () => {
		expect(analyserLiveEnv("A=1=2\n\n=orphelin\n   \nB=  espacé  ")).toEqual({
			A: "1=2",
			B: "espacé",
		});
	});
});

describe("formaterEnTetes", () => {
	test("rend les en-têtes réels de inazuma.jp", () => {
		const texte = formaterEnTetes({
			server: "openresty",
			"content-encoding": "gzip",
			"strict-transport-security": "max-age=315360000;",
		});
		expect(texte).toContain("`server` : openresty");
		expect(texte).toContain("`content-encoding` : gzip");
	});

	test("une charge non objet ne fait pas lever", () => {
		expect(formaterEnTetes(null)).toBe("*aucun*");
		expect(formaterEnTetes("texte")).toBe("*aucun*");
		expect(formaterEnTetes({})).toBe("*aucun*");
	});
});

describe("listeCourte", () => {
	test("rend les technologies réelles de inazuma.jp", () => {
		expect(
			listeCourte(["Google Fonts", "Google Tag Manager", "HSTS", "jQuery", "OpenResty", "Swiper"])
		).toBe("Google Fonts · Google Tag Manager · HSTS · jQuery · OpenResty · Swiper");
	});

	test("annonce le reste au lieu de le taire", () => {
		expect(listeCourte(["a", "b", "c", "d"], 2)).toBe("a · b … +2");
	});

	test("une liste vide ou non tableau rend le libellé de vide", () => {
		expect(listeCourte([])).toBe("*aucune*");
		expect(listeCourte(undefined)).toBe("*aucune*");
		expect(listeCourte([1, 2, 3])).toBe("*aucune*");
	});
});
