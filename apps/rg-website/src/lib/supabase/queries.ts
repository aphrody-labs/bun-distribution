import { cache } from "react";

import { getPgPool } from "@/lib/db/pg";

// Lectures publiques "full local" — connexion Postgres DIRECTE (bypass le
// Data API PostgREST de Supabase) au lieu du client Supabase JS. Le Data API
// a été restreint (`exceed_storage_size_quota`) pendant 7+ jours début août
// 2026, cassant ces pages en boucle, alors que la connexion Postgres directe
// (packages/cron/src/lib/db.ts, apps/website/src/lib/db/pg.ts) restait
// fonctionnelle tout du long.

interface ProfileRow {
	id: string;
	username: string | null;
	full_name: string | null;
	avatar_url: string | null;
	role: string | null;
}

interface ArticleRow {
	id: string;
	title: string;
	slug: string;
	excerpt: string | null;
	created_at: string | null;
	featured_image_url: string | null;
	author_id: string | null;
}

interface ArticleRowWithCount extends ArticleRow {
	full_count: string;
}

/**
 * Récupère le profil de l'utilisateur connecté.
 * Utilise React Cache pour éviter les requêtes dupliquées.
 */
export const getUserProfile = cache(async (userId: string) => {
	try {
		const pool = getPgPool();
		const { rows } = await pool.query<ProfileRow>(
			"SELECT id, username, full_name, avatar_url, role FROM profiles WHERE id = $1 LIMIT 1",
			[userId]
		);

		const profile = rows[0];
		if (rows.length !== 1 || !profile) {
			console.error("Error fetching profile:", new Error("Profile not found"));
			return null;
		}

		return profile;
	} catch (error) {
		console.error("Error fetching profile:", error);
		return null;
	}
});

/**
 * Récupère les articles publics avec pagination.
 * Optimisé pour ne récupérer que les champs nécessaires pour une liste.
 */
export const getPublicArticles = async (page = 1, limit = 10) => {
	const from = (page - 1) * limit;

	try {
		const pool = getPgPool();
		const { rows } = await pool.query<ArticleRowWithCount>(
			`SELECT id, title, slug, excerpt, created_at, featured_image_url, author_id,
				count(*) OVER() AS full_count
			FROM articles
			WHERE status = $1 AND app = $2
			ORDER BY created_at DESC
			LIMIT $3 OFFSET $4`,
			["published", "website", limit, from]
		);

		if (rows.length === 0) {
			return { count: 0, data: [] as ArticleRow[] };
		}

		const count = Number(rows[0]?.full_count ?? 0);
		const data: ArticleRow[] = rows.map(({ full_count: _full_count, ...row }) => row);

		return { count, data };
	} catch (error) {
		console.error("Error fetching articles:", error);
		return { count: 0, data: [] as ArticleRow[] };
	}
};
