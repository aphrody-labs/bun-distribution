/**
 * backfill-media-works.ts — Sprint 2 Refonte Média Dragon Ball
 *
 * Associe les 42 tomes du manga original (bot.db_manga_volumes) et leurs
 * chapitres (bot.db_manga_chapters) à l'ontologie unifiée :
 *   - bot.media_works ('dragon-ball')
 *   - bot.media_editions ('tankobon' ja/fr, 'kanzenban', 'full_color')
 *   - bot.media_volumes (avec legacy_volume_id)
 *   - bot.media_chapters (avec legacy_chapter_id)
 *   - bot.media_page_assets (assets dédupliqués avec SHA-256 déterministe)
 *   - bot.media_page_refs (liaison ordonnée chapitre ↔ asset)
 *
 * Zéro suppression physique (visible = false obligatoire).
 * Usage : bun scripts/ops/backfill-media-works.ts [--dry-run]
 */
import { createHash } from "node:crypto";
import postgres from "postgres";

const NEON_URL = process.env.DATABASE_URL;
if (!NEON_URL) {
	console.error("✗ DATABASE_URL requis dans l'environnement.");
	process.exit(1);
}

const isDryRun = process.argv.includes("--dry-run");
const sql = postgres(NEON_URL, { max: 2, prepare: false });

function computeSha256(input: string): string {
	return createHash("sha256").update(input).digest("hex");
}

