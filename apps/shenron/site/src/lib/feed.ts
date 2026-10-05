/**
 * feed — le fil d'actualité unifié du site.
 *
 * Avant, l'activité du projet était éparpillée sur trois pages qui ne se
 * parlaient pas : `/news` (les articles de la rédaction), `/wiki/modifications`
 * (les révisions du wiki) et rien du tout pour les contributions de la
 * communauté ou les discussions. Un lecteur qui voulait savoir « ce qui s'est
 * passé cette semaine » devait visiter trois URL, et les deux pages faibles
 * (modifications, contributions) restaient invisibles.
 *
 * Ici, une seule liste, quatre natures d'événements :
 *
 *  - `article`      — une parution éditoriale (`Post`) ;
 *  - `wiki`         — une fiche modifiée (`wiki_revisions`, via
 *                     `lib/wiki-modifications`, qui sait déjà résoudre les URL
 *                     publiques et écarter ce qui n'est pas montrable) ;
 *  - `contribution` — une proposition communautaire acceptée
 *                     (`wiki_contributions`) : le crédit public des membres ;
 *  - `discussion`   — un commentaire récent (`ContentComment`).
 *
 * **Pagination.** Fusionner N sources hétérogènes n'autorise pas un `OFFSET`
 * SQL : l'ordre final n'existe qu'après fusion. Chaque source est donc tirée
 * jusqu'à `page × parPage`, fusionnée, puis découpée. Le coût croît avec la
 * profondeur, d'où `FEED_MAX_PAGES` : au-delà, un lecteur cherche une archive,
 * pas un fil — il a le journal (`/news`) et la recherche.
 *
 * Server-only.
 */
