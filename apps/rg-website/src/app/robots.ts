import type { MetadataRoute } from "next";

import { SITE_URL } from "@/lib/site-url";

/**
 * Chemins sans valeur d'index, communs à tous les robots :
 * espaces d'administration, espace membre, parcours d'authentification,
 * tunnel d'achat et fiches de profil (biographie d'un membre, publiée sans
 * qu'aucune indexation ait été demandée — même politique que le wiki Azalée).
 *
 * `/_next/` n'y figure PAS et ne doit pas y revenir : ce préfixe sert les
 * feuilles de style, le JavaScript et les images optimisées. Le bloquer
 * empêchait Google de rendre les pages telles qu'un visiteur les voit, et
 * mettait toutes les images passées par `next/image` hors de portée de
 * l'indexation d'images.
 */
const PRIVE = [
	"/api/",
	"/admin/",
	"/dashboard/",
	"/login",
	"/forgot-password",
	"/reset-password",
	"/auth/",
	"/profil/",
	"/shop/panier",
	"/shop/merci",
	"/shop/commandes",
	"/maintenance",
];

export default function robots(): MetadataRoute.Robots {
	// Host canonique (apex, sans www) — cohérent avec le `metadataBase` du layout et
	// la redirection 301 www → apex de next.config. Évite que la directive Sitemap
	// pointe vers une URL redirigée. `SITE_URL` (lib/site-url.ts) applique la même
	// normalisation ; ce fichier, `app/sitemap.ts` et `app/wiki/sitemap.ts` la
	// recopiaient chacun séparément.
	const baseUrl = SITE_URL;
	return {
		rules: [
			{
				// /api/llm/* = contexte IA (CLAUDE.md/GEMINI.md/Grok) : explicitement autorisé (allow plus spécifique que disallow /api/).
				allow: ["/", "/api/llm/"],
				disallow: PRIVE,
				userAgent: "*",
			},
			{
				allow: ["/", "/api/llm/"],
				disallow: PRIVE,
				userAgent: "Googlebot",
			},
			{
				allow: "/",
				disallow: ["/admin/", "/dashboard/", "/profil/"],
				userAgent: "Googlebot-Image",
			},
			{
				// Mediapartners-Google = robot d'AdSense. Il lit le contenu de la page
				// pour choisir les annonces ; sans autorisation explicite il ne reste que
				// du remplissage générique, et le revenu s'effondre sans message d'erreur.
				allow: "/",
				disallow: PRIVE,
				userAgent: "Mediapartners-Google",
			},
			{
				allow: "/",
				disallow: PRIVE,
				userAgent: [
					// Crawlers IA explicitement autorisés (condition pour l'ingestion LLM)
					"GPTBot",
					"ChatGPT-User",
					"OAI-SearchBot",
					"ClaudeBot",
					"Claude-Web",
					"anthropic-ai",
					"Anthropic-AI",
					"Google-Extended",
					"PerplexityBot",
					"Perplexity-User",
					"CCBot",
					"Bytespider",
					"Amazonbot",
					"Applebot",
					"Applebot-Extended",
					"cohere-ai",
					"FacebookBot",
					"Meta-ExternalAgent",
					"ImagesiftBot",
				],
			},
		],
		// Trois plans de site : Next en génère un par fichier `sitemap.ts`. Celui
		// de la boutique (`app/shop/sitemap.ts`) n'était déclaré nulle part — ses
		// douze fiches produit n'avaient donc aucun point d'entrée de découverte.
		sitemap: [
			`${baseUrl}/sitemap.xml`,
			`${baseUrl}/shop/sitemap.xml`,
			// Restaure le plan de site du wiki, supprimé sans être porté par la fusion
			// d'`apps/azalee` (commit `d74cee35`) — voir `app/wiki/sitemap.ts`.
			`${baseUrl}/wiki/sitemap.xml`,
		],
	};
}