async function main() {
	console.log(`[Sprint 2 Backfill] Démarrage... Mode: ${isDryRun ? "DRY-RUN (simulation)" : "LIVE"}`);

	// 1. Œuvre pivot : Dragon Ball (Manga original d'Akira Toriyama)
	console.log("→ Ingestion bot.media_works...");
	let workId: number;
	if (isDryRun) {
		workId = 1;
		console.log("  [DRY] media_works 'dragon-ball' simulé");
	} else {
		const [work] = await sql`
			INSERT INTO bot.media_works (
				slug, kind, series, title, title_ja, title_romaji, synopsis_fr, visible
			) VALUES (
				'dragon-ball',
				'manga',
				'DB',
				'Dragon Ball',
				'ドラゴンボール',
				'Doragon Bōru',
				'L''épopée canonique d''Akira Toriyama : la quête des sept Dragon Balls par Son Goku, de sa rencontre avec Bulma jusqu''au départ avec Oob (42 tomes, 519 chapitres).',
				true
			)
			ON CONFLICT (slug) DO UPDATE SET
				title = EXCLUDED.title,
				title_ja = EXCLUDED.title_ja,
				title_romaji = EXCLUDED.title_romaji,
				synopsis_fr = EXCLUDED.synopsis_fr,
				updated_at = now()
			RETURNING id;
		`;
		workId = Number(work.id);
		console.log(`  ✓ media_works 'dragon-ball' prêt (id: ${workId})`);
	}

	// 2. Éditions physiques & numériques de Dragon Ball
	console.log("→ Ingestion bot.media_editions...");
	const EDITIONS_CONFIG = [
		{
			edition: "tankobon",
			label: "Tankōbon N&B Original (42 tomes)",
			language: "ja",
			publisher: "Shūeisha",
			page_color: "nb",
		},
		{
			edition: "tankobon",
			label: "Édition Française Originale (42 tomes Glénat)",
			language: "fr",
			publisher: "Glénat",
			page_color: "nb",
		},
		{
			edition: "kanzenban",
			label: "Édition Kanzenban / Perfect Edition (34 tomes)",
			language: "ja",
			publisher: "Shūeisha",
			page_color: "mixed",
		},
		{
			edition: "full_color",
			label: "Dragon Ball Full Color (32 tomes)",
			language: "ja",
			publisher: "Shūeisha",
			page_color: "color",
		},
	];

	const editionIds: Record<string, number> = {};
	for (const ed of EDITIONS_CONFIG) {
		const key = `${ed.edition}_${ed.language}`;
		if (isDryRun) {
			editionIds[key] = 1;
			console.log(`  [DRY] media_editions ${ed.label}`);
		} else {
			const [existingEd] = await sql`
				SELECT id FROM bot.media_editions
				WHERE work_id = ${workId} AND edition = ${ed.edition} AND language = ${ed.language} AND visible = true
				ORDER BY id ASC LIMIT 1;
			`;

			if (existingEd) {
				editionIds[key] = Number(existingEd.id);
				console.log(`  ✓ media_editions '${key}' existant (id: ${editionIds[key]})`);
			} else {
				const [res] = await sql`
					INSERT INTO bot.media_editions (
						work_id, edition, label, language, publisher, page_color, visible
					) VALUES (
						${workId},
						${ed.edition},
						${ed.label},
						${ed.language},
						${ed.publisher},
						${ed.page_color},
						true
					)
					RETURNING id;
				`;
				editionIds[key] = Number(res.id);
				console.log(`  ✓ media_editions '${key}' créé (id: ${editionIds[key]})`);
			}
		}
	}

	const tankobonFrEditionId = editionIds["tankobon_fr"] ?? 2;
	const fullColorEditionId = editionIds["full_color_ja"] ?? 4;

	// 3. Backfill des tomes 1 à 42 depuis bot.db_manga_volumes
	console.log("→ Récupération des tomes originaux depuis bot.db_manga_volumes...");
	const sourceVolumes = await sql`
		SELECT id, series, volume_number, title, title_ja, cover, isbn
		FROM bot.db_manga_volumes
		WHERE series = 'DB' AND volume_number IS NOT NULL AND volume_number <= 42
		ORDER BY volume_number ASC;
	`;
	console.log(`  Trouvé : ${sourceVolumes.length} tomes à backfiller.`);

	const tankobonVolumeMap: Map<number, number> = new Map(); // legacy_volume_id -> media_volume_id
	const fullColorVolumeMap: Map<number, number> = new Map(); // legacy_volume_id -> media_volume_id
	let insertedVolumes = 0;

	for (const sv of sourceVolumes) {
		const legacyVolId = Number(sv.id);
		const volNum = Number(sv.volume_number);
		const title = sv.title ?? `Tome ${volNum}`;

		if (isDryRun) {
			tankobonVolumeMap.set(legacyVolId, volNum);
			fullColorVolumeMap.set(legacyVolId, volNum + 100);
			insertedVolumes += 2;
		} else {
			// Volume Tankōbon N&B
			const [vRowNb] = await sql`
				INSERT INTO bot.media_volumes (
					edition_id, legacy_volume_id, number, slug, title, cover, visible
				) VALUES (
					${tankobonFrEditionId},
					${legacyVolId},
					${volNum},
					${`db-fr-tome-${volNum}`},
					${title},
					${sv.cover},
					true
				)
				ON CONFLICT (edition_id, number) DO UPDATE SET
					legacy_volume_id = EXCLUDED.legacy_volume_id,
					title = EXCLUDED.title,
					cover = EXCLUDED.cover
				RETURNING id;
			`;
			tankobonVolumeMap.set(legacyVolId, Number(vRowNb.id));

			// Volume Full Color correspondant
			const [vRowColor] = await sql`
				INSERT INTO bot.media_volumes (
					edition_id, number, slug, title, cover, visible
				) VALUES (
					${fullColorEditionId},
					${volNum},
					${`dbfc-fr-tome-${volNum}`},
					${`${title} (Full Color)`},
					${sv.cover},
					true
				)
				ON CONFLICT (edition_id, number) DO UPDATE SET
					title = EXCLUDED.title,
					cover = EXCLUDED.cover
				RETURNING id;
			`;
			fullColorVolumeMap.set(legacyVolId, Number(vRowColor.id));
			insertedVolumes += 2;
		}
	}
	console.log(`  ✓ ${insertedVolumes} volumes backfillés dans bot.media_volumes.`);

	// 4. Backfill des chapitres associés depuis bot.db_manga_chapters
	console.log("→ Récupération des chapitres canoniques...");
	const sourceChapters = await sql`
		SELECT id, volume_id, series, chapter_number, title, pages
		FROM bot.db_manga_chapters
		WHERE volume_id IN (
			SELECT id FROM bot.db_manga_volumes WHERE series = 'DB' AND volume_number <= 42
		)
		ORDER BY chapter_number ASC;
	`;
	console.log(`  Trouvé : ${sourceChapters.length} chapitres à relier.`);

	let insertedChapters = 0;
	let insertedAssets = 0;
	let insertedRefs = 0;

	for (const sc of sourceChapters) {
		const legacyChapterId = Number(sc.id);
		const legacyVolId = Number(sc.volume_id);
		const isColor = sc.series === "DBFC";
		const mediaVolId = isColor ? fullColorVolumeMap.get(legacyVolId) : tankobonVolumeMap.get(legacyVolId);
		if (!mediaVolId) continue;

		const chNum = Number(sc.chapter_number);
		const chSlug = isColor ? `dbfc-ch-${chNum}` : `db-tome-ch-${chNum}`;
		const chTitle = sc.title ?? `Chapitre ${chNum}`;
		const rawPages: string[] = Array.isArray(sc.pages) ? sc.pages : [];

		let mediaChapterId: number;
		if (isDryRun) {
			mediaChapterId = legacyChapterId;
			insertedChapters++;
		} else {
			const [chRow] = await sql`
				INSERT INTO bot.media_chapters (
					volume_id, legacy_chapter_id, number, slug, title, pages, visible
				) VALUES (
					${mediaVolId},
					${legacyChapterId},
					${chNum},
					${chSlug},
					${chTitle},
					${sql.json(rawPages)},
					true
				)
				ON CONFLICT (legacy_chapter_id) DO UPDATE SET
					volume_id = EXCLUDED.volume_id,
					number = EXCLUDED.number,
					slug = EXCLUDED.slug,
					title = EXCLUDED.title,
					pages = EXCLUDED.pages
				RETURNING id;
			`;
			mediaChapterId = Number(chRow.id);
			insertedChapters++;
		}

		// 5. Backfill des assets et des références physiques de pages
		for (let idx = 0; idx < rawPages.length; idx++) {
			const uri = rawPages[idx];
			if (!uri) continue;
			const ordinal = idx + 1;
			const deterministicSha256 = computeSha256(`${uri}:${chNum}:${ordinal}`);

			if (isDryRun) {
				insertedAssets++;
				insertedRefs++;
			} else {
				const [assetRow] = await sql`
					INSERT INTO bot.media_page_assets (
						uri, sha256
					) VALUES (
						${uri},
						${deterministicSha256}
					)
					ON CONFLICT (sha256) DO UPDATE SET
						uri = EXCLUDED.uri
					RETURNING id;
				`;
				const assetId = Number(assetRow.id);
				insertedAssets++;

				await sql`
					INSERT INTO bot.media_page_refs (
						chapter_id, asset_id, ordinal, page_label
					) VALUES (
						${mediaChapterId},
						${assetId},
						${ordinal},
						${`Page ${ordinal}`}
					)
					ON CONFLICT (chapter_id, ordinal) DO UPDATE SET
						asset_id = EXCLUDED.asset_id,
						page_label = EXCLUDED.page_label;
				`;
				insertedRefs++;
			}
		}
	}

	console.log(`  ✓ ${insertedChapters} chapitres reliés dans bot.media_chapters.`);
	console.log(`  ✓ ${insertedAssets} assets enregistrés dans bot.media_page_assets.`);
	console.log(`  ✓ ${insertedRefs} références ordonnées créées dans bot.media_page_refs.`);

	console.log("\n=========================================");
	console.log(" BILAN SPRINT 2 BACKFILL RÉUSSI (FAIT)");
	console.log("=========================================");
	console.log(`- Media Works : 1 ('dragon-ball')`);
	console.log(`- Éditions configurées : ${Object.keys(editionIds).length}`);
	console.log(`- Volumes reliés : ${insertedVolumes}/42 tomes`);
	console.log(`- Chapitres reliés : ${insertedChapters}`);
	console.log(`- Assets physiques dédupliqués (SHA-256) : ${insertedAssets}`);
	console.log(`- Références ordonnées de pages : ${insertedRefs}`);
	console.log("=========================================\n");

	await sql.end();
}

main().catch((err) => {
	console.error("✗ Échec du backfill média :", err);
	process.exit(1);
});
