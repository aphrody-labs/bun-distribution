/**
 * /api/chronologie-config — curation de la chronologie universelle (gate admin).
 *
 *   GET → { config, items }   config résolue + dataset brut (épisodes + films)
 *                             pour alimenter l'éditeur `/admin/chronologie`
 *   PUT → { ok, config }      enregistre le patch (upsert singleton) + revalide
 *                             `/wiki/chronologie`
 *
 * Le gate admin réutilise `isCurrentUserAdmin` / `getCurrentUser` (Better Auth +
 * users.roleAdmin, cf. /api/home-config). Le dataset brut vient de
 * `dbUniverse.timeline()` (server-only) — l'éditeur applique la curation en local.
 */
import { adminUserOrToken, isAdminOrToken } from "@/lib/admin-guard";
import { getChronologyConfig, saveChronologyConfig } from "@/lib/chronology-config";
import { dbUniverse } from "@/lib/db-universe";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forbidden = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const badRequest = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

export async function GET(req: NextRequest) {
	if (!(await isAdminOrToken(req))) return forbidden();
	const [config, items] = await Promise.all([getChronologyConfig(), dbUniverse.timeline()]);
	return NextResponse.json({ config, items: items ?? [] });
}

export async function PUT(req: NextRequest) {
	const { allowed, me } = await adminUserOrToken(req);
	if (!allowed) return forbidden();
	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return badRequest("JSON body requis");
	}
	try {
		const config = await saveChronologyConfig(body, me?.discordId || me?.user?.id || "token-admin");
		// La frise publique est en ISR (revalidate 3600) → purge immédiate.
		revalidatePath("/wiki/chronologie");
		return NextResponse.json({ ok: true, config });
	} catch (err) {
		return badRequest(err instanceof Error ? err.message : "erreur");
	}
}
