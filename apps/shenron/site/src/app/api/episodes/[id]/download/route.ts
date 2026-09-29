import { getCurrentUser } from "@/lib/session";
import { dbUniverse } from "@/lib/db-universe";
import { apiUrl } from "@/lib/config";

/**
 * Téléchargement d'un épisode — **réservé aux membres connectés via Discord**.
 *
 * Tout passe par cette route (jamais un lien direct vers le bot) pour que la
 * connexion Discord soit imposée côté serveur :
 *   - non connecté → 302 vers /signin (retour sur la fiche épisode) ;
 *   - connecté → 302 vers le MP4 direct (`video_url`) si dispo, sinon vers la
 *     résolution HLS→MP4 on-demand du bot (`/api/hls/:id/download`), qui marche
 *     pour toute la base (sources voiranime), même sans `stream_url` stocké.
 * Le bot pose le `Content-Disposition: attachment` → le navigateur télécharge.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	if (!/^\d+$/.test(id)) {
		return new Response("Épisode introuvable.", { status: 404 });
	}

	const me = await getCurrentUser();
	if (!me?.user) {
		// Location RELATIF : le navigateur le résout contre l'URL publique
		// (derrière nginx, `req.url` porterait l'hôte loopback interne).
		const back = encodeURIComponent(`/wiki/episodes/${id}`);
		return new Response(null, {
			status: 302,
			headers: { Location: `/signin?callbackURL=${back}` },
		});
	}

	const ep = await dbUniverse.episode(Number(id));
	if (!ep) {
		return new Response("Épisode introuvable.", { status: 404 });
	}

	// Garde `URL.canParse` + protocole, comme la route films (qui documente déjà
	// le piège) : `video_url` est saisi à la main côté admin sans validation, et
	// `Response.redirect` sur une valeur relative lève → 500. Un `javascript:`
	// deviendrait par ailleurs une redirection ouverte. Valeur douteuse → on
	// retombe sur le résolveur du bot plutôt que d'échouer.
	const stored = ep.video_url && URL.canParse(ep.video_url) ? new URL(ep.video_url) : null;
	const target =
		stored && (stored.protocol === "http:" || stored.protocol === "https:")
			? stored.toString()
			: apiUrl(`api/hls/${id}/download`);
	return Response.redirect(target, 302);
}
