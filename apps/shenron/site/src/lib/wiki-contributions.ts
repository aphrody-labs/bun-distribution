/**
 * wiki-contributions — propositions de correction venues de la communauté.
 *
 * Le wiki avait deux extrêmes et rien entre les deux : le signalement en texte
 * libre (`site_reports`), qui laisse tout le travail au modérateur, et
 * l'édition directe (`/api/wiki-admin`), réservée aux admins. Ce module porte
 * l'entre-deux : un membre connecté propose **la valeur exacte** qu'il veut
 * voir à la place, avec ses sources ; un modérateur voit le diff et applique
 * d'un clic.
 *
 * Deux principes non négociables :
 *
 *  1. **Un seul chemin d'écriture.** L'acceptation passe par `updateWiki` +
 *     `recordRevision`, exactement comme une édition admin. Une contribution
 *     n'est donc jamais un contournement des gardes existantes, et elle est
 *     annulable par le même « revert » que tout le reste.
 *  2. **Le crédit est réel.** La révision est enregistrée au nom du
 *     contributeur, pas du modérateur qui a cliqué. C'est ce qui fait que
 *     l'historique public dit la vérité sur qui a écrit le wiki.
 *
 * Conflit : `valueBefore` est comparée à la valeur en base au moment
 * d'appliquer. Si elle a bougé, on refuse — sinon accepter une vieille
 * proposition écraserait silencieusement le travail de quelqu'un d'autre.
 *
 * Server-only : Drizzle/Postgres + réutilise le CRUD de `wiki-admin.ts`.
 */
import "server-only";
import { and, count, desc, eq, sql as raw } from "drizzle-orm";
import { db } from "@/lib/db";
import { wikiContributions, type ContributionStatus, type WikiContribution } from "@/db/schema";
import { getWikiRow, updateWiki } from "@/lib/wiki-admin";
import { recordRevision, type RevisionActor } from "@/lib/wiki-revisions";
import { revalidateWikiEntity, revalidateSectionParent } from "@/lib/wiki-revalidate";
import { isContributableColumn, CONTRIBUTION_MAX } from "@/lib/contributions-shared";
import {
	ecrireTranscription,
	estCiblePlanche,
	lireTranscription,
	numeroDePlanche,
} from "@/lib/databook-pages";
import { estCibleStats, formatStats, fusionnerStats, parseStats } from "@/lib/stats-personnage";
import { WIKI_TABLE_SPECS } from "@/lib/wiki-tables";

export interface ContributionView {
	id: string;
	createdAt: string;
	authorName: string | null;
	authorId: string | null;
	tableName: string;
	rowId: string;
	columnName: string;
	entityLabel: string | null;
	entityPath: string | null;
	valueBefore: string | null;
	valueAfter: string;
	comment: string | null;
	sources: string | null;
	status: ContributionStatus;
	reviewerName: string | null;
	reviewNote: string | null;
	reviewedAt: string | null;
	revisionId: string | null;
}

function toView(r: WikiContribution): ContributionView {
	return {
		id: r.id,
		createdAt: r.createdAt.toISOString(),
		authorName: r.authorName,
		authorId: r.authorId,
		tableName: r.tableName,
		rowId: r.rowId,
		columnName: r.columnName,
		entityLabel: r.entityLabel,
		entityPath: r.entityPath,
		valueBefore: r.valueBefore,
		valueAfter: r.valueAfter,
		comment: r.comment,
		sources: r.sources,
		status: r.status as ContributionStatus,
		reviewerName: r.reviewerName,
		reviewNote: r.reviewNote,
		reviewedAt: r.reviewedAt?.toISOString() ?? null,
		revisionId: r.revisionId,
	};
}

