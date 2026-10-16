/**
 * Noyau pur des tweets : filtre de notification, rendu, pagination.
 *
 * Les cas limites testés ici viennent tous d'un relevé réel de la base
 * (12/8/2026) : médias ré-hébergés dans le Storage self-host, tweets japonais
 * traduits, lot de 245 posts en une minute, `category` NULL sur 7672 lignes.
 */
import { describe, expect, test } from "bun:test";

import {
	CATEGORIES_INTERDITES,
	FILTRE_TWEETS_DEFAUT,
	MAX_CARACTERES_PAR_MESSAGE,
	MAX_EMBEDS_PAR_MESSAGE,
	PLAFOND_DRAIN,
	bornerPage,
	categoriesBannies,
	compterParAuteur,
	corpsTweet,
	couper,
	decoderEtatListe,
	decouperEnLots,
	encoderEtatListe,
	formaterMetriques,
	imagesTweet,
	ligneListe,
	lireFiltreTweets,
	memeCompte,
	nombreDePages,
	nonceLot,
	resumeLot,
	texteSansLienMedia,
	tweetEstNotifiable,
	urlMediaAbsolue,
	urlTweet,
	type FiltreTweets,
	type LigneTweet,
} from "./tweets-format";

function tweet(patch: Partial<LigneTweet> = {}): LigneTweet {
	return {
		id: "2087621938692677991",
		text: "Nouvelle mise à jour disponible !",
		created_at: "2026-08-12T19:27:10+00:00",
		author_username: "inazuma_project",
		author_name: "Inazuma Eleven",
		media: [],
		metrics: {},
		is_thread: false,
		tweet_count: 1,
		translation: null,
		category: "news",
		...patch,
	};
}

const filtreActif: FiltreTweets = { ...FILTRE_TWEETS_DEFAUT, actif: true };

describe("lireFiltreTweets", () => {
	test("un réglage absent retombe sur le défaut", () => {
		expect(lireFiltreTweets(null)).toEqual({
			...FILTRE_TWEETS_DEFAUT,
			comptes: [...FILTRE_TWEETS_DEFAUT.comptes],
		});
	});

	test("un réglage corrompu ne fait ni taire ni emballer la notification", () => {
		const filtre = lireFiltreTweets({
			actif: "oui",
			comptes: "inazuma_project",
			max_par_lot: "beaucoup",
		});
		expect(filtre.actif).toBe(false); // seul `true` strict allume
		expect(filtre.comptes).toEqual([...FILTRE_TWEETS_DEFAUT.comptes]);
		expect(filtre.max_par_lot).toBe(FILTRE_TWEETS_DEFAUT.max_par_lot);
	});

	test("le `@` d'un compte est retiré, les entrées vides écartées", () => {
		expect(lireFiltreTweets({ comptes: ["@Level5Hub", "  ", 42] }).comptes).toEqual(["Level5Hub"]);
	});

	test("`max_par_lot` est borné par le plafond de drain", () => {
		expect(lireFiltreTweets({ max_par_lot: 9_999 }).max_par_lot).toBe(PLAFOND_DRAIN);
		expect(lireFiltreTweets({ max_par_lot: 0 }).max_par_lot).toBe(1);
	});

	test("un tableau ou une chaîne à la place de l'objet ne casse rien", () => {
		expect(lireFiltreTweets(["nawak"]).actif).toBe(false);
		expect(lireFiltreTweets("nawak").comptes).toEqual([...FILTRE_TWEETS_DEFAUT.comptes]);
	});
});

