/**
 * /api/banner-config — bannières des pages wiki/catalogues (server-only, gate admin).
 *
 *   GET → { banners }           config résolue
 *   PUT → { ok, banners }       upsert singleton + revalidate des pages touchées
 */
import { adminUserOrToken, isAdminOrToken } from "@/lib/admin-guard";
import { getPageBanners, savePageBanners } from "@/lib/banner-config";
import { revalidatePath } from "next/cache";
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const forbidden = () => NextResponse.json({ error: "Forbidden" }, { status: 403 });
const badRequest = (msg: string) => NextResponse.json({ error: msg }, { status: 400 });

/** Paths publics impactés par une bannière (ISR). */
const REVALIDATE_PATHS = [
	"/wiki/episodes",
	"/wiki/episodes/serie/[series]",
	"/wiki/films",
	"/wiki/chronologie",
	"/wiki/personnages",
	"/wiki/sagas",
	"/wiki/arcs",
	"/wiki/races",
	"/wiki/transformations",
	"/wiki/techniques",
	"/wiki/jeux",
	"/wiki/manga",
	"/wiki/databooks",
	"/wiki/tools",
	"/actualites",
	"/news",
	"/news/page/[n]",
	"/jeux/2048",
];

export async function GET(req: NextRequest) {
	if (!(await isAdminOrToken(req))) return forbidden();
	return NextResponse.json({ banners: await getPageBanners() });
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
		const banners = await savePageBanners(body, me?.discordId || me?.user?.id || "token-admin");
		for (const p of REVALIDATE_PATHS) {
			try {
				revalidatePath(p, p.includes("[") ? "page" : undefined);
			} catch {
				/* best-effort */
			}
		}
		// Layout racine (nav / segments partagés).
		try {
			revalidatePath("/", "layout");
		} catch {
			/* best-effort */
		}
		return NextResponse.json({ ok: true, banners });
	} catch (err) {
		return badRequest(err instanceof Error ? err.message : "erreur");
	}
}
