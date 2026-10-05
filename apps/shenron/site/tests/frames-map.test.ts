/**
 * Test exhaustif du module frames-map-shared :
 * - mapping des séries et des films vers SiteEpisodeRef
 * - normalisation des vignettes (image) et posters (assetUrl)
 * - formatage de timecode (ms -> m:ss / mm:ss)
 * - filtrage des animes parasites hors univers (One Piece, Hayate, Naruto, etc.)
 * - tri prioritaire (Dragon Ball d'abord, fiches résolues d'abord, similarité)
 * - validation et sniffing d'images (formats acceptés, limites de taille, payloads vides)
 */
import { describe, expect, test } from "bun:test";
import {
	ALL_DBFR_ANILIST_IDS,
	ANILIST_TO_MOVIE,
	ANILIST_TO_SERIES,
	DBFR_ANILIST_IDS,
	DBFR_MOVIE_ANILIST_IDS,
	formatTimecode,
	isDragonBallMatch,
	MAX_FRAME_IMAGE_BYTES,
	movieIdForMatch,
	seriesForMatch,
	siteRefFor,
	sniffImage,
	sortFrameMatches,
	validateFrameImage,
	type FrameMatchLike,
	type SiteEpisodeRef,
} from "../src/lib/frames-map-shared";
import { assetUrl } from "../src/lib/assets";

const resolved = new Map<string, SiteEpisodeRef>([
	[
		"DB:5",
		{
			id: 5,
			series: "DB",
			numberInSeries: 5,
			title: "Le Kaméhaméha",
			href: "/wiki/episodes/5",
			image: assetUrl("./assets/ext/db_episodes/5.jpg"),
		},
	],
	[
		"DBZ:1",
		{
			id: 154,
			series: "DBZ",
			numberInSeries: 1,
			title: "Un mystérieux guerrier",
			href: "/wiki/episodes/154",
			image: assetUrl("assets/episodes/dbz-1.webp"),
		},
	],
	[
		"DBS:131",
		{
			id: 723,
			series: "DBS",
			numberInSeries: 131,
			title: "Un dénouement miraculeux",
			href: "/wiki/episodes/723",
			image: assetUrl("https://bot.dragonballfr.com/assets/episodes/dbs-131.webp"),
		},
	],
	[
		"DBGT:64",
		{
			id: 594,
			series: "DBGT",
			numberInSeries: 64,
			title: "Au revoir, Goku...",
			href: "/wiki/episodes/594",
			image: assetUrl("/wiki/gt-64.webp"),
		},
	],
	[
		"DBZ_KAI:1",
		{
			id: 437,
			series: "DBZ_KAI",
			numberInSeries: 1,
			title: "L'ouverture du rideau",
			href: "/wiki/episodes/437",
			image: null,
		},
	],
	[
		"DBZ_KAI_FINAL:1",
		{
			id: 534,
			series: "DBZ_KAI_FINAL",
			numberInSeries: 1,
			title: "Sept ans plus tard",
			href: "/wiki/episodes/534",
			image: assetUrl("./assets/episodes/kai-final-1.webp"),
		},
	],
	[
		"DB_DAIMA:1",
		{
			id: 724,
			series: "DB_DAIMA",
			numberInSeries: 1,
			title: "Complot",
			href: "/wiki/episodes/724",
			image: assetUrl("./assets/episodes/daima-1.webp"),
		},
	],
	[
		"movie:13",
		{
			id: 13,
			series: "DBZ_MOVIE",
			numberInSeries: null,
			title: "Battle of Gods",
			href: "/wiki/films/dragon-ball-z-movie-14-kami-to-kami",
			image: assetUrl("./assets/ext/db_movies/13.webp"),
		},
	],
	[
		"movie:12",
		{
			id: 12,
			series: "DBS_MOVIE",
			numberInSeries: null,
			title: "Broly",
			href: "/wiki/films/dragon-ball-super-broly",
			image: assetUrl("./assets/ext/db_movies/12.webp"),
		},
	],
]);

