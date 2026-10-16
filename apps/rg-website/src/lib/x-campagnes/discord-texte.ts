/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Le texte d'un message Discord n'est PAS du texte.
 *
 * ── LE DÉFAUT, TEL QU'IL SE VOYAIT ────────────────────────────────────────
 * Discord stocke les mentions et les émojis personnalisés sous forme de balises
 * porteuses d'identifiants : `<@198209347589898240>`, `<:mouahaha:1296067836388708513>`,
 * `<#1537458038623965194>`, `<@&1152050533289443358>`. Servies telles quelles, elles
 * s'affichaient LITTÉRALEMENT sur https://rosegriffon.fr/iergday — « Dessin sous contrainte
 * de <@198209347589898240> » — et un émoji de 38 caractères mangeait à lui seul le quart
 * d'un extrait plafonné à 160. Six des quinze créations Discord d'IERG Day en portaient.
 *
 * ── CE QUE FAIT CE MODULE ─────────────────────────────────────────────────
 * Il ne devine rien : il RÉSOUT contre ce que la base connaît déjà
 * (`discord_members`, `discord_roles`, `discord_channels`), et se rabat sur un mot neutre
 * quand l'identifiant est inconnu — jamais sur l'identifiant brut, qui n'apprend rien à
 * personne et ressemble à un bogue.
 *
 * Les émojis personnalisés, eux, ne se résolvent pas en texte : ils survivent le temps de
 * la découpe en morceaux (`decouperTexteDiscord`) pour que l'écran les rende en IMAGE.
 * C'est la seule façon de rendre « ma fille shirel ça faisait longtemps 🐿 » au lieu d'une
 * suite de chiffres — ou de `:RG_Roy_coeur1:` pour qui bloque les images tierces.
 *
 * ── MODULE PUR ────────────────────────────────────────────────────────────
 * Aucun import : il est lisible par la page serveur, par un îlot `"use client"` et par un
 * script Bun. La RÉSOLUTION (les requêtes SQL) vit dans `queries.ts` ; ici, on ne fait que
 * transformer une chaîne en s'appuyant sur un dictionnaire qu'on nous donne.
 */

/** Ce que la base sait des identifiants croisés dans un texte. */
export interface ResolutionDiscord {
	/** `discord_id` → nom affiché (surnom de serveur, sinon nom global, sinon pseudo). */
	membres: Readonly<Record<string, string>>;
	/** `role_id` → nom du rôle. */
	roles: Readonly<Record<string, string>>;
	/** `channel_id` → nom du salon, sans le `#`. */
	salons: Readonly<Record<string, string>>;
}

/** Résolution vide : tout retombe sur les libellés neutres. */
export const RESOLUTION_VIDE: ResolutionDiscord = { membres: {}, roles: {}, salons: {} };

/*
 * ⚠ LES `RegExp` GLOBALES SONT CONSTRUITES À CHAQUE APPEL, JAMAIS PARTAGÉES.
 * Une `RegExp` avec le drapeau `g` garde son `lastIndex` d'un appel à l'autre : partagée
 * entre deux textes, elle saute le début du second. C'est le genre de défaut qui ne se voit
 * qu'une fois sur deux, sur une carte au hasard de la galerie.
 */
const MENTION_MEMBRE = () => /<@!?(\d{15,20})>/g;
const MENTION_ROLE = () => /<@&(\d{15,20})>/g;
const MENTION_SALON = () => /<#(\d{15,20})>/g;
const HORODATAGE = () => /<t:(-?\d{1,15})(?::([tTdDfFR]))?>/g;
/** `<:nom:id>` et sa variante animée `<a:nom:id>`. */
const EMOJI = () => /<(a)?:([A-Za-z0-9_]{2,32}):(\d{15,20})>/g;

