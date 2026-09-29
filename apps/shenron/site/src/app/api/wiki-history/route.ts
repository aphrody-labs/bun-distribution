/**
 * /api/wiki-history — flux d'activité éditoriale du wiki + retour arrière.
 *
 *   GET  ?limit&offset&table&rowId&action → { rows, total, limit, offset }
 *        (sans table/rowId = flux global récent ; avec = historique d'une entité)
 *   POST { id }                            → revert de la révision `id`
 *
 * Server-only, gate admin (Better Auth + roleAdmin). Après un revert on purge le
 * cache ISR de la page publique impactée.
 */
import { getCurrentUser, isCurrentUserAdmin } from "@/lib/session";
import { getWikiRow } from "@/lib/wiki-admin";
import { listRevisions, revertRevision, type RevisionActor } from "@/lib/wiki-revisions";
import { revalidateWikiEntity } from "@/lib/wiki-revalidate";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forbidden = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const badRequest = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

async function currentActor(): Promise<RevisionActor> {
	try {
		const me = await getCurrentUser();
		if (!me?.user) return null;
		return { id: me.user.id ?? null, name: me.user.username ?? null };
	} catch {
		return null;
	}
}

export async function GET(req: NextRequest) {
	if (!(await isCurrentUserAdmin())) return forbidden();
	const sp = req.nextUrl.searchParams;
	try {
		const result = await listRevisions({
			table: sp.get("table") ?? undefined,
			rowId: sp.get("rowId") ?? undefined,
			action: sp.get("action") ?? undefined,
			limit: Number(sp.get("limit")) || 50,
			offset: Number(sp.get("offset")) || 0,
		});
		return NextResponse.json(result);
	} catch (err) {
		return writeFailed("wiki-history", err);
	}
}

export async function POST(req: NextRequest) {
	if (!(await isCurrentUserAdmin())) return forbidden();
	let body: { id?: string } | null = null;
	try {
		body = (await req.json()) as { id?: string };
	} catch {
		return badRequest("JSON body requis");
	}
	if (!body?.id) return badRequest("id requis");
	try {
		const res = await revertRevision(body.id, await currentActor());
		// Purge la page publique de l'entité restaurée.
		const row = res.row ?? (await getWikiRow(res.table, res.rowId).catch(() => null));
		revalidateWikiEntity(res.table, row ?? { id: res.rowId });
		return NextResponse.json({ ok: true, ...res });
	} catch (err) {
		return writeFailed("wiki-history", err);
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
