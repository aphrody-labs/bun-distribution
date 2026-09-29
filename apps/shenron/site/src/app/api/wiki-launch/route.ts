/**
 * /api/wiki-launch — contrôle d'accès et classement des rubriques (gate admin).
 *
 *   GET → { openKeys, order, access }   configuration courante
 *   PUT → { ok, ...config }             enregistre + revalide le layout
 *
 * Le PUT accepte n'importe quel sous-ensemble des trois champs : la page
 * /admin/lancement envoie l'accès et l'ordre séparément sans écraser le reste.
 * Le nettoyage (clés inconnues, modes invalides, rôles non-snowflake) est fait
 * dans `wiki-launch-config`, source unique de vérité.
 */
import { adminUserOrToken, isAdminOrToken } from "@/lib/admin-guard";
import { getLaunchConfig, saveLaunchConfig } from "@/lib/wiki-launch-config";
import type { AccessRule } from "@/lib/wiki-launch";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forbidden = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });

export async function GET(req: NextRequest) {
	if (!(await isAdminOrToken(req))) return forbidden();
	return NextResponse.json(await getLaunchConfig());
}

export async function PUT(req: NextRequest) {
	const { allowed, me } = await adminUserOrToken(req);
	if (!allowed) return forbidden();

	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return NextResponse.json({ error: "JSON body requis" }, { status: 400 });
	}

	const b = body as {
		openKeys?: unknown;
		order?: unknown;
		access?: unknown;
	};
	const strings = (v: unknown) =>
		Array.isArray(v) ? (v.filter((k) => typeof k === "string") as string[]) : undefined;

	const patch: Parameters<typeof saveLaunchConfig>[0] = {};
	const openKeys = strings(b.openKeys);
	if (openKeys) patch.openKeys = openKeys;
	const order = strings(b.order);
	if (order) patch.order = order;
	if (b.access && typeof b.access === "object") {
		patch.access = b.access as Record<string, AccessRule>;
	}

	if (Object.keys(patch).length === 0) {
		return NextResponse.json({ error: "openKeys[], order[] ou access{} attendu" }, { status: 400 });
	}

	const config = await saveLaunchConfig(patch, me?.discordId || me?.user?.id || "token-admin");
	// Le gating/nav/teaser lisent la config dans le layout → revalide tout le site.
	revalidatePath("/", "layout");
	return NextResponse.json({ ok: true, ...config });
}
