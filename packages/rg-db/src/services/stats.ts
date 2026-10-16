import { sql } from "kysely";
import type { DashboardStats } from "@rosegriffon/types";
import { createAchilleaSql } from "../achillea-sql";

type CountRow = { count: number };

/**
 * Service partagé pour les agrégats du tableau de bord.
 * Chaque métrique est calculée côté PostgreSQL, sans charger les lignes.
 */
export async function getDashboardStats(): Promise<DashboardStats> {
	const db = createAchilleaSql();
	const yesterday = new Date(Date.now() - 24 * 3600 * 1000);
	const now = new Date();

	const count = async (query: ReturnType<typeof sql<CountRow>>) => {
		const result = await query.execute(db);
		return Number(result.rows[0]?.count ?? 0);
	};

	const [
		profiles_total,
		profiles_24h,
		admins,
		banned,
		articles_published,
		articles_draft,
		events_upcoming,
		events_past,
		team_members,
		discord_members,
	] = await Promise.all([
		count(sql<CountRow>`SELECT COUNT(*)::int AS count FROM public.profiles`),
		count(sql<CountRow>`SELECT COUNT(*)::int AS count FROM public.profiles WHERE updated_at >= ${yesterday}`),
		count(sql<CountRow>`SELECT COUNT(*)::int AS count FROM public.profiles WHERE role = 'admin'`),
		count(sql<CountRow>`SELECT COUNT(*)::int AS count FROM public.profiles WHERE role = 'banned'`),
		count(sql<CountRow>`SELECT COUNT(*)::int AS count FROM public.articles WHERE status = 'published'`),
		count(sql<CountRow>`SELECT COUNT(*)::int AS count FROM public.articles WHERE status = 'draft'`),
		count(sql<CountRow>`SELECT COUNT(*)::int AS count FROM public.events WHERE end_time >= ${now}`),
		count(sql<CountRow>`SELECT COUNT(*)::int AS count FROM public.events WHERE end_time < ${now}`),
		count(sql<CountRow>`SELECT COUNT(*)::int AS count FROM public.team_members WHERE is_active = TRUE`),
		count(sql<CountRow>`SELECT COUNT(*)::int AS count FROM public.discord_members WHERE is_bot = FALSE`),
	]);

	return {
		profiles_total,
		profiles_24h,
		admins,
		banned,
		articles_published,
		articles_draft,
		events_upcoming,
		events_past,
		team_members,
		discord_members,
		generated_at: new Date().toISOString(),
	};
}
