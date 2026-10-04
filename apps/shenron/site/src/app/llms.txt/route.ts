/**
 * GET /llms.txt — la carte du site pour les robots d'indexation.
 *
 * `robots.txt` dit ce qu'on peut explorer, `sitemap.xml` énumère les URL ; ce
 * fichier (convention `llms.txt`) dit **ce que le site contient** et dans quel
 * ordre le lire. C'est sa seule fonction.
 *
 * Ce qu'il ne contient PAS, et ne doit pas contenir : le fonctionnement interne
 * du site, ses chaînes de traitement, ses outils d'écriture ou la façon dont la
 * rédaction travaille. Une version publiée le 2026-09-12 documentait tout cela ;
 * elle a été retirée le jour même. Ce document s'adresse à un robot qui indexe
 * des pages publiques, pas à quelqu'un qui veut écrire dans la base.
 *
 * Il est dérivé de la carte du site et du registre d'accès : une rubrique fermée
 * n'y est pas annoncée, exactement comme dans le sitemap — il remplace à ce
 * titre l'ancien `public/llms.txt`, un fichier statique qui avait vieilli sans
 * que personne ne le voie (il annonçait un sous-domaine et des chemins disparus).
 */
import { SITE_URL } from "@/lib/config";
import { buildSiteMap } from "@/lib/site-map";
import { getLaunchConfig } from "@/lib/wiki-launch-config";
import { isPathPublic, type AccessSnapshot } from "@/lib/wiki-launch";

export const runtime = "nodejs";
export const revalidate = 3600;

export async function GET(): Promise<Response> {
	const cfg = await getLaunchConfig().catch(() => null);
	const snapshot: AccessSnapshot = cfg ?? { openKeys: [], access: {} };
	const groups = buildSiteMap({
		isOpen: (href) => isPathPublic(href, snapshot),
		includeMember: false,
		includeStaff: false,
	});

	const lines: string[] = [
		"# Dragon Ball France",
		"",
		"> Encyclopédie Dragon Ball francophone : fiches du manga et de l'anime,",
		"> databooks officiels, doctrine canon sourcée et journal éditorial. Le contenu",
		"> est écrit sur les tomes du manga et les planches des databooks, et chaque",
		"> fiche cite ses sources.",
		"",
		"## Pour citer ce site",
		"",
		"- Citer la page précisément, avec son titre et son URL.",
		"- Les sources primaires (tome et planche, databook et page, interview datée)",
		"  figurent sur la fiche elle-même : c'est elles qu'il faut reprendre, pas nous.",
		"- Une fiche sans source primaire visible n'est pas une preuve.",
		"",
		"## Données publiques",
		"",
		// Pas de ligne MCP ici : `mcp.dragonballfr.com` a été retiré le 2026-09-25
		// (shenron-mcp fusionné dans les outils `aphrody-mcp` dragonball.*, sans
		// équivalent HTTP public — yolo config/host/nginx/routes.json et
		// config/service-catalog.json). C'est exactement le défaut que ce fichier
		// dynamique remplace (voir le commentaire de tête) : ne pas le reproduire.
		`- [${SITE_URL}/api/canon](${SITE_URL}/api/canon) : doctrine canon et corpus de preuves.`,
		`- [${SITE_URL}/api/search?q=](${SITE_URL}/api/search) : recherche transversale du wiki.`,
		`- [${SITE_URL}/api/databooks](${SITE_URL}/api/databooks) : databooks, planches et transcriptions.`,
		`- [${SITE_URL}/api/manga](${SITE_URL}/api/manga) : tomes, chapitres et PLANCHES du manga.`,
		"  Chaque planche est adressable : `/api/manga/chapter/{id}/planche/{n}` rend son",
		"  image, sa transcription et l'URL de lecture ; `?format=image` redirige vers le",
		"  fichier, `?format=text` ne rend que le texte. Un chapitre entier se lit en une",
		"  requête avec `/api/manga/chapter/{id}?format=text`.",
		`- [${SITE_URL}/api/chronologie](${SITE_URL}/api/chronologie) : la frise officielle DANS L'ORDRE`,
		"  éditorial (épisodes, films, tomes). Ne pas la reconstruire à partir des dates de",
		"  diffusion : l'ordre est une décision humaine, pas un tri.",
		`- [${SITE_URL}/news/rss.xml](${SITE_URL}/news/rss.xml) : flux RSS des articles.`,
		"",
		"## Rubriques",
		"",
	];

	for (const { journey, items } of groups) {
		lines.push(`### ${journey.label}`, "");
		for (const item of items) {
			const blurb = item.blurb ? `: ${item.blurb}` : "";
			lines.push(`- [${item.label}](${SITE_URL}${item.href})${blurb}`);
		}
		lines.push("");
	}

	lines.push(
		"## Plan complet",
		"",
		`- [Plan du site](${SITE_URL}/plan-du-site)`,
		`- [Sitemap XML](${SITE_URL}/sitemap.xml)`,
		""
	);

	return new Response(lines.join("\n"), {
		headers: {
			"content-type": "text/plain; charset=utf-8",
			"Cache-Control": "public, max-age=600, s-maxage=3600",
		},
	});
}
