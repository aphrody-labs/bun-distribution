/**
 * manga-api.ts — la lecture du manga rendue ADRESSABLE, planche par planche.
 *
 * Le lecteur du site savait déjà afficher un chapitre ; rien ne savait désigner
 * UNE planche. Un agent (ou un `curl`) n'avait aucun moyen de demander « la
 * planche 12 du chapitre 1421 » ni de récupérer son texte : les images vivaient
 * dans une colonne `jsonb` de `bot.db_manga_chapters`, l'OCR dans une table
 * séparée (`bot.db_manga_pages`) indexée par des clés d'une AUTRE forme, et rien
 * ne joignait les deux. Ce module est ce joint.
 *
 * LA CLÉ DE JOINTURE
 * ------------------
 * `db_manga_pages` range ses lignes par `(series, tome, planche)`, et `tome` n'a
 * pas la même forme selon l'édition — c'est la seule subtilité du fichier :
 *   - série `DB`  : un « chapitre » = un TOME entier → `tome = vol{numéro}`
 *                   (les chemins d'images le confirment : `.../regular/vol13/007.webp`) ;
 *   - série `DBS` : un chapitre = un chapitre → `tome = ch{id du chapitre}` ;
 *   - série `DBFC`: édition couleur hébergée hors assets, aucune transcription.
 *
 * Le numéro de planche ne se déduit PAS de l'index dans le tableau : les tomes
 * numérisés commencent parfois à `002.webp` (jaquette absente) et l'OCR, lui,
 * porte le numéro du FICHIER. On lit donc le nombre dans le nom de fichier, et
 * l'index n'est qu'un repli.
 */
import "server-only";

import { sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { assetUrl } from "@/lib/assets";
import { API_URL as BOT_API_URL, SITE_URL } from "@/lib/config";
import { dbUniverse, type MangaChapterRead, type MangaVolume } from "@/lib/db-universe";
import { EDITION_PAR_SERIE, SERIE_COULEUR } from "@/lib/manga-editions";
import { resolveMangaPage } from "@/lib/manga-assets";
import { estCjk, extraitAutour, normaliser, scorer } from "@/lib/manga-search-rules";
import { sansAccents } from "@/lib/pg-unaccent";

/** Une planche, telle qu'un agent la reçoit : image, texte, et son adresse. */
export type PlancheApi = {
	/** Rang de lecture dans le chapitre, 1..n — c'est LUI qui sert d'adresse. */
	index: number;
	/** Numéro imprimé/numérisé (nom de fichier), quand il diffère du rang. */
	planche: number;
	image: string;
	/** Texte OCR de la planche (`null` quand la transcription n'existe pas). */
	text: string | null;
	/** Bulles séparées, quand l'OCR les a conservées. */
	lines: string[] | null;
	lang: string | null;
	/** Page du lecteur, cadrée sur cette planche. */
	href: string;
	/** Ressource JSON de CETTE planche seule. */
	api: string;
};

export type ChapitreApi = {
	id: number;
	series: string;
	chapter_number: number;
	title: string | null;
	volume_id: number | null;
	edition: { langue: string; colorisation: string };
	pages: number;
	/** Planches transcrites sur `pages` (0 quand l'OCR n'a pas tourné). */
	transcrites: number;
	prev: number | null;
	next: number | null;
	href: string;
	api: string;
	planches: PlancheApi[];
};

/**
 * Clé `tome` de `db_manga_pages` pour un chapitre du site.
 * `null` = édition sans transcription (couleur, ou série inconnue).
 */
function cleTomeOcr(chapter: {
	id: number;
	series: string;
	chapter_number: number;
}): { series: string; tome: string } | null {
	const s = (chapter.series ?? "").toUpperCase();
	if (s === SERIE_COULEUR) return null;
	if (s === "DB") return { series: "DB", tome: `vol${chapter.chapter_number}` };
	if (s === "DBS") return { series: "DBS", tome: `ch${chapter.id}` };
	if (["DBKZ", "SOSH", "DBJP", "DBZ_ANIME_COMICS", "DB_MOVIES", "ARALE"].includes(s)) {
		return { series: s, tome: `vol${chapter.chapter_number}` };
	}
	return null;
}

/** Numéro de planche lu dans le nom de fichier (`.../007.webp` → 7). */
function numeroDePlanche(chemin: string, index: number): number {
	const fichier = chemin.split("?")[0]!.split("/").pop() ?? "";
	// On prend le DERNIER groupe de chiffres du nom : `DragonBallTome37-152.jpg`
	// doit rendre 152, pas 37.
	const groupes = fichier.replace(/\.[a-z0-9]+$/i, "").match(/\d+/g);
	const n = groupes?.length ? Number(groupes[groupes.length - 1]) : NaN;
	return Number.isFinite(n) && n > 0 ? n : index + 1;
}

type LigneOcr = { planche: number; text: string | null; lines: string | null; lang: string | null };

/** Transcriptions d'un chapitre, indexées par numéro de planche. */
async function ocrDuChapitre(chapter: {
	id: number;
	series: string;
	chapter_number: number;
}): Promise<Map<number, LigneOcr>> {
	const cle = cleTomeOcr(chapter);
	if (!cle) return new Map();
	try {
		const rows = await db.execute<LigneOcr>(sql`
			SELECT planche, text, lines, lang
			FROM bot.db_manga_pages
			WHERE series = ${cle.series} AND tome = ${cle.tome}
		`);
		const map = new Map<number, LigneOcr>();
		for (const r of rows) if (r.planche != null) map.set(Number(r.planche), r);
		return map;
	} catch (e) {
		// L'OCR est un BONUS : une table absente ou un miroir en retard ne doit
		// jamais faire échouer la lecture des images.
		console.error("[manga-api] OCR indisponible:", e);
		return new Map();
	}
}

/** `lines` est stocké tantôt en jsonb, tantôt en texte JSON : on tolère les deux. */
function decodeLignes(raw: string | null): string[] | null {
	if (!raw) return null;
	if (Array.isArray(raw)) return (raw as unknown[]).map(String);
	try {
		const v = JSON.parse(raw);
		return Array.isArray(v) ? v.map(String) : null;
	} catch {
		return null;
	}
}

/** Chapitre complet, planches adressables comprises. */
export async function chapitreApi(id: number): Promise<ChapitreApi | null> {
	const chapter = (await dbUniverse.mangaChapter(id)) as MangaChapterRead | null;
	if (!chapter) return null;
	const ocr = await ocrDuChapitre(chapter);

	const planches: PlancheApi[] = (chapter.pages ?? []).map((chemin, i) => {
		const numero = numeroDePlanche(chemin, i);
		const t = ocr.get(numero) ?? null;
		return {
			index: i + 1,
			planche: numero,
			image: assetUrl(chemin),
			text: t?.text?.trim() ? t.text : null,
			lines: decodeLignes(t?.lines ?? null),
			lang: t?.lang ?? null,
			href: `${SITE_URL}/wiki/manga/${chapter.id}?planche=${i + 1}`,
			api: `${SITE_URL}/api/manga/chapter/${chapter.id}/planche/${i + 1}`,
		};
	});

	return {
		id: chapter.id,
		series: chapter.series,
		chapter_number: chapter.chapter_number,
		title: chapter.title,
		volume_id: chapter.volume_id,
		edition: editionDe(chapter.series),
		pages: planches.length,
		transcrites: planches.filter((p) => p.text !== null).length,
		prev: chapter.prev,
		next: chapter.next,
		href: `${SITE_URL}/wiki/manga/${chapter.id}`,
		api: `${SITE_URL}/api/manga/chapter/${chapter.id}`,
		planches,
	};
}

function editionDe(series: string): { langue: string; colorisation: string } {
	return EDITION_PAR_SERIE[series] ?? { langue: "fr", colorisation: "nb" };
}

/** Une planche seule + ses voisines (navigation sans recharger le chapitre). */
export async function plancheApi(
	chapterId: number,
	index: number
): Promise<
	| (PlancheApi & {
			chapter: { id: number; series: string; chapter_number: number; title: string | null };
			total: number;
			prev: string | null;
			next: string | null;
	  })
	| null
> {
	const ch = await chapitreApi(chapterId);
	if (!ch) return null;
	// L'adresse publique est d'abord le RANG de lecture. Le numéro imprimé ne
	// sert de repli qu'en dehors de cette plage : dans un tome contenant à la
	// fois `000` puis `001`, chercher le numéro imprimé en premier faisait pointer
	// `/planche/1` vers la 42e image au lieu de la couverture.
	const p = resolveMangaPage(ch.planches, index);
	if (!p) return null;
	const rang = p.index;
	return {
		...p,
		chapter: {
			id: ch.id,
			series: ch.series,
			chapter_number: ch.chapter_number,
			title: ch.title,
		},
		total: ch.pages,
		prev: rang > 1 ? `${SITE_URL}/api/manga/chapter/${ch.id}/planche/${rang - 1}` : null,
		next: rang < ch.pages ? `${SITE_URL}/api/manga/chapter/${ch.id}/planche/${rang + 1}` : null,
	};
}

export type TomeApi = MangaVolume & {
	href: string;
	api: string;
	cover_image: string | null;
	chapters: Array<{
		id: number;
		chapter_number: number;
		title: string | null;
		series: string;
		pages: number;
		href: string;
		api: string;
	}>;
};

/** Tome + ses chapitres, chacun avec son adresse d'API. */
export async function tomeApi(id: number): Promise<TomeApi | null> {
	const v = await dbUniverse.mangaVolume(id);
	if (!v) return null;
	return {
		...v,
		cover_image: v.cover ? assetUrl(v.cover) : null,
		href: `${SITE_URL}/wiki/manga/volume/${v.id}`,
		api: `${SITE_URL}/api/manga/volume/${v.id}`,
		chapters: (v.chapters ?? []).map((c) => ({
			id: c.id,
			chapter_number: c.chapter_number,
			title: c.title,
			series: c.series,
			pages: Array.isArray(c.pages) ? c.pages.length : 0,
			href: `${SITE_URL}/wiki/manga/${c.id}`,
			api: `${SITE_URL}/api/manga/chapter/${c.id}`,
		})),
	};
}

export type ResultatPlanche = {
	series: string;
	tome: string;
	planche: number;
	extrait: string;
	snippet: string;
	chapter_id: number | null;
	href: string | null;
	api: string | null;
	/** Pertinence 0–100 (expression exacte, mots présents, fréquence, trigrammes). */
	score: number;
	/** Scan de la planche, quand le chapitre du site la contient. */
	image: string | null;
	/** Rang de lecture dans le chapitre (adresse du lecteur), `null` si inconnu. */
	rang: number | null;
};

export type OptionsRecherchePlanches = {
	limit?: number;
	offset?: number;
	page?: number;
	series?: string;
	tome?: string;
	surligner?: boolean;
};

export type OptionsTotalPlanches = {
	series?: string;
	tome?: string;
};

/** Seuil de similarité de trigrammes retenu pour le rappel (mesuré, cf. module de règles). */
const SEUIL_TRIGRAMMES = 0.45;

/**
 * Nombre total de planches correspondant à la requête dans les transcriptions,
 * avec prise en compte des filtres par série (DB/DBS) et tome.
 */
export async function totalPlanchesPourRequete(
	q: string,
	options?: OptionsTotalPlanches
): Promise<number> {
	const terme = q.trim().slice(0, 120);
	if (terme.length < 2) return 0;

	const filtreSeries = options?.series ? options.series.trim().toUpperCase() : null;
	const filtreTome = options?.tome ? options.tome.trim().toLowerCase() : null;

	const conditionsSql: SQL[] = [];
	if (filtreSeries) conditionsSql.push(sql`series = ${filtreSeries}`);
	if (filtreTome) {
		if (/^\d+$/.test(filtreTome)) {
			conditionsSql.push(
				sql`(lower(tome) = ${filtreTome} OR lower(tome) = ${"vol" + filtreTome} OR lower(tome) = ${"ch" + filtreTome})`
			);
		} else {
			conditionsSql.push(sql`lower(tome) = ${filtreTome}`);
		}
	}

	if (estCjk(terme)) {
		const segments = terme
			.split(/[\s　、。！？・「」『』（）～〜【】\p{P}\p{S}]+/gu)
			.filter((s) => s.length >= 1);
		if (segments.length === 0) return 0;

		const cjkConds: SQL[] = [];
		if (segments.length <= 1) {
			const clean = (segments[0] || terme).trim();
			cjkConds.push(sql`text LIKE ${"%" + clean + "%"}`);
		} else {
			const clauses = segments.map((s) => sql`text LIKE ${"%" + s + "%"}`);
			cjkConds.push(sql`(${sql.join(clauses, sql` OR `)})`);
		}
		cjkConds.push(...conditionsSql);

		const rows = await db.execute<{ total: number }>(sql`
			SELECT count(*)::int AS total
			FROM bot.db_manga_pages
			WHERE ${sql.join(cjkConds, sql` AND `)}
		`);
		return Number(rows[0]?.total ?? 0);
	}

	const norm =
		normaliser(terme).replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "") || normaliser(terme);
	const texte = await sansAccents(sql`text`);
	const nonCjkConds = [
		sql`text IS NOT NULL`,
		sql`(${texte} LIKE ${"%" + norm + "%"} OR ${norm} <% ${texte})`,
		...conditionsSql,
	];

	return db.transaction(async (tx) => {
		await tx.execute(sql.raw(`SET LOCAL pg_trgm.word_similarity_threshold = ${SEUIL_TRIGRAMMES}`));
		const rows = await tx.execute<{ total: number }>(sql`
			SELECT count(*)::int AS total
			FROM bot.db_manga_pages
			WHERE ${sql.join(nonCjkConds, sql` AND `)}
		`);
		return Number(rows[0]?.total ?? 0);
	});
}

