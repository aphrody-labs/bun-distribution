import type { Action, Organization, WebSite, WithContext } from "schema-dts";
import { JsonLd } from "@/components/JsonLd";
import { DISCORD_INVITE, SITE_URL } from "@/lib/config";

/**
 * Données structurées AU NIVEAU DU SITE (rendues sur toutes les pages via le
 * layout) : Organization (marque + logo + profils sociaux → knowledge panel) et
 * WebSite avec SearchAction (sitelinks search box Google → champ de recherche
 * directement dans les résultats, ciblant /wiki/search?q=). Absentes jusqu'ici :
 * la home n'avait AUCun JSON-LD. Server Component inerte, zéro JS client, aucun
 * cookie/header → ne casse pas le cache CDN du layout.
 */
const organization: WithContext<Organization> = {
	"@context": "https://schema.org",
	"@type": "Organization",
	name: "DBFR — Dragon Ball France",
	alternateName: "DBFR",
	url: SITE_URL,
	logo: `${SITE_URL}/apple-touch-icon.png`,
	description:
		"Communauté et encyclopédie francophone de l'univers Dragon Ball : personnages, sagas, planètes, manga, anime, films et jeux.",
	sameAs: [DISCORD_INVITE, "https://www.tiktok.com/@goku_dbfr"],
};

// `query-input` est une extension Google (sitelinks search box), absente du
// vocabulaire schema.org → schema-dts ne la modélise pas. Cast localisé sur la
// seule SearchAction pour garder le reste du document typé.
const searchAction = {
	"@type": "SearchAction",
	target: {
		"@type": "EntryPoint",
		urlTemplate: `${SITE_URL}/wiki/search?q={search_term_string}`,
	},
	"query-input": "required name=search_term_string",
} as unknown as Action;

const website: WithContext<WebSite> = {
	"@context": "https://schema.org",
	"@type": "WebSite",
	name: "DBFR — Dragon Ball France",
	url: SITE_URL,
	inLanguage: "fr-FR",
	potentialAction: searchAction,
};

export function SiteJsonLd() {
	return (
		<>
			<JsonLd data={organization} />
			<JsonLd data={website} />
		</>
	);
}