describe("tweetEstNotifiable", () => {
	test("coupé = rien ne passe, même un compte officiel", () => {
		expect(tweetEstNotifiable(tweet(), { ...filtreActif, actif: false })).toBe(false);
	});

	test("un compte hors liste blanche ne passe pas", () => {
		expect(tweetEstNotifiable(tweet({ author_username: "JavierSolero16" }), filtreActif)).toBe(
			false
		);
	});

	test("la casse du pseudo n'a aucun sens sur X", () => {
		expect(tweetEstNotifiable(tweet({ author_username: "INAZUMA_PROJECT" }), filtreActif)).toBe(
			true
		);
	});

	test("`leak` est refusé même si le réglage l'autorise", () => {
		const permissif: FiltreTweets = { ...filtreActif, categories_exclues: [] };
		expect(CATEGORIES_INTERDITES).toContain("leak");
		expect(tweetEstNotifiable(tweet({ category: "leak" }), permissif)).toBe(false);
		expect(categoriesBannies(permissif)).toContain("leak");
	});

	test("une catégorie exclue par réglage est refusée", () => {
		expect(tweetEstNotifiable(tweet({ category: "fan-content" }), filtreActif)).toBe(false);
	});

	test("category NULL passe : 7672 lignes de l'archive n'en ont pas", () => {
		expect(tweetEstNotifiable(tweet({ category: null }), filtreActif)).toBe(true);
	});

	test("une liste blanche vide n'annonce rien", () => {
		expect(tweetEstNotifiable(tweet(), { ...filtreActif, comptes: [] })).toBe(false);
	});
});

describe("memeCompte", () => {
	test("ignore le @ et la casse, refuse le vide", () => {
		expect(memeCompte("@Level5Hub", "level5hub")).toBe(true);
		expect(memeCompte(null, "level5hub")).toBe(false);
		expect(memeCompte("a", null)).toBe(false);
	});
});

describe("médias", () => {
	test("le Storage self-host passe devant pbs.twimg.com et devient absolu", () => {
		const images = imagesTweet([
			{
				type: "photo",
				url: "https://pbs.twimg.com/media/HPi5FitWcAEaCB5.jpg",
				storage_url: "/storage/v1/object/public/tweets/HPi5FitWcAEaCB5.jpg",
				width: 1280,
				height: 720,
			},
		]);
		expect(images).toEqual([
			{
				url: "https://rosegriffon.fr/storage/v1/object/public/tweets/HPi5FitWcAEaCB5.jpg",
				largeur: 1280,
				hauteur: 720,
			},
		]);
	});

	test("sans média ré-hébergé, l'URL d'origine est conservée", () => {
		expect(imagesTweet([{ type: "photo", url: "https://pbs.twimg.com/media/x.jpg" }])[0]?.url).toBe(
			"https://pbs.twimg.com/media/x.jpg"
		);
	});

	test("les vidéos sont écartées (Discord n'en fait rien dans un embed)", () => {
		expect(imagesTweet([{ type: "video", url: "https://video.twimg.com/x.mp4" }])).toEqual([]);
	});

	test("un `media` non tableau ou vide ne casse pas", () => {
		expect(imagesTweet(null)).toEqual([]);
		expect(imagesTweet({})).toEqual([]);
		expect(imagesTweet([null, 3, { type: "photo" }])).toEqual([]);
	});

	test("une URL relative hors Storage est refusée : Discord ne la résoudrait pas", () => {
		expect(urlMediaAbsolue("/ievr.webp")).toBeNull();
		expect(urlMediaAbsolue("javascript:alert(1)")).toBeNull();
		expect(urlMediaAbsolue("https://cdn.rosegriffon.fr/x.png")).toBe(
			"https://cdn.rosegriffon.fr/x.png"
		);
	});
});

describe("formaterMetriques", () => {
	test("n'affiche que les compteurs non nuls", () => {
		expect(formaterMetriques({ like_count: 12, view_count: 0, retweet_count: 3 })).toBe(
			"♥ 12 · RT 3"
		);
	});

	test("rend null quand tout est à zéro ou absent", () => {
		expect(formaterMetriques({ like_count: 0, view_count: 0 })).toBeNull();
		expect(formaterMetriques(null)).toBeNull();
		expect(formaterMetriques("nawak")).toBeNull();
	});
});

