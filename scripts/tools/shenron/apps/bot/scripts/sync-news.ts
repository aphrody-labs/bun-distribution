import "reflect-metadata";
import { container } from "tsyringe";
import { DatabaseService } from "~/db/index";
import { NewsService } from "~/services/NewsService";
import { logger } from "~/lib/logger";

const SITEMAP_URL = "https://fr.dragon-ball-official.com/dbos-fr-dynamic-1.xml";
const SOURCE_ID = "dbo-fr";

async function fetchSitemap(url: string): Promise<string[]> {
	const res = await fetch(url);
	if (!res.ok) throw new Error(`Failed to fetch sitemap: ${res.status}`);
	const xml = await res.text();
	const urls: string[] = [];
	const matches = xml.matchAll(
		/<loc>(https:\/\/fr\.dragon-ball-official\.com\/news\/[^<]+)<\/loc>/g
	);
	for (const m of matches) {
		urls.push(m[1]!);
	}
	return urls;
}

async function extractMetadata(url: string) {
	const res = await fetch(url);
	if (!res.ok) return null;
	const html = await res.text();

	const titleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
	const imageMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
	const descMatch = html.match(/<meta property="og:description" content="([^"]+)"/);

	// Heuristique pour la date : l'URL contient souvent l'ID, mais pas la date.
	// On utilise la date du jour si on ne trouve pas mieux, ou on laisse à la DB le soin de gérer.
	// Sur le site officiel, la date est souvent dans le corps du texte.
	// Pour simplifier, on prendra la date de "lastmod" du sitemap si on l'avait parsé plus finement,
	// ou on met Date.now() pour les nouvelles news.

	return {
		title: titleMatch?.[1]?.replace(" | SITE OFFICIEL DRAGON BALL", "") ?? "News Dragon Ball",
		image: imageMatch?.[1] ?? null,
		excerpt: descMatch?.[1]?.trim() ?? null,
		publishedAt: new Date(), // Idéalement à extraire du HTML ou sitemap
	};
}

async function main() {
	logger.info("▶ Starting news synchronization...");
	const urls = await fetchSitemap(SITEMAP_URL);
	logger.info(`  Found ${urls.length} news URLs in sitemap.`);

	const newsService = container.resolve(NewsService);

	// On ne prend que les 5 dernières pour le test/premier run
	const latestUrls = urls.slice(-5);
	let synced = 0;

	for (const url of latestUrls) {
		logger.info(`  Processing ${url}...`);
		const meta = await extractMetadata(url);
		if (meta) {
			await newsService.saveNews({
				sourceId: SOURCE_ID,
				sourceUrl: url,
				title: meta.title,
				titleJa: null,
				excerpt: meta.excerpt,
				category: "official",
				publishedAt: meta.publishedAt,
				image: meta.image,
			});
			synced++;
		}
	}

	logger.info(`✓ Synced ${synced} news items.`);
}

main()
	.then(() => {
		const dbs = container.resolve(DatabaseService);
		return dbs.close();
	})
	.catch((err) => {
		logger.error(`Fatal error: ${err instanceof Error ? err.message : err}`);
		process.exit(1);
	});
