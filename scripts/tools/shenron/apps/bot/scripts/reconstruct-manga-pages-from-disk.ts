/**
 * reconstruct-manga-pages-from-disk.ts — Reconstruit `bot.db_manga_chapters.pages`
 * à partir des planches **déjà self-hostées** sur le VPS (`apps/bot/assets/manga/`).
 *
 * Contexte : migration Neon → PostgreSQL local (2026-06-23). La colonne `pages`
 * (jsonb, Neon-only) était absente du réplica SQLite → le seed `bot.*` l'a laissée
 * NULL. Mais les planches WebP sont déjà sur disque (rapatriées par
 * `selfhost-manga-pages.ts`), structurées en `assets/manga/<SERIES>/ch<id>/NNN.webp`.
 * On relit donc le disque pour reconstruire l'index ordonné des pages par chapitre.
 *
 * Format écrit (identique à selfhost-manga-pages.ts) :
 *   pages = ["./assets/manga/<series>/ch<id>/001.webp", "002.webp", …] (triées).
 *   → côté site, `assetUrl()` résout en https://bot.dragonballfr.com/assets/...
 *
 * Seuls les chapitres ayant un dossier non vide sur disque sont réécrits ; les
 * autres gardent `pages = NULL` (ils étaient hotlinkés/externes → données perdues
 * avec Neon, à re-scraper plus tard si besoin).
 *
 * Idempotent. Env requis : DATABASE_URL (PostgreSQL local).
 * Usage : cd apps/bot && bun scripts/reconstruct-manga-pages-from-disk.ts [--dry-run]
 */
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import postgres from "postgres";

const PG_URL = process.env.DATABASE_URL;
if (!PG_URL) {
	console.error("✗ DATABASE_URL (PostgreSQL local) requis.");
	process.exit(1);
}
const DRY = process.argv.includes("--dry-run");

const ASSETS_ROOT = join(import.meta.dir, "..", "assets");
const MANGA_ROOT = join(ASSETS_ROOT, "manga");
const sql = postgres(PG_URL, { max: 2, prepare: false, onnotice: () => {} });

const isImg = (f: string) => /\.(webp|jpe?g|png)$/i.test(f);

/**
 * Reconstruit les pages du **Dragon Ball original** (42 tomes N&B). Modèle :
 * `assets/manga/DB/regular/vol<N>/NNN.webp` = un dossier par tome, et UN chapitre
 * lisible « Tome N » (rattaché au volume `Dragon Ball Vol. N`) porte toutes ses
 * pages (cf. `ingest-dragonball-volumes.ts`). Le seed a recréé les lignes chapitre
 * « Tome N » mais `pages` (Neon-only) est NULL → la grille `/wiki/manga` masque
 * les tomes (elle n'affiche que les volumes ayant ≥1 chapitre lisible). On relit
 * le disque pour réécrire `pages` (+ `cover` si absente). Insère le chapitre s'il
 * manque (défensif). Retourne le nombre de tomes réécrits.
 */
async function reconstructDbRegularVolumes(): Promise<number> {
	const regularRoot = join(MANGA_ROOT, "DB", "regular");
	let volDirs: string[] = [];
	try {
		volDirs = (await readdir(regularRoot, { withFileTypes: true }))
			.filter((d) => d.isDirectory() && /^vol\d+$/.test(d.name))
			.map((d) => d.name);
	} catch {
		return 0; // pas de dossier regular → rien à faire
	}

	// volume_number → id des 42 tomes canoniques « Dragon Ball Vol. N ».
	const vols = await sql<{ id: number | string; volume_number: number | string }[]>`
		SELECT id, volume_number FROM bot.db_manga_volumes WHERE title LIKE 'Dragon Ball Vol. %'`;
	const volIdByNum = new Map(vols.map((v) => [Number(v.volume_number), Number(v.id)]));

	let written = 0;
	for (const dir of volDirs.toSorted((a, b) => Number(a.slice(3)) - Number(b.slice(3)))) {
		const n = Number(dir.slice(3));
		const volId = volIdByNum.get(n);
		if (!volId) {
			console.warn(
				`! regular/vol${n} sur disque mais pas de « Dragon Ball Vol. ${n} » en base — skip`
			);
			continue;
		}
		const files = (await readdir(join(regularRoot, dir)))
			.filter(isImg)
			.toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }));
		if (files.length === 0) continue;
		const pages = files.map((f) => `./assets/manga/DB/regular/${dir}/${f}`);

		if (!DRY) {
			// UPDATE du chapitre « Tome N » existant ; sinon INSERT (modèle ingest).
			const upd = await sql`
				UPDATE bot.db_manga_chapters
				SET pages = ${sql.json(pages)}, cover = COALESCE(cover, ${pages[0]})
				WHERE series = 'DB' AND volume_id = ${volId} AND title = ${`Tome ${n}`}`;
			if (upd.count === 0) {
				await sql`
					INSERT INTO bot.db_manga_chapters (series, chapter_number, title, cover, pages, volume_id)
					VALUES ('DB', ${n}, ${`Tome ${n}`}, ${pages[0]}, ${sql.json(pages)}, ${volId})`;
			}
		}
		written++;
		if (written <= 3 || written % 10 === 0) {
			console.log(`${DRY ? "·" : "✓"} Tome ${n} (vol_id ${volId}) → ${pages.length} pages`);
		}
	}
	console.log(`${written} tomes DB (regular/vol) réécrits`);
	return written;
}