/**
 * Tous les identifiants Discord croisés dans un lot de textes.
 *
 * Un lot, et non un texte : la galerie affiche vingt créations par page, et les résoudre
 * une par une ferait soixante requêtes là où trois suffisent.
 */
export function collecterIdentifiantsDiscord(textes: readonly string[]): {
	membres: string[];
	roles: string[];
	salons: string[];
} {
	const membres = new Set<string>();
	const roles = new Set<string>();
	const salons = new Set<string>();
	for (const texte of textes) {
		if (!texte) continue;
		// `matchAll` type ses groupes en `string | undefined` : ils sont ici garantis par la
		// forme même de l'expression, mais on préfère un filtre à une assertion — une regex
		// qu'on retouche un jour ne doit pas pouvoir glisser un `undefined` dans un Set.
		for (const trouve of texte.matchAll(MENTION_MEMBRE())) if (trouve[1]) membres.add(trouve[1]);
		for (const trouve of texte.matchAll(MENTION_ROLE())) if (trouve[1]) roles.add(trouve[1]);
		for (const trouve of texte.matchAll(MENTION_SALON())) if (trouve[1]) salons.add(trouve[1]);
	}
	return { membres: [...membres], roles: [...roles], salons: [...salons] };
}

/**
 * Rend un horodatage Discord (`<t:1755900000:R>`) en français.
 *
 * Le format `R` (« il y a trois jours ») est délibérément rendu en date absolue : une page
 * mise en cache par l'ISR figerait un « il y a 2 heures » qui vieillirait sans jamais se
 * corriger. Une date qui ne bouge pas ne peut pas mentir.
 */
function rendreHorodatage(secondes: number, style: string | undefined): string {
	const date = new Date(secondes * 1000);
	if (Number.isNaN(date.getTime())) return "";
	const avecHeure = style === undefined || ["t", "T", "f", "F"].includes(style);
	return date.toLocaleString("fr-FR", {
		day: "numeric",
		month: "long",
		year: "numeric",
		...(avecHeure ? { hour: "2-digit", minute: "2-digit" } : {}),
	});
}

/**
 * Remplace les mentions par des noms lisibles. Les émojis personnalisés sont laissés en
 * place : c'est `decouperTexteDiscord` qui les transformera en images.
 *
 * `@everyone` et `@here` ne sont PAS touchés : ce sont déjà des mots, et les réécrire
 * donnerait à croire que quelqu'un a été nommé.
 */
export function resoudreMentions(texte: string, resolution: ResolutionDiscord = RESOLUTION_VIDE): string {
	if (!texte) return "";
	return texte
		.replace(MENTION_MEMBRE(), (_, id: string) => `@${resolution.membres[id] ?? "membre"}`)
		.replace(MENTION_ROLE(), (_, id: string) => `@${resolution.roles[id] ?? "rôle"}`)
		.replace(MENTION_SALON(), (_, id: string) => `#${resolution.salons[id] ?? "salon"}`)
		.replace(HORODATAGE(), (brut, secondes: string, style: string | undefined) => {
			const rendu = rendreHorodatage(Number.parseInt(secondes, 10), style);
			return rendu || brut;
		});
}

/** Un morceau de texte Discord : du texte, ou un émoji personnalisé. */
export type MorceauDiscord =
	| { type: "texte"; valeur: string }
	| { type: "emoji"; nom: string; id: string; anime: boolean };

/**
 * Découpe un texte en morceaux affichables.
 *
 * L'ordre est conservé : c'est la seule façon de rendre « merci <:coeur:1> beaucoup » sans
 * déplacer l'émoji à la fin ni le perdre.
 */
