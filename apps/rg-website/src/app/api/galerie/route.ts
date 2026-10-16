/**
 * `/api/galerie` — relais des illustrations du jeu vers la popup de bannière.
 *
 * ── POURQUOI RELAYER PLUTÔT QU'APPELER DIRECTEMENT ─────────────────────────
 * Le montage Azalée de l'API unifiée (`rg-api.service`, `127.0.0.1:8800/v1/azalee`, aussi servi
 * sur `api.rosegriffon.fr/azalee`) répond en CORS ouvert : le navigateur
 * POURRAIT l'appeler. Mais chaque frappe déclencherait un préflight, la requête
 * dépendrait de la politique de sécurité de contenu du site (`connect-src`), et
 * une panne du sous-domaine casserait un formulaire qui n'a rien à voir. Ici
 * l'appel part du serveur, sur la boucle locale, et la popup ne connaît que sa
 * propre origine.
 *
 * ── TRADUCTION DES PARAMÈTRES, PAS DES DONNÉES ─────────────────────────────
 * La popup parle français (`limite`, `categorie`), l'API du wiki anglais
 * (`limit`, `category`). La traduction se fait ici ; la charge, elle, est
 * relayée telle quelle et normalisée côté client par `lireReponseGalerie` —
 * une seule forme à maintenir.
 */
import { GALERIE_PAR_PAGE } from "@rosegriffon/ui";

export const dynamic = "force-dynamic";

/** Le sidecar tourne sur la même machine ; le sous-domaine public est le repli. */
const BASE_INTERNE = process.env.AZALEE_API_URL ?? "http://127.0.0.1:8800/v1/azalee";

/** Plafond de page : la popup en affiche douze, personne n'a besoin de mille. */
const LIMITE_MAX = 48;

export async function GET(requete: Request): Promise<Response> {
	const entrants = new URL(requete.url).searchParams;
	const sortants = new URLSearchParams();
	sortants.set("page", String(entier(entrants.get("page"), 1)));
	sortants.set("limit", String(Math.min(LIMITE_MAX, entier(entrants.get("limite"), GALERIE_PAR_PAGE))));
	const categorie = entrants.get("categorie");
	if (categorie) {
		sortants.set("category", categorie);
	}
	const recherche = entrants.get("q");
	if (recherche) {
		sortants.set("q", recherche);
	}

	try {
		const reponse = await fetch(`${BASE_INTERNE}/api/gallery?${sortants.toString()}`, {
			cache: "no-store",
			signal: AbortSignal.timeout(8_000),
		});
		if (!reponse.ok) {
			return Response.json(
				{ error: `La galerie du wiki a répondu ${reponse.status}.` },
				{ status: 502 }
			);
		}
		return Response.json(await reponse.json());
	} catch (erreur) {
		console.error("[galerie] wiki injoignable", erreur);
		return Response.json({ error: "Galerie momentanément injoignable." }, { status: 502 });
	}
}

function entier(valeur: string | null, defaut: number): number {
	const n = Number.parseInt(valeur ?? "", 10);
	return Number.isFinite(n) && n > 0 ? n : defaut;
}