async function main() {
	// Chapitres connus en base (id → series) pour ne réécrire que les ids valides.
	// NB: postgres-js rend les colonnes bigint en STRING → coercer en Number pour
	// que la lookup par id numérique (parsé du nom de dossier `ch<id>`) matche.
	const chapters = await sql<{ id: number | string; series: string }[]>`
		SELECT id, series FROM bot.db_manga_chapters`;
	const seriesById = new Map(chapters.map((c) => [Number(c.id), c.series]));

	// Parcours du disque : assets/manga/<SERIES>/ch<id>/*.webp
	let seriesDirs: string[] = [];
	try {
		seriesDirs = (await readdir(MANGA_ROOT, { withFileTypes: true }))
			.filter((d) => d.isDirectory() && d.name !== "transcripts")
			.map((d) => d.name);
	} catch (e) {
		console.error(`✗ ${MANGA_ROOT} illisible: ${(e as Error).message}`);
		process.exit(1);
	}

	let written = 0;
	let skippedUnknown = 0;
	let totalPages = 0;

	for (const series of seriesDirs) {
		const seriesDir = join(MANGA_ROOT, series);
		const chDirs = (await readdir(seriesDir, { withFileTypes: true }))
			.filter((d) => d.isDirectory() && /^ch\d+$/.test(d.name))
			.map((d) => d.name);

		for (const chName of chDirs) {
			const chId = Number(chName.slice(2));
			const files = (await readdir(join(seriesDir, chName)))
				.filter(isImg)
				.toSorted((a, b) => a.localeCompare(b, undefined, { numeric: true }));
			if (files.length === 0) continue;

			const dbSeries = seriesById.get(chId);
			if (dbSeries === undefined) {
				skippedUnknown++;
				console.warn(`! ch${chId} (${series}) sur disque mais absent de la base — skip`);
				continue;
			}
			// Le chemin utilise la série du dossier disque (= ce qu'a écrit selfhost).
			const pages = files.map((f) => `./assets/manga/${series}/${chName}/${f}`);
			totalPages += pages.length;

			if (!DRY) {
				await sql`UPDATE bot.db_manga_chapters SET pages = ${sql.json(pages)} WHERE id = ${chId}`;
			}
			written++;
			if (written <= 5 || written % 25 === 0) {
				console.log(`${DRY ? "·" : "✓"} ch${chId} (${series}) → ${pages.length} pages`);
			}
		}
	}

	// Pass 2 — Dragon Ball original (42 tomes, modèle un-chapitre-par-volume).
	const tomes = await reconstructDbRegularVolumes();

	const [{ withpages }] = await sql`
		SELECT count(*)::int AS withpages FROM bot.db_manga_chapters
		WHERE pages IS NOT NULL AND jsonb_array_length(pages) > 0`;
	void tomes;

	console.log(
		`\n${written} chapitres réécrits · ${totalPages} pages · ${skippedUnknown} dossiers inconnus`
	);
	console.log(`base : ${withpages} chapitres avec pages non vides${DRY ? " (avant dry-run)" : ""}`);

	await sql.end();
	console.log(`✓ Reconstruction manga pages depuis disque${DRY ? " (dry-run)" : ""} terminée.`);
}

main().catch((e) => {
	console.error(e);
	process.exit(1);
});
