// Ce module rend l'archive personnelle complète d'un compte (e-mail Better Auth,
// journal de navigation, brouillons, signalements) et purge ses données. Tous
// ses voisins qui touchent la base portent cette garde ; ici elle manquait, si
// bien que rien n'empêchait un import depuis un Client Component — ce qui aurait
// tiré `postgres`/`drizzle` dans le bundle et fait fuiter la forme même de
// l'export. Cf. `docs/pieges.md` (« shenron.ts / db-universe.ts sont server-only »).
import "server-only";
import { and, count, desc, eq, or } from "drizzle-orm";
import {
	baUser,
	comments,
	editorDrafts,
	posts,
	siteEvents,
	siteRatings,
	siteReports,
	tierlists,
	tierlistVotes,
	userPreferences,
	users,
	wikiContributions,
	wikiRevisions,
} from "@/db/schema";
import { db } from "@/lib/db";

export type AccountIdentity = {
	authUserId: string;
	appUserId: string;
	discordId: string;
};

export async function readAccountSummary(appUserId: string) {
	const [
		preferenceRows,
		ratingCountRows,
		voteCountRows,
		tierlistCountRows,
		commentCountRows,
		contributionCountRows,
		reportCountRows,
		recentContributions,
		recentReports,
		recentRatings,
	] = await Promise.all([
		db
			.select({ prefs: userPreferences.prefs })
			.from(userPreferences)
			.where(eq(userPreferences.identity, `u:${appUserId}`))
			.limit(1),
		db.select({ value: count() }).from(siteRatings).where(eq(siteRatings.userId, appUserId)),
		db.select({ value: count() }).from(tierlistVotes).where(eq(tierlistVotes.userId, appUserId)),
		db.select({ value: count() }).from(tierlists).where(eq(tierlists.authorId, appUserId)),
		db.select({ value: count() }).from(comments).where(eq(comments.authorId, appUserId)),
		db
			.select({ value: count() })
			.from(wikiContributions)
			.where(eq(wikiContributions.authorId, appUserId)),
		db.select({ value: count() }).from(siteReports).where(eq(siteReports.userId, appUserId)),
		db
			.select({
				id: wikiContributions.id,
				createdAt: wikiContributions.createdAt,
				entityLabel: wikiContributions.entityLabel,
				entityPath: wikiContributions.entityPath,
				status: wikiContributions.status,
			})
			.from(wikiContributions)
			.where(eq(wikiContributions.authorId, appUserId))
			.orderBy(desc(wikiContributions.createdAt))
			.limit(4),
		db
			.select({
				id: siteReports.id,
				createdAt: siteReports.createdAt,
				pageTitle: siteReports.pageTitle,
				path: siteReports.path,
				status: siteReports.status,
			})
			.from(siteReports)
			.where(eq(siteReports.userId, appUserId))
			.orderBy(desc(siteReports.createdAt))
			.limit(4),
		db
			.select({
				id: siteRatings.id,
				createdAt: siteRatings.createdAt,
				targetType: siteRatings.targetType,
				targetId: siteRatings.targetId,
				score: siteRatings.score,
			})
			.from(siteRatings)
			.where(eq(siteRatings.userId, appUserId))
			.orderBy(desc(siteRatings.createdAt))
			.limit(4),
	]);
	const favorites = preferenceRows[0]?.prefs?.favorites;

	return {
		favorites: Array.isArray(favorites) ? favorites.length : 0,
		counts: {
			ratings: ratingCountRows[0]?.value ?? 0,
			tierlistVotes: voteCountRows[0]?.value ?? 0,
			tierlists: tierlistCountRows[0]?.value ?? 0,
			comments: commentCountRows[0]?.value ?? 0,
			wikiContributions: contributionCountRows[0]?.value ?? 0,
			reports: reportCountRows[0]?.value ?? 0,
		},
		recent: {
			contributions: recentContributions,
			reports: recentReports,
			ratings: recentRatings,
		},
	};
}

/** Activité déjà publique d'un membre, destinée à sa fiche de profil. */
export async function readPublicProfileActivity(discordId: string) {
	const [member] = await db
		.select({ id: users.id })
		.from(users)
		.where(eq(users.discordId, discordId))
		.limit(1);
	if (!member) return null;

	const [ratingRows, tierlistRows, contributionRows, commentRows, recentRatings, recentTierlists] =
		await Promise.all([
			db.select({ value: count() }).from(siteRatings).where(eq(siteRatings.userId, member.id)),
			db
				.select({ value: count() })
				.from(tierlists)
				.where(and(eq(tierlists.authorId, member.id), eq(tierlists.published, true))),
			db
				.select({ value: count() })
				.from(wikiContributions)
				.where(
					and(eq(wikiContributions.authorId, member.id), eq(wikiContributions.status, "accepted"))
				),
			db.select({ value: count() }).from(comments).where(eq(comments.authorId, member.id)),
			db
				.select({
					id: siteRatings.id,
					targetType: siteRatings.targetType,
					targetId: siteRatings.targetId,
					score: siteRatings.score,
					updatedAt: siteRatings.updatedAt,
				})
				.from(siteRatings)
				.where(eq(siteRatings.userId, member.id))
				.orderBy(desc(siteRatings.updatedAt))
				.limit(4),
			db
				.select({
					id: tierlists.id,
					slug: tierlists.slug,
					title: tierlists.title,
					updatedAt: tierlists.updatedAt,
				})
				.from(tierlists)
				.where(and(eq(tierlists.authorId, member.id), eq(tierlists.published, true)))
				.orderBy(desc(tierlists.updatedAt))
				.limit(3),
		]);

	return {
		counts: {
			ratings: ratingRows[0]?.value ?? 0,
			tierlists: tierlistRows[0]?.value ?? 0,
			contributions: contributionRows[0]?.value ?? 0,
			comments: commentRows[0]?.value ?? 0,
		},
		recentRatings,
		recentTierlists,
	};
}

