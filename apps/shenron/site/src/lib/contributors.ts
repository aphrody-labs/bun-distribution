/**
 * contributors — classement des membres par contribution (notes + commentaires)
 * et inspection détaillée d'un membre pour l'arbitrage d'un concours.
 *
 * Pourquoi ce module existe : un cash prize « au plus grand nombre de notes »
 * se triche en trois clics (noter 200 épisodes à 5 ★ sans rien écrire). Le
 * classement seul ne suffit donc pas — il faut pouvoir OUVRIR le dossier d'un
 * membre : chaque note, chaque commentaire, la cible, l'horodatage, et des
 * signaux de suspicion calculés sur la série (rafales, scores plats, textes
 * dupliqués). Les signaux ne décident rien : ils orientent la relecture humaine.
 *
 * Server-only : Drizzle sur le schéma `public` (notes/commentaires du site) et
 * `bot.*` (titres et slugs des entités notées).
 */
import "server-only";
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contentComments, siteRatings, users, type RatingTargetType } from "@/db/schema";
import { botArcs, botEpisodes, botGames, botMovies } from "@/db/bot-schema";
import { HIDDEN_COMMENT_BODY, type SocialKind } from "@/lib/social-shared";
import { detectCheatSignals, type CheatSignal } from "@/lib/contributors-rules";

// Règles pures (signaux d'intégrité) : hors de ce module parce que `server-only`
// les rendrait intestables — même découpage que `ratings` / `ratings-rules`.
export { detectCheatSignals, type CheatSignal } from "@/lib/contributors-rules";

/* ────────────────────────── Classement ────────────────────────── */

export type ContributorRow = {
	rank: number;
	userId: string;
	discordId: string;
	username: string;
	avatar: string | null;
	/** Notes (1–5 ★) déposées sur les fiches. */
	ratings: number;
	/** Notes accompagnées d'un texte. */
	ratingComments: number;
	/** Commentaires de fil (articles, fiches, databooks, tier lists). */
	comments: number;
	/** Total retenu pour le classement du concours. */
	score: number;
	/** Dernière activité connue (note ou commentaire). */
	lastActivity: string | null;
};

/**
 * Classement « plus grand nombre de notes ».
 *
 * Le tri porte sur `ratings` (l'objet du concours) ; les commentaires servent
 * de départage, parce qu'entre deux membres à 120 notes, celui qui a rédigé
 * 120 avis a produit plus de valeur que celui qui a cliqué 120 étoiles.
 */
export async function getTopRaters(limit = 50): Promise<ContributorRow[]> {
	const take = Math.min(200, Math.max(1, Math.trunc(limit)));

	const ratingRows = await db
		.select({
			userId: siteRatings.userId,
			total: sql<number>`count(*)::int`,
			written: sql<number>`count(*) filter (where ${siteRatings.comment} is not null and length(trim(${siteRatings.comment})) > 0)::int`,
			last: sql<Date | null>`max(${siteRatings.updatedAt})`,
		})
		.from(siteRatings)
		.groupBy(siteRatings.userId);

	const commentRows = await db
		.select({
			userId: contentComments.authorId,
			total: sql<number>`count(*)::int`,
			last: sql<Date | null>`max(${contentComments.createdAt})`,
		})
		.from(contentComments)
		.where(and(isNotNull(contentComments.authorId), sql`${contentComments.status} <> 'deleted'`))
		.groupBy(contentComments.authorId);

	type Acc = Omit<ContributorRow, "rank" | "discordId" | "username" | "avatar"> & {
		lastDate: Date | null;
	};
	const acc = new Map<string, Acc>();
	const touch = (userId: string): Acc => {
		let a = acc.get(userId);
		if (!a) {
			a = {
				userId,
				ratings: 0,
				ratingComments: 0,
				comments: 0,
				score: 0,
				lastActivity: null,
				lastDate: null,
			};
			acc.set(userId, a);
		}
		return a;
	};
	const keepLast = (a: Acc, d: Date | null) => {
		if (d && (!a.lastDate || d > a.lastDate)) a.lastDate = d;
	};

	for (const r of ratingRows) {
		const a = touch(r.userId);
		a.ratings = Number(r.total ?? 0);
		a.ratingComments = Number(r.written ?? 0);
		keepLast(a, r.last ? new Date(r.last) : null);
	}
	for (const c of commentRows) {
		if (!c.userId) continue;
		const a = touch(c.userId);
		a.comments = Number(c.total ?? 0);
		keepLast(a, c.last ? new Date(c.last) : null);
	}
	if (acc.size === 0) return [];

	const profiles = await db
		.select({
			id: users.id,
			discordId: users.discordId,
			username: users.username,
			avatar: users.avatar,
		})
		.from(users)
		.where(inArray(users.id, [...acc.keys()]));
	const byId = new Map(profiles.map((p) => [p.id, p]));

	return [...acc.values()]
		.flatMap((a) => {
			const p = byId.get(a.userId);
			// Compte supprimé entre l'agrégat et la lecture des profils : on
			// l'écarte plutôt que d'afficher un rang anonyme dans un concours.
			if (!p) return [];
			return [
				{
					...a,
					discordId: p.discordId,
					username: p.username,
					avatar: p.avatar,
					score: a.ratings + a.comments,
					lastActivity: a.lastDate ? a.lastDate.toISOString() : null,
				},
			];
		})
		.toSorted(
			(x, y) =>
				y.ratings - x.ratings ||
				y.ratingComments - x.ratingComments ||
				y.comments - x.comments ||
				x.username.localeCompare(y.username, "fr")
		)
		.slice(0, take)
		.map(({ lastDate: _lastDate, ...row }, i) => (Object.assign(row, { rank: i + 1 })));
}

