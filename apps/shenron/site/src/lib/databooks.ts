import "server-only";

/**
 * Databooks — accès serveur unique (lecture, recherche, écriture).
 *
 * La rubrique n'avait qu'une lecture minimale dans `db-universe.ts` : ni
 * recherche, ni écriture, ni type d'entrée. Impossible d'alimenter ou de
 * corriger les 318 fiches autrement qu'à la main dans Postgres. Ce module
 * rassemble les trois et sert de socle à `/api/databooks`.
 *
 * **Recherche** : plein texte français, adossée à l'index GIN `db_databooks_fts`
 * (titre + titre japonais + auteur + description). Le trigramme existant, posé
 * sur le seul titre, ne trouvait rien dans une description de plusieurs milliers
 * de signes.
 *
 * **Index Redis** : tenu à jour à chaque écriture (cf. `databooks-redis.ts`).
 * Best-effort — une panne Redis ne fait jamais échouer une écriture Postgres.
 */
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { revalidateWikiEntity } from "@/lib/wiki-revalidate";
import { botDatabooks } from "@/db/bot-schema";
import { wikiRevisions } from "@/db/schema";
import { forgetDatabook, indexDatabook } from "@/lib/databooks-redis";
import { toSeconds } from "@/lib/epoch";
import { normalizePages, type DatabookPageInput } from "@/lib/databooks-rules";
import { CLE_VERIFIEE } from "@/lib/databooks-defauts";

/** Fiche telle que servie par l'API. */
export interface DatabookRecord {
	id: number;
	kind: string;
	title: string;
	title_ja: string | null;
	author: string | null;
	published_at: number | null;
	cover: string | null;
	description: string | null;
	source_url: string | null;
	category: string | null;
	visible: boolean;
	pages: DatabookPageInput[];
}

/** Champs acceptés en écriture. Une clé absente n'est pas touchée. */
export interface DatabookWrite {
	kind?: string;
	title?: string;
	title_ja?: string | null;
	author?: string | null;
	published_at?: number | null;
	cover?: string | null;
	description?: string | null;
	source_url?: string | null;
	category?: string | null;
	visible?: boolean;
	pages?: DatabookPageInput[];
}

export interface DatabookQuery {
	kind?: string;
	category?: string;
	/** Recherche plein texte (titre, titre japonais, auteur, description). */
	q?: string;
	/** Inclure les fiches masquées — réservé aux appels authentifiés. */
	includeHidden?: boolean;
	order?: "asc" | "desc";
	limit?: number;
	offset?: number;
}

;
;

const DATABOOK_KINDS = ["databook", "interview", "artbook"] as const;
export const DATABOOK_LIMIT_MAX = 200;
const LIMIT_DEFAUT = 50;

type Row = typeof botDatabooks.$inferSelect;

function toRecord(r: Row): DatabookRecord {
	return {
		id: Number(r.id),
		kind: r.kind,
		title: r.title,
		title_ja: r.titleJa ?? null,
		author: r.author ?? null,
		published_at: r.publishedAt == null ? null : Number(r.publishedAt),
		cover: r.cover ?? null,
		description: r.description ?? null,
		source_url: r.sourceUrl ?? null,
		category: r.category ?? null,
		visible: r.visible !== false,
		pages: normalizePages(r.pages),
	};
}

/** Expression `tsvector` — DOIT rester identique à l'index `db_databooks_fts`. */
const FTS = sql`to_tsvector('french',
	coalesce(${botDatabooks.title}, '') || ' ' ||
	coalesce(${botDatabooks.titleJa}, '') || ' ' ||
	coalesce(${botDatabooks.author}, '') || ' ' ||
	coalesce(${botDatabooks.description}, ''))`;

export async function listDatabooks(
	opts: DatabookQuery = {}
): Promise<{ items: DatabookRecord[]; total: number; limit: number; offset: number }> {
	const limit = Math.min(DATABOOK_LIMIT_MAX, Math.max(1, opts.limit ?? LIMIT_DEFAUT));
	const offset = Math.max(0, opts.offset ?? 0);

	const conds = [];
	if (!opts.includeHidden) conds.push(eq(botDatabooks.visible, true));
	if (opts.kind) conds.push(eq(botDatabooks.kind, opts.kind));
	if (opts.category) conds.push(eq(botDatabooks.category, opts.category));
	const terme = opts.q?.trim();
	if (terme) conds.push(sql`${FTS} @@ plainto_tsquery('french', ${terme})`);
	const where = conds.length ? and(...conds) : undefined;

	const [rows, compte] = await Promise.all([
		db
			.select()
			.from(botDatabooks)
			.where(where)
			.orderBy(
				opts.order === "asc" ? asc(botDatabooks.publishedAt) : desc(botDatabooks.publishedAt)
			)
			.limit(limit)
			.offset(offset),
		db
			.select({ n: sql<number>`count(*)::int` })
			.from(botDatabooks)
			.where(where),
	]);

	return { items: rows.map(toRecord), total: compte[0]?.n ?? 0, limit, offset };
}

