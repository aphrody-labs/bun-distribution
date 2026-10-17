import { getPgPool } from "@/lib/db/pg";
import { absoluteUrl } from "@/lib/site-url";
import { cachePublic } from "@/lib/cache-public";

export const dynamic = "force-dynamic";

interface ArticleRow {
	id: string;
	title: string;
	slug: string;
	excerpt: string | null;
	content: string;
	featured_image_url: string | null;
	published_at: string | null;
	category: string | null;
	author_id: string | null;
}

// Pas de clé étrangère articles.author_id → profiles dans le schéma : on résout
// les auteurs via une requête séparée (un embed PostgREST échouerait en 500).
interface ProfileRow {
	id: string;
	username: string | null;
	avatar_url: string | null;
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const limit = Number.parseInt(searchParams.get("limit") || "5", 10);
	const category = searchParams.get("category");

	try {
		const pool = getPgPool();

		const conditions = ["status = $1", "app = $2"];
		const params: unknown[] = ["published", "azalee"];

		if (category) {
			params.push(category);
			conditions.push(`category = $${params.length}`);
		}

		params.push(Math.min(limit, 20)); // Max 20 pour éviter l'abus
		const limitIdx = params.length;

		const { rows: articles } = await pool.query<ArticleRow>(
			`SELECT id, title, slug, excerpt, content, featured_image_url, published_at, category, author_id
			 FROM articles
			 WHERE ${conditions.join(" AND ")}
			 ORDER BY published_at DESC
			 LIMIT $${limitIdx}`,
			params
		);

		const authorIds = [...new Set(articles.map((a) => a.author_id).filter(Boolean))] as string[];
		const profilesById = new Map<string, ProfileRow>();
		if (authorIds.length > 0) {
			const { rows: profiles } = await pool.query<ProfileRow>(
				"SELECT id, username, avatar_url FROM profiles WHERE id = ANY($1)",
				[authorIds]
			);
			for (const p of profiles) {
				profilesById.set(p.id, p);
			}
		}

		// Formatage pour simplifier la consommation
		const formattedArticles = articles.map((article) => {
			const profile = article.author_id ? profilesById.get(article.author_id) ?? null : null;
			return {
				author: {
					avatar: profile?.avatar_url,
					name: profile?.username || "Rose Griffon",
				},
				category: article.category,
				date: article.published_at,
				excerpt: article.excerpt,
				id: article.id,
				image: article.featured_image_url,
				slug: article.slug,
				title: article.title,
				url: absoluteUrl(`/news/${article.slug}`),
			};
		});

		return Response.json(
			{
				articles: formattedArticles,
				count: formattedArticles.length,
			},
			{ headers: cachePublic(300) }
		);
	} catch (error) {
		const message = error instanceof Error ? error.message : "Erreur inconnue";
		return Response.json({ error: message }, { status: 500 });
	}
}