/* ─────────────────── Dossier détaillé d'un membre ─────────────────── */

export type MemberRating = {
	id: string;
	targetType: RatingTargetType;
	targetId: string;
	score: number;
	comment: string | null;
	createdAt: string;
	updatedAt: string;
	/** Titre de l'entité notée, `null` si l'entité a disparu. */
	title: string | null;
	href: string | null;
};

export type MemberComment = {
	id: string;
	kind: SocialKind;
	targetId: string;
	body: string;
	status: string;
	isReply: boolean;
	createdAt: string;
	updatedAt: string;
};

export type MemberContributions = {
	member: { userId: string; discordId: string; username: string; avatar: string | null };
	counts: {
		ratings: number;
		ratingComments: number;
		comments: number;
		averageScore: number;
	};
	ratings: MemberRating[];
	comments: MemberComment[];
	signals: CheatSignal[];
	truncated: boolean;
};

const RATING_PAGE_MAX = 500;

function entityHref(type: RatingTargetType, slugOrId: string): string {
	switch (type) {
		case "episode":
			return `/wiki/episodes/${slugOrId}`;
		case "movie":
			return `/wiki/films/${slugOrId}`;
		case "game":
			return `/wiki/jeux/${slugOrId}`;
		case "arc":
			return `/wiki/arcs/${slugOrId}`;
	}
}

/**
 * Titre + lien des entités notées, un lot par type.
 * Les ids non numériques sont ignorés : `db_*` est indexé par entier.
 */
async function resolveTargets(
	rows: Array<{ targetType: string; targetId: string }>
): Promise<Map<string, { title: string; href: string }>> {
	const out = new Map<string, { title: string; href: string }>();
	const byType = new Map<RatingTargetType, number[]>();
	for (const r of rows) {
		if (!/^\d+$/.test(r.targetId)) continue;
		const t = r.targetType as RatingTargetType;
		if (!byType.has(t)) byType.set(t, []);
		byType.get(t)!.push(Number(r.targetId));
	}

	for (const [type, ids] of byType) {
		const unique = [...new Set(ids)];
		if (unique.length === 0) continue;

		if (type === "episode") {
			const eps = await db
				.select({
					id: botEpisodes.id,
					series: botEpisodes.series,
					num: botEpisodes.numberInSeries,
					title: botEpisodes.title,
				})
				.from(botEpisodes)
				.where(inArray(botEpisodes.id, unique));
			for (const e of eps) {
				const serie = (e.series ?? "").replace(/_/g, " ");
				const label = e.title?.trim() || `Épisode ${e.num ?? e.id}`;
				out.set(`episode:${e.id}`, {
					title: `${serie} · ${e.num ?? e.id} — ${label}`,
					href: entityHref("episode", String(e.id)),
				});
			}
			continue;
		}
		if (type === "movie") {
			const rowsM = await db
				.select({ id: botMovies.id, slug: botMovies.slug, title: botMovies.title })
				.from(botMovies)
				.where(inArray(botMovies.id, unique));
			for (const m of rowsM) {
				out.set(`movie:${m.id}`, { title: m.title, href: entityHref("movie", m.slug) });
			}
			continue;
		}
		if (type === "game") {
			const rowsG = await db
				.select({ id: botGames.id, slug: botGames.slug, title: botGames.title })
				.from(botGames)
				.where(inArray(botGames.id, unique));
			for (const g of rowsG) {
				out.set(`game:${g.id}`, { title: g.title, href: entityHref("game", g.slug) });
			}
			continue;
		}
		const rowsA = await db
			.select({ id: botArcs.id, slug: botArcs.slug, name: botArcs.name })
			.from(botArcs)
			.where(inArray(botArcs.id, unique));
		for (const a of rowsA) {
			out.set(`arc:${a.id}`, { title: a.name, href: entityHref("arc", a.slug) });
		}
	}
	return out;
}