/** Une cible est valide si la table est wiki, la colonne mutable ET ouverte. */
export function targetIsValid(table: string, column: string): boolean {
	// Cas particulier : `pages#42` désigne la transcription d'UNE planche de
	// databook. Ce n'est pas une colonne de la table (le jsonb `pages` l'est),
	// donc `mutableColumns` ne peut pas trancher — c'est `estCiblePlanche` qui
	// valide la forme, et le module dédié qui fera l'écriture ciblée.
	if (estCiblePlanche(table, column)) return true;
	// La zone de statistiques d'un personnage : un jsonb libre, proposé et relu
	// sous forme de texte (« Ki : 8 000 » par ligne). Elle n'est pas dans
	// `CONTRIBUTABLE_COLUMNS`, qui ne décrit que des colonnes de TEXTE — et
	// c'est bien la liberté de cette zone qu'on ouvre : rien n'oblige à parler
	// de ki, une fiche peut porter « Santé » ou « Portée ».
	if (estCibleStats(table, column)) return true;
	const spec = WIKI_TABLE_SPECS[table];
	if (!spec) return false;
	if (!spec.mutableColumns.includes(column)) return false;
	return isContributableColumn(column);
}

/** Valeur courante d'une colonne, normalisée en chaîne (ou null). */
async function currentValue(table: string, rowId: string, column: string): Promise<string | null> {
	const planche = estCiblePlanche(table, column) ? numeroDePlanche(column) : null;
	if (planche !== null) return await lireTranscription(rowId, planche);
	const row = await getWikiRow(table, rowId);
	// Les statistiques voyagent en texte dans les deux sens : c'est ce que le
	// contributeur écrit, et ce que le relecteur compare en diff.
	if (row && estCibleStats(table, column)) {
		return formatStats((row as Record<string, unknown>).stats);
	}
	if (!row) return null;
	const v = (row as Record<string, unknown>)[column];
	return v == null ? null : String(v);
}

/**
 * Deux valeurs sont « la même » si elles ne diffèrent que par les fins de ligne
 * et les blancs de bord. Sans ça, un copier-coller depuis un navigateur (CRLF)
 * ferait passer une proposition identique pour un conflit.
 */
function sameText(a: string | null, b: string | null): boolean {
	const norm = (v: string | null) => (v ?? "").replace(/\r\n/g, "\n").trim();
	return norm(a) === norm(b);
}

export class ContributionError extends Error {
	constructor(
		message: string,
		readonly code: string,
		readonly status = 400
	) {
		super(message);
	}
}

/** Dépose une proposition. Ne touche RIEN au wiki — c'est tout l'intérêt. */
export async function createContribution(input: {
	table: string;
	rowId: string;
	column: string;
	valueAfter: string;
	comment?: string | null;
	sources?: string | null;
	entityPath?: string | null;
	author: { id: string; name: string | null; discordId: string | null };
}): Promise<ContributionView> {
	if (!targetIsValid(input.table, input.column)) {
		throw new ContributionError("Cible non modifiable par proposition.", "bad_target");
	}
	if (input.valueAfter.length > CONTRIBUTION_MAX) {
		throw new ContributionError("Texte trop long.", "too_long");
	}

	const row = await getWikiRow(input.table, input.rowId);
	if (!row) throw new ContributionError("Fiche introuvable.", "not_found", 404);

	const before = await currentValue(input.table, input.rowId, input.column);
	if (sameText(before, input.valueAfter)) {
		throw new ContributionError("Le texte proposé est identique à l'actuel.", "no_change");
	}

	const label = ["name", "title", "label"]
		.map((k) => (row as Record<string, unknown>)[k])
		.find((v) => typeof v === "string" && v.trim());

	const [created] = await db
		.insert(wikiContributions)
		.values({
			authorId: input.author.id,
			authorName: input.author.name,
			authorDiscordId: input.author.discordId,
			tableName: input.table,
			rowId: input.rowId,
			columnName: input.column,
			entityLabel: typeof label === "string" ? label.slice(0, 200) : null,
			entityPath: input.entityPath?.slice(0, 512) ?? null,
			valueBefore: before,
			valueAfter: input.valueAfter,
			comment: input.comment?.trim() || null,
			sources: input.sources?.trim() || null,
			status: "pending",
		})
		.returning();

	return toView(created!);
}

export interface ListOptions {
	status?: string;
	authorId?: string;
	table?: string;
	rowId?: string;
	limit?: number;
	offset?: number;
}

