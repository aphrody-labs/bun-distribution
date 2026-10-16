import { SITE_URL } from "@/lib/site-url";

/**
 * Liens publics canoniques du réseau Rose Griffon.
 *
 * Une seule source alimente les cartes sociales, le JSON-LD et les métadonnées
 * des trois univers après fusion. Les liens propres à un contenu restent dans
 * ce contenu ; cette liste décrit uniquement les identités officielles.
 */
export const SOCIAL_LINKS = {
	association: {
		discord: "https://discord.gg/rosegriffon",
		instagram: "https://www.instagram.com/rose_griffonfr",
		twitch: "https://twitch.tv/rose_griffontv",
		x: "https://x.com/rose_griffon",
		youtube: "https://www.youtube.com/@RoseGriffon",
	},
	azalee: {
		instagram: "https://www.instagram.com/azaleefr",
		x: "https://x.com/Azalee_IE",
	},
	achillea: {
		discord: "https://discord.gg/achillea-competitif-inazuma-eleven-fr-1055585286320554055",
		twitch: "https://twitch.tv/Achillea_IE",
		x: "https://x.com/Achillea_IE",
		youtube: "https://youtube.com/@Achillea_IE",
	},
} as const;

/** Liste stable utilisée par Organization.sameAs. */
export const NETWORK_SOCIAL_LINKS = [
	SOCIAL_LINKS.association.x,
	SOCIAL_LINKS.azalee.x,
	SOCIAL_LINKS.achillea.x,
	SOCIAL_LINKS.association.youtube,
	SOCIAL_LINKS.achillea.youtube,
	SOCIAL_LINKS.association.twitch,
	SOCIAL_LINKS.achillea.twitch,
	SOCIAL_LINKS.association.instagram,
	SOCIAL_LINKS.azalee.instagram,
	SOCIAL_LINKS.association.discord,
	SOCIAL_LINKS.achillea.discord,
] as const;

export const NETWORK_SITES = [
	SITE_URL,
	"https://azalee.rosegriffon.fr",
	"https://achillea.rosegriffon.fr",
] as const;

export const NETWORK_SAME_AS = [...NETWORK_SITES, ...NETWORK_SOCIAL_LINKS] as const;
