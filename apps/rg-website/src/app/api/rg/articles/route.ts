import { NextResponse } from "next/server";

import { getPgPool } from "@/lib/db/pg";
import { SITE_URL } from "@/lib/site-url";

// Articles publiés — re-fetch toutes les 5 min (compromis fraîcheur/CDN hit).
export const revalidate = 300;

interface ArticleRow {
	id: string;
	title: string;
	slug: string;
	excerpt: string | null;
	featured_image_url: string | null;
	published_at: string | null;
	category: string | null;
	author_id: string | null;
}

export async function GET(request: Request) {
	const { searchParams } = new URL(request.url);
	const limitRaw = Number.parseInt(searchParams.get("limit") || "5", 10);
	const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(limitRaw, 50)) : 5;
	const category = searchParams.get("category");

	try {
		const pool = getPgPool();

		const conditions = ["status = $1", "app = $2"];
		const params: unknown[] = ["published", "website"];

		if (category) {
			params.push(category);
			conditions.push(`category = $${params.length}`);
		}

		params.push(limit);
		const limitIdx = params.length;

		const { rows: articles } = await pool.query<ArticleRow>(
			`SELECT id, title, slug, excerpt, featured_image_url, published_at, category, author_id
			 FROM articles
			 WHERE ${conditions.join(" AND ")}
			 ORDER BY published_at DESC
			 LIMIT $${limitIdx}`,
			params
		);

		// Ajouter l'URL complète pour les images et les liens
		const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || SITE_URL;

		const formattedArticles = articles.map((article) => ({
			...article,
			featured_image_full_url: article.featured_image_url
				? article.featured_image_url.startsWith("http")
					? article.featured_image_url
					: `${baseUrl}${article.featured_image_url}`
				: null,
			url: `${baseUrl}/news/${article.slug}`,
		}));

		return NextResponse.json({
			count: formattedArticles.length,
			data: formattedArticles,
			success: true,
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Erreur inconnue";
		return NextResponse.json({ error: message, success: false }, { status: 500 });
	}
}
