/**
 * scrape-manga-chapters.ts — Scrape et importe les planches (pages) de scans manga
 * Dragon Ball Super en français depuis scan-vf.net et lelscanfr.com vers Neon
 * (`bot.db_manga_chapters.pages`, colonne jsonb Neon-only).
 *
 * Utilise BXC recon sous le capot pour contourner de manière transparente les
 * protections Cloudflare (méthode d'analyse d'assets / extracteur d'images).
 *
 * Options supportées :
 *   --force       Mettre à jour même si les planches sont déjà présentes.
 *   --limit <N>   Nombre maximum de chapitres à traiter (par défaut: infini).
 *   --chapter <N> Traiter uniquement un chapitre spécifique.
 *
 * Env requis : DATABASE_URL (Neon).
 * Usage : bun apps/bot/scripts/ingest/scrape-manga-chapters.ts [--force] [--limit 10]
 */
import postgres from "postgres";

const NEON_URL = process.env.DATABASE_URL;
if (!NEON_URL) {
	console.error("✗ DATABASE_URL (Neon) requis.");
	process.exit(1);
}

// Arguments CLI
const args = process.argv.slice(2);
const force = args.includes("--force");
const limitArg = args.indexOf("--limit");
const maxChapters = limitArg !== -1 ? Number(args[limitArg + 1]) : Infinity;
const chapterArg = args.indexOf("--chapter");
const targetChapter = chapterArg !== -1 ? Number(args[chapterArg + 1]) : null;

const sql = postgres(NEON_URL, { max: 2, prepare: false });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function runBxcRecon(url: string): Promise<string[]> {
	const proc = Bun.spawn(["bxc", "recon", url, "--profile", "static", "--json"]);
	const output = await new Response(proc.stdout).text();

	try {
		const data = JSON.parse(output);
		if (!data.assets) return [];

		// Filtrer les images d'assets
		return data.assets.filter((a: any) => a.type === "image").map((a: any) => a.url);
	} catch (err) {
		return [];
	}
}

async function scrapeChapter(chapterNum: number): Promise<string[]> {
	// Source 1 : scan-vf.net
	const scanVfUrl = `https://www.scan-vf.net/dragon-ball-super/chapitre-${chapterNum}`;
	console.log(`🔍 [scan-vf.net] Tentative pour le chapitre ${chapterNum}...`);
	try {
		const assets = await runBxcRecon(scanVfUrl);
		const scanUrls = assets.filter((img) => img.includes("/uploads/manga/"));
		if (scanUrls.length > 0) {
			console.log(`   ✓ ${scanUrls.length} pages trouvées sur scan-vf.net`);
			return scanUrls;
		}
	} catch (e) {
		console.log(`   ✗ Échec de récupération sur scan-vf.net`);
	}

	// Source 2 : lelscanfr.com
	const lelscanUrl = `https://lelscanfr.com/manga/dragon-ball-super/${chapterNum}`;
	console.log(`🔍 [lelscanfr.com] Tentative pour le chapitre ${chapterNum}...`);
	try {
		const assets = await runBxcRecon(lelscanUrl);
		const scanUrls = assets.filter((img) => img.includes("/storage/content/"));
		if (scanUrls.length > 0) {
			console.log(`   ✓ ${scanUrls.length} pages trouvées sur lelscanfr.com`);
			return scanUrls;
		}
	} catch (e) {
		console.log(`   ✗ Échec de récupération sur lelscanfr.com`);
	}

	return [];
}

async function main() {
	console.log("🚀 Lancement de l'ingestion des planches manga via BXC...");

	// Récupérer les chapitres DBS correspondants à la trame principale (vols 1 à 23)
	let query = sql`
		SELECT id, chapter_number, title, pages
		FROM bot.db_manga_chapters
		WHERE series = 'DBS'
		  AND volume_id BETWEEN 124 AND 146
	`;

	if (targetChapter !== null) {
		query = sql`${query} AND chapter_number = ${targetChapter}`;
	}

	query = sql`${query} ORDER BY chapter_number`;

	const chapters = (await query) as unknown as {
		id: number;
		chapter_number: number;
		title: string | null;
		pages: string[] | null;
	}[];

	console.log(`📚 ${chapters.length} chapitres DBS trouvés dans la base.`);

	let processed = 0;
	let updated = 0;
	let skipped = 0;

	for (const ch of chapters) {
		if (processed >= maxChapters) {
			console.log(`\n🛑 Limite de ${maxChapters} chapitres atteinte.`);
			break;
		}

		const hasPages = ch.pages && ch.pages.length > 0;
		if (hasPages && !force) {
			skipped++;
			continue;
		}

		console.log(
			`\n📖 Traitement du Chapitre ${ch.chapter_number} ("${ch.title ?? ""}") (ID: ${ch.id})...`
		);

		processed++;
		const pages = await scrapeChapter(ch.chapter_number);

		if (pages.length === 0) {
			console.log(`⚠️ Aucune planche trouvée pour le chapitre ${ch.chapter_number}`);
			continue;
		}

		// Sauvegarder dans la base Neon. La couverture d'un chapitre est sa première
		// planche (convention DB et DBFC) ; posée seulement si elle manque — les 103
		// chapitres DBS étaient sans couverture le 2026-09-13.
		await sql`
			UPDATE bot.db_manga_chapters
			SET pages = ${sql.json(pages)},
				cover = coalesce(nullif(btrim(cover), ''), ${pages[0] ?? null})
			WHERE id = ${ch.id}
		`;
		updated++;
		console.log(
			`✅ Chapitre ${ch.chapter_number} mis à jour dans la base avec ${pages.length} pages.`
		);

		// Respecter les serveurs cibles
		await sleep(2000);
	}

	console.log(
		`\n✨ Ingestion terminée : ${processed} traités, ${updated} mis à jour, ${skipped} sautés.`
	);
	await sql.end();
}

main().catch((err) => {
	console.error("❌ Erreur critique :", err);
	process.exit(1);
});