describe("frames-map — mapping des séries et des films", () => {
	test("les séries DBFR couvrent les sept diffusions du site", () => {
		expect(Object.values(ANILIST_TO_SERIES).toSorted()).toEqual(
			["DB", "DBGT", "DBS", "DBZ", "DBZ_KAI", "DBZ_KAI_FINAL", "DB_DAIMA"].toSorted()
		);
		expect(DBFR_ANILIST_IDS.length).toBe(7);
	});

	test("reconnaît chaque série via son code ou alias minuscule", () => {
		expect(seriesForMatch({ title: "DB" })).toBe("DB");
		expect(seriesForMatch({ title: "db" })).toBe("DB");
		expect(seriesForMatch({ title: "dragon ball" })).toBe("DB");

		expect(seriesForMatch({ title: "DBZ" })).toBe("DBZ");
		expect(seriesForMatch({ title: "dbz" })).toBe("DBZ");
		expect(seriesForMatch({ title: "dragon ball z" })).toBe("DBZ");

		expect(seriesForMatch({ title: "DBS" })).toBe("DBS");
		expect(seriesForMatch({ title: "dbs" })).toBe("DBS");
		expect(seriesForMatch({ title: "dragon ball super" })).toBe("DBS");

		expect(seriesForMatch({ title: "DBGT" })).toBe("DBGT");
		expect(seriesForMatch({ title: "dbgt" })).toBe("DBGT");
		expect(seriesForMatch({ title: "dragon ball gt" })).toBe("DBGT");

		expect(seriesForMatch({ title: "DBZ_KAI" })).toBe("DBZ_KAI");
		expect(seriesForMatch({ title: "dbkai" })).toBe("DBZ_KAI");
		expect(seriesForMatch({ title: "dbz_kai" })).toBe("DBZ_KAI");
		expect(seriesForMatch({ title: "kai" })).toBe("DBZ_KAI");

		expect(seriesForMatch({ title: "DBZ_KAI_FINAL" })).toBe("DBZ_KAI_FINAL");
		expect(seriesForMatch({ title: "dbz_kai_final" })).toBe("DBZ_KAI_FINAL");

		expect(seriesForMatch({ title: "DB_DAIMA" })).toBe("DB_DAIMA");
		expect(seriesForMatch({ title: "daima" })).toBe("DB_DAIMA");
		expect(seriesForMatch({ title: "db_daima" })).toBe("DB_DAIMA");
	});

	test("reconnaît chaque série via son identifiant AniList officiel", () => {
		expect(seriesForMatch({ anilist: 223 })).toBe("DB");
		expect(seriesForMatch({ anilist: 813 })).toBe("DBZ");
		expect(seriesForMatch({ anilist: 225 })).toBe("DBGT");
		expect(seriesForMatch({ anilist: 6033 })).toBe("DBZ_KAI");
		expect(seriesForMatch({ anilist: 18617 })).toBe("DBZ_KAI_FINAL");
		expect(seriesForMatch({ anilist: 21745 })).toBe("DBS");
		expect(seriesForMatch({ anilist: 178025 })).toBe("DB_DAIMA");
	});

	test("reconnaît les films via l'index local movie:<id> et film:<id>", () => {
		expect(movieIdForMatch({ title: "movie:13" })).toBe(13);
		expect(movieIdForMatch({ title: "movie: 12" })).toBe(12);
		expect(movieIdForMatch({ title: "film:13" })).toBe(13);
		expect(movieIdForMatch({ title: "FILM:15" })).toBe(15);
		expect(movieIdForMatch({ title: "movie:abc" })).toBeNull();
		expect(movieIdForMatch({ title: "movie:-5" })).toBeNull();
		expect(movieIdForMatch({ title: "movie:0" })).toBeNull();
	});

	test("reconnaît les films via les identifiants AniList officiels (ANILIST_TO_MOVIE)", () => {
		expect(ANILIST_TO_MOVIE[14837]).toBe(13); // Battle of Gods
		expect(ANILIST_TO_MOVIE[101302]).toBe(12); // Broly
		expect(ANILIST_TO_MOVIE[20778]).toBe(14); // Résurrection de F
		expect(ANILIST_TO_MOVIE[133898]).toBe(36); // Super Hero
		expect(ANILIST_TO_MOVIE[502]).toBe(15); // La Légende de Shenron
		expect(ANILIST_TO_MOVIE[986]).toBe(11); // Bardock special

		expect(movieIdForMatch({ anilist: 14837 })).toBe(13);
		expect(movieIdForMatch({ anilist: 101302 })).toBe(12);
		expect(isDragonBallMatch({ anilist: 14837 })).toBe(true);
		expect(isDragonBallMatch({ anilist: 101302 })).toBe(true);

		expect(DBFR_MOVIE_ANILIST_IDS.length).toBe(26);
		expect(ALL_DBFR_ANILIST_IDS.length).toBe(33); // 7 séries + 26 films
	});

	test("résout les séries vers SiteEpisodeRef avec lien horodaté", () => {
		const refDb = siteRefFor({ title: "db", episode: 5, atMs: 125_400 }, resolved);
		expect(refDb).not.toBeNull();
		expect(refDb?.id).toBe(5);
		expect(refDb?.series).toBe("DB");
		expect(refDb?.href).toBe("/wiki/episodes/5?t=125");
		expect(refDb?.image).toContain("assets/ext/db_episodes/5.jpg");

		const refDbs = siteRefFor({ anilist: 21745, episode: 131, atMs: 60_000 }, resolved);
		expect(refDbs?.id).toBe(723);
		expect(refDbs?.series).toBe("DBS");
		expect(refDbs?.href).toBe("/wiki/episodes/723?t=60");

		const refDaima = siteRefFor({ title: "daima", episode: 1, atMs: 10_000 }, resolved);
		expect(refDaima?.id).toBe(724);
		expect(refDaima?.series).toBe("DB_DAIMA");
		expect(refDaima?.href).toBe("/wiki/episodes/724?t=10");
	});

	test("résout les films vers SiteEpisodeRef avec lien horodaté vers la fiche film", () => {
		const refBog = siteRefFor({ anilist: 14837, atMs: 600_000 }, resolved);
		expect(refBog).not.toBeNull();
		expect(refBog?.id).toBe(13);
		expect(refBog?.series).toBe("DBZ_MOVIE");
		expect(refBog?.numberInSeries).toBeNull();
		expect(refBog?.href).toBe("/wiki/films/dragon-ball-z-movie-14-kami-to-kami?t=600");
		expect(refBog?.image).toContain("assets/ext/db_movies/13.webp");

		const refBroly = siteRefFor({ title: "movie:12", atMs: 1_200_000 }, resolved);
		expect(refBroly?.id).toBe(12);
		expect(refBroly?.series).toBe("DBS_MOVIE");
		expect(refBroly?.href).toBe("/wiki/films/dragon-ball-super-broly?t=1200");
	});
});

