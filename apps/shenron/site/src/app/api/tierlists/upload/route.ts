import { getCurrentUser } from "@/lib/session";
import { API_URL } from "@/lib/config";
import { env } from "@/lib/env";
import { signActingUser } from "@shenron/auth/acting-user";

/**
 * Upload d'une image custom pour l'éditeur de tierlist.
 *
 * Tout membre connecté peut envoyer sa propre image (≤ 4 Mo, png/jpg/webp/gif).
 * Le site :
 *   - vérifie la **signature binaire** (magic-bytes), pas le `Content-Type`
 *     client (falsifiable) ;
 *   - applique un **quota par utilisateur** (anti-DoS disque) ;
 *   - relaie vers l'API bot `/api/assets/upload` **au nom du membre** : en-têtes
 *     `x-acting-*` signés par `signActingUser` (`SHENRON_USER_SECRET`,
 *     server-only), jamais le jeton maître admin (S7, docs/STACK.md §2.2 : le
 *     bot borne une signature acting-user au seul périmètre `tierlists/`), dans
 *     un **namespace dédié** pour ne pas polluer les assets wiki curés.
 * Le bot renvoie un chemin `./assets/wiki/tierlists/<uuid>.<ext>` que
 * `assetUrl()` résout en URL absolue sur l'hôte du bot
 * (`${ASSET_BASE}/assets/wiki/tierlists/...`).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 4 * 1024 * 1024;
const SUBDIR = "tierlists";

/**
 * Plafond du corps accepté, refusé AVANT `req.formData()`.
 *
 * `MAX_BYTES` ne se mesure que sur le fichier une fois le multipart entièrement
 * lu en mémoire, et nginx laisse passer 60 Mo (`client_max_body_size`) : un
 * membre — quota d'upload épuisé ou non, puisque le quota est vérifié en
 * dernier — pouvait faire tamponner 60 Mo à chaque appel, aussi souvent qu'il
 * voulait. L'enveloppe multipart n'ajoute que les bornes et le champ `subdir` :
 * 64 Ko de marge couvrent largement un fichier de 4 Mo.
 */
const CORPS_MAX = MAX_BYTES + 64 * 1024;

// Quota best-effort par utilisateur (in-process) : borne l'épuisement disque
// par un compte authentifié. Fenêtre glissante d'une heure.
const QUOTA_WINDOW_MS = 60 * 60 * 1000;
const QUOTA_MAX_FILES = 30;
const QUOTA_MAX_BYTES = 40 * 1024 * 1024;
const usage = new Map<string, { count: number; bytes: number; resetAt: number }>();

function quotaExceeded(userId: string, size: number): boolean {
	const now = Date.now();
	if (usage.size > 5_000) for (const [k, v] of usage) if (v.resetAt < now) usage.delete(k);
	let u = usage.get(userId);
	if (!u || u.resetAt < now) {
		u = { count: 0, bytes: 0, resetAt: now + QUOTA_WINDOW_MS };
		usage.set(userId, u);
	}
	if (u.count + 1 > QUOTA_MAX_FILES || u.bytes + size > QUOTA_MAX_BYTES) return true;
	u.count += 1;
	u.bytes += size;
	return false;
}

/** Détecte le vrai type via magic-bytes (ignore le Content-Type client). */
function sniffImage(b: Uint8Array): { type: string; ext: string } | null {
	if (b.length >= 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47)
		return { type: "image/png", ext: "png" };
	if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff)
		return { type: "image/jpeg", ext: "jpg" };
	if (b.length >= 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38)
		return { type: "image/gif", ext: "gif" };
	if (
		b.length >= 12 &&
		b[0] === 0x52 &&
		b[1] === 0x49 &&
		b[2] === 0x46 &&
		b[3] === 0x46 &&
		b[8] === 0x57 &&
		b[9] === 0x45 &&
		b[10] === 0x42 &&
		b[11] === 0x50
	)
		return { type: "image/webp", ext: "webp" };
	return null;
}

export async function POST(req: Request) {
	const me = await getCurrentUser();
	if (!me?.user) {
		return Response.json({ error: "Connexion requise." }, { status: 401 });
	}

	const discordId = me.discordId;
	if (!discordId) {
		return Response.json({ error: "Compte Discord requis." }, { status: 403 });
	}
	// S7 : le téléversement part signé au nom du membre (acting-user), plus
	// jamais avec le jeton maître admin.
	const userSecret = env.SHENRON_USER_SECRET ?? "";
	if (!userSecret) {
		return Response.json(
			{ error: "Upload indisponible (SHENRON_USER_SECRET non configuré)." },
			{ status: 503 }
		);
	}

	const annoncee = Number(req.headers.get("content-length") ?? 0);
	if (Number.isFinite(annoncee) && annoncee > CORPS_MAX) {
		return Response.json({ error: "Image trop lourde (max 4 Mo)." }, { status: 413 });
	}

	let form: FormData;
	try {
		form = await req.formData();
	} catch {
		return Response.json({ error: "multipart/form-data requis." }, { status: 400 });
	}
	const file = form.get("file");
	if (!(file instanceof File)) {
		return Response.json({ error: "Champ « file » manquant." }, { status: 400 });
	}
	if (file.size === 0) {
		return Response.json({ error: "Fichier vide." }, { status: 400 });
	}
	if (file.size > MAX_BYTES) {
		return Response.json({ error: "Image trop lourde (max 4 Mo)." }, { status: 413 });
	}

	// Vérifie la signature binaire RÉELLE (pas le Content-Type client).
	const buf = new Uint8Array(await file.arrayBuffer());
	const kind = sniffImage(buf);
	if (!kind) {
		return Response.json(
			{ error: "Fichier non reconnu comme image (png, jpg, webp, gif)." },
			{ status: 415 }
		);
	}

	if (quotaExceeded(me.user.id, file.size)) {
		return Response.json({ error: "Quota d'upload atteint. Réessaie plus tard." }, { status: 429 });
	}

	// Réémet un fichier propre (type corrigé d'après les magic-bytes) + le
	// sous-dossier dédié pour ne pas écrire dans le namespace wiki curé.
	const clean = new File([buf], `upload.${kind.ext}`, { type: kind.type });
	const upstream = new FormData();
	upstream.append("file", clean, clean.name);
	upstream.append("subdir", SUBDIR);

	try {
		const res = await fetch(`${API_URL}/api/assets/upload`, {
			method: "POST",
			headers: signActingUser({ secret: userSecret, discordId }),
			body: upstream,
			cache: "no-store",
		});
		const data = (await res.json().catch(() => ({}))) as { path?: string; error?: string };
		if (!res.ok || !data.path) {
			return Response.json(
				{ error: data.error ?? "Échec de l'upload." },
				{ status: res.ok ? 502 : res.status }
			);
		}
		return Response.json({ path: data.path }, { status: 201 });
	} catch {
		return Response.json({ error: "Service d'upload injoignable." }, { status: 502 });
	}
}
