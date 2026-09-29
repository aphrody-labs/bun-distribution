import type { Metadata } from "next";
import { SITE_URL } from "@/lib/config";

/**
 * Fragment de métadonnées Open Graph + Twitter Card réutilisable.
 * `image` doit être une URL ABSOLUE (ex. `assetUrl(...)` renvoie déjà des URLs
 * absolues vers le bot) ; les chemins relatifs ne sont PAS résolus ici — pour
 * un défaut relatif, c'est `metadataBase` du layout + le fichier
 * `app/opengraph-image.tsx` qui s'en chargent.
 * Sans `image`, on retombe sur la carte de marque (`app/opengraph-image.tsx`),
 * référencée par son URL. Compter sur l'héritage ne marche PAS : déclarer
 * `openGraph` sur une page remplace l'objet hérité, image comprise.
 */
export function ogMeta({
	title,
	description,
	image,
	type = "article",
	canonical,
}: {
	title: string;
	description?: string;
	image?: string | null;
	type?: "article" | "website" | "video.episode" | "video.movie";
	/**
	 * URL canonique auto-référente de la page (chemin relatif, ex. `/wiki/sagas`,
	 * résolu contre `metadataBase` du layout). À renseigner page par page :
	 * une canonical globale pointerait à tort toutes les pages vers la home.
	 */
	canonical?: string;
}): Pick<Metadata, "openGraph" | "twitter" | "alternates"> {
	// Sans image propre, on pointe EXPLICITEMENT la carte de marque.
	//
	// Le commentaire d'origine affirmait que la page « hérite alors de l'OG image
	// par défaut » : c'est faux, et vérifié deux fois en production le
	// 2026-08-21. Déclarer `openGraph` dans les métadonnées d'une page REMPLACE
	// l'objet hérité — l'image dérivée de `app/opengraph-image.tsx` comprise. Ni
	// `images: undefined`, ni l'omission de la clé n'y changent rien. Résultat :
	// `/shop`, `/leaderboard`, `/classements`, `/stats`, `/jeux` et toutes les
	// fiches sans visuel n'émettaient AUCUN `og:image` — un partage Discord ou
	// Twitter sans vignette, sur un site adossé à Discord — alors que les pages
	// n'appelant PAS ce helper, elles, l'avaient.
	//
	// L'URL est celle de la route générée, sans sa clé de cache (un simple
	// paramètre de requête) : elle sert bien le PNG 1200×630.
	const fallback = `${SITE_URL}/opengraph-image`;
	const src = image ?? fallback;
	const images = { images: [{ url: src, alt: title }] };
	const twitterImages = { images: [src] };
	return {
		...(canonical ? { alternates: { canonical } } : {}),
		openGraph: {
			title,
			description,
			type: type === "video.episode" || type === "video.movie" ? "video.other" : type,
			...(canonical ? { url: canonical } : {}),
			...images,
		},
		twitter: {
			card: "summary_large_image",
			title,
			description,
			...twitterImages,
		},
	};
}