describe("frames-map — normalisation des vignettes et posters (assetUrl)", () => {
	test("normalise les chemins relatifs ./assets/... en URLs absolues", () => {
		const u = assetUrl("./assets/ext/db_episodes/5.jpg");
		expect(u).toMatch(/^https:\/\/bot\.dragonballfr\.com\/assets\/ext\/db_episodes\/5\.jpg$/);
	});

	test("normalise les chemins sans point assets/... en URLs absolues", () => {
		const u = assetUrl("assets/episodes/dbz-1.webp");
		expect(u).toMatch(/^https:\/\/bot\.dragonballfr\.com\/assets\/episodes\/dbz-1\.webp$/);
	});

	test("préserve les URLs déjà absolues (http/https)", () => {
		const u = assetUrl("https://images.example.com/poster.webp");
		expect(u).toBe("https://images.example.com/poster.webp");
	});

	test("préserve les chemins racines servis par public/ (/wiki/...)", () => {
		const u = assetUrl("/wiki/gt-64.webp");
		expect(u).toBe("/wiki/gt-64.webp");
	});

	test("renvoie une chaîne vide pour les valeurs nulles ou indéfinies", () => {
		expect(assetUrl(null)).toBe("");
		expect(assetUrl(undefined)).toBe("");
		expect(assetUrl("")).toBe("");
	});
});

describe("frames-map — formatage de timecode", () => {
	test("formate les durées standards en m:ss", () => {
		expect(formatTimecode(0)).toBe("0:00");
		expect(formatTimecode(500)).toBe("0:00");
		expect(formatTimecode(1000)).toBe("0:01");
		expect(formatTimecode(41_000)).toBe("0:41");
		expect(formatTimecode(59_000)).toBe("0:59");
		expect(formatTimecode(60_000)).toBe("1:00");
		expect(formatTimecode(65_000)).toBe("1:05");
		expect(formatTimecode(125_400)).toBe("2:05");
		expect(formatTimecode(600_000)).toBe("10:00");
		expect(formatTimecode(3_661_000)).toBe("61:01");
	});

	test("supporte l'option padMinutes pour un affichage strict mm:ss", () => {
		expect(formatTimecode(0, { padMinutes: true })).toBe("00:00");
		expect(formatTimecode(45_000, { padMinutes: true })).toBe("00:45");
		expect(formatTimecode(65_000, { padMinutes: true })).toBe("01:05");
		expect(formatTimecode(125_400, { padMinutes: true })).toBe("02:05");
		expect(formatTimecode(600_000, { padMinutes: true })).toBe("10:00");
	});

	test("gère avec robustesse les valeurs aberrantes (null, undefined, NaN, négatif)", () => {
		expect(formatTimecode(null)).toBe("0:00");
		expect(formatTimecode(undefined)).toBe("0:00");
		expect(formatTimecode(NaN)).toBe("0:00");
		expect(formatTimecode(-500)).toBe("0:00");
		expect(formatTimecode(Infinity)).toBe("0:00");
	});
});

