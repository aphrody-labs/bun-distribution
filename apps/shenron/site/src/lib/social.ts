/**
 * social — commentaires et réactions, **un seul chemin d'écriture** pour toutes
 * les surfaces du site (articles, fiches wiki, databooks, tier lists).
 *
 * Trois principes, qui expliquent toutes les décisions du fichier :
 *
 *  1. **La cible est vérifiée, pas supposée.** `kind` n'est pas une clé
 *     étrangère (une fiche wiki vit dans le schéma `bot.*`), donc chaque
 *     écriture commence par `resolveTarget()` : si la cible n'existe pas ou
 *     n'est pas publique, l'écriture est refusée. Sans ça, n'importe qui
 *     pourrait écrire des commentaires sur un brouillon, ou sur un id inventé,
 *     et empiler des lignes que personne ne verra jamais.
 *
 *  2. **Un fil a deux niveaux, pas N.** Un commentaire, ses réponses. Les fils
 *     infinis demandent un arbre récursif (CTE + rendu imbriqué) pour un gain
 *     de lecture nul sur un wiki. `parentId` d'un parent doit donc être NULL.
 *
 *  3. **Rien n'est supprimé physiquement côté modération.** `hidden` garde la
 *     ligne et la trace du modérateur ; `deleted` est réservé à l'auteur qui
 *     retire son propre message. L'historique de modération doit rester
 *     lisible — c'est la contrepartie d'un wiki participatif.
 *
 * Server-only : Drizzle + `bot.*` via `lib/wiki-admin` et `lib/databooks`.
 */
