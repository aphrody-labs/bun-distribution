"use server";

import { getServerSession } from "@/lib/auth-helpers";
import { getPgPool } from "@/lib/db/pg";
import { createPostgresClient } from "@rosegriffon/db/service";

export interface ReadingHistoryEntry {
	article_id: string;
	title: string;
	slug: string;
	featured_image_url: string | null;
	excerpt: string | null;
	category: string | null;
	progress: number;
	last_read_at: string;
	read_count: number;
}

export interface ReadingStats {
	totalRead: number;
	totalInProgress: number;
	streak: number;
}

/**
 * Enregistre ou met à jour la progression de lecture d'un article.
 * Appelle la RPC upsert_reading_progress avec user_id, article_id, progress (0-100).
 */
export async function trackReading(articleId: string, progress: number): Promise<void> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const supabase = createPostgresClient();
	await supabase.rpc("upsert_reading_progress", {
		p_article_id: articleId,
		p_progress: progress,
		p_user_id: session.user.id,
	});
}

/**
 * Récupère l'historique de lecture de l'utilisateur connecté.
 * Retourne les articles publiés sur azalee, ordonnés par dernière lecture.
 */
export async function getReadingHistory(limit = 10): Promise<ReadingHistoryEntry[]> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const { rows } = await getPgPool().query<ReadingHistoryEntry>(
		`SELECT h.article_id, a.title, a.slug, a.featured_image_url, a.excerpt, a.category,
			h.progress, h.last_read_at, h.read_count
		 FROM reading_history h
		 JOIN articles a ON a.id = h.article_id
		 WHERE h.user_id = $1 AND a.status = 'published' AND a.app = 'azalee'
		 ORDER BY h.last_read_at DESC LIMIT $2`,
		[session.user.id, limit]
	);
	return rows;
}

/**
 * Récupère les articles commencés mais non terminés (progress < 100).
 * Permet d'afficher une section "Continuer la lecture".
 */
export async function getContinueReading(limit = 4): Promise<ReadingHistoryEntry[]> {
	const session = await getServerSession();
	if (!session?.user) {
		return [];
	}

	const { rows } = await getPgPool().query<ReadingHistoryEntry>(
		`SELECT h.article_id, a.title, a.slug, a.featured_image_url, a.excerpt, a.category,
			h.progress, h.last_read_at, h.read_count
		 FROM reading_history h
		 JOIN articles a ON a.id = h.article_id
		 WHERE h.user_id = $1 AND h.progress < 100 AND a.status = 'published' AND a.app = 'azalee'
		 ORDER BY h.last_read_at DESC LIMIT $2`,
		[session.user.id, limit]
	);
	return rows;
}

/**
 * Calcule les statistiques de lecture de l'utilisateur connecté.
 * - totalRead : articles lus en entier (progress = 100)
 * - totalInProgress : articles commencés mais non terminés (progress < 100)
 * - streak : nombre de jours consécutifs avec activité de lecture (en remontant depuis aujourd'hui)
 */
export async function getReadingStats(): Promise<ReadingStats> {
	const session = await getServerSession();
	if (!session?.user) {
		throw new Error("Non authentifié");
	}

	const pool = getPgPool();
	const [{ rows: readRows }, { rows: progressRows }, { rows: history }] = await Promise.all([
		pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM reading_history WHERE user_id = $1 AND progress = 100", [session.user.id]),
		pool.query<{ count: string }>("SELECT COUNT(*)::text AS count FROM reading_history WHERE user_id = $1 AND progress < 100", [session.user.id]),
		pool.query<{ last_read_at: string }>("SELECT last_read_at FROM reading_history WHERE user_id = $1 ORDER BY last_read_at DESC", [session.user.id]),
	]);
	const totalRead = Number(readRows[0]?.count ?? 0);
	const totalInProgress = Number(progressRows[0]?.count ?? 0);

	// Calcul du streak : jours consécutifs avec activité en remontant depuis aujourd'hui
	let streak = 0;
	if (history && history.length > 0) {
		// Construire un Set des jours (format YYYY-MM-DD) ayant une activité
		const activeDays = new Set<string>(
		history.map((row) => new Date(row.last_read_at).toISOString().slice(0, 10))
		);

		const today = new Date();
		today.setHours(0, 0, 0, 0);

		const cursor = new Date(today);
		while (activeDays.has(cursor.toISOString().slice(0, 10))) {
			streak++;
			cursor.setDate(cursor.getDate() - 1);
		}
	}

	return {
		streak,
		totalInProgress: totalInProgress || 0,
		totalRead: totalRead || 0,
	};
}
