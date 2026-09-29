/**
 * /api/canon-config — doctrine de canonicité de `/wiki/canon` (gate admin).
 *
 *   GET → { config, defaults }  doctrine effective + doctrine du dépôt (pour le
 *                               bouton « rétablir » de l'éditeur)
 *   PUT → { ok, config }        enregistre le document et purge `/wiki/canon`
 *
 * Le gate réutilise `isCurrentUserAdmin` / `getCurrentUser` (Better Auth +
 * users.roleAdmin), comme /api/chronologie-config.
 */
import { adminUserOrToken, isAdminOrToken } from "@/lib/admin-guard";
import { getCanonConfig, saveCanonConfig } from "@/lib/canon-config";
import { DEFAULT_CANON_CONFIG } from "@/lib/canon-engine";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forbidden = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const badRequest = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

/** Plafond du corps accepté en écriture (16 Mio). */
const MAX_CORPS = 16 * 1024 * 1024;

export async function GET(req: NextRequest) {
	if (!(await isAdminOrToken(req))) return forbidden();
	const config = await getCanonConfig();
	return NextResponse.json({ config, defaults: DEFAULT_CANON_CONFIG });
}

export async function PUT(req: NextRequest) {
	const { allowed, me } = await adminUserOrToken(req);
	if (!allowed) return forbidden();
	// Le document complet (corpus de citations inclus) pèse quelques mégaoctets ;
	// au-delà, c'est une erreur d'appel et on refuse avant de désérialiser.
	const taille = Number(req.headers.get("content-length") ?? 0);
	if (Number.isFinite(taille) && taille > MAX_CORPS)
		return badRequest("Document trop volumineux");

	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return badRequest("JSON body requis");
	}
	// `resolveCanonConfig` rend la doctrine du dépôt pour tout ce qui n'est pas un
	// objet : un PUT malformé (chaîne, tableau, nombre) écrasait donc la doctrine
	// éditée par les défauts en répondant `ok`. On refuse explicitement.
	if (!body || typeof body !== "object" || Array.isArray(body))
		return badRequest("Le document de doctrine doit être un objet JSON");

	try {
		const config = await saveCanonConfig(body, me?.discordId || me?.user?.id || "token-admin");
		revalidatePath("/wiki/canon");
		return NextResponse.json({ ok: true, config });
	} catch (err) {
		return badRequest(err instanceof Error ? err.message : "erreur");
	}
}