import "server-only";
import { and, desc, eq, inArray, isNotNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { contentComments, posts, users, wikiContributions, wikiRevisions } from "@/db/schema";
import { publicPostFilter } from "@/lib/posts";
import { listeModifications } from "@/lib/wiki-modifications";
import { countCommentsBatch, reactionCounts } from "@/lib/social";
import { CONTRIBUTABLE_COLUMNS } from "@/lib/contributions-shared";
import { assetUrl } from "@/lib/assets";

const FEED_KINDS = ["article", "wiki", "contribution", "discussion"] as const;
export type FeedKind = (typeof FEED_KINDS)[number];

/**
 * Onglets du fil PUBLIC. `tout` = tous les types publics mélangés.
 *
 * Les révisions du wiki et les contributions acceptées ne sont **plus** exposées
 * côté lecteur (2026-09-12) : un flux qui détaille quelle fiche a été modifiée,
 * par qui et sur quel champ raconte la fabrication du site, pas Dragon Ball. Les
 * deux sources existent toujours (`FEED_KINDS`) et alimentent les écrans
 * d'équipe ; seules les natures listées ici ont une URL publique.
 */
export const FEED_FILTERS = ["tout", "articles", "discussions"] as const;
export type FeedFilter = (typeof FEED_FILTERS)[number];

export function isFeedFilter(value: unknown): value is FeedFilter {
	return typeof value === "string" && (FEED_FILTERS as readonly string[]).includes(value);
}

/**
 * Types d'événements inclus par chaque onglet.
 *
 * `tout` ne veut PAS dire « toutes les natures existantes » : il vaut la réunion
 * des onglets publics. Écrire `FEED_KINDS` ici remettrait les révisions du wiki
 * dans le fil du lecteur par le simple fait d'ajouter une nature plus tard.
 */
const FILTER_KINDS: Record<FeedFilter, readonly FeedKind[]> = {
	tout: ["article", "discussion"],
	articles: ["article"],
	discussions: ["discussion"],
};

export const FEED_FILTER_LABELS: Record<FeedFilter, string> = {
	tout: "Tout",
	articles: "Articles",
	discussions: "Discussions",
};

const FEED_PER_PAGE = 20;
/** Profondeur maximale du fil (cf. en-tête : au-delà, c'est une archive). */
const FEED_MAX_PAGES = 25;

export interface FeedEntry {
	/** Identifiant stable de l'événement (clé de rendu, pas une URL). */
	id: string;
	kind: FeedKind;
	/** Date ISO de l'événement — c'est elle qui ordonne le fil. */
	at: string;
	/** Étiquette courte affichée en tête de carte (« Article », « Personnage »…). */
	badge: string;
	title: string;
	href: string | null;
	summary: string | null;
	/** Qui est à l'origine de l'événement (rédacteur, contributeur, membre). */
	actor: string | null;
	actorAvatar: string | null;
	image: string | null;
	/** Détails propres au type : champs touchés, compteurs sociaux. */
	fields: string[];
	likes: number;
	comments: number;
	readingMinutes: number | null;
	tags: string[];
}

export interface FeedPage {
	filter: FeedFilter;
	page: number;
	pages: number;
	entries: FeedEntry[];
	/** `true` s'il reste quelque chose après cette page. */
	hasMore: boolean;
}

/** URL canonique d'une page du fil (page 1 = la racine de l'onglet). */
export function feedHref(filter: FeedFilter, page = 1): string {
	const base = filter === "tout" ? "/news/fil" : `/news/fil/${filter}`;
	return page <= 1 ? base : `${base}/page/${page}`;
}

// --- Sources ---------------------------------------------------------------

async function articleEntries(limit: number): Promise<FeedEntry[]> {
	const rows = await db.query.posts.findMany({
		where: publicPostFilter(),
		orderBy: [desc(posts.publishedAt)],
		limit,
		columns: {
			id: true,
			slug: true,
			title: true,
			excerpt: true,
			cover: true,
			publishedAt: true,
			readingMinutes: true,
			tags: true,
		},
		with: { author: { columns: { username: true, avatar: true } } },
	});

	const ids = rows.map((r) => r.id);
	// Compteurs sociaux en deux requêtes pour tout le lot, jamais une par carte.
	const [likes, comments] = await Promise.all([
		reactionCounts("post", ids),
		countCommentsBatch("post", ids),
	]);

	return rows.map((r) => ({
		id: `article:${r.id}`,
		kind: "article" as const,
		at: (r.publishedAt ?? new Date()).toISOString(),
		badge: "Article",
		title: r.title,
		href: `/news/${r.slug}`,
		summary: r.excerpt,
		actor: r.author?.username ?? null,
		actorAvatar: r.author?.avatar ?? null,
		// Couverture téléversée à l'admin = chemin d'asset brut : résolu ici, pour
		// que le fil (next/image) comme tout consommateur reçoivent une URL servie.
		image: r.cover ? assetUrl(r.cover) : null,
		fields: [],
		likes: likes.get(r.id) ?? 0,
		comments: comments.get(r.id) ?? 0,
		readingMinutes: r.readingMinutes,
		tags: r.tags ?? [],
	}));
}

async function wikiEntries(limit: number): Promise<FeedEntry[]> {
	const mods = await listeModifications(limit);
	return mods.map((m) => ({
		id: `wiki:${m.id}`,
		kind: "wiki" as const,
		at: m.createdAt,
		badge: m.rubrique,
		title: m.label,
		href: m.href,
		summary: null,
		actor: m.auteur,
		actorAvatar: null,
		image: null,
		fields: m.champs,
		likes: 0,
		comments: 0,
		readingMinutes: null,
		tags: [],
	}));
}

async function contributionEntries(limit: number): Promise<FeedEntry[]> {
	// Seules les propositions ACCEPTÉES entrent dans le fil : une proposition en
	// attente n'est pas un fait établi, et l'afficher reviendrait à publier une
	// information non relue.
	const rows = await db
		.select({
			id: wikiContributions.id,
			createdAt: wikiContributions.createdAt,
			reviewedAt: wikiContributions.reviewedAt,
			authorName: wikiContributions.authorName,
			columnName: wikiContributions.columnName,
			entityLabel: wikiContributions.entityLabel,
			entityPath: wikiContributions.entityPath,
			tableName: wikiContributions.tableName,
			rowId: wikiContributions.rowId,
		})
		.from(wikiContributions)
		.where(and(eq(wikiContributions.status, "accepted"), isNotNull(wikiContributions.reviewedAt)))
		.orderBy(desc(wikiContributions.reviewedAt))
		.limit(limit);

	return rows.map((r) => ({
		id: `contribution:${r.id}`,
		kind: "contribution" as const,
		at: (r.reviewedAt ?? r.createdAt).toISOString(),
		badge: "Contribution",
		title: r.entityLabel ?? `${r.tableName} #${r.rowId}`,
		href: r.entityPath,
		summary: null,
		actor: r.authorName,
		actorAvatar: null,
		image: null,
		fields: [CONTRIBUTABLE_COLUMNS[r.columnName]?.label ?? r.columnName],
		likes: 0,
		comments: 0,
		readingMinutes: null,
		tags: [],
	}));
}

async function discussionEntries(limit: number): Promise<FeedEntry[]> {
	const rows = await db
		.select({
			id: contentComments.id,
			body: contentComments.body,
			createdAt: contentComments.createdAt,
			targetKind: contentComments.targetKind,
			targetId: contentComments.targetId,
			authorName: contentComments.authorName,
			agentName: contentComments.agentName,
			username: users.username,
			avatar: users.avatar,
		})
		.from(contentComments)
		.leftJoin(users, eq(users.id, contentComments.authorId))
		.where(eq(contentComments.status, "visible"))
		.orderBy(desc(contentComments.createdAt))
		.limit(limit);

	// Les commentaires d'articles sont les seuls dont on puisse fabriquer l'URL
	// sans requête supplémentaire par ligne : on résout les slugs par lot.
	const postIds = [...new Set(rows.filter((r) => r.targetKind === "post").map((r) => r.targetId))];
	const slugs = new Map<string, { slug: string; title: string }>();
	if (postIds.length > 0) {
		const articles = await db
			.select({ id: posts.id, slug: posts.slug, title: posts.title })
			.from(posts)
			.where(and(inArray(posts.id, postIds), publicPostFilter()));
		for (const a of articles) slugs.set(a.id, { slug: a.slug, title: a.title });
	}

	return rows.flatMap((r) => {
		const article = r.targetKind === "post" ? slugs.get(r.targetId) : undefined;
		// Un commentaire dont la cible n'est plus publique ne doit pas rester
		// visible dans le fil : il fuiterait le titre d'un brouillon dépublié.
		if (r.targetKind === "post" && !article) return [];
		return [
			{
				id: `discussion:${r.id}`,
				kind: "discussion" as const,
				at: r.createdAt.toISOString(),
				badge: "Discussion",
				title: article ? article.title : "Fiche du wiki",
				href: article ? `/news/${article.slug}#c-${r.id}` : null,
				summary: r.body.length > 240 ? `${r.body.slice(0, 237)}…` : r.body,
				actor: r.authorName ?? r.username ?? r.agentName ?? null,
				actorAvatar: r.avatar,
				image: null,
				fields: [],
				likes: 0,
				comments: 0,
				readingMinutes: null,
				tags: [],
			},
		];
	});
}

// --- Fusion ----------------------------------------------------------------

const SOURCES: Record<FeedKind, (limit: number) => Promise<FeedEntry[]>> = {
	article: articleEntries,
	wiki: wikiEntries,
	contribution: contributionEntries,
	discussion: discussionEntries,
};

/**
 * Une page du fil. `page` est borné par `FEED_MAX_PAGES` ; au-delà la fonction
 * renvoie une page vide plutôt que de tirer des milliers de lignes.
 */
export async function listFeed(
	opts: { filter?: FeedFilter; page?: number; perPage?: number } = {}
): Promise<FeedPage> {
	const filter = opts.filter ?? "tout";
	const perPage = Math.min(50, Math.max(5, opts.perPage ?? FEED_PER_PAGE));
	const page = Math.max(1, Math.min(FEED_MAX_PAGES, Math.trunc(opts.page ?? 1)));

	const kinds = FILTER_KINDS[filter];
	// `+1` : une entrée de plus que nécessaire suffit à savoir s'il y a une suite,
	// sans compter le total de quatre sources hétérogènes.
	const need = page * perPage + 1;

	const parts = await Promise.all(
		kinds.map((kind) =>
			SOURCES[kind](need).catch((err) => {
				// Une source en panne (table wiki absente en dev) ne doit pas faire
				// tomber tout le fil : le reste s'affiche.
				console.error(`[feed] source ${kind}`, err);
				return [] as FeedEntry[];
			})
		)
	);

	const merged = parts.flat().toSorted((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
	const start = (page - 1) * perPage;
	const entries = merged.slice(start, start + perPage);
	const hasMore = merged.length > start + perPage;

	return {
		filter,
		page,
		pages: Math.min(FEED_MAX_PAGES, Math.max(page, Math.ceil(merged.length / perPage))),
		entries,
		hasMore,
	};
}

/** Compteurs d'en-tête du fil — « 142 articles · 3 100 révisions · … ». */
export async function feedCounters(): Promise<{
	articles: number;
	revisions: number;
	contributions: number;
	discussions: number;
}> {
	const [articles, revisions, contributions, discussions] = await Promise.all([
		db.$count(posts, publicPostFilter()),
		// `$count` sur la table déclarée plutôt qu'un fragment SQL brut : le
		// fragment compilait mais n'aurait été validé qu'à l'exécution, sur une
		// page publique.
		db.$count(wikiRevisions).catch(() => 0),
		db.$count(wikiContributions, eq(wikiContributions.status, "accepted")),
		db.$count(contentComments, eq(contentComments.status, "visible")),
	]);
	return { articles, revisions, contributions, discussions };
}
