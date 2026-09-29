import { db } from "@/lib/db";
import { posts as postsTable } from "@/db/schema";
import { desc } from "drizzle-orm";
import { publicPostFilter } from "@/lib/posts";
import { SITE_URL } from "@/lib/config";
import { assetUrl } from "@/lib/assets";

/**
 * Flux RSS 2.0 du journal.
 *
 * Segment statique `rss.xml` : Next le résout avant la route dynamique
 * `/news/[slug]`, il n'y a donc pas de collision avec un article dont le
 * slug serait « rss.xml ».
 */

export const revalidate = 600;

/**
 * Type MIME d'une image de couverture, déduit de son extension. Le flux
 * annonçait `image/jpeg` pour tout le monde : un agrégateur qui respecte
 * l'en-tête refusait donc d'afficher les couvertures `.webp` et `.png`, qui
 * sont la majorité des visuels du site.
 */
function typeImage(url: string): string {
	const ext = url.split("?")[0].split(".").pop()?.toLowerCase();
	switch (ext) {
		case "png":
			return "image/png";
		case "webp":
			return "image/webp";
		case "avif":
			return "image/avif";
		case "gif":
			return "image/gif";
		default:
			return "image/jpeg";
	}
}

/** Échappe les 5 caractères réservés XML. */
function xml(s: string): string {
	return s
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

export async function GET() {
	const rows = await db.query.posts.findMany({
		where: publicPostFilter(),
		orderBy: [desc(postsTable.publishedAt)],
		limit: 50,
		// `contentJson` (le document Tiptap) et `body` (le Markdown historique) ne
		// servent pas au flux : seul `contentHtml` y est publié.
		columns: {
			slug: true,
			title: true,
			excerpt: true,
			cover: true,
			publishedAt: true,
			tags: true,
			contentHtml: true,
		},
		// Seul le pseudo de l'auteur part dans le flux : la relation `true`
		// ramenait toute la ligne `User` (dont `discordId` et `roleAdmin`).
		with: { author: { columns: { username: true } } },
	});

	const items = rows
		.map((post) => {
			const url = `${SITE_URL}/news/${post.slug}`;
			// `assetUrl` d'abord : une couverture téléversée à l'admin est un chemin
			// brut (`./assets/wiki/articles/…`) servi par l'hôte d'assets ; le
			// concaténer au site donnait `https://dragonballfr.com./assets/…`. Seuls
			// les chemins du site (`/…`) sont encore préfixés par SITE_URL.
			const coverPath = assetUrl(post.cover);
			const cover = coverPath
				? coverPath.startsWith("http")
					? coverPath
					: `${SITE_URL}${coverPath}`
				: null;

			return `		<item>
			<title>${xml(post.title)}</title>
			<link>${xml(url)}</link>
			<guid isPermaLink="true">${xml(url)}</guid>
			<description>${xml(post.excerpt)}</description>${
				post.publishedAt ? `\n			<pubDate>${post.publishedAt.toUTCString()}</pubDate>` : ""
			}${post.author?.username ? `\n			<dc:creator>${xml(post.author.username)}</dc:creator>` : ""}${(
				post.tags ?? []
			)
				.map((t) => `\n			<category>${xml(t)}</category>`)
				.join("")}${cover ? `\n			<enclosure url="${xml(cover)}" type="${typeImage(cover)}" />` : ""}${
				post.contentHtml
					? `\n			<content:encoded><![CDATA[${post.contentHtml.replace(/]]>/g, "]]&gt;")}]]></content:encoded>`
					: ""
			}
		</item>`;
		})
		.join("\n");

	const body = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:atom="http://www.w3.org/2005/Atom">
	<channel>
		<title>Le Journal — Dragon Ball France</title>
		<link>${SITE_URL}/news</link>
		<description>Sorties anime, chapitres du manga, films, événements et analyses Dragon Ball.</description>
		<language>fr-FR</language>
		<atom:link href="${SITE_URL}/news/rss.xml" rel="self" type="application/rss+xml" />${
			rows[0]?.publishedAt
				? `\n		<lastBuildDate>${rows[0].publishedAt.toUTCString()}</lastBuildDate>`
				: ""
		}
${items}
	</channel>
</rss>`;

	return new Response(body, {
		headers: {
			"content-type": "application/rss+xml; charset=utf-8",
			"cache-control": "public, max-age=600, s-maxage=600, stale-while-revalidate=86400",
		},
	});
}
