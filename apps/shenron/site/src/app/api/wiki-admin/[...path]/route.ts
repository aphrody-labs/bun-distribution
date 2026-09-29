/**
 * /api/wiki-admin/* — CRUD **direct sur Postgres** (schéma `bot`) pour le wiki
 * éditorial Dragon Ball. Remplace le proxy `/api/bot-admin/database/:table` pour
 * les tables dont Postgres est la source de vérité (cf. `WIKI_TABLES`).
 *
 * Server-only : importe `wiki-admin.ts` (Drizzle/Postgres) → jamais bundlé côté
 * client. Gate admin via Better Auth + `users.roleAdmin` (`isCurrentUserAdmin`).
 *
 * Chaque écriture (create/update/delete + bascule de visibilité une-ligne) laisse
 * une **révision** (`public.wiki_revisions`) : snapshot avant/après + auteur, pour
 * le flux d'activité /admin/wiki/history, le panneau historique du studio, et le
 * retour arrière. Best-effort : une révision ratée ne fait jamais échouer l'édit.
 *
 * Contrat aligné sur l'API bot `/api/database` pour réutiliser les composants
 * Client verbatim :
 *   GET    /:table?limit&offset  → { rows, total, limit, offset }
 *   GET    /:table?as=byParent&col&id → { rows, total } (enfants 1-N d'un parent)
 *   GET    /:table/:id           → row (objet brut, camelCase) | 404
 *   POST   /:table               → { ok: true, row }
 *   PUT    /:table/:id           → { ok: true, row }
 *   PATCH  /:table/:id           → { ok: true, row }
 *   DELETE /:table/:id           → { ok: true }
 */
import { getCurrentUser, isCurrentUserAdmin } from "@/lib/session";
import {
	deleteWiki,
	getWikiRow,
	hasVisibility,
	insertWiki,
	isWikiTable,
	listWiki,
	listWikiByParent,
	listWikiOptions,
	listWikiRelations,
	listWikiSectionsForEntity,
	listWikiVisibility,
	setAllWikiVisibility,
	setWikiVisibility,
	updateWiki,
} from "@/lib/wiki-admin";
import {
	recordBulkVisibilityRevision,
	recordRevision,
	type RevisionActor,
} from "@/lib/wiki-revisions";
import { revalidateSectionParent, revalidateWikiEntity } from "@/lib/wiki-revalidate";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

/** Auteur figé de la révision (best-effort ; null si non résolu). */
async function currentActor(): Promise<RevisionActor> {
	try {
		const me = await getCurrentUser();
		if (!me?.user) return null;
		return { id: me.user.id ?? null, name: me.user.username ?? null };
	} catch {
		return null;
	}
}

const forbidden = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const notFound = (msg = "Table inconnue") => NextResponse.json({ error: msg }, { status: 404 });
const badRequest = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

async function readJson(req: NextRequest): Promise<Record<string, unknown> | null> {
	try {
		return (await req.json()) as Record<string, unknown>;
	} catch {
		return null;
	}
}

export async function GET(req: NextRequest, ctx: Ctx) {
	if (!(await isCurrentUserAdmin())) return forbidden();
	const { path } = await ctx.params;
	const [table, id] = path;
	if (!table || !isWikiTable(table)) return notFound();

	try {
		if (id != null) {
			const row = await getWikiRow(table, decodeURIComponent(id));
			if (!row) return notFound("Row introuvable");
			return NextResponse.json(row);
		}
		const sp = req.nextUrl.searchParams;
		// Picker FK : pk + libellé seulement (léger, trié, non tronqué à 500).
		if (sp.get("as") === "options") {
			return NextResponse.json({ options: await listWikiOptions(table) });
		}
		// Relations N-N : ids liés dans une table de jointure.
		if (sp.get("as") === "relations") {
			const col = sp.get("col") ?? "";
			const relId = sp.get("id") ?? "";
			const target = sp.get("target") ?? "";
			if (!col || !relId || !target) return badRequest("col, id, target requis");
			return NextResponse.json({ ids: await listWikiRelations(table, col, relId, target) });
		}
		// Relations 1-N : lignes enfants d'un parent (transformations d'un personnage).
		// Sans ce mode, la requête retombait sur la liste générique et le panneau
		// affichait les 50 premières transformations de toute la table.
		if (sp.get("as") === "byParent") {
			const col = sp.get("col") ?? "";
			const parentId = sp.get("id") ?? "";
			if (!col || !parentId) return badRequest("col, id requis");
			return NextResponse.json(await listWikiByParent(table, col, parentId));
		}
		// Gestionnaire de visibilité : id + libellé + image + état visible.
		if (sp.get("as") === "visibility") {
			if (!hasVisibility(table)) return badRequest("Table sans colonne de visibilité");
			const q = sp.get("q") ?? undefined;
			return NextResponse.json({ items: await listWikiVisibility(table, { q }) });
		}
		// Sections d'une entité (toutes, masquées comprises) pour le panneau du studio.
		if (sp.get("as") === "sectionsFor") {
			if (table !== "db_wiki_sections") return badRequest("Réservé à db_wiki_sections");
			const entityType = sp.get("entityType") ?? "";
			const entityId = Number(sp.get("entityId"));
			if (!entityType || !Number.isFinite(entityId)) {
				return badRequest("entityType, entityId requis");
			}
			return NextResponse.json({ items: await listWikiSectionsForEntity(entityType, entityId) });
		}
		const limit = Number(sp.get("limit")) || 50;
		const offset = Number(sp.get("offset")) || 0;
		const q = sp.get("q") ?? undefined;
		return NextResponse.json(await listWiki(table, { limit, offset, q }));
	} catch (err) {
		return writeFailed("wiki-admin", err);
	}
}