describe("texte", () => {
	test("le lien t.co de fin est retiré : il ne fait que doubler l'image", () => {
		expect(texteSansLienMedia("@InazumaSeries #InazumaDay https://t.co/jZQFTHfp7Q")).toBe(
			"@InazumaSeries #InazumaDay"
		);
	});

	test("un lien t.co au milieu du texte est conservé", () => {
		expect(texteSansLienMedia("voir https://t.co/abc pour la suite")).toBe(
			"voir https://t.co/abc pour la suite"
		);
	});

	test("la traduction passe devant l'original, qui suit en citation", () => {
		const corps = corpsTweet(tweet({ text: "アップデート", translation: "Mise à jour" }), 200);
		expect(corps.startsWith("Mise à jour")).toBe(true);
		expect(corps).toContain("> アップデート");
	});

	test("sans traduction, l'original est rendu tel quel", () => {
		expect(corpsTweet(tweet({ translation: null }), 200)).toBe("Nouvelle mise à jour disponible !");
	});

	test("une traduction identique à l'original n'est pas doublée", () => {
		const corps = corpsTweet(tweet({ text: "Salut", translation: "Salut" }), 200);
		expect(corps).toBe("Salut");
	});

	test("couper ne dépasse jamais la longueur demandée", () => {
		expect(couper("abcdefghij", 5)).toHaveLength(5);
		expect(couper("abc", 5)).toBe("abc");
	});
});

describe("ligneListe", () => {
	test("porte l'auteur cliquable, l'horodatage et les étiquettes", () => {
		const ligne = ligneListe(
			tweet({
				is_thread: true,
				tweet_count: 4,
				media: [{ type: "photo", url: "https://pbs.twimg.com/a.jpg" }],
			})
		);
		expect(ligne).toContain(
			"[@inazuma_project](https://x.com/inazuma_project/status/2087621938692677991)"
		);
		expect(ligne).toContain("fil de 4");
		expect(ligne).toContain("1 image");
		expect(ligne).toContain("*news*");
	});

	test("un tweet sans texte reste lisible", () => {
		expect(ligneListe(tweet({ text: null, translation: null }))).toContain("*(sans texte)*");
	});
});

describe("urlTweet", () => {
	test("reconstruit le lien canonique", () => {
		expect(urlTweet({ id: "42", author_username: "Level5Hub" })).toBe(
			"https://x.com/Level5Hub/status/42"
		);
	});

	test("sans auteur, `i` reste un chemin valide chez X", () => {
		expect(urlTweet({ id: "42", author_username: null })).toBe("https://x.com/i/status/42");
	});
});

describe("pagination", () => {
	test("nombreDePages n'est jamais nul", () => {
		expect(nombreDePages(0, 5)).toBe(1);
		expect(nombreDePages(12_998, 5)).toBe(2_600);
	});

	test("la page 40 d'une archive de 13 000 posts reste valide", () => {
		expect(bornerPage(40, 12_998, 5)).toBe(40);
	});

	test("une page démesurée est ramenée à la dernière, jamais envoyée à Postgres", () => {
		expect(bornerPage(999_999_999_999, 12_998, 5)).toBe(2_600);
		expect(bornerPage(Number.NaN, 12_998, 5)).toBe(1);
		expect(bornerPage(-3, 12_998, 5)).toBe(1);
	});
});

describe("boutons de pagination", () => {
	test("l'aller-retour conserve l'état", () => {
		const etat = { page: 7, auteur: "inazuma_cross", categorie: "news", recherche: "stade" };
		const identifiant = encoderEtatListe(etat);
		expect(identifiant).not.toBeNull();
		expect(decoderEtatListe(identifiant!)).toEqual(etat);
	});

	test("un état sans filtre se relit avec des nulls", () => {
		const identifiant = encoderEtatListe({
			page: 1,
			auteur: null,
			categorie: null,
			recherche: null,
		});
		expect(decoderEtatListe(identifiant!)).toEqual({
			page: 1,
			auteur: null,
			categorie: null,
			recherche: null,
		});
	});

	test("un état trop long rend null plutôt que de tronquer la recherche", () => {
		expect(
			encoderEtatListe({ page: 1, auteur: null, categorie: null, recherche: "x".repeat(120) })
		).toBeNull();
	});

	test("le séparateur est neutralisé dans les valeurs", () => {
		const identifiant = encoderEtatListe({
			page: 2,
			auteur: null,
			categorie: null,
			recherche: "a|b",
		});
		expect(decoderEtatListe(identifiant!)?.recherche).toBe("a b");
	});

	test("un customId étranger est rejeté", () => {
		expect(decoderEtatListe("profil|1")).toBeNull();
		expect(decoderEtatListe("tw|zero||||")).toBeNull();
	});
});