/**
 * Dossier d'un membre (par identifiant Discord). `null` si inconnu.
 *
 * `viewerIsAdmin` décide de ce qui sort de la base, pas seulement de ce qui
 * s'affiche : hors staff, un commentaire supprimé par son auteur n'est pas
 * renvoyé et le texte d'un commentaire masqué par la modération est remplacé —
 * exactement le contrat de `lib/social.ts`. Sans ça, le registre du concours
 * serait devenu une porte de sortie publique pour les messages retirés.
 */
export async function getMemberContributions(
	discordId: string,
	opts: { limit?: number; viewerIsAdmin?: boolean } = {}
): Promise<MemberContributions | null> {
	const viewerIsAdmin = opts.viewerIsAdmin === true;
	const limit = Math.min(RATING_PAGE_MAX, Math.max(1, Math.trunc(opts.limit ?? 200)));

	const [member] = await db
		.select({
			id: users.id,
			discordId: users.discordId,
			username: users.username,
			avatar: users.avatar,
		})
		.from(users)
		.where(eq(users.discordId, discordId))
		.limit(1);
	if (!member) return null;

	const [ratingRows, commentRows, totals] = await Promise.all([
		db
			.select({
				id: siteRatings.id,
				targetType: siteRatings.targetType,
				targetId: siteRatings.targetId,
				score: siteRatings.score,
				comment: siteRatings.comment,
				createdAt: siteRatings.createdAt,
				updatedAt: siteRatings.updatedAt,
			})
			.from(siteRatings)
			.where(eq(siteRatings.userId, member.id))
			.orderBy(desc(siteRatings.updatedAt))
			.limit(limit + 1),
		db
			.select({
				id: contentComments.id,
				kind: contentComments.targetKind,
				targetId: contentComments.targetId,
				parentId: contentComments.parentId,
				body: contentComments.body,
				status: contentComments.status,
				createdAt: contentComments.createdAt,
				updatedAt: contentComments.updatedAt,
			})
			.from(contentComments)
			.where(
				and(
					eq(contentComments.authorId, member.id),
					viewerIsAdmin ? undefined : sql`${contentComments.status} <> 'deleted'`
				)
			)
			.orderBy(desc(contentComments.createdAt))
			.limit(limit),
		db
			.select({
				ratings: sql<number>`count(*)::int`,
				written: sql<number>`count(*) filter (where ${siteRatings.comment} is not null and length(trim(${siteRatings.comment})) > 0)::int`,
				average: sql<string>`coalesce(avg(${siteRatings.score}), 0)::float8`,
			})
			.from(siteRatings)
			.where(eq(siteRatings.userId, member.id)),
	]);

	const truncated = ratingRows.length > limit;
	const page = truncated ? ratingRows.slice(0, limit) : ratingRows;
	const targets = await resolveTargets(page);

	const ratings: MemberRating[] = page.map((r) => {
		const resolved = targets.get(`${r.targetType}:${r.targetId}`);
		return {
			id: r.id,
			targetType: r.targetType as RatingTargetType,
			targetId: r.targetId,
			score: r.score,
			comment: r.comment,
			createdAt: r.createdAt.toISOString(),
			updatedAt: r.updatedAt.toISOString(),
			title: resolved?.title ?? null,
			href: resolved?.href ?? null,
		};
	});

	const comments: MemberComment[] = commentRows.map((c) => ({
		id: c.id,
		kind: c.kind,
		targetId: c.targetId,
		body: !viewerIsAdmin && c.status !== "visible" ? HIDDEN_COMMENT_BODY : c.body,
		status: c.status,
		isReply: c.parentId != null,
		createdAt: c.createdAt.toISOString(),
		updatedAt: c.updatedAt.toISOString(),
	}));

	const t = totals[0];
	return {
		member: {
			userId: member.id,
			discordId: member.discordId,
			username: member.username,
			avatar: member.avatar,
		},
		counts: {
			ratings: Number(t?.ratings ?? 0),
			ratingComments: Number(t?.written ?? 0),
			comments: comments.length,
			averageScore: Math.round(Number(t?.average ?? 0) * 10) / 10,
		},
		ratings,
		comments,
		signals: detectCheatSignals(ratings, comments),
		truncated,
	};
}