export async function POST(req: NextRequest, ctx: Ctx) {
	if (!(await isCurrentUserAdmin())) return forbidden();
	const { path } = await ctx.params;
	const [table] = path;
	if (!table || !isWikiTable(table)) return notFound();
	const body = await readJson(req);
	if (!body) return badRequest("JSON body requis");
	try {
		// Bascule de visibilité (une ligne ou toute la table) — écrit la colonne
		// `visible` directement (pas via l'allowlist mutable de l'éditeur générique).
		if (req.nextUrl.searchParams.get("as") === "visibility") {
			if (!hasVisibility(table)) return badRequest("Table sans colonne de visibilité");
			const visible = body.visible === true || body.visible === "true" || body.visible === 1;
			if (body.all === true || body.all === "true") {
				// L'audit est écrit AVANT la réponse, et son échec fait échouer la
				// requête : une bascule de masse non tracée est irréversible. C'est
				// ce `return` prématuré qui a laissé 2 309 lignes masquées en prod
				// sans aucune trace dans `wiki_revisions`.
				const { updated, previous } = await setAllWikiVisibility(table, visible);
				await recordBulkVisibilityRevision({
					table,
					visible,
					previous,
					updated,
					actor: await currentActor(),
				});
				revalidateWikiEntity(table);
				return NextResponse.json({ ok: true, updated, reversible: previous.length > 0 });
			}
			const id = body.id;
			if (id == null || id === "") return badRequest("id ou all requis");
			const prev = await getWikiRow(table, String(id)).catch(() => null);
			await setWikiVisibility(table, String(id), visible);
			const row = await getWikiRow(table, String(id)).catch(() => null);
			revalidateWikiEntity(table, row ?? { id });
			await recordRevision({
				table,
				id: String(id),
				action: "visibility",
				before: { ...prev, visible: prev?.visible !== false },
				after: { ...(row ?? { id }), visible },
				actor: await currentActor(),
			});
			return NextResponse.json({ ok: true });
		}
		const row = await insertWiki(table, body);
		revalidateWikiEntity(table, row);
		if (table === "db_wiki_sections") await revalidateSectionParent(row);
		await recordRevision({ table, action: "create", after: row, actor: await currentActor() });
		return NextResponse.json({ ok: true, row });
	} catch (err) {
		return writeFailed("wiki-admin", err);
	}
}

async function mutate(req: NextRequest, ctx: Ctx) {
	if (!(await isCurrentUserAdmin())) return forbidden();
	const { path } = await ctx.params;
	const [table, id] = path;
	if (!table || !isWikiTable(table)) return notFound();
	if (id == null) return badRequest("id requis");
	const body = await readJson(req);
	if (!body) return badRequest("JSON body requis");
	try {
		const decoded = decodeURIComponent(id);
		// Snapshot AVANT pour la révision (diff avant/après + retour arrière).
		const before = await getWikiRow(table, decoded).catch(() => null);
		const row = await updateWiki(table, decoded, body);
		revalidateWikiEntity(table, row);
		if (table === "db_wiki_sections") await revalidateSectionParent(row);
		await recordRevision({
			table,
			id: decoded,
			action: "update",
			before,
			after: row,
			actor: await currentActor(),
		});
		return NextResponse.json({ ok: true, row });
	} catch (err) {
		return writeFailed("wiki-admin", err);
	}
}

export const PUT = mutate;
export const PATCH = mutate;

export async function DELETE(req: NextRequest, ctx: Ctx) {
	if (!(await isCurrentUserAdmin())) return forbidden();
	const { path } = await ctx.params;
	const [table, id] = path;
	if (!table || !isWikiTable(table)) return notFound();
	if (id == null) return badRequest("id requis");
	try {
		const decoded = decodeURIComponent(id);
		// On lit la ligne AVANT suppression pour purger la page détail (slug/id) qui
		// n'existe plus après coup, et tracer la révision (retour arrière possible).
		const before = await getWikiRow(table, decoded).catch(() => null);
		await deleteWiki(table, decoded, await currentActor());
		revalidateWikiEntity(table, before ?? { id: decoded });
		if (table === "db_wiki_sections") await revalidateSectionParent(before ?? undefined);
		return NextResponse.json({ ok: true });
	} catch (err) {
		return writeFailed("wiki-admin", err);
	}
}

/**
 * Erreur d'écriture → réponse propre, et journalisation côté serveur.
 *
 * Auparavant : `badRequest(err.message)`. Deux défauts. (1) Les messages de
 * postgres-js portent les noms de contrainte, de colonne et de table — de la
 * cartographie de schéma offerte au client. (2) Une panne de la base répondait
 * **400** et n'écrivait **rien** dans le journal : côté exploitation, une
 * indisponibilité était indiscernable d'une saisie invalide.
 *
 * Les erreurs métier (levées volontairement par `wiki-admin.ts`, ex. « Ligne
 * introuvable ») restent renvoyées telles quelles : elles sont écrites pour
 * l'utilisateur et ne contiennent rien d'interne.
 */
function writeFailed(context: string, err: unknown): NextResponse {
	const msg = err instanceof Error ? err.message : String(err);
	console.error(`[${context}]`, err);
	// Signature d'une erreur du pilote PostgreSQL (code SQLSTATE) → on masque.
	const isDriverError =
		typeof (err as { code?: unknown })?.code === "string" ||
		/constraint|violates|relation |column |syntax error/i.test(msg);
	if (isDriverError) {
		return NextResponse.json({ error: "Écriture refusée par la base." }, { status: 500 });
	}
	return NextResponse.json({ error: msg || "erreur" }, { status: 400 });
}
