import { singleton, inject } from "tsyringe";
import type { Message } from "discord.js";
import { DatabaseService } from "~/db/index";
import { dbNews } from "~/db/schema";
import { logger } from "~/lib/logger";
import { eq, desc } from "drizzle-orm";

const NEWS_TITLE_MAX = 140;
const NEWS_EXCERPT_MAX = 600;

export interface DBNews {
	id: number;
	sourceId: string;
	sourceUrl: string;
	title: string;
	titleJa: string | null;
	excerpt: string | null;
	category: string | null;
	publishedAt: Date;
	fetchedAt: Date;
	image: string | null;
}

@singleton()
export class NewsService {
	constructor(@inject(DatabaseService) private dbs: DatabaseService) {}

	private get db() {
		return this.dbs.db;
	}

	async getLatestNews(limit = 10): Promise<DBNews[]> {
		return this.db
			.select()
			.from(dbNews)
			.orderBy(desc(dbNews.publishedAt))
			.limit(limit) as unknown as Promise<DBNews[]>;
	}

	async saveNews(news: Omit<DBNews, "id" | "fetchedAt">) {
		try {
			await this.db
				.insert(dbNews)
				.values({
					...news,
					fetchedAt: new Date(),
				})
				.onConflictDoUpdate({
					target: dbNews.sourceUrl,
					set: {
						title: news.title,
						titleJa: news.titleJa,
						excerpt: news.excerpt,
						category: news.category,
						publishedAt: news.publishedAt,
						image: news.image,
					},
				});
		} catch (e) {
			logger.error(`[NewsService] Failed to save news: ${e instanceof Error ? e.message : e}`);
		}
	}

	/** Première image exploitable d'un message (attachment image > embed image/thumbnail). */
	private extractImage(message: Message): string | null {
		const att = message.attachments.find((a) => (a.contentType ?? "").startsWith("image/"));
		if (att) return att.url;
		for (const e of message.embeds) {
			if (e.image?.url) return e.image.url;
			if (e.thumbnail?.url) return e.thumbnail.url;
		}
		return null;
	}

	/**
	 * Mappe un message d'un salon d'annonces Discord vers `db_news` (alimente la
	 * page Actualités du site). Titre = 1re ligne, excerpt = reste, image = 1re
	 * pièce jointe/embed. Idempotent via `sourceUrl` (lien message). Retourne
	 * `false` si rien d'exploitable (message vide sans image).
	 */
	async saveFromDiscord(message: Message, category = "Annonce"): Promise<boolean> {
		const raw = (message.content ?? "").trim();
		const embedText = message.embeds
			.map((e) => [e.title, e.description].filter(Boolean).join("\n"))
			.join("\n")
			.trim();
		const body = raw || embedText;
		const image = this.extractImage(message);

		// Retire seulement les tokens Discord (mentions rôle/user/salon, custom
		// emoji, @everyone/@here) — on PRÉSERVE le markdown (gras, listes, liens)
		// pour que le site puisse le rendre via react-markdown.
		const stripTokens = (s: string) =>
			s
				.replace(/<a?:(\w+):\d+>/g, ":$1:") // custom emoji → :nom:
				.replace(/<[@#][!&]?\d+>/g, "") // mentions
				.replace(/@everyone|@here/g, "")
				.replace(/[ \t]+/g, " ")
				.trim();
		// Pour le titre : en plus, on enlève la syntaxe markdown de tête (#, >, *, -).
		const titleLine = (s: string) =>
			stripTokens(s)
				.replace(/^[#>*\-\s]+/, "")
				.trim();

		const lines = body.split("\n").map(stripTokens);
		const nonEmpty = lines.filter(Boolean);

		// Rien d'exploitable (que des mentions/emoji) et pas d'image → on saute.
		if (nonEmpty.length === 0 && !image) return false;

		const channelName =
			message.channel && "name" in message.channel
				? (message.channel.name ?? "Annonce")
				: "Annonce";
		const title = (titleLine(nonEmpty[0] ?? "") || message.embeds[0]?.title || channelName).slice(
			0,
			NEWS_TITLE_MAX
		);
		// Excerpt = corps après la 1re ligne, markdown préservé (newlines compris).
		const firstIdx = lines.findIndex(Boolean);
		const excerpt =
			lines
				.slice(firstIdx + 1)
				.join("\n")
				.replace(/\n{3,}/g, "\n\n")
				.trim()
				.slice(0, NEWS_EXCERPT_MAX) || null;

		await this.saveNews({
			sourceId: `discord:${message.channelId}`,
			sourceUrl: message.url,
			title,
			titleJa: null,
			excerpt,
			category,
			publishedAt: message.createdAt,
			image,
		});
		return true;
	}

	async deleteBySourceUrl(url: string) {
		await this.db.delete(dbNews).where(eq(dbNews.sourceUrl, url));
	}

	async syncFromSitemap(url: string, sourceId: string) {
		logger.info(`[NewsService] Syncing news from ${url} (${sourceId})`);
		// Implementation for parsing sitemap and fetching news items
		// This will be expanded with actual fetch and parse logic
	}
}
