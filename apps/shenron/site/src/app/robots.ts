import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/config";

export default function robots(): MetadataRoute.Robots {
	return {
		rules: [
			{
				userAgent: "*",
				// Pas d'exception pour le contrat de l'API d'écriture : il demande
				// désormais une clé ou une session d'administration (cf. la route), donc
				// il n'a rien à faire dans un index — `Disallow: /api/` le couvre.
				allow: "/",
				// /admin + /api : privés. /profil : pages de compte, sans intérêt
				// d'index et parfois nominatives.
				//
				// NE PAS blanket-disallow /wiki : tout le wiki est public depuis le
				// 2026-08-27, et une directive robots.txt le retirerait entièrement de
				// l'index. Les pages à ne pas indexer le disent elles-mêmes en meta
				// robots (`/wiki/search`, `/wiki/corriger`) — une meta laisse Google
				// LIRE la page pour en suivre les liens, un `Disallow` l'en empêche.
				//
				// `/tierlists/` a été retiré de cette liste : la page répond 200 en
				// public depuis la fin de la bêta, la garder ici l'excluait de l'index
				// sans raison.
				disallow: ["/admin/", "/api/", "/profil/"],
			},
			// Robots publicitaires Google. Ils n'indexent RIEN : ils explorent la page
			// pour en déduire le ciblage contextuel (Mediapartners-Google = AdSense) ou
			// pour contrôler la qualité de la page de destination (AdsBot). Les laisser
			// tomber sur le `Disallow` générique dégrade la pertinence des annonces —
			// et donc le revenu — et fait remonter « erreurs d'exploration » côté
			// AdSense. Une règle nommée remplace intégralement `*` pour ces agents,
			// d'où la reprise explicite des chemins privés.
			{
				userAgent: ["Mediapartners-Google", "AdsBot-Google", "AdsBot-Google-Mobile"],
				allow: "/",
				disallow: ["/admin/", "/api/"],
			},
		],
		sitemap: `${SITE_URL}/sitemap.xml`,
	};
}
