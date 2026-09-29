/**
 * Brouillons d'édition — l'autosauvegarde serveur du module d'édition.
 *
 * Trois verbes, une clé logique (`key`) par document et un brouillon par
 * utilisateur : `GET` pour la reprise, `PUT` pour l'autosauvegarde, `DELETE`
 * quand le contenu a été réellement enregistré à sa vraie place.
 *
 * Réservé aux comptes connectés (le brouillon est nominatif). L'éditeur double
 * de toute façon cette sauvegarde d'une copie locale : perdre la session ne perd
 * pas le texte.
 */
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { editorDrafts } from "@/db/schema";
import { createMemoryRateLimiter } from "@/lib/memory-rate-limit";
import { getCurrentUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// L'identité retenue est `sessionUserId` (Better Auth) : elle existe dès la
// connexion, sans dépendre de l'upsert du user métier.

/** Un brouillon ne doit jamais devenir un canal de stockage : 512 Ko suffisent largement. */
const MAX_CONTENT = 512 * 1024;

/**
 * La clé identifie le document édité (`post:42`, `wiki-page:<titre>`) : quelques
 * dizaines de signes en pratique. Non bornée, elle ouvrait la porte à des clés
 * arbitrairement longues — et surtout à un nombre illimité de LIGNES, puisque
 * `(docKey, userId)` est la clé unique : une clé neuve = un brouillon de plus.
 */
const MAX_KEY = 300;
/** Libellé d'affichage dans l'écran de reprise, jamais une donnée métier. */
const MAX_LABEL = 300;
/** Les seuls formats que l'éditeur sait relire (`useAutosave`). */
const FORMATS = new Set(["doc", "markdown", "text"]);

/**
 * Anti-abus : l'autosauvegarde écrit au plus une fois toutes les 2,5 s par
 * onglet, et chaque écriture peut créer une ligne de 512 Ko. 60 écritures par
 * minute laissent deux éditions simultanées au large, et bornent l'appétit
 * disque d'un compte qui bouclerait sur des clés inventées.
 */
const draftRateLimit = createMemoryRateLimiter({
	windowMs: 60_000,
	limit: 60,
	namespace: "drafts",
});

/**
 * Plafond du corps accepté, refusé AVANT désérialisation.
 *
 * `MAX_CONTENT` ne s'applique qu'une fois le JSON désérialisé, et nginx laisse
 * passer 60 Mo (`client_max_body_size`) : un compte connecté faisait donc
 * désérialiser jusqu'à 60 Mo à chaque appel, et le compteur de débit — placé
 * après la lecture du corps — refusait la requête une fois la dépense déjà
 * consentie. 4 Mo couvrent très largement un brouillon de 512 K signes, même
 * entièrement composé de caractères multi-octets échappés en JSON.
 */
const CORPS_MAX = 4 * 1024 * 1024;

export async function GET(req: Request) {
	const user = await getCurrentUser();
	if (!user) return Response.json({ draft: null }, { status: 200 });

	const key = new URL(req.url).searchParams.get("key");
	if (!key || key.length > MAX_KEY) {
		return Response.json({ error: "Clé manquante ou trop longue." }, { status: 400 });
	}

	const [draft] = await db
		.select()
		.from(editorDrafts)
		.where(and(eq(editorDrafts.docKey, key), eq(editorDrafts.userId, user.sessionUserId)))
		.limit(1);

	return Response.json({ draft: draft ?? null });
}

export async function PUT(req: Request) {
	const user = await getCurrentUser();
	if (!user) return Response.json({ error: "Session requise." }, { status: 401 });

	// Les deux garde-fous passent AVANT la lecture du corps : un compte déjà
	// limité, ou qui annonce une charge hors norme, ne doit pas faire désérialiser
	// sa requête pour s'entendre refuser ensuite.
	const rate = await draftRateLimit.consume(user.sessionUserId);
	if (rate.limited) {
		return Response.json(
			{ error: "Trop d'enregistrements d'affilée." },
			{ status: 429, headers: { "Retry-After": String(rate.retryAfter) } }
		);
	}
	const annoncee = Number(req.headers.get("content-length") ?? 0);
	if (Number.isFinite(annoncee) && annoncee > CORPS_MAX) {
		return Response.json({ error: "Brouillon trop volumineux." }, { status: 413 });
	}

	const body = (await req.json().catch(() => null)) as {
		key?: string;
		format?: string;
		content?: string;
		label?: string;
	} | null;
	if (!body?.key || body.key.length > MAX_KEY || typeof body.content !== "string") {
		return Response.json({ error: "Requête invalide." }, { status: 400 });
	}
	if (body.content.length > MAX_CONTENT) {
		return Response.json({ error: "Brouillon trop volumineux." }, { status: 413 });
	}

	// Un format inconnu ne serait relu par personne : on retombe sur le défaut
	// plutôt que d'écrire une valeur libre venue du navigateur.
	const format =
		typeof body.format === "string" && FORMATS.has(body.format) ? body.format : "markdown";
	const label =
		typeof body.label === "string" && body.label.trim()
			? body.label.trim().slice(0, MAX_LABEL)
			: null;

	const now = new Date();
	await db
		.insert(editorDrafts)
		.values({
			docKey: body.key,
			userId: user.sessionUserId,
			format,
			content: body.content,
			label,
			updatedAt: now,
		})
		.onConflictDoUpdate({
			target: [editorDrafts.docKey, editorDrafts.userId],
			set: {
				content: body.content,
				format,
				label,
				updatedAt: now,
			},
		});

	return Response.json({ ok: true, savedAt: now.toISOString() });
}

/**
 * `sendBeacon` (déchargement de page) ne sait émettre qu'un POST : même
 * traitement que `PUT`, c'est la dernière écriture avant la fermeture de
 * l'onglet.
 */
export const POST = PUT;

export async function DELETE(req: Request) {
	const user = await getCurrentUser();
	if (!user) return Response.json({ ok: true });

	const key = new URL(req.url).searchParams.get("key");
	if (!key || key.length > MAX_KEY) {
		return Response.json({ error: "Clé manquante ou trop longue." }, { status: 400 });
	}

	await db
		.delete(editorDrafts)
		.where(and(eq(editorDrafts.docKey, key), eq(editorDrafts.userId, user.sessionUserId)));

	return Response.json({ ok: true });
}