/**
 * Recherche dans les transcriptions, classée par pertinence, rendue en PLANCHES
 * adressables — avec leur image.
 *
 * Deux temps. Le RAPPEL en SQL : similarité de trigrammes sur le texte sans
 * accents (tolère « KAMÉHAMÉHA », « KAMEHAME HA », les fautes), ou sous-chaîne
 * pour le japonais que les trigrammes ne découpent pas. Le CLASSEMENT ensuite,
 * dans `manga-search-rules` : expression exacte, couverture des mots,
 * fréquence. L'ancienne version (`ILIKE` trié par tome) trouvait 3 planches
 * pour « kamehameha » et les rendait dans l'ordre de rangement, pas de
 * pertinence.
 *
 * Le contrat historique (`series`, `tome`, `planche`, `extrait`, `chapter_id`,
 * `href`, `api`) est conservé : le serveur MCP (`manga_recherche`) le consomme.
 */
export async function chercherPlanches(
	q: string,
	optionsOuLimit: number | OptionsRecherchePlanches = 20
): Promise<ResultatPlanche[]> {
	const terme = q.trim().slice(0, 120);
	if (terme.length < 2) return [];

	const options: OptionsRecherchePlanches =
		typeof optionsOuLimit === "number" ? { limit: optionsOuLimit } : optionsOuLimit;

	const limit = Number(options.limit ?? 20);
	const max = Math.min(Math.max(Number.isFinite(limit) ? limit : 20, 1), 100);
	const offset = Math.max(
		0,
		Number(options.offset ?? (options.page ? Math.max(0, (options.page - 1) * max) : 0))
	);
	const surligner = Boolean(options.surligner);
	const filtreSeries = options.series ? options.series.trim().toUpperCase() : null;
	const filtreTome = options.tome ? options.tome.trim().toLowerCase() : null;

	const conditionsSql: SQL[] = [];
	if (filtreSeries) conditionsSql.push(sql`series = ${filtreSeries}`);
	if (filtreTome) {
		if (/^\d+$/.test(filtreTome)) {
			conditionsSql.push(
				sql`(lower(tome) = ${filtreTome} OR lower(tome) = ${"vol" + filtreTome} OR lower(tome) = ${"ch" + filtreTome})`
			);
		} else {
			conditionsSql.push(sql`lower(tome) = ${filtreTome}`);
		}
	}

	// Candidats élargis : le classement JS doit avoir de quoi reclasser et paginer.
	const candidats = Math.min(1000, Math.max(100, (offset + max) * 4));
	const norm =
		normaliser(terme).replace(/^[\p{P}\p{S}\s]+|[\p{P}\p{S}\s]+$/gu, "") || normaliser(terme);

	const rows = estCjk(terme)
		? await (async () => {
				const segments = terme
					.split(/[\s　、。！？・「」『』（）～〜【】\p{P}\p{S}]+/gu)
					.filter((s) => s.length >= 1);
				if (segments.length <= 1) {
					const clean = (segments[0] || terme).trim();
					const cjkClauses = [sql`text LIKE ${"%" + clean + "%"}`, ...conditionsSql];
					return db.execute<{
						series: string;
						tome: string;
						planche: number;
						text: string;
						sim: number;
					}>(sql`
						SELECT series, tome, planche, text, 1.0::float8 AS sim
						FROM bot.db_manga_pages
						WHERE ${sql.join(cjkClauses, sql` AND `)}
						LIMIT ${candidats}
					`);
				}
				const clauses = segments.map((s) => sql`text LIKE ${"%" + s + "%"}`);
				const cjkClauses = [sql`(${sql.join(clauses, sql` OR `)})`, ...conditionsSql];
				return db.execute<{
					series: string;
					tome: string;
					planche: number;
					text: string;
					sim: number;
				}>(sql`
					SELECT series, tome, planche, text, 1.0::float8 AS sim
					FROM bot.db_manga_pages
					WHERE ${sql.join(cjkClauses, sql` AND `)}
					LIMIT ${candidats}
				`);
			})()
		: await (async () => {
				const texte = await sansAccents(sql`text`);
				const nonCjkClauses = [
					sql`text IS NOT NULL`,
					sql`(${texte} LIKE ${"%" + norm + "%"} OR ${norm} <% ${texte})`,
					...conditionsSql,
				];
				// `<%` est l'opérateur que l'index GIN sait servir, mais il applique
				// `pg_trgm.word_similarity_threshold` (0,6 par défaut) : trop strict,
				// les fautes de frappe tombent entre 0,45 et 0,6. `SET LOCAL` fixe le
				// seuil mesuré pour CETTE transaction seulement — jamais pour les
				// autres requêtes qui partagent la connexion du pool.
				return db.transaction(async (tx) => {
					await tx.execute(
						sql.raw(`SET LOCAL pg_trgm.word_similarity_threshold = ${SEUIL_TRIGRAMMES}`)
					);
					return tx.execute<{
						series: string;
						tome: string;
						planche: number;
						text: string;
						sim: number;
					}>(sql`
						SELECT series, tome, planche, text,
							word_similarity(${norm}, ${texte})::float8 AS sim
						FROM bot.db_manga_pages
						WHERE ${sql.join(nonCjkClauses, sql` AND `)}
						ORDER BY sim DESC
						LIMIT ${candidats}
					`);
				});
			})();

	const classes = rows
		.map((r) => ({ r, d: scorer(r.text, terme, Number(r.sim) || 0) }))
		.filter((x) => x.d.score > 0)
		.toSorted(
			(a, b) =>
				b.d.score - a.d.score ||
				a.r.series.localeCompare(b.r.series) ||
				a.r.tome.localeCompare(b.r.tome) ||
				Number(a.r.planche) - Number(b.r.planche)
		)
		.slice(offset, offset + max);

	// Résolution des coordonnées OCR vers un chapitre du site : `vol{N}` → le
	// chapitre DB de numéro N, `ch{id}` → le chapitre d'identifiant id.
	const numerosDb = [
		...new Set(
			classes
				.filter((x) => x.r.series === "DB" && /^vol\d+$/.test(x.r.tome))
				.map((x) => Number(x.r.tome.slice(3)))
		),
	];
	const idsDbs = [
		...new Set(
			classes.filter((x) => /^ch\d+$/.test(x.r.tome)).map((x) => Number(x.r.tome.slice(2)))
		),
	];
	const chapitres = new Map<string, { id: number; pages: string[] }>();
	if (numerosDb.length > 0 || idsDbs.length > 0) {
		const chaps = await db.execute<{
			id: number;
			series: string;
			chapter_number: number;
			pages: string[] | null;
		}>(sql`
			SELECT id, series, chapter_number, pages FROM bot.db_manga_chapters
			WHERE (series = 'DB' AND chapter_number = ANY(${sql.raw(
				`ARRAY[${numerosDb.join(",") || "NULL"}]::int[]`
			)}))
			OR id = ANY(${sql.raw(`ARRAY[${idsDbs.join(",") || "NULL"}]::int[]`)})
		`);
		for (const c of chaps) {
			const pages = Array.isArray(c.pages) ? c.pages : [];
			const cle = c.series === "DB" ? `DB:vol${c.chapter_number}` : `ch${c.id}`;
			chapitres.set(cle, { id: Number(c.id), pages });
		}
	}

	return classes.map(({ r, d }) => {
		const cle = r.series === "DB" ? `DB:${r.tome}` : r.tome;
		const chap = chapitres.get(cle) ?? null;
		const numero = Number(r.planche);
		// Le numéro OCR est celui du FICHIER ; le lecteur parle en rang. On
		// retrouve le fichier pour produire une adresse qui tombe juste.
		const idx = chap
			? chap.pages.findIndex((chemin, i) => numeroDePlanche(chemin, i) === numero)
			: -1;
		const rang = idx >= 0 ? idx + 1 : null;
		const chapterId = chap?.id ?? null;
		const extraitBrut = extraitAutour(r.text, terme);
		const extraitSurligne = extraitAutour(r.text, terme, { surligner: true });

		return {
			series: r.series,
			tome: r.tome,
			planche: numero,
			extrait: surligner ? extraitSurligne : extraitBrut,
			snippet: extraitSurligne,
			chapter_id: chapterId,
			href: chapterId ? `${SITE_URL}/wiki/manga/${chapterId}?planche=${rang ?? numero}` : null,
			api: chapterId
				? `${SITE_URL}/api/manga/chapter/${chapterId}/planche/${rang ?? numero}`
				: null,
			score: d.score,
			image: chap && idx >= 0 ? assetUrl(chap.pages[idx]!) : null,
			rang,
		};
	});
}