describe("regroupement d'un gros lot", () => {
	const lot: LigneTweet[] = [
		...Array.from({ length: 8 }, (_, i) =>
			tweet({ id: `a${i}`, author_username: "inazuma_project" })
		),
		...Array.from({ length: 4 }, (_, i) =>
			tweet({ id: `b${i}`, author_username: "inazuma_cross" })
		),
	];

	test("compte par auteur, du plus prolifique au moins", () => {
		expect(compterParAuteur(lot)).toEqual([
			{ compte: "inazuma_project", n: 8 },
			{ compte: "inazuma_cross", n: 4 },
		]);
	});

	test("la synthèse annonce le total et la répartition", () => {
		expect(resumeLot(lot)).toBe(
			"**12 nouveaux tweets** — @inazuma_project (8), @inazuma_cross (4)"
		);
	});

	test("tient le pire lot mesuré (245 posts en une minute)", () => {
		const gros = Array.from({ length: 245 }, (_, i) => tweet({ id: `c${i}` }));
		expect(resumeLot(gros)).toContain("**245 nouveaux tweets**");
	});
});

describe("decouperEnLots", () => {
	/** Faux embed : seul `length` compte, c'est ce que Discord facture. */
	const embed = (length: number) => ({ length });

	test("découpe à 10 embeds, la borne dure d'un message Discord", () => {
		const lots = decouperEnLots(
			Array.from({ length: 23 }, () => embed(10)),
			MAX_EMBEDS_PAR_MESSAGE,
			MAX_CARACTERES_PAR_MESSAGE
		);
		expect(lots.map((l) => l.length)).toEqual([10, 10, 3]);
	});

	test("découpe aussi sur les 6 000 caractères : six gros posts ne tiennent pas", () => {
		const lots = decouperEnLots(Array.from({ length: 6 }, () => embed(1_150)));
		expect(lots.map((l) => l.length)).toEqual([5, 1]);
		for (const lot of lots) {
			expect(lot.reduce((n, e) => n + e.length, 0)).toBeLessThanOrEqual(MAX_CARACTERES_PAR_MESSAGE);
		}
	});

	test("un embed seul plus gros que la borne part quand même, jamais tronqué ici", () => {
		expect(decouperEnLots([embed(9_000)])).toEqual([[{ length: 9_000 }]]);
	});

	test("aucun élément : aucun message", () => {
		expect(decouperEnLots([])).toEqual([]);
	});

	/**
	 * Le filet qui rend le seuil `max_par_lot` inoffensif : même poussé au
	 * plafond de drain par un `UPDATE settings`, l'envoi détaillé reste découpé
	 * en messages qu'un `send` accepte. C'est ce qui justifie de borner
	 * `lireFiltreTweets` sur `PLAFOND_DRAIN` et non sur 10.
	 */
	test("un seuil au plafond de drain reste envoyable", () => {
		const seuil = lireFiltreTweets({ max_par_lot: PLAFOND_DRAIN }).max_par_lot;
		expect(seuil).toBe(PLAFOND_DRAIN);
		const lots = decouperEnLots(Array.from({ length: seuil }, () => embed(500)));
		for (const lot of lots) {
			expect(lot.length).toBeLessThanOrEqual(MAX_EMBEDS_PAR_MESSAGE);
			expect(lot.reduce((n, e) => n + e.length, 0)).toBeLessThanOrEqual(MAX_CARACTERES_PAR_MESSAGE);
		}
		expect(lots.reduce((n, lot) => n + lot.length, 0)).toBe(seuil);
	});
});

describe("nonceLot", () => {
	test("déterministe pour un même lot, et distinct par tranche", () => {
		expect(nonceLot("2087621938692677991")).toBe(nonceLot("2087621938692677991"));
		expect(nonceLot("2087621938692677991", 1)).not.toBe(nonceLot("2087621938692677991"));
	});

	test("ne dépasse jamais les 25 caractères admis par Discord", () => {
		expect(nonceLot("9".repeat(64), 9).length).toBeLessThanOrEqual(25);
	});

	test("les caractères hors [0-9A-Za-z] sont retirés", () => {
		expect(nonceLot("20876-2193/8692 677991")).toBe("tw0-087621938692677991");
	});
});