export function decouperTexteDiscord(texte: string): MorceauDiscord[] {
	if (!texte) return [];
	const morceaux: MorceauDiscord[] = [];
	let curseur = 0;
	for (const trouve of texte.matchAll(EMOJI())) {
		const debut = trouve.index ?? 0;
		if (debut > curseur) {
			morceaux.push({ type: "texte", valeur: texte.slice(curseur, debut) });
		}
		const nom = trouve[2];
		const id = trouve[3];
		if (!nom || !id) continue;
		morceaux.push({ anime: trouve[1] === "a", id, nom, type: "emoji" });
		curseur = debut + trouve[0].length;
	}
	if (curseur < texte.length) {
		morceaux.push({ type: "texte", valeur: texte.slice(curseur) });
	}
	return morceaux;
}

/**
 * Version PUREMENT TEXTUELLE : chaque émoji devient `:nom:`.
 *
 * C'est ce qui part dans un attribut `alt`, un `aria-label`, une balise `<meta>` ou un
 * flux JSON-LD — partout où une image n'a pas sa place et où l'identifiant brut n'aurait
 * aucun sens.
 */
export function texteDiscordEnClair(texte: string, resolution?: ResolutionDiscord): string {
	return resoudreMentions(texte, resolution).replace(EMOJI(), (_, __, nom: string) => `:${nom}:`);
}

/**
 * URL de l'émoji personnalisé sur le CDN de Discord.
 *
 * Format `webp` et taille 48 : la balise l'affiche à 20 px, et un PNG de 128 px pèserait
 * quatre fois plus pour le même rendu. ⚠ `cdn.discordapp.com` doit figurer dans la
 * directive `img-src` de la politique de sécurité du site, sinon l'émoji ne charge pas —
 * et rien dans la console ne parle d'émoji, seulement de « Refused to load the image ».
 */
export function urlEmojiDiscord(id: string, anime: boolean): string {
	return `https://cdn.discordapp.com/emojis/${id}.${anime ? "gif" : "webp"}?size=48&quality=lossless`;
}

/**
 * Extrait borné qui ne coupe JAMAIS au milieu d'une balise d'émoji.
 *
 * `extraitTexte` compte des caractères : appliqué à un texte Discord, il tranchait
 * `<:mouahaha:1296067836388708513>` en `<:mouah…`, c'est-à-dire un déchet que plus aucun
 * rendu ne sait rattraper. Ici, un émoji compte pour DEUX caractères — sa largeur réelle à
 * l'écran — et la coupe tombe toujours entre deux morceaux.
 */
export function extraitTexteDiscord(
	texte: string,
	maximum = 220,
	resolution?: ResolutionDiscord
): string {
	const resolu = resoudreMentions(texte, resolution)
		.replace(/https:\/\/t\.co\/\w+/g, "")
		.replace(/\s+\n/g, "\n")
		.trim();

	const morceaux = decouperTexteDiscord(resolu);
	let largeur = 0;
	let sortie = "";
	for (const morceau of morceaux) {
		if (morceau.type === "emoji") {
			if (largeur + 2 > maximum) return `${sortie.trimEnd()}…`;
			largeur += 2;
			sortie += `<${morceau.anime ? "a" : ""}:${morceau.nom}:${morceau.id}>`;
			continue;
		}
		const reste = maximum - largeur;
		if (morceau.valeur.length <= reste) {
			largeur += morceau.valeur.length;
			sortie += morceau.valeur;
			continue;
		}
		const brut = morceau.valeur.slice(0, Math.max(1, reste - 1));
		// Le caractère suivant est une espace → le dernier mot est complet, on le garde.
		const motComplet = /\s/.test(morceau.valeur.charAt(Math.max(1, reste - 1)));
		const coupe = motComplet ? brut : brut.replace(/\s+\S*$/, "");
		// ⚠ `sortie` EN TÊTE. Sans elle, un texte dont le PREMIER morceau tient dans le budget
		// et dont le second déborde perdait tout ce qui précédait : « Je crois que je suis pile
		// dans les temps :mouahaha: Bellatrix… » se réduisait à « Bellatrix… ».
		return `${sortie}${(coupe || brut).trimEnd()}…`;
	}
	return sortie.trim();
}
