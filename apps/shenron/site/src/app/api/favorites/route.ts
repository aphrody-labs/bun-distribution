/**
 * /api/favorites — favoris d'un compte connecté.
 *
 *   GET → { favorites }        la liste enregistrée
 *   PUT → { ok, count }        remplace la liste
 *
 * Stockés dans `public.user_preferences.prefs.favorites` (jsonb libre) : la
 * table existe déjà et son champ `prefs` est fait pour ça, donc aucune
 * migration. La clé d'identité suit la convention du fichier : `u:<userId>`.
 *
 * Le stockage de référence reste le navigateur (cf. `lib/favorites.ts`) : cette
 * route n'est qu'un miroir permettant de retrouver ses favoris d'un appareil à
 * l'autre. Un visiteur anonyme reçoit une liste vide, jamais une erreur — le
 * bouton doit continuer de fonctionner sans compte.
 */
import { NextResponse, type NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { userPreferences } from "@/db/schema";
import { getCurrentUser } from "@/lib/session";
import { sanitizeInternalPath } from "@/lib/internal-path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Plafond de la liste : un favori est un raccourci, pas une sauvegarde. */
const MAX = 200;

/**
 * Plafond du corps accepté, refusé AVANT désérialisation.
 *
 * `sanitize` borne déjà tout ce qui est écrit, mais il ne s'applique qu'une fois
 * le JSON désérialisé — et nginx laisse passer 60 Mo
 * (`client_max_body_size`). Cette route n'a par ailleurs aucun compteur de
 * débit : un compte connecté pouvait donc faire désérialiser 60 Mo autant de
 * fois qu'il voulait. Une liste pleine (200 favoris aux bornes de `sanitize`)
 * pèse ~220 Ko ; 512 Ko laissent de la marge sans offrir de levier.
 */
const CORPS_MAX = 512 * 1024;

type Favorite = {
	kind: string;
	id: string;
	title: string;
	href: string;
	image?: string | null;
	caption?: string | null;
	at: number;
};

const KINDS = new Set(["episode", "movie", "chapter", "databook", "character", "saga", "game"]);

/** Validation stricte : la charge vient du client, elle est rejouée telle quelle. */
function sanitize(input: unknown): Favorite[] {
	if (!Array.isArray(input)) return [];
	const str = (v: unknown, max: number): string | null =>
		typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null;

	const out: Favorite[] = [];
	const seen = new Set<string>();
	for (const raw of input.slice(0, MAX)) {
		if (!raw || typeof raw !== "object") continue;
		const f = raw as Record<string, unknown>;
		const kind = str(f.kind, 20);
		const id = str(f.id, 64);
		const title = str(f.title, 200);
		const href = sanitizeInternalPath(f.href, 300);
		if (!kind || !KINDS.has(kind) || !id || !title || !href) continue;
		const key = `${kind}:${id}`;
		if (seen.has(key)) continue;
		seen.add(key);
		out.push({
			kind,
			id,
			title,
			href,
			image: str(f.image, 300),
			caption: str(f.caption, 120),
			at: typeof f.at === "number" && Number.isFinite(f.at) ? f.at : Date.now(),
		});
	}
	return out;
}

const identityOf = (userId: string) => `u:${userId}`;

export async function GET() {
	const me = await getCurrentUser();
	if (!me?.user) return NextResponse.json({ favorites: [] });
	try {
		const [row] = await db
			.select({ prefs: userPreferences.prefs })
			.from(userPreferences)
			.where(eq(userPreferences.identity, identityOf(me.user.id)))
			.limit(1);
		const favorites = sanitize((row?.prefs as Record<string, unknown> | undefined)?.favorites);
		return NextResponse.json(
			{ favorites },
			// Strictement personnel : jamais de cache partagé.
			{ headers: { "cache-control": "private, no-store" } }
		);
	} catch (err) {
		console.error("[favorites] lecture", err);
		return NextResponse.json({ favorites: [] });
	}
}

export async function PUT(req: NextRequest) {
	const me = await getCurrentUser();
	if (!me?.user) return NextResponse.json({ error: "Connexion requise" }, { status: 401 });

	const annoncee = Number(req.headers.get("content-length") ?? 0);
	if (Number.isFinite(annoncee) && annoncee > CORPS_MAX) {
		return NextResponse.json({ error: "Liste trop volumineuse" }, { status: 413 });
	}

	let body: unknown;
	try {
		body = await req.json();
	} catch {
		return NextResponse.json({ error: "JSON body requis" }, { status: 400 });
	}
	const favorites = sanitize((body as { favorites?: unknown })?.favorites);

	try {
		const identity = identityOf(me.user.id);
		const [existing] = await db
			.select({ prefs: userPreferences.prefs })
			.from(userPreferences)
			.where(eq(userPreferences.identity, identity))
			.limit(1);

		// Fusion et non remplacement du document : `prefs` porte aussi les
		// préférences dérivées de la télémétrie, qu'on n'a pas à écraser.
		const prefs = { ...existing?.prefs, favorites };
		await db
			.insert(userPreferences)
			.values({ identity, userId: me.user.id, prefs })
			.onConflictDoUpdate({
				target: userPreferences.identity,
				set: { prefs, userId: me.user.id, updatedAt: new Date() },
			});
		return NextResponse.json({ ok: true, count: favorites.length });
	} catch (err) {
		console.error("[favorites] écriture", err);
		return NextResponse.json({ error: "Enregistrement impossible" }, { status: 500 });
	}
}