export async function listContributions(
	opts: ListOptions = {}
): Promise<{ rows: ContributionView[]; total: number; limit: number; offset: number }> {
	const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
	const offset = Math.max(opts.offset ?? 0, 0);
	const conds = [
		opts.status ? eq(wikiContributions.status, opts.status) : undefined,
		opts.authorId ? eq(wikiContributions.authorId, opts.authorId) : undefined,
		opts.table ? eq(wikiContributions.tableName, opts.table) : undefined,
		opts.rowId ? eq(wikiContributions.rowId, opts.rowId) : undefined,
	].filter(Boolean);
	const where = conds.length ? and(...(conds as NonNullable<(typeof conds)[number]>[])) : undefined;

	const [rows, [tot]] = await Promise.all([
		db
			.select()
			.from(wikiContributions)
			.where(where)
			.orderBy(desc(wikiContributions.createdAt))
			.limit(limit)
			.offset(offset),
		db.select({ n: count() }).from(wikiContributions).where(where),
	]);

	return { rows: rows.map(toView), total: Number(tot?.n ?? 0), limit, offset };
}

/** Effectif par statut — sert le badge « N en attente » de la navigation admin. */
export async function countByStatus(): Promise<Record<string, number>> {
	const rows = await db
		.select({ status: wikiContributions.status, n: count() })
		.from(wikiContributions)
		.groupBy(wikiContributions.status);
	return Object.fromEntries(rows.map((r) => [r.status, Number(r.n)]));
}

async function getContribution(id: string): Promise<ContributionView | null> {
	const [r] = await db
		.select()
		.from(wikiContributions)
		.where(eq(wikiContributions.id, id))
		.limit(1);
	return r ? toView(r) : null;
}

/**
 * Accepte une proposition : applique la valeur au wiki et journalise la
 * révision **au nom du contributeur**.
 *
 * Refuse si la valeur en base a bougé depuis le dépôt (`superseded`) : le
 * modérateur voit alors le nouveau texte et peut redemander une proposition
 * rebasée, plutôt que d'écraser sans le savoir.
 */
export async function acceptContribution(
	id: string,
	reviewer: RevisionActor,
	note?: string | null
): Promise<ContributionView> {
	const [row] = await db
		.select()
		.from(wikiContributions)
		.where(eq(wikiContributions.id, id))
		.limit(1);
	if (!row) throw new ContributionError("Proposition introuvable.", "not_found", 404);
	if (row.status !== "pending") {
		throw new ContributionError("Proposition déjà traitée.", "already_reviewed", 409);
	}
	if (!targetIsValid(row.tableName, row.columnName)) {
		throw new ContributionError("Cible devenue non modifiable.", "bad_target");
	}

	const before = await getWikiRow(row.tableName, row.rowId);
	if (!before) throw new ContributionError("Fiche supprimée depuis.", "not_found", 404);

	// Valeur en base AU MOMENT D'APPLIQUER. Passe par `currentValue` et non par
	// la ligne lue plus haut : une cible `pages#42` n'est pas une clé de la
	// ligne, `before["pages#42"]` vaudrait toujours `undefined` — et toute
	// contribution sur une planche serait classée « obsolète » sans avoir jamais
	// été comparée à quoi que ce soit.
	const actuelStr = await currentValue(row.tableName, row.rowId, row.columnName);
	if (!sameText(actuelStr, row.valueBefore)) {
		await db
			.update(wikiContributions)
			.set({
				status: "superseded",
				reviewerId: reviewer?.id ?? null,
				reviewerName: reviewer?.name ?? null,
				reviewNote: "La valeur en base a changé depuis le dépôt de la proposition.",
				reviewedAt: new Date(),
				updatedAt: new Date(),
			})
			.where(eq(wikiContributions.id, id));
		throw new ContributionError(
			"La fiche a changé depuis cette proposition — elle est marquée obsolète.",
			"superseded",
			409
		);
	}

	// Écriture. Une planche de databook passe par `jsonb_set` ciblé (le tableau
	// `pages` n'est PAS réécrit en entier — deux corrections sur le même ouvrage
	// ne peuvent donc pas s'écraser l'une l'autre) ; tout le reste passe par le
	// chemin d'écriture normal du wiki.
	const planche = estCiblePlanche(row.tableName, row.columnName)
		? numeroDePlanche(row.columnName)
		: null;
	let after: Record<string, unknown>;
	if (estCibleStats(row.tableName, row.columnName)) {
		// Retour au jsonb, en conservant les accents de couleur déjà posés : le
		// contributeur corrige une mesure, il ne repeint pas la fiche.
		const stats = fusionnerStats(
			parseStats(row.valueAfter),
			(before as Record<string, unknown>).stats
		);
		after = await updateWiki(row.tableName, row.rowId, { stats });
	} else if (planche !== null) {
		const ok = await ecrireTranscription(row.rowId, planche, row.valueAfter);
		if (!ok) throw new ContributionError("Planche introuvable dans cet ouvrage.", "not_found", 404);
		after = { [row.columnName]: row.valueAfter };
	} else {
		after = await updateWiki(row.tableName, row.rowId, { [row.columnName]: row.valueAfter });
	}

	// Le crédit va au contributeur : c'est lui qui a écrit le texte. Le
	// modérateur reste identifié sur la contribution (`reviewerName`).
	const revisionId = await recordRevision({
		table: row.tableName,
		id: row.rowId,
		action: "update",
		before,
		after,
		actor: { id: row.authorId, name: row.authorName },
	});

	revalidateWikiEntity(row.tableName, after);
	if (row.tableName === "db_wiki_sections") {
		await revalidateSectionParent(after as Record<string, unknown>);
	}

	const [updated] = await db
		.update(wikiContributions)
		.set({
			status: "accepted",
			reviewerId: reviewer?.id ?? null,
			reviewerName: reviewer?.name ?? null,
			reviewNote: note?.trim() || null,
			reviewedAt: new Date(),
			updatedAt: new Date(),
			revisionId,
		})
		.where(eq(wikiContributions.id, id))
		.returning();

	return toView(updated!);
}