describe("frames-map — filtrage des correspondances parasites hors univers", () => {
	test("rejette One Piece (AniList 21 ou titre) même en cas de coïncidence de numéro d'épisode", () => {
		const matchAnilist: FrameMatchLike = { anilist: 21, episode: 5, atMs: 50_000 };
		expect(isDragonBallMatch(matchAnilist)).toBe(false);
		expect(seriesForMatch(matchAnilist)).toBeUndefined();
		expect(siteRefFor(matchAnilist, resolved)).toBeNull();

		const matchTitre: FrameMatchLike = { title: "ONE PIECE", episode: 5, atMs: 50_000 };
		expect(isDragonBallMatch(matchTitre)).toBe(false);
		expect(seriesForMatch(matchTitre)).toBeUndefined();
		expect(siteRefFor(matchTitre, resolved)).toBeNull();
	});

	test("rejette Hayate no Gotoku! (bruit observé lors des audits de production)", () => {
		const match: FrameMatchLike = { title: "Hayate no Gotoku!", episode: 1, atMs: 120_000 };
		expect(isDragonBallMatch(match)).toBe(false);
		expect(seriesForMatch(match)).toBeUndefined();
		expect(siteRefFor(match, resolved)).toBeNull();
	});

	test("rejette Naruto et Naruto Shippuuden", () => {
		expect(isDragonBallMatch({ anilist: 20, episode: 1 })).toBe(false);
		expect(isDragonBallMatch({ title: "Naruto", episode: 1 })).toBe(false);
		expect(isDragonBallMatch({ title: "Naruto Shippuuden", episode: 154 })).toBe(false);
		expect(siteRefFor({ title: "Naruto", episode: 1 }, resolved)).toBeNull();
	});

	test("rejette Yu☆Gi☆Oh! ARC-V (AniList 20703)", () => {
		expect(isDragonBallMatch({ anilist: 20703, episode: 5 })).toBe(false);
		expect(isDragonBallMatch({ title: "Yu☆Gi☆Oh! ARC-V", episode: 5 })).toBe(false);
		expect(siteRefFor({ anilist: 20703, episode: 5 }, resolved)).toBeNull();
	});

	test("rejette les animes généraux (Bleach, Hunter x Hunter, Gintama...)", () => {
		for (const title of ["Bleach", "Hunter x Hunter", "Gintama", "Fairy Tail", "Detective Conan"]) {
			expect(isDragonBallMatch({ title, episode: 1 })).toBe(false);
			expect(siteRefFor({ title, episode: 1 }, resolved)).toBeNull();
		}
	});
});

describe("frames-map — tri prioritaire des résultats", () => {
	test("accorde une priorité absolue à Dragon Ball et aux fiches résolues sur le site", () => {
		const ref5 = resolved.get("DB:5")!;
		const ref1 = resolved.get("DBZ:1")!;

		const rawMatches = [
			{
				title: "ONE PIECE",
				similarity: 0.98,
				isDragonBall: false,
				siteEpisode: null,
			},
			{
				title: "DBZ",
				similarity: 0.65,
				isDragonBall: true,
				siteEpisode: null,
			},
			{
				title: "DBZ",
				similarity: 0.85,
				isDragonBall: true,
				siteEpisode: ref1,
			},
			{
				title: "DB",
				similarity: 0.92,
				isDragonBall: true,
				siteEpisode: ref5,
			},
			{
				title: "Naruto",
				similarity: 0.75,
				isDragonBall: false,
				siteEpisode: null,
			},
		];

		const sorted = sortFrameMatches(rawMatches);

		// 1er : DB résolu (sim 0.92)
		expect(sorted[0].title).toBe("DB");
		expect(sorted[0].siteEpisode).toBe(ref5);

		// 2e : DBZ résolu (sim 0.85)
		expect(sorted[1].title).toBe("DBZ");
		expect(sorted[1].siteEpisode).toBe(ref1);

		// 3e : DBZ non résolu (sim 0.65, mais Dragon Ball > One Piece 0.98)
		expect(sorted[2].title).toBe("DBZ");
		expect(sorted[2].siteEpisode).toBeNull();

		// 4e : One Piece (hors univers mais similarité 0.98 > Naruto 0.75)
		expect(sorted[3].title).toBe("ONE PIECE");

		// 5e : Naruto (hors univers, similarité 0.75)
		expect(sorted[4].title).toBe("Naruto");
	});
});