import "server-only";
import { and, desc, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { db } from "@/lib/db";
import {
	contentComments,
	contentReactions,
	posts,
	tierlists,
	users,
	type CommentStatus,
} from "@/db/schema";
import { publicPostFilter } from "@/lib/posts";
import { getWikiRow, isWikiTable } from "@/lib/wiki-admin";
import { getDatabook } from "@/lib/databooks";
import {
	COMMENTS_PER_PAGE,
	COMMENT_MAX,
	COMMENT_MIN,
	HIDDEN_COMMENT_BODY,
	REPLIES_PREVIEW,
	parseWikiTargetId,
	type CommentPage,
	type CommentSort,
	type CommentView,
	type SocialKind,
	type SocialTarget,
} from "@/lib/social-shared";

/** Identité de l'auteur d'une écriture : un membre OU un agent, jamais les deux. */
export type SocialActor =
	| { type: "user"; id: string; name: string; isAdmin: boolean }
	| { type: "agent"; name: string; canModerate: boolean };

export class SocialError extends Error {
	constructor(
		readonly code: string,
		readonly status = 400
	) {
		super(code);
		this.name = "SocialError";
	}
}

/** Métadonnées d'une cible existante — sert aussi à la file de modération. */
interface ResolvedTarget {
	kind: SocialKind;
	id: string;
	label: string;
	/** URL publique, quand la surface en a une. */
	href: string | null;
}

/**
 * La cible existe-t-elle, et est-elle publiquement visible ?
 *
 * Chaque `kind` a son propre résolveur parce que chaque surface a sa propre
 * règle de visibilité : un article programmé n'est pas public (`publicPostFilter`),
 * un databook masqué non plus (`visible`), une fiche wiki dépend de sa table.
 */
async function resolveTarget(target: SocialTarget): Promise<ResolvedTarget | null> {
	switch (target.kind) {
		case "post": {
			const row = await db.query.posts.findFirst({
				where: and(eq(posts.id, target.id), publicPostFilter()),
				columns: { id: true, title: true, slug: true },
			});
			return row
				? { kind: "post", id: row.id, label: row.title, href: `/news/${row.slug}` }
				: null;
		}
		case "wiki": {
			const parsed = parseWikiTargetId(target.id);
			if (!parsed || !isWikiTable(parsed.table)) return null;
			const row = await getWikiRow(parsed.table, parsed.rowId);
			if (!row) return null;
			const label =
				[row.name, row.title, row.label, row.slug].find(
					(v): v is string => typeof v === "string" && v.length > 0
				) ?? `${parsed.table} #${parsed.rowId}`;
			// Le chemin public d'une fiche dépend de sa famille (personnage, saga,
			// technique…) et se calcule côté page ; la modération passe par le studio.
			return { kind: "wiki", id: target.id, label, href: null };
		}
		case "databook": {
			const id = Number(target.id);
			const row = await getDatabook(id);
			if (!row || !row.visible) return null;
			return {
				kind: "databook",
				id: String(row.id),
				label: row.title,
				href: `/wiki/databooks/${row.id}`,
			};
		}
		case "tierlist": {
			const row = await db.query.tierlists.findFirst({
				where: and(eq(tierlists.id, target.id), eq(tierlists.published, true)),
				columns: { id: true, title: true, slug: true },
			});
			return row
				? { kind: "tierlist", id: row.id, label: row.title, href: `/tierlists/${row.slug}` }
				: null;
		}
		case "comment": {
			// Réaction sur un commentaire : la cible est le commentaire lui-même.
			const row = await db.query.contentComments.findFirst({
				where: and(eq(contentComments.id, target.id), eq(contentComments.status, "visible")),
				columns: { id: true, body: true },
			});
			return row
				? { kind: "comment", id: row.id, label: row.body.slice(0, 60), href: null }
				: null;
		}
	}
}

// --- Lecture ---------------------------------------------------------------

type CommentRow = {
	id: string;
	body: string;
	createdAt: Date;
	updatedAt: Date;
	edited: boolean;
	pinned: boolean;
	status: CommentStatus;
	authorId: string | null;
	authorName: string | null;
	agentName: string | null;
	author: { username: string; avatar: string | null } | null;
};

/** Traduit une ligne en vue publique. Le corps masqué n'est jamais renvoyé. */
function toView(
	row: CommentRow,
	opts: { likes: number; liked: boolean; viewerId: string | null; replyCount?: number }
): CommentView {
	const hidden = row.status !== "visible";
	return {
		id: row.id,
		body: hidden ? HIDDEN_COMMENT_BODY : row.body,
		createdAt: row.createdAt.toISOString(),
		updatedAt: row.updatedAt.toISOString(),
		edited: row.edited,
		pinned: row.pinned,
		hidden,
		authorId: row.authorId,
		// Pseudo figé d'abord : si le compte a été supprimé, la jointure est vide
		// mais le crédit reste juste.
		authorName: row.authorName ?? row.author?.username ?? row.agentName ?? "Anonyme",
		authorAvatar: row.author?.avatar ?? null,
		agentName: row.agentName,
		likes: opts.likes,
		liked: opts.liked,
		mine: Boolean(opts.viewerId && row.authorId === opts.viewerId),
		replyCount: opts.replyCount ?? 0,
		replies: [],
	};
}

/**
 * Lecture de commentaires en `select()` explicite, jointure auteur incluse.
 *
 * Le query builder relationnel (`db.query…`) serait plus court, mais il alias la
 * table principale : toute expression SQL écrite à la main (le compteur de
 * réactions du tri « populaire ») référencerait un nom qui n'existe pas dans la
 * requête générée. Une seule forme de lecture, donc, pour les racines comme pour
 * les réponses.
 */
async function selectComments(
	where: SQL | undefined,
	orderBy: (SQL | PgColumn)[],
	opts: { limit?: number; offset?: number } = {}
): Promise<(CommentRow & { parentId: string | null })[]> {
	const query = db
		.select({
			id: contentComments.id,
			body: contentComments.body,
			createdAt: contentComments.createdAt,
			updatedAt: contentComments.updatedAt,
			edited: contentComments.edited,
			pinned: contentComments.pinned,
			status: contentComments.status,
			authorId: contentComments.authorId,
			authorName: contentComments.authorName,
			agentName: contentComments.agentName,
			parentId: contentComments.parentId,
			username: users.username,
			avatar: users.avatar,
		})
		.from(contentComments)
		.leftJoin(users, eq(users.id, contentComments.authorId))
		.where(where)
		.orderBy(...orderBy);

	const rows = await (opts.limit !== undefined
		? query.limit(opts.limit).offset(opts.offset ?? 0)
		: query);

	return rows.map((r) => ({
		id: r.id,
		body: r.body,
		createdAt: r.createdAt,
		updatedAt: r.updatedAt,
		edited: r.edited,
		pinned: r.pinned,
		status: r.status,
		authorId: r.authorId,
		authorName: r.authorName,
		agentName: r.agentName,
		parentId: r.parentId,
		// La jointure peut être vide (compte supprimé) : `authorName` figé à
		// l'écriture garde alors le crédit juste.
		author: r.username ? { username: r.username, avatar: r.avatar } : null,
	}));
}

/** Compte les « likes » d'un lot de commentaires en une seule requête. */
async function likeCounts(ids: string[]): Promise<Map<string, number>> {
	if (ids.length === 0) return new Map();
	const rows = await db
		.select({ id: contentReactions.targetId, total: sql<number>`count(*)::int` })
		.from(contentReactions)
		.where(and(eq(contentReactions.targetKind, "comment"), inArray(contentReactions.targetId, ids)))
		.groupBy(contentReactions.targetId);
	return new Map(rows.map((r) => [r.id, Number(r.total)]));
}

/** Les commentaires de ce lot que le membre courant a déjà aimés. */
async function likedByViewer(ids: string[], viewerId: string | null): Promise<Set<string>> {
	if (!viewerId || ids.length === 0) return new Set();
	const rows = await db
		.select({ id: contentReactions.targetId })
		.from(contentReactions)
		.where(
			and(
				eq(contentReactions.targetKind, "comment"),
				eq(contentReactions.userId, viewerId),
				inArray(contentReactions.targetId, ids)
			)
		);
	return new Set(rows.map((r) => r.id));
}

/**
 * Fil paginé d'une cible : racines triées, réponses attachées.
 *
 * Le tri « populaire » se fait en SQL sur le nombre de réactions (et non en JS
 * après coup) : sinon la page 2 d'un fil populaire n'aurait aucun sens, le tri
 * ne portant que sur les 20 lignes déjà ramenées.
 */
export async function listComments(
	target: SocialTarget,
	opts: { page?: number; sort?: CommentSort; viewerId?: string | null; viewerIsAdmin?: boolean } = {}
): Promise<CommentPage> {
	const page = Math.max(1, Math.trunc(opts.page ?? 1));
	const sort: CommentSort = opts.sort ?? "recent";
	const viewerId = opts.viewerId ?? null;
	const offset = (page - 1) * COMMENTS_PER_PAGE;

	const visibleOnly = opts.viewerIsAdmin
		? undefined
		: // Un commentaire supprimé par son auteur disparaît ; un commentaire masqué
			// reste en place (son emplacement dans le fil dit qu'il a existé).
			sql`${contentComments.status} <> 'deleted'`;

	const base = and(
		eq(contentComments.targetKind, target.kind),
		eq(contentComments.targetId, target.id),
		isNull(contentComments.parentId),
		visibleOnly
	);

	const total = await db.$count(contentComments, base);

	// Le tri « populaire » a besoin du compteur de réactions. Il est sélectionné
	// comme sous-requête corrélée (plutôt qu'un LEFT JOIN + GROUP BY, qui
	// obligerait à regrouper toutes les colonnes du commentaire) — et la requête
	// est un `select()` explicite, PAS le query builder relationnel : celui-ci
	// alias la table principale, ce qui ferait référencer un alias inexistant
	// depuis la sous-requête. Le tri se ferait alors sur une erreur SQL, pile sur
	// l'onglet « Plus aimés ».
	const likeExpr = sql<number>`(
		select count(*) from "ContentReaction" r
		where r."targetKind" = 'comment' and r."targetId" = "ContentComment"."id"
	)::int`;

	const orderBy =
		sort === "populaire"
			? [desc(contentComments.pinned), desc(likeExpr), desc(contentComments.createdAt)]
			: sort === "ancien"
				? [desc(contentComments.pinned), asc(contentComments.createdAt)]
				: [desc(contentComments.pinned), desc(contentComments.createdAt)];

	const roots = await selectComments(base, orderBy, {
		limit: COMMENTS_PER_PAGE,
		offset,
	});

	const rootIds = roots.map((r) => r.id);

	// Réponses : un seul aller-retour pour tout le lot, puis regroupement en
	// mémoire. `REPLIES_PREVIEW` n'est PAS appliqué en SQL (pas de `LIMIT` par
	// groupe sans window function) mais après comptage, pour afficher un vrai
	// « + N réponses ».
	const replyRows =
		rootIds.length === 0
			? []
			: await selectComments(
					and(
						inArray(contentComments.parentId, rootIds),
						opts.viewerIsAdmin ? undefined : sql`${contentComments.status} <> 'deleted'`
					),
					[asc(contentComments.createdAt)]
				);

	const allIds = [...rootIds, ...replyRows.map((r) => r.id)];
	const [likes, liked] = await Promise.all([likeCounts(allIds), likedByViewer(allIds, viewerId)]);

	const repliesByParent = new Map<string, (CommentRow & { parentId: string | null })[]>();
	for (const r of replyRows) {
		const key = r.parentId ?? "";
		const list = repliesByParent.get(key);
		if (list) list.push(r);
		else repliesByParent.set(key, [r]);
	}

	const comments = roots.map((row) => {
		const replies = repliesByParent.get(row.id) ?? [];
		const view = toView(row, {
			likes: likes.get(row.id) ?? 0,
			liked: liked.has(row.id),
			viewerId,
			replyCount: replies.length,
		});
		view.replies = replies.slice(0, REPLIES_PREVIEW).map((r) =>
			toView(r, {
				likes: likes.get(r.id) ?? 0,
				liked: liked.has(r.id),
				viewerId,
			})
		);
		return view;
	});

	return {
		target: `${target.kind}:${target.id}`,
		sort,
		page,
		pages: Math.max(1, Math.ceil(total / COMMENTS_PER_PAGE)),
		total,
		comments,
	};
}

/** Toutes les réponses d'un commentaire (bouton « voir les N réponses »). */
export async function listReplies(
	parentId: string,
	opts: { viewerId?: string | null; viewerIsAdmin?: boolean } = {}
): Promise<CommentView[]> {
	const rows = await selectComments(
		and(
			eq(contentComments.parentId, parentId),
			opts.viewerIsAdmin ? undefined : sql`${contentComments.status} <> 'deleted'`
		),
		[asc(contentComments.createdAt)]
	);

	const ids = rows.map((r) => r.id);
	const viewerId = opts.viewerId ?? null;
	const [likes, liked] = await Promise.all([likeCounts(ids), likedByViewer(ids, viewerId)]);
	return rows.map((r) =>
		toView(r, { likes: likes.get(r.id) ?? 0, liked: liked.has(r.id), viewerId })
	);
}

/** Nombre de commentaires visibles d'une cible (badge, listes, SSR). */
async function countComments(target: SocialTarget): Promise<number> {
	return db.$count(
		contentComments,
		and(
			eq(contentComments.targetKind, target.kind),
			eq(contentComments.targetId, target.id),
			eq(contentComments.status, "visible")
		)
	);
}

/** Compteurs de commentaires pour un lot de cibles du même `kind`. */
export async function countCommentsBatch(
	kind: SocialKind,
	ids: string[]
): Promise<Map<string, number>> {
	if (ids.length === 0) return new Map();
	const rows = await db
		.select({ id: contentComments.targetId, total: sql<number>`count(*)::int` })
		.from(contentComments)
		.where(
			and(
				eq(contentComments.targetKind, kind),
				eq(contentComments.status, "visible"),
				inArray(contentComments.targetId, ids)
			)
		)
		.groupBy(contentComments.targetId);
	return new Map(rows.map((r) => [r.id, Number(r.total)]));
}

// --- Écriture --------------------------------------------------------------

/** Validation commune du corps d'un commentaire. */
function normalizeBody(raw: string): string {
	const body = raw.replace(/\r\n/g, "\n").trim();
	if (body.length < COMMENT_MIN) throw new SocialError("body_empty", 400);
	if (body.length > COMMENT_MAX) throw new SocialError("body_too_long", 413);
	return body;
}

export interface CreateCommentInput {
	target: SocialTarget;
	body: string;
	parentId?: string | null;
	actor: SocialActor;
}

/**
 * Dépose un commentaire. Refuse si la cible n'est pas publique, si le parent
 * n'appartient pas à la même cible, ou si le parent est déjà une réponse.
 */
export async function createComment(input: CreateCommentInput): Promise<CommentView> {
	const body = normalizeBody(input.body);

	const resolved = await resolveTarget(input.target);
	if (!resolved) throw new SocialError("target_unknown", 404);

	let parentId: string | null = null;
	if (input.parentId) {
		const parent = await db.query.contentComments.findFirst({
			where: eq(contentComments.id, input.parentId),
			columns: { id: true, parentId: true, targetKind: true, targetId: true, status: true },
		});
		if (!parent || parent.status === "deleted") throw new SocialError("parent_invalid", 404);
		// Le parent doit porter la MÊME cible : sinon une réponse pourrait être
		// déplacée sous un autre article en passant un id arbitraire.
		if (parent.targetKind !== input.target.kind || parent.targetId !== input.target.id) {
			throw new SocialError("parent_invalid", 400);
		}
		if (parent.parentId) throw new SocialError("depth_exceeded", 400);
		parentId = parent.id;
	}

	const [row] = await db
		.insert(contentComments)
		.values({
			targetKind: input.target.kind,
			targetId: input.target.id,
			parentId,
			authorId: input.actor.type === "user" ? input.actor.id : null,
			authorName: input.actor.name,
			agentName: input.actor.type === "agent" ? input.actor.name : null,
			body,
		})
		.returning();

	if (!row) throw new SocialError("write_failed", 500);

	return toView(
		{
			...row,
			author: null,
		} as CommentRow,
		{
			likes: 0,
			liked: false,
			viewerId: input.actor.type === "user" ? input.actor.id : null,
		}
	);
}

/** Édition par l'auteur. Le corps change, la date de création non. */
export async function editComment(
	id: string,
	body: string,
	actor: SocialActor
): Promise<CommentView> {
	const next = normalizeBody(body);
	const row = await db.query.contentComments.findFirst({
		where: eq(contentComments.id, id),
		columns: { id: true, authorId: true, status: true },
	});
	if (!row) throw new SocialError("not_found", 404);
	if (row.status === "deleted") throw new SocialError("not_found", 404);

	const isOwner = actor.type === "user" && row.authorId === actor.id;
	if (!isOwner) throw new SocialError("forbidden", 403);

	const [updated] = await db
		.update(contentComments)
		.set({ body: next, edited: true, updatedAt: new Date() })
		.where(eq(contentComments.id, id))
		.returning();
	if (!updated) throw new SocialError("not_found", 404);

	return toView({ ...updated, author: null } as CommentRow, {
		likes: 0,
		liked: false,
		viewerId: actor.type === "user" ? actor.id : null,
	});
}

/**
 * Retrait d'un commentaire.
 *
 * Par l'auteur → `deleted` (il disparaît de la lecture). Par la modération →
 * `hidden` + trace du modérateur : l'emplacement reste visible dans le fil,
 * ce qui évite les « mais j'avais répondu à quoi ? ».
 */
export async function removeComment(
	id: string,
	actor: SocialActor
): Promise<{ status: CommentStatus }> {
	const row = await db.query.contentComments.findFirst({
		where: eq(contentComments.id, id),
		columns: { id: true, authorId: true },
	});
	if (!row) throw new SocialError("not_found", 404);

	const isOwner = actor.type === "user" && row.authorId === actor.id;
	const isModerator =
		(actor.type === "user" && actor.isAdmin) || (actor.type === "agent" && actor.canModerate);
	if (!isOwner && !isModerator) throw new SocialError("forbidden", 403);

	const status: CommentStatus = isOwner ? "deleted" : "hidden";
	await db
		.update(contentComments)
		.set({
			status,
			updatedAt: new Date(),
			moderatedBy: isOwner ? null : actor.name,
			moderatedAt: isOwner ? null : new Date(),
		})
		.where(eq(contentComments.id, id));
	return { status };
}

/** Modération : masquer, rétablir, épingler, désépingler. */
export async function moderateComment(
	id: string,
	action: "hide" | "restore" | "pin" | "unpin",
	actor: SocialActor
): Promise<void> {
	const allowed =
		(actor.type === "user" && actor.isAdmin) || (actor.type === "agent" && actor.canModerate);
	if (!allowed) throw new SocialError("forbidden", 403);

	const patch =
		action === "hide"
			? { status: "hidden" as CommentStatus, moderatedBy: actor.name, moderatedAt: new Date() }
			: action === "restore"
				? { status: "visible" as CommentStatus, moderatedBy: actor.name, moderatedAt: new Date() }
				: action === "pin"
					? { pinned: true }
					: { pinned: false };

	const res = await db
		.update(contentComments)
		.set({ ...patch, updatedAt: new Date() })
		.where(eq(contentComments.id, id))
		.returning({ id: contentComments.id });
	if (res.length === 0) throw new SocialError("not_found", 404);
}

// --- Réactions -------------------------------------------------------------

/**
 * Bascule le « like » d'un membre sur une cible.
 *
 * Le DELETE puis l'INSERT sont tous deux bornés par la contrainte d'unicité :
 * deux clics simultanés ne peuvent pas créer deux lignes, donc le compteur reste
 * exact sans verrou applicatif.
 */
export async function toggleReaction(
	target: SocialTarget,
	userId: string
): Promise<{ liked: boolean; likes: number }> {
	// Une réaction sur un commentaire n'a pas besoin de revalider la cible
	// parente ; pour le reste, la cible doit être publique.
	const resolved = await resolveTarget(target);
	if (!resolved) throw new SocialError("target_unknown", 404);

	const existing = await db
		.select({ id: contentReactions.id })
		.from(contentReactions)
		.where(
			and(
				eq(contentReactions.targetKind, target.kind),
				eq(contentReactions.targetId, target.id),
				eq(contentReactions.userId, userId),
				eq(contentReactions.kind, "like")
			)
		)
		.limit(1);

	if (existing.length > 0) {
		await db.delete(contentReactions).where(eq(contentReactions.id, existing[0]!.id));
	} else {
		await db
			.insert(contentReactions)
			.values({ targetKind: target.kind, targetId: target.id, userId, kind: "like" })
			.onConflictDoNothing();
	}

	const likes = await db.$count(
		contentReactions,
		and(
			eq(contentReactions.targetKind, target.kind),
			eq(contentReactions.targetId, target.id),
			eq(contentReactions.kind, "like")
		)
	);
	return { liked: existing.length === 0, likes };
}

/** Compteur de « likes » + état du membre courant, pour une cible. */
export async function reactionState(
	target: SocialTarget,
	userId: string | null
): Promise<{ likes: number; liked: boolean }> {
	const [likes, mine] = await Promise.all([
		db.$count(
			contentReactions,
			and(
				eq(contentReactions.targetKind, target.kind),
				eq(contentReactions.targetId, target.id),
				eq(contentReactions.kind, "like")
			)
		),
		userId
			? db
					.select({ id: contentReactions.id })
					.from(contentReactions)
					.where(
						and(
							eq(contentReactions.targetKind, target.kind),
							eq(contentReactions.targetId, target.id),
							eq(contentReactions.userId, userId)
						)
					)
					.limit(1)
			: Promise.resolve([]),
	]);
	return { likes, liked: mine.length > 0 };
}

/**
 * Parmi ces cibles, lesquelles le membre a-t-il aimées ?
 *
 * Renvoie des clés `kind:id` directement exploitables par l'API. Une requête par
 * `kind` présent, et non une par cible : afficher l'état d'une grille de
 * quarante cartes ne doit pas coûter quarante allers-retours.
 */
export async function myReactions(
	userId: string,
	targets: readonly SocialTarget[]
): Promise<Set<string>> {
	if (targets.length === 0) return new Set();
	const byKind = new Map<SocialKind, string[]>();
	for (const t of targets) {
		const list = byKind.get(t.kind);
		if (list) list.push(t.id);
		else byKind.set(t.kind, [t.id]);
	}

	const found = new Set<string>();
	await Promise.all(
		[...byKind.entries()].map(async ([kind, ids]) => {
			const rows = await db
				.select({ id: contentReactions.targetId })
				.from(contentReactions)
				.where(
					and(
						eq(contentReactions.targetKind, kind),
						eq(contentReactions.userId, userId),
						inArray(contentReactions.targetId, ids)
					)
				);
			for (const r of rows) found.add(`${kind}:${r.id}`);
		})
	);
	return found;
}

/** Compteurs de « likes » pour un lot de cibles (grilles, classements). */
export async function reactionCounts(kind: SocialKind, ids: string[]): Promise<Map<string, number>> {
	if (ids.length === 0) return new Map();
	const rows = await db
		.select({ id: contentReactions.targetId, total: sql<number>`count(*)::int` })
		.from(contentReactions)
		.where(
			and(
				eq(contentReactions.targetKind, kind),
				eq(contentReactions.kind, "like"),
				inArray(contentReactions.targetId, ids)
			)
		)
		.groupBy(contentReactions.targetId);
	return new Map(rows.map((r) => [r.id, Number(r.total)]));
}

// --- Modération (file d'attente) ------------------------------------------

export interface ModerationEntry {
	id: string;
	targetKind: SocialKind;
	targetId: string;
	body: string;
	status: CommentStatus;
	pinned: boolean;
	createdAt: string;
	authorName: string;
	authorId: string | null;
	agentName: string | null;
	likes: number;
	/** Lien public de la cible, quand il est calculable. */
	href: string | null;
	targetLabel: string | null;
}

/**
 * Derniers commentaires, tous supports confondus — l'écran de modération.
 *
 * Le libellé de la cible est résolu pour les seules lignes affichées : résoudre
 * toutes les cibles d'un coup demanderait une requête par table wiki.
 */
export async function listModerationQueue(
	opts: { status?: CommentStatus | "all"; limit?: number; offset?: number } = {}
): Promise<{ entries: ModerationEntry[]; total: number }> {
	const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
	const offset = Math.max(0, opts.offset ?? 0);
	const where =
		!opts.status || opts.status === "all"
			? undefined
			: eq(contentComments.status, opts.status);

	const [rows, total] = await Promise.all([
		db
			.select({
				id: contentComments.id,
				targetKind: contentComments.targetKind,
				targetId: contentComments.targetId,
				body: contentComments.body,
				status: contentComments.status,
				pinned: contentComments.pinned,
				createdAt: contentComments.createdAt,
				authorId: contentComments.authorId,
				authorName: contentComments.authorName,
				agentName: contentComments.agentName,
				username: users.username,
			})
			.from(contentComments)
			.leftJoin(users, eq(users.id, contentComments.authorId))
			.where(where)
			.orderBy(desc(contentComments.createdAt))
			.limit(limit)
			.offset(offset),
		db.$count(contentComments, where),
	]);

	const likes = await likeCounts(rows.map((r) => r.id));

	const entries = await Promise.all(
		rows.map(async (r) => {
			const resolved = await resolveTarget({ kind: r.targetKind, id: r.targetId }).catch(
				() => null
			);
			return {
				id: r.id,
				targetKind: r.targetKind,
				targetId: r.targetId,
				body: r.body,
				status: r.status,
				pinned: r.pinned,
				createdAt: r.createdAt.toISOString(),
				authorName: r.authorName ?? r.username ?? r.agentName ?? "Anonyme",
				authorId: r.authorId,
				agentName: r.agentName,
				likes: likes.get(r.id) ?? 0,
				href: resolved?.href ?? null,
				targetLabel: resolved?.label ?? null,
			} satisfies ModerationEntry;
		})
	);

	return { entries, total };
}