export async function getDatabook(id: number): Promise<DatabookRecord | null> {
	if (!Number.isSafeInteger(id) || id <= 0) return null;
	const [row] = await db.select().from(botDatabooks).where(eq(botDatabooks.id, id)).limit(1);
	return row ? toRecord(row) : null;
}

/** Traduit un patch d'API en colonnes Drizzle, en ignorant les clés absentes. */
function toColumns(w: DatabookWrite): Record<string, unknown> {
	const c: Record<string, unknown> = {};
	if (w.kind !== undefined) c.kind = w.kind;
	if (w.title !== undefined) c.title = w.title;
	if (w.title_ja !== undefined) c.titleJa = w.title_ja;
	if (w.author !== undefined) c.author = w.author;
	// Normalisé en secondes : l'API est ouverte à des clients externes, et un
	// `Date.now()` déposé tel quel créerait deux unités dans la même colonne.
	if (w.published_at !== undefined) {
		c.publishedAt =
			w.published_at === null || !Number.isFinite(w.published_at)
				? null
				: toSeconds(w.published_at);
	}
	if (w.cover !== undefined) c.cover = w.cover;
	if (w.description !== undefined) c.description = w.description;
	if (w.source_url !== undefined) c.sourceUrl = w.source_url;
	if (w.category !== undefined) c.category = w.category;
	if (w.visible !== undefined) c.visible = w.visible;
	// La clé du drapeau n'est écrite que quand elle vaut `true` : poser
	// `verifiee: false` sur 11 778 planches gonflerait le jsonb sans rien dire
	// de plus que son absence.
	if (w.pages !== undefined) {
		c.pages = normalizePages(w.pages).map(({ verifiee, ...p }) =>
			verifiee ? Object.assign(p, { [CLE_VERIFIEE]: true }) : p
		);
	}
	return c;
}

export async function createDatabook(w: DatabookWrite): Promise<DatabookRecord> {
	const titre = w.title?.trim();
	if (!titre) throw new Error("`title` est requis.");
	const [row] = await db
		.insert(botDatabooks)
		.values({ ...toColumns(w), title: titre, kind: w.kind?.trim() || "databook" } as never)
		.returning();
	const rec = toRecord(row as Row);
	await indexDatabook(rec);
	// L'index Redis ne suffit pas : les pages publiques sont statiques
	// (`revalidate = 3600`). Sans cette purge, un ouvrage créé par un outil
	// externe reste absent de la grille pendant une heure — le défaut que les
	// routes `pages` et `transcription` corrigent déjà de leur côté.
	revalidateWikiEntity("db_databooks", { id: rec.id });
	return rec;
}

export async function updateDatabook(id: number, w: DatabookWrite): Promise<DatabookRecord | null> {
	if (!Number.isSafeInteger(id) || id <= 0) return null;
	const cols = toColumns(w);
	if (Object.keys(cols).length === 0) return getDatabook(id);
	const [row] = await db
		.update(botDatabooks)
		.set(cols as never)
		.where(eq(botDatabooks.id, id))
		.returning();
	if (!row) return null;
	const rec = toRecord(row as Row);
	await indexDatabook(rec);
	revalidateWikiEntity("db_databooks", { id: rec.id });
	return rec;
}

export async function deleteDatabook(id: number): Promise<boolean> {
	if (!Number.isSafeInteger(id) || id <= 0) return false;
	const hidden = await db.transaction(async (tx) => {
		const [before] = await tx.select().from(botDatabooks).where(eq(botDatabooks.id, id)).limit(1);
		if (!before) return false;
		const [after] = await tx
			.update(botDatabooks)
			.set({ visible: false })
			.where(eq(botDatabooks.id, id))
			.returning();
		await tx.insert(wikiRevisions).values({
			tableName: "db_databooks",
			rowId: String(id),
			action: "visibility",
			label: before.title.slice(0, 200),
			before: { ...before, pages: undefined },
			after: { ...after, pages: undefined },
			editorId: "api-token",
			editorName: "API Databooks",
		});
		return true;
	});
	if (!hidden) return false;
	await forgetDatabook(id);
	// Sans purge, la fiche d'un ouvrage MASQUÉ continue d'être servie —
	// couverture, description et planches comprises — jusqu'à une heure.
	revalidateWikiEntity("db_databooks", { id });
	return true;
}