/** Une bulle traduite publiée par le bot pour une planche. */
export type TraductionTexte = {
	id: number | string;
	readingOrder: number;
	sourceText: string;
	translatedText: string;
	bounds?: { x: number; y: number; width: number; height: number } | null;
};

export type TraductionPlanche = { pageId: string; texts: TraductionTexte[] };

/**
 * Identifiant de page Shenron (`série:tome:planche`) de la planche `(chapitre, rang)`,
 * la clé que le bot attend pour ses traductions. `null` hors séries couvertes.
 */
export async function pageIdDePlanche(chapterId: number, index: number): Promise<string | null> {
	const ch = await chapitreApi(chapterId);
	if (!ch) return null;
	const cle = cleTomeOcr(ch);
	const p = resolveMangaPage(ch.planches, index);
	if (!cle || !p) return null;
	// Même clé que le pipeline Koharu et le bot : `DB:vol1:3`, `DBS:ch12:4`.
	return `${cle.series}:${cle.tome}:${p.planche}`;
}

/**
 * Traductions FR publiées d'une planche, lues sur l'API publique du bot
 * (`GET /api/manga/planche/:pageId/traduction`). `null` quand rien n'est publié.
 */
export async function traductionPlanche(
	chapterId: number,
	index: number
): Promise<TraductionPlanche | null> {
	const pageId = await pageIdDePlanche(chapterId, index);
	if (pageId == null) return null;
	try {
		const res = await fetch(`${BOT_API_URL}/api/manga/planche/${encodeURIComponent(pageId)}/traduction`, {
			headers: { accept: "application/json" },
			next: { revalidate: 300 },
		});
		if (!res.ok) return null;
		// Le bot répond `{data: {pairs: [...]}}` (PublishedMangaTranslation).
		const body = (await res.json()) as {
			data?: {
				pairs?: Array<{
					regionId: string;
					textId: string | null;
					readingOrder: number | null;
					sourceText: string | null;
					translatedText: string;
				}>;
			};
		};
		const pairs = Array.isArray(body.data?.pairs) ? body.data.pairs : [];
		const texts: TraductionTexte[] = pairs.map((pair, i) => ({
			id: pair.textId ?? pair.regionId,
			readingOrder: pair.readingOrder ?? i,
			sourceText: pair.sourceText ?? "",
			translatedText: pair.translatedText,
		}));
		if (texts.length === 0) return null;
		return { pageId, texts: texts.toSorted((a, b) => a.readingOrder - b.readingOrder) };
	} catch (e) {
		console.error("[manga-api] traduction indisponible:", e);
		return null;
	}
}
