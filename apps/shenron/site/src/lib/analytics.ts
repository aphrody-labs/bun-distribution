import "server-only";

/**
 * Couche analytics d'AUDIENCE du site (trafic web), au-dessus de la table
 * `site_events` (télémétrie first-party RGPD-safe, cf. `/api/telemetry`).
 *
 * Toutes les agrégations ici sont GLOBALES / site-wide — aucune n'est rattachée
 * à une identité.
 *
 * server-only : tape le Postgres du site via Drizzle. Ne JAMAIS importer depuis
 * un Client Component (le driver `postgres` fuiterait dans le bundle). Consommé
 * par `/api/analytics` (admin) et la page publique `/stats` (compteur non-sensible).
 *
 * Confidentialité : les fenêtres relatives sont calculées côté SQL (`now() -
 * interval`) → aucune horloge client. Les visiteurs uniques se comptent sur
 * `anonId` (pseudonyme stable) et non `visitorHash` (rotaté chaque jour, unicité
 * seulement intra-jour). Aucune IP brute n'existe en base.
 */
import { and, desc, eq, isNotNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/lib/db";
import { siteEvents } from "@/db/schema";

// --- Fenêtres temporelles ----------------------------------------------------

const ANALYTICS_RANGES = ["today", "7d", "30d", "90d"] as const;
export type AnalyticsRange = (typeof ANALYTICS_RANGES)[number];

export function isAnalyticsRange(v: unknown): v is AnalyticsRange {
	return typeof v === "string" && (ANALYTICS_RANGES as readonly string[]).includes(v);
}

const RANGE_LABELS: Record<AnalyticsRange, string> = {
	today: "Aujourd'hui",
	"7d": "7 jours",
	"30d": "30 jours",
	"90d": "90 jours",
};

/** Condition SQL de la fenêtre courante (range vient d'une whitelist → sûr). */
function currentWindow(range: AnalyticsRange): SQL {
	switch (range) {
		case "today":
			return sql`${siteEvents.ts} >= date_trunc('day', now())`;
		case "7d":
			return sql`${siteEvents.ts} >= now() - interval '7 days'`;
		case "30d":
			return sql`${siteEvents.ts} >= now() - interval '30 days'`;
		case "90d":
			return sql`${siteEvents.ts} >= now() - interval '90 days'`;
	}
}

/** Condition SQL de la fenêtre PRÉCÉDENTE de même durée (pour les deltas). */
function previousWindow(range: AnalyticsRange): SQL {
	switch (range) {
		case "today":
			return sql`${siteEvents.ts} >= date_trunc('day', now()) - interval '1 day' and ${siteEvents.ts} < date_trunc('day', now())`;
		case "7d":
			return sql`${siteEvents.ts} >= now() - interval '14 days' and ${siteEvents.ts} < now() - interval '7 days'`;
		case "30d":
			return sql`${siteEvents.ts} >= now() - interval '60 days' and ${siteEvents.ts} < now() - interval '30 days'`;
		case "90d":
			return sql`${siteEvents.ts} >= now() - interval '180 days' and ${siteEvents.ts} < now() - interval '90 days'`;
	}
}

/** Bucket temporel de la série (heure pour aujourd'hui, jour sinon). */
function bucketExpr(range: AnalyticsRange): SQL<string> {
	const unit = range === "today" ? "hour" : "day";
	return sql<string>`to_char(date_trunc('${sql.raw(unit)}', ${siteEvents.ts}), 'YYYY-MM-DD"T"HH24:00')`;
}

// --- Formes de retour --------------------------------------------------------

type AnalyticsTotals = {
	events: number;
	pageviews: number;
	uniqueVisitors: number;
	sessions: number;
	loggedIn: number;
};

export type AnalyticsPoint = {
	bucket: string;
	pageviews: number;
	visitors: number;
	events: number;
};

export type AnalyticsOverview = {
	range: AnalyticsRange;
	generatedAt: string;
	totals: AnalyticsTotals;
	/** Variation en % vs la fenêtre précédente de même durée (null si base 0). */
	delta: { pageviews: number | null; uniqueVisitors: number | null; sessions: number | null };
	timeseries: AnalyticsPoint[];
	topPages: { path: string; views: number; visitors: number }[];
	sources: { source: string; count: number; visitors: number }[];
	topEntities: { entityType: string; entityId: string; name: string | null; views: number }[];
	topSearches: { query: string; count: number }[];
	eventTypes: { type: string; count: number }[];
	live: { activeVisitors: number; activeSessions: number; events: number };
};

// --- Requêtes élémentaires ---------------------------------------------------

async function totals(where: SQL): Promise<AnalyticsTotals> {
	const [row] = await db
		.select({
			events: sql<number>`count(*)::int`,
			pageviews: sql<number>`count(*) filter (where ${siteEvents.type} = 'pageview')::int`,
			uniqueVisitors: sql<number>`count(distinct ${siteEvents.anonId})::int`,
			sessions: sql<number>`count(distinct ${siteEvents.sessionId})::int`,
			loggedIn: sql<number>`count(distinct ${siteEvents.userId})::int`,
		})
		.from(siteEvents)
		.where(where);
	return row ?? { events: 0, pageviews: 0, uniqueVisitors: 0, sessions: 0, loggedIn: 0 };
}

function pct(cur: number, prev: number): number | null {
	if (prev <= 0) return cur > 0 ? 100 : null;
	return Math.round(((cur - prev) / prev) * 1000) / 10;
}

// --- API principale ----------------------------------------------------------

/** Vue d'ensemble complète de l'audience sur une fenêtre. Usage admin. */
export async function getAnalyticsOverview(range: AnalyticsRange): Promise<AnalyticsOverview> {
	const cur = currentWindow(range);
	const bucket = bucketExpr(range);

	const [
		curTotals,
		prevTotals,
		timeseries,
		topPages,
		sources,
		topEntities,
		topSearches,
		eventTypes,
		liveRow,
	] = await Promise.all([
		totals(cur),
		totals(previousWindow(range)),
		// Série temporelle (par heure aujourd'hui, par jour sinon).
		db
			.select({
				bucket,
				pageviews: sql<number>`count(*) filter (where ${siteEvents.type} = 'pageview')::int`,
				visitors: sql<number>`count(distinct ${siteEvents.anonId})::int`,
				events: sql<number>`count(*)::int`,
			})
			.from(siteEvents)
			.where(cur)
			.groupBy(bucket)
			.orderBy(bucket),
		// Top pages (visites).
		db
			.select({
				path: siteEvents.path,
				views: sql<number>`count(*)::int`,
				visitors: sql<number>`count(distinct ${siteEvents.anonId})::int`,
			})
			.from(siteEvents)
			.where(and(cur, eq(siteEvents.type, "pageview")))
			.groupBy(siteEvents.path)
			.orderBy(desc(sql`count(*)`))
			.limit(20),
		// Sources de trafic : referrer externe (host) ou (direct) si absent.
		// On exclut les référents INTERNES (stockés comme chemin, commencent par '/').
		db
			.select({
				source: sql<string>`case when ${siteEvents.referrer} is null then '(direct)' else ${siteEvents.referrer} end`,
				count: sql<number>`count(*)::int`,
				visitors: sql<number>`count(distinct ${siteEvents.anonId})::int`,
			})
			.from(siteEvents)
			.where(
				and(cur, sql`(${siteEvents.referrer} is null or ${siteEvents.referrer} not like '/%')`)
			)
			.groupBy(
				sql`case when ${siteEvents.referrer} is null then '(direct)' else ${siteEvents.referrer} end`
			)
			.orderBy(desc(sql`count(*)`))
			.limit(15),
		// Top entités wiki consultées (fiches perso/saga/film…).
		db
			.select({
				entityType: sql<string>`${siteEvents.entityType}`,
				entityId: sql<string>`${siteEvents.entityId}`,
				name: sql<string | null>`max(${siteEvents.props}->>'entityName')`,
				views: sql<number>`count(*)::int`,
			})
			.from(siteEvents)
			.where(and(cur, eq(siteEvents.type, "wiki_view"), isNotNull(siteEvents.entityType)))
			.groupBy(siteEvents.entityType, siteEvents.entityId)
			.orderBy(desc(sql`count(*)`))
			.limit(15),
		// Recherches populaires (site-wide).
		db
			.select({
				query: sql<string>`${siteEvents.props}->>'query'`,
				count: sql<number>`count(*)::int`,
			})
			.from(siteEvents)
			.where(
				and(
					cur,
					eq(siteEvents.type, "search"),
					sql`${siteEvents.props}->>'query' is not null and ${siteEvents.props}->>'query' <> ''`
				)
			)
			.groupBy(sql`${siteEvents.props}->>'query'`)
			.orderBy(desc(sql`count(*)`))
			.limit(15),
		// Répartition globale par type d'event.
		db
			.select({
				type: siteEvents.type,
				count: sql<number>`count(*)::int`,
			})
			.from(siteEvents)
			.where(cur)
			.groupBy(siteEvents.type)
			.orderBy(desc(sql`count(*)`)),
		// Temps réel : 5 dernières minutes (hors fenêtre du range).
		db
			.select({
				activeVisitors: sql<number>`count(distinct ${siteEvents.anonId})::int`,
				activeSessions: sql<number>`count(distinct ${siteEvents.sessionId})::int`,
				events: sql<number>`count(*)::int`,
			})
			.from(siteEvents)
			.where(sql`${siteEvents.ts} >= now() - interval '5 minutes'`),
	]);

	return {
		range,
		generatedAt: new Date().toISOString(),
		totals: curTotals,
		delta: {
			pageviews: pct(curTotals.pageviews, prevTotals.pageviews),
			uniqueVisitors: pct(curTotals.uniqueVisitors, prevTotals.uniqueVisitors),
			sessions: pct(curTotals.sessions, prevTotals.sessions),
		},
		timeseries,
		topPages,
		sources,
		topEntities,
		topSearches,
		eventTypes,
		live: liveRow[0] ?? { activeVisitors: 0, activeSessions: 0, events: 0 },
	};
}

// --- Compteur public (non-sensible) ------------------------------------------

export type PublicActivity = {
	visitorsThisMonth: number;
	pageviewsThisMonth: number;
	visitorsAllTime: number;
	popularPages: { path: string; views: number }[];
	generatedAt: string;
};

/**
 * Chiffres d'audience AGRÉGÉS et NON-SENSIBLES pour la vitrine publique `/stats` :
 * visiteurs du mois, pages vues, visiteurs cumulés, pages populaires. Aucun
 * referrer, aucun détail par visiteur, aucune donnée privée. Sûr à cacher (CDN/ISR).
 */
async function getPublicActivity(): Promise<PublicActivity> {
	const [month, allTime, popular] = await Promise.all([
		db
			.select({
				visitors: sql<number>`count(distinct ${siteEvents.anonId})::int`,
				pageviews: sql<number>`count(*) filter (where ${siteEvents.type} = 'pageview')::int`,
			})
			.from(siteEvents)
			.where(sql`${siteEvents.ts} >= date_trunc('month', now())`),
		db
			.select({ visitors: sql<number>`count(distinct ${siteEvents.anonId})::int` })
			.from(siteEvents),
		db
			.select({
				path: siteEvents.path,
				views: sql<number>`count(*)::int`,
			})
			.from(siteEvents)
			.where(
				and(sql`${siteEvents.ts} >= now() - interval '30 days'`, eq(siteEvents.type, "pageview"))
			)
			.groupBy(siteEvents.path)
			.orderBy(desc(sql`count(*)`))
			.limit(8),
	]);

	return {
		visitorsThisMonth: month[0]?.visitors ?? 0,
		pageviewsThisMonth: month[0]?.pageviews ?? 0,
		visitorsAllTime: allTime[0]?.visitors ?? 0,
		popularPages: popular,
		generatedAt: new Date().toISOString(),
	};
}

/**
 * Variante tolérante aux pannes pour la vitrine publique `/stats` : un blip DB
 * (ou une table vide au tout début) ne doit jamais casser le prerender/ISR de la
 * page — on renvoie des zéros plutôt que de rejeter (comme `getShenronStats`).
 */
export async function getPublicActivitySafe(): Promise<PublicActivity> {
	try {
		return await getPublicActivity();
	} catch (err) {
		console.error("[analytics] getPublicActivity failed", err);
		return {
			visitorsThisMonth: 0,
			pageviewsThisMonth: 0,
			visitorsAllTime: 0,
			popularPages: [],
			generatedAt: new Date().toISOString(),
		};
	}
}

// --- Utilitaire d'affichage --------------------------------------------------

/**
 * Libellé lisible d'un chemin (`/wiki/personnages` → « Personnages »).
 *
 * Le chemin vient de `site_events.path`, donc du corps POST de `/api/telemetry` :
 * il est écrit par le visiteur. Un pourcentage isolé ou une paire d'octets
 * invalide (`/wiki/%zz`, `/wiki/%e9`) fait lever `decodeURIComponent` — et cette
 * exception traversait le rendu de « Top pages », donc le tableau de bord admin
 * ET la vitrine publique `/stats`. On garde alors le segment brut.
 */
export function prettyPath(path: string): string {
	if (path === "/" || path === "") return "Accueil";
	const seg = path.replace(/\/+$/, "").split("/").filter(Boolean);
	const last = seg[seg.length - 1] ?? path;
	let lisible: string;
	try {
		lisible = decodeURIComponent(last);
	} catch {
		lisible = last;
	}
	const decoded = lisible.replace(/[-_]+/g, " ");
	return decoded.charAt(0).toUpperCase() + decoded.slice(1);
}
