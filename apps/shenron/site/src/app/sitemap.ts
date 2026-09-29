import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";
import { db } from "@/lib/db";
import { posts, wikiPages } from "@/db/schema";
import {
	botEpisodes,
	botMovies,
	botMangaVolumes,
	botMangaChapters,
	botSagas,
	botArcs,
	botGames,
	botCharacters,
	botRaces,
	botTechniques,
	botDatabooks,
	botTransformations,
} from "@/db/bot-schema";
import { and, eq, sql } from "drizzle-orm";
import { publicPostFilter } from "@/lib/posts";
import { getLaunchConfig } from "@/lib/wiki-launch-config";
import { isPathPublic, type AccessSnapshot } from "@/lib/wiki-launch";
import { sitemapDestinations } from "@/lib/site-map";
import { isDatabookIndexable } from "@/lib/databooks-rules";
import { formatCharacterSlug, formatTransformationSlug } from "@/lib/wiki-slugs";
import {
	externalSourceHref,
	listExternalSourceSitemapRecords,
} from "@/lib/external-source-catalog";

export const revalidate = 86400; // Cache le sitemap pendant 24 heures

/**
 * Sitemap **dérivé de la configuration d'accès réelle** (`public."WikiLaunch"`),
 * et non d'une liste écrite en dur.
 *
 * L'ancienne version figeait la liste bêta (episodes/films/manga/chronologie) en
 * constante. Le gating ayant migré en base, les deux ont divergé : au 2026-08-21,
 * `/wiki/sagas` (33 sagas) et `/wiki/jeux` (58 jeux) répondaient 200 en
 * production sans qu'aucune de leurs URL ne figure au sitemap — une centaine de
 * pages publiques invisibles de Google, et une régression garantie à chaque
 * ouverture de rubrique. Ici, ouvrir une rubrique depuis /admin/lancement la fait
 * entrer au sitemap à la revalidation suivante, sans toucher au code.
 *
 * `isPathPublic` est la MÊME fonction que celle qui décide d'émettre un lien
 * dans les pages : ce qu'on déclare à Google est ce qu'un anonyme obtient.
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
	const cfg = await getLaunchConfig().catch(() => null);
	// Sans config lisible, on retombe sur « rien de /wiki » plutôt que de publier
	// des URL qui redirigeraient : un sitemap plein de 307 abîme le crawl.
	const snapshot: AccessSnapshot = cfg ?? { openKeys: [], access: {} };
	const isPublic = (path: string) => isPathPublic(path, snapshot);

	const entries: MetadataRoute.Sitemap = [];
	const push = (
		path: string,
		priority: number,
		changeFrequency: MetadataRoute.Sitemap[number]["changeFrequency"] = "weekly",
		lastModified: Date = new Date()
	) => {
		if (!isPublic(path)) return;
		entries.push({ url: `${SITE_URL}${path}`, lastModified, changeFrequency, priority });
	};

	// ── Pages fixes ───────────────────────────────────────────────────────────
	// Dérivées de `lib/site-map.ts` (lui-même dérivé du registre d'accès), et non
	// plus de deux tableaux écrits à la main. Ces tableaux avaient divergé : ni
	// `/tierlists`, ni `/wiki/modifications`, ni `/wiki/contribuer`, ni
	// `/wiki/tools` n'y figuraient, alors que ces pages répondaient 200. Une
	// rubrique qui s'ouvre depuis /admin/lancement entre désormais au sitemap à la
	// revalidation suivante, sans toucher à ce fichier.
	//
	// `isPathPublic` filtre toujours : une rubrique fermée n'est pas annoncée, et
	// les pages hors registre (mentions légales…) passent telles quelles.
	for (const dest of sitemapDestinations()) {
		push(dest.href === "/" ? "" : dest.href, dest.priority, dest.changeFrequency ?? "weekly");
	}
	// Les mini-jeux sont des pages filles d'une rubrique déjà portée par le
	// registre (`/jeux`) : elles n'ont pas d'entrée propre, mais chacune est une
	// page réelle et indexable.
	for (const p of ["/jeux/2048", "/jeux/bingo", "/jeux/morpion", "/jeux/pfc"]) push(p, 0.4);
	// Onglets du fil d'actualité — une URL par nature d'événement.
	for (const p of ["/news/fil/articles", "/news/fil/discussions"]) {
		push(p, 0.5, "daily");
	}

	// ── Entités ───────────────────────────────────────────────────────────────
	// Chaque bloc est indépendant : une table en échec ne doit pas vider tout le
	// sitemap. `visible` est filtré ici comme dans les pages publiques — un
	// contenu masqué en base ne doit jamais être annoncé à Google.
	const sec = (v: number | null) => (v ? new Date(Number(v) * 1000) : new Date());

	await Promise.all([
		block(entries, isPublic, async () => {
			const rows = await db
				.select({ id: botEpisodes.id, series: botEpisodes.series, airDate: botEpisodes.airDate })
				.from(botEpisodes)
				.where(eq(botEpisodes.visible, true));
			const out: Array<[string, number, Date]> = [];
			const series = new Set<string>();
			for (const r of rows) {
				out.push([`/wiki/episodes/${r.id}`, 0.6, sec(r.airDate)]);
				if (r.series) series.add(r.series);
			}
			for (const s of series) out.push([`/wiki/episodes/serie/${s}`, 0.7, new Date()]);
			return out;
		}),
		block(entries, isPublic, async () => {
			const rows = await db
				.select({ slug: botMovies.slug, releaseDate: botMovies.releaseDate })
				.from(botMovies)
				.where(eq(botMovies.visible, true));
			return rows.map((m) => [`/wiki/films/${m.slug}`, 0.7, sec(m.releaseDate)] as const);
		}),
		block(entries, isPublic, async () => {
			const vols = await db
				.select({ id: botMangaVolumes.id, publishedAt: botMangaVolumes.publishedAt })
				.from(botMangaVolumes)
				.where(eq(botMangaVolumes.visible, true));
			return vols.map((v) => [`/wiki/manga/volume/${v.id}`, 0.6, sec(v.publishedAt)] as const);
		}),
		block(entries, isPublic, async () => {
			const chaps = await db
				.select({ id: botMangaChapters.id, publishedAt: botMangaChapters.publishedAt })
				.from(botMangaChapters)
				.where(eq(botMangaChapters.visible, true));
			return chaps.map((c) => [`/wiki/manga/${c.id}`, 0.6, sec(c.publishedAt)] as const);
		}),
		block(entries, isPublic, async () => {
			const rows = await db
				.select({ slug: botSagas.slug })
				.from(botSagas)
				.where(eq(botSagas.visible, true));
			return rows.map((r) => [`/wiki/sagas/${r.slug}`, 0.7, new Date()] as const);
		}),
		block(entries, isPublic, async () => {
			const rows = await db
				.select({ slug: botArcs.slug })
				.from(botArcs)
				.where(eq(botArcs.visible, true));
			return rows.map((r) => [`/wiki/arcs/${r.slug}`, 0.6, new Date()] as const);
		}),
		block(entries, isPublic, async () => {
			const rows = await db
				.select({ slug: botGames.slug })
				.from(botGames)
				.where(eq(botGames.visible, true));
			return rows.map((r) => [`/wiki/jeux/${r.slug}`, 0.6, new Date()] as const);
		}),
		block(entries, isPublic, async () => {
			const rows = await db
				.select({
					id: botCharacters.id,
					name: botCharacters.name,
					nameJa: botCharacters.nameJa,
					nameRomaji: botCharacters.nameRomaji,
				})
				.from(botCharacters)
				.where(eq(botCharacters.visible, true));
			return rows.map(
				(r) => [`/wiki/personnages/${formatCharacterSlug(r)}`, 0.6, new Date()] as const
			);
		}),
		block(entries, isPublic, async () => {
			const rows = await db
				.select({ slug: botRaces.slug })
				.from(botRaces)
				.where(eq(botRaces.visible, true));
			return rows.map((r) => [`/wiki/races/${r.slug}`, 0.5, new Date()] as const);
		}),
		block(entries, isPublic, async () => {
			const rows = await db
				.select({ slug: botTechniques.slug })
				.from(botTechniques)
				.where(eq(botTechniques.visible, true));
			return rows.map((r) => [`/wiki/techniques/${r.slug}`, 0.5, new Date()] as const);
		}),
		block(entries, isPublic, async () => {
			// Seules les transformations qui ont un ARTICLE ont une page : c'est le
			// même filtre que `generateStaticParams`, sinon on annoncerait à un
			// moteur 58 URL qui n'existent pas. L'index les listait toutes sans
			// qu'aucune n'ait de fiche — 23 articles rédigés restaient invisibles.
			const rows = await db
				.select({ id: botTransformations.id, name: botTransformations.name })
				.from(botTransformations)
				.where(
					and(
						eq(botTransformations.visible, true),
						sql`length(trim(coalesce(${botTransformations.article}, ''))) > 50`
					)
				);
			return rows.map(
				(r) => [`/wiki/transformations/${formatTransformationSlug(r)}`, 0.5, new Date()] as const
			);
		}),
		block(entries, isPublic, async () => {
			// On n'annonce pas une fiche vide. 21 des 318 databooks n'ont ni planche
			// ni description — les lister, c'est promettre à un moteur un contenu
			// qui n'existe pas. `isDatabookIndexable` gouverne aussi le `robots` de
			// la page : le sitemap et la balise disent la même chose, par
			// construction. Le jour où la transcription arrive, la fiche revient.
			const rows = await db
				.select({
					id: botDatabooks.id,
					description: botDatabooks.description,
					pages: botDatabooks.pages,
				})
				.from(botDatabooks)
				.where(eq(botDatabooks.visible, true));
			return rows
				.filter((r) => isDatabookIndexable(r as never))
				.map((r) => [`/wiki/databooks/${r.id}`, 0.5, new Date()] as const);
		}),
		// Journal : `publicPostFilter()` et non `published = true` — un article
		// programmé est « publié » avec une date future, le lister l'exposerait
		// avant l'heure.
		block(entries, isPublic, async () => {
			const rows = await db
				.select({ slug: posts.slug, updatedAt: posts.updatedAt, tags: posts.tags })
				.from(posts)
				.where(publicPostFilter());
			const out: Array<readonly [string, number, Date]> = rows.map(
				(p) => [`/news/${p.slug}`, 0.8, p.updatedAt ? new Date(p.updatedAt) : new Date()] as const
			);
			// Une page de thème n'est référencée que si elle a du contenu.
			const tags = new Set<string>();
			for (const p of rows) for (const t of p.tags ?? []) tags.add(t.toLowerCase());
			for (const tag of tags) {
				out.push([`/news/theme/${encodeURIComponent(tag)}`, 0.5, new Date()] as const);
			}
			return out;
		}),
		// Pages wiki éditoriales (Articles libres, Archives Akira Toriyama, etc.)
		block(entries, isPublic, async () => {
			const rows = await db
				.select({ slug: wikiPages.slug, updatedAt: wikiPages.updatedAt })
				.from(wikiPages);
			return rows.map(
				(p) => [`/wiki/${p.slug}`, 0.7, p.updatedAt ? new Date(p.updatedAt) : new Date()] as const
			);
		}),
		// Every successfully crawled, attributed document gets its own public
		// detail page. The catalogue page alone is insufficient for discovery:
		// these stable URLs let a visitor and a search engine reach the exact
		// source while keeping its original URL and provenance visible.
		block(entries, isPublic, async () => {
			const rows = await listExternalSourceSitemapRecords();
			return rows.map((record) => [externalSourceHref(record.url), 0.4, record.fetchedAt] as const);
		}),
	]);

	return entries;
}

/**
 * Exécute un bloc de collecte et pousse ses URL, en absorbant son échec : une
 * table injoignable ne doit pas amputer le sitemap des autres.
 */
async function block(
	entries: MetadataRoute.Sitemap,
	isPublic: (path: string) => boolean,
	fn: () => Promise<ReadonlyArray<readonly [string, number, Date]>>
): Promise<void> {
	try {
		for (const [path, priority, lastModified] of await fn()) {
			if (!isPublic(path)) continue;
			entries.push({
				url: `${SITE_URL}${path}`,
				lastModified,
				changeFrequency: "weekly",
				priority,
			});
		}
	} catch (error) {
		console.error("[sitemap] bloc ignoré :", error);
	}
}