describe("frames-map — validation et sniffing des images", () => {
	// Magic bytes valides
	const jpegHeader = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
	const pngHeader = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
	const gifHeader = new Uint8Array([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0x01, 0x00, 0x01, 0x00]);
	const webpHeader = new Uint8Array([
		0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
	]);
	const avifHeader = new Uint8Array([
		0x00, 0x00, 0x00, 0x1c, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66,
	]);

	test("sniffImage détecte correctement tous les formats supportés", () => {
		expect(sniffImage(jpegHeader)?.ext).toBe("jpg");
		expect(sniffImage(jpegHeader)?.type).toBe("image/jpeg");

		expect(sniffImage(pngHeader)?.ext).toBe("png");
		expect(sniffImage(pngHeader)?.type).toBe("image/png");

		expect(sniffImage(gifHeader)?.ext).toBe("gif");
		expect(sniffImage(gifHeader)?.type).toBe("image/gif");

		expect(sniffImage(webpHeader)?.ext).toBe("webp");
		expect(sniffImage(webpHeader)?.type).toBe("image/webp");

		expect(sniffImage(avifHeader)?.ext).toBe("avif");
		expect(sniffImage(avifHeader)?.type).toBe("image/avif");
	});

	test("validateFrameImage valide les formats corrects", () => {
		const valJpeg = validateFrameImage(jpegHeader);
		expect(valJpeg.ok).toBe(true);
		if (valJpeg.ok) {
			expect(valJpeg.ext).toBe("jpg");
			expect(valJpeg.mime).toBe("image/jpeg");
		}

		const valPng = validateFrameImage(pngHeader);
		expect(valPng.ok).toBe(true);
		if (valPng.ok) {
			expect(valPng.ext).toBe("png");
		}
	});

	test("validateFrameImage rejette les payloads vides ou nuls", () => {
		expect(validateFrameImage(null)).toEqual({
			ok: false,
			error: "Veuillez fournir une image valide (fichier ou URL).",
			status: 400,
		});
		expect(validateFrameImage(undefined)).toEqual({
			ok: false,
			error: "Veuillez fournir une image valide (fichier ou URL).",
			status: 400,
		});
		expect(validateFrameImage(new Uint8Array(0))).toEqual({
			ok: false,
			error: "Veuillez fournir une image valide (fichier ou URL).",
			status: 400,
		});
	});

	test("validateFrameImage rejette les images dépassant 8 Mo", () => {
		// Simule un buffer de 8 Mo + 1 octet
		const oversize = new Uint8Array(MAX_FRAME_IMAGE_BYTES + 1);
		oversize[0] = 0xff;
		oversize[1] = 0xd8;
		oversize[2] = 0xff;

		const result = validateFrameImage(oversize);
		expect(result).toEqual({
			ok: false,
			error: "L'image dépasse la taille maximale autorisée (8 Mo).",
			status: 400,
		});
	});

	test("validateFrameImage rejette les formats non supportés (PDF, texte, binaire inconnu)", () => {
		const pdf = new TextEncoder().encode("%PDF-1.4 header text...");
		expect(validateFrameImage(pdf)).toEqual({
			ok: false,
			error: "Format d'image non supporté. Formats acceptés : JPEG, PNG, WebP, GIF, AVIF.",
			status: 400,
		});

		const text = new TextEncoder().encode("Hello world not an image");
		expect(validateFrameImage(text).ok).toBe(false);

		const exe = new Uint8Array([0x4d, 0x5a, 0x90, 0x00]); // MZ executable
		expect(validateFrameImage(exe).ok).toBe(false);
	});
});
