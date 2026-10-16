/**
 * Constantes Discord — module PUR, lisible côté serveur ET client.
 *
 * Elles vivaient dans `components/shared/DiscordSection.tsx`, marqué
 * `"use client"` : un export lu depuis un composant serveur (l'accueil) passe
 * le `type-check` et fait exploser `next build` en silence. Toute constante
 * partagée serveur/client doit vivre dans un module sans directive.
 */

export interface ServeurDiscord {
	/** Clé stable, utilisée dans les URL (`?serveur=`). */
	cle: string;
	/** Identifiant de guilde, tel que le widget public l'attend. */
	guildId: string;
	nom: string;
	/** Invitation permanente : le widget n'en renvoie pas toujours une. */
	invitation: string;
	/** Ce que le serveur EST, en une phrase — affiché sous son nom. */
	description: string;
	/** Trois mots, pas plus : ce sont des repères, pas un argumentaire. */
	atouts: readonly string[];
}

/**
 * Les deux serveurs de l'écosystème.
 *
 * Rose Griffon rassemble la communauté ; Achilléa porte la scène compétitive.
 * Ils ont leurs propres membres et leur propre hiérarchie — d'où deux embeds
 * et deux annuaires, jamais une liste fusionnée qui mélangerait les deux.
 */
export const SERVEURS_DISCORD: readonly ServeurDiscord[] = [
	{
		atouts: ["Discussion", "Événements", "Créations"],
		cle: "rose-griffon",
		description:
			"Le serveur de l'association : discussions, événements, projets créatifs et actualité Inazuma Eleven.",
		guildId: "1072991720268111892",
		invitation: "https://discord.com/invite/rosegriffon",
		nom: "Rose Griffon",
	},
	{
		atouts: ["Clans", "Mode classé", "Tournois"],
		cle: "achillea",
		description:
			"Le serveur compétitif : clans, matchs classés, tournois et classement de la scène française.",
		guildId: "1055585286320554055",
		invitation: "https://discord.gg/achillea-competitif-inazuma-eleven-fr-1055585286320554055",
		nom: "Achilléa",
	},
];

export function serveurDiscord(cle: string): ServeurDiscord {
	return SERVEURS_DISCORD.find((serveur) => serveur.cle === cle) ?? SERVEURS_DISCORD[0]!;
}

/** Serveur Rose Griffon interrogé via le widget public de Discord. */
export const ID_SERVEUR_DISCORD = SERVEURS_DISCORD[0]!.guildId;

/** Invitation unique de la communauté (le widget n'en renvoie pas toujours). */
export const INVITATION_DISCORD = SERVEURS_DISCORD[0]!.invitation;
