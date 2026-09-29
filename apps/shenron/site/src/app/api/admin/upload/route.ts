import { API_URL } from "@/lib/config";
import { isCurrentUserAdmin } from "@/lib/session";

/**
 * Upload d'image **admin** pour les éditeurs du dashboard `/admin` (éditeur DB
 * wiki, etc.). Le navigateur envoie un `multipart/form-data` (`file` + `subdir`
 * optionnel) ; le site :
 *   - gate la session admin (Better Auth + `users.roleAdmin`) ;
 *   - vérifie la **signature binaire** (magic-bytes), jamais le `Content-Type`
 *     client (falsifiable) ;
 *   - relaie vers l'API bot `POST /api/assets/upload` avec le `SHENRON_ADMIN_TOKEN`
 *     server-only (jamais exposé au navigateur), dans le sous-dossier wiki
 *     demandé (slug strict, défaut `uploads`).
 *
 * NB : on NE passe PAS par le proxy `/api/bot-admin` car celui-ci lit `req.text()`
 * et corromprait les bytes binaires — d'où ce handler dédié (cf. note
 * `uploadWikiImage` dans `admin/wiki/_actions.ts`).
 *
 * Le bot renvoie un chemin DB `./assets/wiki/<subdir>/<uuid>.<ext>` que
 * `assetUrl()` résout en URL absolue sur l'hôte du bot
 * (`${ASSET_BASE}/assets/wiki/...`) — servi sans collision avec la route Next
 * catch-all `/wiki/[...slug]` (cf. lib/assets.ts).
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 50 * 1024 * 1024;

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
	if (!(await isCurrentUserAdmin())) {
		return Response.json({ error: "Accès réservé aux administrateurs." }, { status: 403 });
	}

	const token = process.env.SHENRON_ADMIN_TOKEN ?? "";
	if (!token) {
		return Response.json(
			{ error: "Upload indisponible (SHENRON_ADMIN_TOKEN non configuré)." },
			{ status: 503 }
		);
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
		return Response.json({ error: "Image trop lourde (max 50 Mo)." }, { status: 413 });
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

	// Sous-dossier wiki demandé (slug strict) — sinon namespace générique.
	const subdirRaw = String(form.get("subdir") ?? "")
		.trim()
		.toLowerCase();
	const subdir = /^[a-z0-9-]{1,32}$/.test(subdirRaw) ? subdirRaw : "uploads";

	// Réémet un fichier propre (type corrigé d'après les magic-bytes).
	const clean = new File([buf], `upload.${kind.ext}`, { type: kind.type });
	const upstream = new FormData();
	upstream.append("file", clean, clean.name);
	upstream.append("subdir", subdir);

	try {
		const res = await fetch(`${API_URL}/api/assets/upload`, {
			method: "POST",
			headers: { authorization: `Bearer ${token}` },
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