/** Refuse une proposition. La note est ce que verra le contributeur — la remplir. */
export async function rejectContribution(
	id: string,
	reviewer: RevisionActor,
	note?: string | null
): Promise<ContributionView> {
	const [updated] = await db
		.update(wikiContributions)
		.set({
			status: "rejected",
			reviewerId: reviewer?.id ?? null,
			reviewerName: reviewer?.name ?? null,
			reviewNote: note?.trim() || null,
			reviewedAt: new Date(),
			updatedAt: new Date(),
		})
		.where(and(eq(wikiContributions.id, id), eq(wikiContributions.status, "pending")))
		.returning();
	if (!updated) {
		throw new ContributionError("Proposition introuvable ou déjà traitée.", "not_found", 404);
	}
	return toView(updated);
}

/** Retrait par l'auteur — possible tant que personne n'a modéré. */
export async function withdrawContribution(id: string, authorId: string): Promise<void> {
	const [updated] = await db
		.update(wikiContributions)
		.set({ status: "withdrawn", updatedAt: new Date() })
		.where(
			and(
				eq(wikiContributions.id, id),
				eq(wikiContributions.authorId, authorId),
				eq(wikiContributions.status, "pending")
			)
		)
		.returning({ id: wikiContributions.id });
	if (!updated) {
		throw new ContributionError("Proposition introuvable ou déjà traitée.", "not_found", 404);
	}
}

export interface ContributorStat {
	authorId: string;
	authorName: string;
	accepted: number;
	pending: number;
	lastAt: string;
}

/**
 * Palmarès public des contributeurs — comptes d'après les propositions
 * **acceptées** uniquement : déposer beaucoup ne vaut pas contribuer.
 */
export async function topContributors(limit = 50): Promise<ContributorStat[]> {
	const rows = await db
		.select({
			authorId: wikiContributions.authorId,
			authorName: wikiContributions.authorName,
			accepted: raw<number>`count(*) filter (where ${wikiContributions.status} = 'accepted')`,
			pending: raw<number>`count(*) filter (where ${wikiContributions.status} = 'pending')`,
			lastAt: raw<Date>`max(${wikiContributions.createdAt})`,
		})
		.from(wikiContributions)
		.groupBy(wikiContributions.authorId, wikiContributions.authorName)
		.orderBy(raw`count(*) filter (where ${wikiContributions.status} = 'accepted') desc`)
		.limit(limit);

	return rows
		.filter((r) => r.authorId && Number(r.accepted) > 0)
		.map((r) => ({
			authorId: r.authorId!,
			authorName: r.authorName ?? "Anonyme",
			accepted: Number(r.accepted),
			pending: Number(r.pending),
			lastAt: new Date(r.lastAt).toISOString(),
		}));
}
