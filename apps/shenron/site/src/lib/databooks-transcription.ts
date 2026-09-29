import "server-only";

import { readFile, readdir, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Transcriptions de databooks — suivi de progression et recherche des planches.
 *
 * Deux besoins que la rubrique ne couvrait pas :
 *
 *  1. **Suivre.** La progression n'existait nulle part : le tableau
 *     `/admin/db-universe/databooks` affiche un total de planches, pas ce qui
 *     est transcrit, ni où il reste du travail, ni à quel rythme il avance.
 *  2. **Chercher.** Le texte des planches vit dans le jsonb `pages` et
 *     n'était atteignable par aucune requête — mesuré le 2026-08-22, une phrase
 *     japonaise pourtant présente dans une planche remontait 0 résultat.
 *     `bot.databook_pages_text()` + l'index trigramme `db_databooks_pages_text_trgm`
 *     (cf. `src/db/bot-indexes.sql`) y répondent ; ce module est leur seul appelant.
 *
 * Les compteurs éditoriaux sont agrégés côté Postgres. Charger toutes les
 * planches en mémoire pour les compter en JavaScript serait inutilement coûteux
 * à chaque mesure live.
 */
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/** Progression d'un ouvrage. */
export interface ProgressionFiche {
	id: number;
	titre: string;
	titreJa: string | null;
	categorie: string | null;
	kind: string;
	cover: string | null;
	visible: boolean;
	planches: number;
	transcrites: number;
	traduites: number;
	avecImage: number;
	/**
	 * Planches portant une signature mécanique d'échec du modèle : caractère de
	 * remplacement, alphabet halluciné (cyrillique/arabe/thaï/coréen), ou
	 * idéogrammes sans un seul kana. Même définition que `classerDefaut`
	 * (`databooks-defauts.ts`) — au détail près de la BOUCLE, qui demande un
	 * back-reference que Postgres met plus de 5 minutes à évaluer sur les 11 778
	 * planches (mesuré) : elle est détectée côté relecteur, pas dans ce total.
	 *
	 * Les planches acquittées à la main (`verifiee`) en sont exclues : le juge
	 * est mécanique, le relecteur qui a comparé le texte au scan tranche.
	 * Ce total couvre les signaux durs calculables en SQL ; le lecteur de
	 * relecture ajoute les textes trop courts et les répétitions, qui restent
	 * volontairement hors de cette agrégation globale coûteuse.
	 */
	fautives: number;
	/** Signes de texte transcrit, tous slots confondus. */
	signes: number;
	/** Dernier dépôt ou édition connu (via `public.wiki_revisions`). */
	derniereEdition: Date | null;
}

export interface ProgressionGlobale {
	fiches: ProgressionFiche[];
	total: {
		fiches: number;
		planches: number;
		transcrites: number;
		traduites: number;
		avecImage: number;
		fautives: number;
		signes: number;
	};
	/** Nombre de planches transcrites par jour, du plus ancien au plus récent. */
	rythme: { jour: string; revisions: number }[];
}

export interface MangaUploadSerie {
	serie: string;
	chapitres: number;
	chapitresAvecPages: number;
	planches: number;
}

/** État réellement publié dans `bot.db_manga_chapters` / `db_manga_pages`. */
export interface MangaUploadStatus {
	series: MangaUploadSerie[];
	chapitres: number;
	chapitresAvecPages: number;
	planches: number;
	ocrPlanches: number;
	ocrPlanchesAvecTexte: number;
}

type EtatPipelineLocal = "actif" | "arrêté" | "absent";

interface OcrDatabooksLocal {
	etat: Exclude<EtatPipelineLocal, "absent">;
	genereLe: Date | null;
	derniereActivite: Date | null;
	expected: number;
	images: number;
	resultats: number;
	textes: number;
	restant: number;
	lotActif: string | null;
	runnerPid: number | null;
	gpu: { nom: string; memoireUtilisee: string; memoireTotale: string; utilisation: string } | null;
}

interface OcrMangaLocal {
	etat: Exclude<EtatPipelineLocal, "absent">;
	runId: string;
	genereLe: Date | null;
	pages: number;
	resultats: number;
	textes: number;
	restant: number;
	aRelire: number;
	lots: number;
}

export interface EtatPipelinesLocaux {
	databooks: OcrDatabooksLocal | null;
	manga: OcrMangaLocal | null;
}

type JsonMap = Record<string, any>;

async function jsonLocal<T extends JsonMap>(chemin: string): Promise<T | null> {
	try {
		return JSON.parse(await readFile(chemin, "utf8")) as T;
	} catch {
		return null;
	}
}

async function dossierLocal(...parties: string[]): Promise<string | null> {
	const cwd = process.cwd();
	const candidats = [
		join(/* turbopackIgnore: true */ cwd, ...parties),
		join(/* turbopackIgnore: true */ cwd, "..", ...parties),
		join(/* turbopackIgnore: true */ cwd, "..", "..", ...parties),
	];
	for (const chemin of candidats) {
		try {
			if ((await stat(chemin)).isDirectory()) return chemin;
		} catch {
			// Le site déployé ne possède pas nécessairement les artefacts du poste local.
		}
	}
	return null;
}

function pidVivant(pid: number | null): boolean {
	if (!pid || !Number.isInteger(pid) || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

function dateJson(valeur: unknown): Date | null {
	if (typeof valeur !== "string" || !valeur) return null;
	const date = new Date(valeur);
	return Number.isNaN(date.valueOf()) ? null : date;
}

function nombre(valeur: unknown): number {
	return typeof valeur === "number" && Number.isFinite(valeur) ? valeur : Number(valeur ?? 0) || 0;
}

function nomFichier(chemin: string): string {
	return chemin.split(/[\\/]/).pop()?.toLowerCase() ?? chemin.toLowerCase();
}

async function statistiquesJsonl(chemins: string[]): Promise<{
	resultats: number;
	textes: number;
	aRelire: number;
}> {
	const vus = new Set<string>();
	let resultats = 0;
	let textes = 0;
	let aRelire = 0;
	for (const chemin of chemins) {
		let contenu: string;
		try {
			contenu = await readFile(chemin, "utf8");
		} catch {
			continue;
		}
		for (const ligne of contenu.split(/\r?\n/)) {
			if (!ligne.trim()) continue;
			try {
				const resultat = JSON.parse(ligne) as JsonMap;
				const image = typeof resultat.image === "string" ? nomFichier(resultat.image) : null;
				if (!image || vus.has(image)) continue;
				vus.add(image);
				resultats++;
				const texte = resultat.text as JsonMap | undefined;
				if (
					texte?.kind === "text" ||
					(typeof texte?.markdown === "string" && texte.markdown.trim())
				)
					textes++;
				const audit = resultat.coverageAudit as JsonMap | undefined;
				if (audit?.verdict === "needs_human") aRelire++;
			} catch {
				// Une ligne invalide ne devient jamais un résultat publié.
			}
		}
	}
	return { resultats, textes, aRelire };
}

async function fichiersResultats(racineRun: string, nom: string): Promise<string[]> {
	try {
		const entrees = await readdir(racineRun, { withFileTypes: true });
		return entrees
			.filter((entree) => entree.isDirectory() && /^lot-\d+$/.test(entree.name))
			.map((entree) => join(racineRun, entree.name, nom));
	} catch {
		return [];
	}
}

/**
 * Lit les campagnes locales sans les confondre avec la vérité PostgreSQL.
 * Les dossiers sont gitignored : en production, `null` est un état explicite,
 * pas un zéro inventé.
 */
export async function etatPipelinesLocaux(): Promise<EtatPipelinesLocaux> {
	const databooksRoot = await dossierLocal("data", "sj-ocr");
	let databooks: OcrDatabooksLocal | null = null;
	if (databooksRoot) {
		const status = await jsonLocal<JsonMap>(join(databooksRoot, "ocr-status.json"));
		const lots = await readdir(/* turbopackIgnore: true */ databooksRoot, { withFileTypes: true }).catch(() => []);
		let expected = 0;
		let images = 0;
		const resultatsPaths: string[] = [];
		for (const lot of lots) {
			if (!lot.isDirectory() || !/^lot-\d+$/.test(lot.name)) continue;
			const manifeste = await jsonLocal<JsonMap>(
				join(databooksRoot, lot.name, "manifeste.ocr.json")
			);
			expected += nombre(manifeste?.counts?.expected);
			images += nombre(manifeste?.counts?.imagesOnDisk);
			resultatsPaths.push(join(databooksRoot, lot.name, "resultats.jsonl"));
		}
		const stats = await statistiquesJsonl(resultatsPaths);
		const logPath = join(databooksRoot, "ocr-monitor.log");
		let derniereActivite: Date | null = null;
		try {
			derniereActivite = (await stat(logPath)).mtime;
		} catch {
			// Pas de journal local.
		}
		const runnerPid = nombre(status?.runner?.process?.[0]) || null;
		databooks = {
			etat: pidVivant(runnerPid) ? "actif" : "arrêté",
			genereLe: dateJson(status?.generatedAt),
			derniereActivite,
			expected: expected || nombre(status?.progress?.expected),
			images: images || nombre(status?.progress?.images),
			resultats: stats.resultats || nombre(status?.progress?.results),
			textes: stats.textes || nombre(status?.progress?.text),
			restant: Math.max(
				0,
				(expected || nombre(status?.progress?.expected)) -
					(stats.resultats || nombre(status?.progress?.results))
			),
			lotActif: pidVivant(runnerPid)
				? typeof status?.runner?.activeLot === "string"
					? status.runner.activeLot
					: null
				: null,
			runnerPid,
			gpu: status?.gpu
				? {
						nom: String(status.gpu.name ?? "GPU local"),
						memoireUtilisee: String(status.gpu.memoryUsed ?? "—"),
						memoireTotale: String(status.gpu.memoryTotal ?? "—"),
						utilisation: String(status.gpu.utilization ?? "—"),
					}
				: null,
		};
	}

	const mangaRoot = await dossierLocal("data", "manga-ocr");
	let manga: OcrMangaLocal | null = null;
	if (mangaRoot) {
		const current = await jsonLocal<JsonMap>(join(mangaRoot, "current.json"));
		const manifesteRelatif = typeof current?.manifest === "string" ? current.manifest : null;
		if (manifesteRelatif) {
			const manifestePath = join(/* turbopackIgnore: true */ mangaRoot, manifesteRelatif);
			const manifeste = await jsonLocal<JsonMap>(manifestePath);
			const runRoot = dirname(manifestePath);
			const stats = await statistiquesJsonl(await fichiersResultats(runRoot, "results.jsonl"));
			const pages = nombre(manifeste?.pages) || nombre(current?.pages);
			let genereLe = dateJson(manifeste?.generatedAt) ?? dateJson(current?.generatedAt);
			try {
				const courant = await stat(runRoot);
				genereLe ??= courant.mtime;
			} catch {
				// Manifest absent ou supprimé entre deux lectures.
			}
			const owner = await jsonLocal<JsonMap>(join(mangaRoot, ".manga-ocr.lock", "owner.json"));
			const ownerPid = nombre(owner?.pid) || null;
			manga = {
				etat: pidVivant(ownerPid) ? "actif" : "arrêté",
				runId: String(current?.runId ?? manifeste?.runId ?? "local"),
				genereLe,
				pages,
				resultats: stats.resultats,
				textes: stats.textes,
				restant: Math.max(0, pages - stats.resultats),
				aRelire: stats.aRelire,
				lots: nombre(manifeste?.lots) || nombre(current?.lots),
			};
		}
	}
	return { databooks, manga };
}

/** Compteurs d'uploads manga issus de PostgreSQL, pas du disque local. */
export async function mangaUploadStatus(): Promise<MangaUploadStatus> {
	const [series, ocr] = await Promise.all([
		db.execute<{
			serie: string;
			chapitres: number;
			chapitres_avec_pages: number;
			planches: number;
		}>(sql`
			SELECT coalesce(c.series, '?') AS serie,
			       count(*)::int AS chapitres,
			       count(*) FILTER (
				       WHERE jsonb_typeof(c.pages) = 'array' AND jsonb_array_length(c.pages) > 0
			       )::int AS chapitres_avec_pages,
			       coalesce(sum(
				       CASE WHEN jsonb_typeof(c.pages) = 'array' THEN jsonb_array_length(c.pages) ELSE 0 END
			       ), 0)::int AS planches
			FROM bot.db_manga_chapters c
			GROUP BY c.series
			ORDER BY c.series
		`),
		db.execute<{ planches: number; planches_avec_texte: number }>(sql`
			SELECT count(*)::int AS planches,
			       count(*) FILTER (WHERE nullif(btrim(text), '') IS NOT NULL)::int AS planches_avec_texte
			FROM bot.db_manga_pages
		`),
	]);

	const lignes = series.map((ligne) => ({
		serie: ligne.serie,
		chapitres: Number(ligne.chapitres),
		chapitresAvecPages: Number(ligne.chapitres_avec_pages),
		planches: Number(ligne.planches),
	}));
	return {
		series: lignes,
		chapitres: lignes.reduce((n, ligne) => n + ligne.chapitres, 0),
		chapitresAvecPages: lignes.reduce((n, ligne) => n + ligne.chapitresAvecPages, 0),
		planches: lignes.reduce((n, ligne) => n + ligne.planches, 0),
		ocrPlanches: Number(ocr[0]?.planches ?? 0),
		ocrPlanchesAvecTexte: Number(ocr[0]?.planches_avec_texte ?? 0),
	};
}

/**
 * Progression de toutes les fiches, avec la date de dernière écriture.
 *
 * Une fiche sans aucune planche est incluse : c'est justement le signal qu'il
 * n'y a pas encore de scans à transcrire, et l'écraser dans un filtre
 * masquerait 21 fiches qui n'ont ni planche ni description.
 */
export async function progressionTranscription(): Promise<ProgressionGlobale> {
	const lignes = await db.execute<{
		id: string;
		titre: string;
		titre_ja: string | null;
		categorie: string | null;
		kind: string;
		cover: string | null;
		visible: boolean;
		planches: number;
		transcrites: number;
		traduites: number;
		avec_image: number;
		fautives: number;
		signes: number;
		derniere_edition: Date | null;
	}>(sql`
		SELECT
			d.id,
			d.title            AS titre,
			d.title_ja         AS titre_ja,
			d.category         AS categorie,
			d.kind,
			d.cover,
			coalesce(d.visible, true) AS visible,
			coalesce(jsonb_array_length(
				CASE WHEN jsonb_typeof(d.pages) = 'array' THEN d.pages ELSE '[]'::jsonb END
			), 0)::int AS planches,
			count(p) FILTER (WHERE nullif(btrim(p ->> 'text'), '') IS NOT NULL)::int  AS transcrites,
			count(p) FILTER (WHERE nullif(btrim(p ->> 'text_fr'), '') IS NOT NULL)::int AS traduites,
			count(p) FILTER (WHERE nullif(btrim(p ->> 'image'), '') IS NOT NULL)::int AS avec_image,
			count(p) FILTER (
				WHERE coalesce(p ->> 'verifiee', 'false') <> 'true' AND (
				      p ->> 'text' LIKE '%' || U&'\FFFD' || '%'
				   OR p ->> 'text' ~ '[Ѐ-ӿ؀-ۿ฀-๿가-힯]'
				   OR (p ->> 'text' ~ '[一-鿿]' AND p ->> 'text' !~ '[぀-ヿ]'))
			)::int                                                                   AS fautives,
			coalesce(sum(length(p ->> 'text')), 0)::int                               AS signes,
			r.derniere_edition
		FROM bot.db_databooks d
		LEFT JOIN LATERAL jsonb_array_elements(
			CASE WHEN jsonb_typeof(d.pages) = 'array' THEN d.pages ELSE '[]'::jsonb END
		) AS p ON true
		LEFT JOIN LATERAL (
			SELECT max(w."createdAt") AS derniere_edition
			FROM public.wiki_revisions w
			WHERE w."tableName" = 'db_databooks' AND w."rowId" = d.id::text
		) r ON true
		GROUP BY d.id, d.title, d.title_ja, d.category, d.kind, d.cover, d.visible,
		         d.pages, r.derniere_edition
		ORDER BY d.title
	`);

	const fiches: ProgressionFiche[] = lignes.map((l) => ({
		id: Number(l.id),
		titre: l.titre,
		titreJa: l.titre_ja,
		categorie: l.categorie,
		kind: l.kind,
		cover: l.cover,
		visible: l.visible !== false,
		planches: Number(l.planches),
		transcrites: Number(l.transcrites),
		traduites: Number(l.traduites),
		avecImage: Number(l.avec_image),
		fautives: Number(l.fautives),
		signes: Number(l.signes),
		derniereEdition: l.derniere_edition ? new Date(l.derniere_edition) : null,
	}));

	const total = fiches.reduce(
		(acc, f) => ({
			fiches: acc.fiches + 1,
			planches: acc.planches + f.planches,
			transcrites: acc.transcrites + f.transcrites,
			traduites: acc.traduites + f.traduites,
			avecImage: acc.avecImage + f.avecImage,
			fautives: acc.fautives + f.fautives,
			signes: acc.signes + f.signes,
		}),
		{ fiches: 0, planches: 0, transcrites: 0, traduites: 0, avecImage: 0, fautives: 0, signes: 0 }
	);

	return { fiches, total, rythme: await rythmeRecent() };
}

/**
 * Dépôts par jour sur les 30 derniers jours.
 *
 * Compte les **révisions**, pas les planches : `wiki_revisions` garde un
 * instantané complet de la fiche, pas un delta par planche. Un point de la
 * courbe est donc « un lot déposé », l'unité réelle du travail en cours.
 */
async function rythmeRecent(): Promise<{ jour: string; revisions: number }[]> {
	const lignes = await db.execute<{ jour: string; n: number }>(sql`
		SELECT to_char(date_trunc('day', w."createdAt"), 'YYYY-MM-DD') AS jour,
		       count(*)::int AS n
		FROM public.wiki_revisions w
		WHERE w."tableName" = 'db_databooks'
		  AND w."createdAt" >= now() - interval '30 days'
		GROUP BY 1
		ORDER BY 1
	`);
	return lignes.map((l) => ({ jour: l.jour, revisions: Number(l.n) }));
}

/** Une planche qui répond à une recherche. */
interface PlancheTrouvee {
	databookId: number;
	titre: string;
	categorie: string | null;
	cover: string | null;
	numero: number;
	image: string | null;
	texte: string;
}

export interface RechercheResultat {
	items: PlancheTrouvee[];
	/** Planches correspondantes au total (avant `limit`). */
	total: number;
	/** Fiches distinctes concernées. */
	fiches: number;
}

/** Neutralise les jokers `LIKE` d'un terme saisi par l'utilisateur. */
function echapperLike(terme: string): string {
	return terme.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/**
 * Cherche une chaîne dans le texte des planches.
 *
 * Sous-chaîne (`ILIKE`) et non plein texte : le corpus est majoritairement
 * japonais, une langue sans espaces que `to_tsvector` ne sait pas segmenter —
 * il en fait un lexème unique par séquence contiguë, donc chercher un mot
 * interne ne peut rien trouver. L'index trigramme, lui, découpe par caractères.
 *
 * Conséquence assumée : un terme de moins de 3 caractères ne peut pas utiliser
 * l'index (un trigramme en fait 3) et déclenche un balayage. Sur 318 fiches et
 * ~9,5 Mo de texte, la requête reste de l'ordre de la centaine de millisecondes.
 */
export async function chercherDansPlanches(
	terme: string,
	opts: { limit?: number; includeHidden?: boolean; databookId?: number } = {}
): Promise<RechercheResultat> {
	const cible = terme.trim();
	if (!cible) return { items: [], total: 0, fiches: 0 };

	const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
	const motif = `%${echapperLike(cible)}%`;
	const visibles = opts.includeHidden ? sql`true` : sql`coalesce(d.visible, true)`;
	const uneFiche = opts.databookId ? sql`AND d.id = ${opts.databookId}` : sql``;

	const lignes = await db.execute<{
		id: string;
		titre: string;
		categorie: string | null;
		cover: string | null;
		numero: number;
		image: string | null;
		texte: string;
		total: number;
		fiches: number;
	}>(sql`
		WITH candidats AS (
			-- Filtre porté par l'index trigramme : ne déroule les planches que des
			-- fiches qui contiennent réellement le terme.
			SELECT d.id, d.title, d.category, d.cover, d.pages
			FROM bot.db_databooks d
			WHERE ${visibles}
			  ${uneFiche}
			  AND bot.databook_pages_text(d.pages) ILIKE ${motif}
		),
		trouvees AS (
			-- Alias en français : le mapping TypeScript lit titre/categorie.
			-- Sans eux, SELECT t.* sort title/category et les deux champs
			-- arrivaient undefined côté client — vu en production.
			SELECT c.id, c.title AS titre, c.category AS categorie, c.cover,
			       coalesce((p ->> 'number')::int, ord::int) AS numero,
			       nullif(btrim(p ->> 'image'), '') AS image,
			       p ->> 'text' AS texte
			FROM candidats c,
			     LATERAL jsonb_array_elements(c.pages) WITH ORDINALITY AS t(p, ord)
			WHERE p ->> 'text' ILIKE ${motif}
		),
		-- count(DISTINCT ...) OVER () n'existe pas en fenêtre sous PostgreSQL :
		-- les totaux passent par un CTE d'agrégat joint à chaque ligne.
		compte AS (
			SELECT count(*)::int AS total, count(DISTINCT id)::int AS fiches FROM trouvees
		)
		SELECT t.*, c.total, c.fiches
		FROM trouvees t CROSS JOIN compte c
		ORDER BY t.titre, t.numero
		LIMIT ${limit}
	`);

	return {
		items: lignes.map((l) => ({
			databookId: Number(l.id),
			titre: l.titre,
			categorie: l.categorie,
			cover: l.cover,
			numero: Number(l.numero),
			image: l.image,
			texte: l.texte,
		})),
		total: lignes.length > 0 ? Number(lignes[0].total) : 0,
		fiches: lignes.length > 0 ? Number(lignes[0].fiches) : 0,
	};
}
