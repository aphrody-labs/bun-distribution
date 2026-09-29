/**
 * Notes communautaires (1–5 étoiles) sur fiches wiki : jeux, épisodes, films, arcs.
 * Server-only — écriture Postgres site (pas le miroir bot).
 *
 * Règles :
 *  - une note par (targetType, targetId, userId) — upsert
 *  - comment optionnel (max RATING_COMMENT_MAX)
 *  - lecture publique (moyenne + count + derniers commentaires)
 *  - écriture réservée aux membres connectés (compte Discord lié)
 *  - suppression de commentaire/note : auteur ou admin
 */
import "server-only";
import { and, avg, count, desc, eq, inArray, sql } from "drizzle-orm";
import { createId } from "@paralleldrive/cuid2";
import { db } from "@/lib/db";
import { siteRatings, users, type RatingTargetType, type SiteRating } from "@/db/schema";

// Les règles pures vivent dans `ratings-rules.ts` (client-safe) : ce module
// impose `server-only`, ce qui les rendait intestables et forçait le fichier de
// test à en tenir une copie. Réexportées ici pour ne rien casser côté appelants.
export {

	RATING_COMMENT_MAX,


	isRatingTargetType,

	type RatingTargetType,
} from "@/lib/ratings-rules";

import { RATING_COMMENT_MAX, clampScore } from "@/lib/ratings-rules";

export type RatingSummary = {
	average: number;
	count: number;
};

type RatingComment = {
	id: string;
	score: number;
	comment: string;
	createdAt: string;
	updatedAt: string;
	author: {
		id: string;
		username: string;
		avatar: string | null;
	};
};

type UserRating = {
	id: string;
	score: number;
	comment: string | null;
	createdAt: string;
	updatedAt: string;
};

export type RatingState = {
	summary: RatingSummary;
	mine: UserRating | null;
	comments: RatingComment[];
};

function emptySummary(): RatingSummary {
	return { average: 0, count: 0 };
}

function rowToMine(r: SiteRating): UserRating {
	return {
		id: r.id,
		score: r.score,
		comment: r.comment,
		createdAt: r.createdAt.toISOString(),
		updatedAt: r.updatedAt.toISOString(),
	};
}

/** Moyenne + count pour une entité. */
async function getRatingSummary(
	targetType: RatingTargetType,
	targetId: string
): Promise<RatingSummary> {
	const [row] = await db
		.select({
			average: avg(siteRatings.score),
			count: count(),
		})
		.from(siteRatings)
		.where(and(eq(siteRatings.targetType, targetType), eq(siteRatings.targetId, targetId)));

	const c = Number(row?.count ?? 0);
	if (!c) return emptySummary();
	const a = Number(row?.average ?? 0);
	return { average: Math.round(a * 10) / 10, count: c };
}

/**
 * Résumés pour une liste d'ids (grille jeux, etc.).
 * Retourne une Map targetId → summary (ids sans note absents de la map).
 */
export async function getRatingSummaries(
	targetType: RatingTargetType,
	targetIds: string[]
): Promise<Map<string, RatingSummary>> {
	const map = new Map<string, RatingSummary>();
	if (targetIds.length === 0) return map;

	const rows = await db
		.select({
			targetId: siteRatings.targetId,
			average: avg(siteRatings.score),
			count: count(),
		})
		.from(siteRatings)
		.where(and(eq(siteRatings.targetType, targetType), inArray(siteRatings.targetId, targetIds)))
		.groupBy(siteRatings.targetId);

	for (const r of rows) {
		const c = Number(r.count ?? 0);
		if (!c) continue;
		map.set(r.targetId, {
			average: Math.round(Number(r.average ?? 0) * 10) / 10,
			count: c,
		});
	}
	return map;
}

/**
 * Agrégat multi-cibles (ex. moyenne d'une saga = toutes les notes de ses arcs).
 */
export async function getAggregateSummary(
	targetType: RatingTargetType,
	targetIds: string[]
): Promise<RatingSummary> {
	if (targetIds.length === 0) return emptySummary();

	const [row] = await db
		.select({
			average: avg(siteRatings.score),
			count: count(),
		})
		.from(siteRatings)
		.where(and(eq(siteRatings.targetType, targetType), inArray(siteRatings.targetId, targetIds)));

	const c = Number(row?.count ?? 0);
	if (!c) return emptySummary();
	return {
		average: Math.round(Number(row?.average ?? 0) * 10) / 10,
		count: c,
	};
}