/**
 * Construit l'archive personnelle du compte depuis les deux identités DBFR :
 * Better Auth (`authUserId`) et l'utilisateur métier (`appUserId`). Les secrets
 * OAuth, jetons de session et notes internes de modération sont exclus.
 */
export async function readAccountData(identity: AccountIdentity) {
	const [
		authRows,
		preferences,
		ratings,
		votes,
		userTierlists,
		userPosts,
		userComments,
		reports,
		drafts,
		contributions,
		revisions,
		events,
	] = await Promise.all([
		db
			.select({
				id: baUser.id,
				name: baUser.name,
				email: baUser.email,
				emailVerified: baUser.emailVerified,
				image: baUser.image,
				createdAt: baUser.createdAt,
				updatedAt: baUser.updatedAt,
			})
			.from(baUser)
			.where(eq(baUser.id, identity.authUserId))
			.limit(1),
		db
			.select()
			.from(userPreferences)
			.where(
				or(
					eq(userPreferences.userId, identity.appUserId),
					eq(userPreferences.identity, `u:${identity.appUserId}`)
				)
			),
		db.select().from(siteRatings).where(eq(siteRatings.userId, identity.appUserId)),
		db.select().from(tierlistVotes).where(eq(tierlistVotes.userId, identity.appUserId)),
		db.select().from(tierlists).where(eq(tierlists.authorId, identity.appUserId)),
		db.select().from(posts).where(eq(posts.authorId, identity.appUserId)),
		db.select().from(comments).where(eq(comments.authorId, identity.appUserId)),
		db
			.select({
				id: siteReports.id,
				createdAt: siteReports.createdAt,
				updatedAt: siteReports.updatedAt,
				path: siteReports.path,
				pageTitle: siteReports.pageTitle,
				category: siteReports.category,
				message: siteReports.message,
				status: siteReports.status,
				resolvedAt: siteReports.resolvedAt,
			})
			.from(siteReports)
			.where(eq(siteReports.userId, identity.appUserId)),
		db.select().from(editorDrafts).where(eq(editorDrafts.userId, identity.appUserId)),
		db.select().from(wikiContributions).where(eq(wikiContributions.authorId, identity.appUserId)),
		db.select().from(wikiRevisions).where(eq(wikiRevisions.editorId, identity.appUserId)),
		db
			.select({
				id: siteEvents.id,
				ts: siteEvents.ts,
				type: siteEvents.type,
				entityType: siteEvents.entityType,
				entityId: siteEvents.entityId,
				path: siteEvents.path,
				referrer: siteEvents.referrer,
				props: siteEvents.props,
			})
			.from(siteEvents)
			.where(eq(siteEvents.userId, identity.authUserId))
			.orderBy(desc(siteEvents.ts)),
	]);

	return {
		authentication: authRows[0] ?? null,
		preferences,
		activity: events,
		community: {
			ratings,
			tierlistVotes: votes,
			tierlists: userTierlists,
			posts: userPosts,
			comments: userComments,
			reports,
			wikiContributions: contributions,
			wikiRevisions: revisions,
			editorDrafts: drafts,
		},
	};
}

/**
 * Efface les données strictement personnelles et anonymise les contributions
 * qu'une suppression ne peut retirer sans casser les discussions ou l'historique.
 * L'opération est idempotente pour pouvoir être rejouée après un incident.
 */
export async function purgeAccountData(identity: AccountIdentity): Promise<void> {
	await db.transaction(async (tx) => {
		// Une transaction postgres-js réserve une connexion : les opérations sont
		// volontairement séquentielles afin qu'une erreur annule tout le lot et
		// qu'aucune requête concurrente ne continue après un rollback.
		await tx.delete(siteEvents).where(eq(siteEvents.userId, identity.authUserId));
		await tx
			.delete(userPreferences)
			.where(
				or(
					eq(userPreferences.userId, identity.appUserId),
					eq(userPreferences.identity, `u:${identity.appUserId}`)
				)
			);
		await tx.delete(tierlistVotes).where(eq(tierlistVotes.userId, identity.appUserId));
		await tx.delete(siteRatings).where(eq(siteRatings.userId, identity.appUserId));
		await tx.delete(editorDrafts).where(eq(editorDrafts.userId, identity.appUserId));
		await tx
			.update(siteReports)
			.set({
				userId: null,
				discordId: null,
				username: "Compte supprimé",
				userAgent: null,
			})
			.where(eq(siteReports.userId, identity.appUserId));
		await tx
			.update(wikiContributions)
			.set({
				authorId: null,
				authorName: "Compte supprimé",
				authorDiscordId: null,
			})
			.where(eq(wikiContributions.authorId, identity.appUserId));
		await tx
			.update(wikiRevisions)
			.set({ editorId: null, editorName: "Compte supprimé" })
			.where(eq(wikiRevisions.editorId, identity.appUserId));

		await tx
			.update(users)
			.set({
				discordId: `deleted:${crypto.randomUUID()}`,
				username: "Compte supprimé",
				avatar: null,
				roleAdmin: false,
			})
			.where(and(eq(users.id, identity.appUserId), eq(users.discordId, identity.discordId)));
	});
}