/** Derniers commentaires non vides pour une entité. */
async function listRatingComments(
	targetType: RatingTargetType,
	targetId: string,
	limit = 30
): Promise<RatingComment[]> {
	const rows = await db
		.select({
			id: siteRatings.id,
			score: siteRatings.score,
			comment: siteRatings.comment,
			createdAt: siteRatings.createdAt,
			updatedAt: siteRatings.updatedAt,
			authorId: users.id,
			username: users.username,
			avatar: users.avatar,
			// PAS de `users.discordId` : `GET /api/ratings` est public et le client
			// n'affiche jamais ce champ (cf. `EntityRating`). Le sérialiser exposait
			// l'identifiant Discord de chaque commentateur à n'importe qui.
		})
		.from(siteRatings)
		.innerJoin(users, eq(users.id, siteRatings.userId))
		.where(
			and(
				eq(siteRatings.targetType, targetType),
				eq(siteRatings.targetId, targetId),
				sql`${siteRatings.comment} IS NOT NULL AND length(trim(${siteRatings.comment})) > 0`
			)
		)
		.orderBy(desc(siteRatings.updatedAt))
		.limit(limit);

	return rows.map((r) => ({
		id: r.id,
		score: r.score,
		comment: (r.comment ?? "").trim(),
		createdAt: r.createdAt.toISOString(),
		updatedAt: r.updatedAt.toISOString(),
		author: {
			id: r.authorId,
			username: r.username,
			avatar: r.avatar,
		},
	}));
}

async function getUserRating(
	targetType: RatingTargetType,
	targetId: string,
	userId: string
): Promise<UserRating | null> {
	const [row] = await db
		.select()
		.from(siteRatings)
		.where(
			and(
				eq(siteRatings.targetType, targetType),
				eq(siteRatings.targetId, targetId),
				eq(siteRatings.userId, userId)
			)
		)
		.limit(1);
	return row ? rowToMine(row) : null;
}

/** État complet pour le panneau client (moyenne + ma note + commentaires). */
export async function getRatingState(
	targetType: RatingTargetType,
	targetId: string,
	userId: string | null
): Promise<RatingState> {
	const [summary, mine, comments] = await Promise.all([
		getRatingSummary(targetType, targetId),
		userId ? getUserRating(targetType, targetId, userId) : Promise.resolve(null),
		listRatingComments(targetType, targetId),
	]);
	return { summary, mine, comments };
}

/**
 * Crée ou met à jour la note de l'utilisateur. `comment` :
 *  - `undefined` → ne change pas le commentaire existant
 *  - `null` ou `""` → efface
 *  - string → set (trim, max RATING_COMMENT_MAX)
 */
export async function upsertRating(opts: {
	targetType: RatingTargetType;
	targetId: string;
	userId: string;
	score: number;
	comment?: string | null;
}): Promise<RatingState> {
	const score = clampScore(opts.score);
	if (score == null) throw new Error("invalid_score");

	const targetId = opts.targetId.trim().slice(0, 64);
	if (!targetId) throw new Error("invalid_target");

	let commentValue: string | null | undefined = opts.comment;
	if (commentValue !== undefined) {
		const t = (commentValue ?? "").trim();
		if (t.length > RATING_COMMENT_MAX) throw new Error("comment_too_long");
		commentValue = t.length === 0 ? null : t;
	}

	const now = new Date();
	// Écriture atomique sur la contrainte `site_ratings_target_user_unique`.
	// La forme précédente lisait la note existante puis choisissait entre UPDATE
	// et INSERT : deux clics rapprochés (ou deux onglets) passaient tous deux par
	// la branche INSERT, et le second violait la contrainte — l'appelant recevait
	// une erreur Postgres brute alors que l'intention est un upsert.
	const set: { score: number; updatedAt: Date; comment?: string | null } = {
		score,
		updatedAt: now,
	};
	// `undefined` = « ne touche pas au commentaire existant » : on l'omet du SET.
	if (commentValue !== undefined) set.comment = commentValue;

	await db
		.insert(siteRatings)
		.values({
			id: createId(),
			targetType: opts.targetType,
			targetId,
			userId: opts.userId,
			score,
			comment: commentValue === undefined ? null : commentValue,
			createdAt: now,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [siteRatings.targetType, siteRatings.targetId, siteRatings.userId],
			set,
		});

	return getRatingState(opts.targetType, targetId, opts.userId);
}

/**
 * Supprime une note (et son commentaire).
 * Autorisé : auteur OU admin (caller vérifie côté route).
 */
export async function deleteRating(id: string): Promise<{
	deleted: SiteRating | null;
}> {
	const [row] = await db.select().from(siteRatings).where(eq(siteRatings.id, id)).limit(1);
	if (!row) return { deleted: null };
	await db.delete(siteRatings).where(eq(siteRatings.id, id));
	return { deleted: row };
}

/** Efface seulement le commentaire d'une note (garde le score). Admin ou auteur. */
export async function clearRatingComment(id: string): Promise<SiteRating | null> {
	const [row] = await db.select().from(siteRatings).where(eq(siteRatings.id, id)).limit(1);
	if (!row) return null;
	const [updated] = await db
		.update(siteRatings)
		.set({ comment: null, updatedAt: new Date() })
		.where(eq(siteRatings.id, id))
		.returning();
	return updated ?? null;
}
