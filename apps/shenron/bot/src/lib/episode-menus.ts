/**
 * Menus déroulants d'épisodes — la brique PURE, partagée par le script de
 * publication du forum (`scripts/forum-anime.ts`) et par le handler qui répond
 * aux clics (`commands/wiki/ForumEpisodes.ts`).
 *
 * Parti pris repris de `@aphrody/wonderbot` (`src/forum.ts`) : le menu remplace
 * la liste de liens. Un fil de saga porte jusqu'à des dizaines d'épisodes ; les
 * lister tous avec leurs lecteurs déborde des 4 096 signes d'une description et
 * des 6 000 signes d'un message. Un membre choisit son épisode, le bot lui
 * répond en éphémère — le fil reste lisible et les discussions ne sont pas
 * noyées.
 *
 * ── POURQUOI CE MODULE NE CONNAÎT PAS discord.js ────────────────────────────
 * Rien ici n'importe `discord.js` : le script qui publie le forum parle à
 * l'API REST à la main, le bot passe par discordx. Une forme neutre
 * (`MenuEpisodes`) permet aux deux de poser exactement les mêmes menus — et se
 * teste sans passerelle Discord.
 *
 * ── L'ENCODAGE, DIT UNE FOIS ────────────────────────────────────────────────
 *   custom_id : `dbfr:ep:<clé>:<page>`   la clé identifie le lot (id de saga,
 *                                        `film`, `chrono`…), la page le rang du
 *                                        menu dans le message ;
 *   value     : l'`id` de `bot.db_episodes`, tel quel.
 *
 * La valeur porte l'identifiant et RIEN d'autre : le handler n'a alors aucune
 * information à croire sur parole (numéro, série, titre), il relit la base. Un
 * custom_id périmé — fil publié avant un changement de saga — ne peut donc pas
 * afficher un épisode faux, au pire il n'affiche rien.
 */

/** Préfixe des `custom_id` : c'est lui que le handler filtre. */
export const PREFIXE_MENU_EPISODES = "dbfr:ep";

/** Un menu Discord accepte 25 options. */
export const OPTIONS_PAR_MENU = 25;

/** Un message accepte 5 rangées de composants, donc 5 menus. */
const MENUS_PAR_MESSAGE = 5;

/** Au-delà, le lot ne tient pas dans un message : 5 × 25. */
export const MAX_EPISODES_PAR_MESSAGE = OPTIONS_PAR_MENU * MENUS_PAR_MESSAGE;

/** Plafonds imposés par Discord, en signes. */
const MAX_LABEL = 100;
const MAX_DESCRIPTION = 100;
const MAX_PLACEHOLDER = 150;
const MAX_CUSTOM_ID = 100;
const MAX_VALUE = 100;

/** Ce que le module a besoin de savoir d'un épisode pour l'afficher en option. */
export interface EpisodePourMenu {
	/** `bot.db_episodes.id` — c'est ce qui voyage en valeur d'option. */
	readonly id: number | string;
	/** Numéro dans la série, s'il est connu. */
	readonly numero?: number | string | null;
	/** Titre français. */
	readonly titre?: string | null;
	/** Ligne d'appoint sous le libellé (langues disponibles, date…). */
	readonly description?: string | null;
}

/** Un menu déroulant, dans une forme que discord.js ET l'API REST acceptent. */
export interface MenuEpisodes {
	readonly customId: string;
	readonly placeholder: string;
	readonly options: readonly OptionEpisode[];
}

interface OptionEpisode {
	readonly label: string;
	readonly value: string;
	readonly description?: string;
}

/** Coupe proprement à `taille` signes, ellipse comprise. */
function coupe(texte: string, taille: number): string {
	const propre = texte.replace(/\s+/g, " ").trim();
	if (propre.length <= taille) return propre;
	return `${propre.slice(0, taille - 1).trimEnd()}…`;
}

/** Libellé d'une option : « Épisode 12 — Le Grand Départ », tronqué à 100. */
export function libelleEpisode(episode: EpisodePourMenu): string {
	const numero = Number(episode.numero);
	const tete = Number.isFinite(numero) && numero > 0 ? `Épisode ${numero}` : `Épisode`;
	const titre = (episode.titre ?? "").trim();
	return coupe(titre ? `${tete} — ${titre}` : tete, MAX_LABEL);
}

/**
 * Clé de lot assainie : seuls `a-z 0-9 - _` survivent.
 *
 * Le custom_id est plafonné à 100 signes et sert de contrat entre un message
 * déjà publié et un handler futur. Un nom de saga libre y ferait entrer des
 * `:` — le séparateur — et casserait la relecture.
 */
export function cleMenu(brut: string | number): string {
	const nettoyee = String(brut)
		.toLowerCase()
		.replace(/[^a-z0-9_-]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return coupe(nettoyee || "lot", 32);
}

/**
 * Découpe une liste d'épisodes en menus de 25 options, 5 menus au plus.
 *
 * Les épisodes en trop ne sont PAS proposés : un message n'accepte pas plus de
 * cinq rangées, et proposer silencieusement un sous-ensemble vaut mieux que
 * refuser de publier le fil. À l'appelant de découper son lot en plusieurs
 * messages s'il dépasse 125 (`MAX_EPISODES_PAR_MESSAGE`).
 *
 * @param cle      identifiant du lot (id de saga, `film`, `chrono`…) — assaini.
 * @param episodes épisodes dans l'ordre d'affichage voulu.
 * @param options  `placeholder` : libellé du menu quand le lot tient en un seul.
 */
export function construireMenusEpisodes(
	cle: string | number,
	episodes: readonly EpisodePourMenu[],
	options?: { readonly placeholder?: string }
): MenuEpisodes[] {
	const cleSure = cleMenu(cle);
	const vues = new Set<string>();
	// Discord refuse deux options de même valeur dans un même message : un
	// doublon en base (même épisode listé deux fois) rendrait le menu invalide.
	const retenus = episodes.filter((e) => {
		const valeur = String(e.id).trim();
		if (!valeur || valeur.length > MAX_VALUE || vues.has(valeur)) return false;
		vues.add(valeur);
		return true;
	});

	const menus: MenuEpisodes[] = [];
	for (let page = 0; page < MENUS_PAR_MESSAGE; page++) {
		const tranche = retenus.slice(page * OPTIONS_PAR_MENU, (page + 1) * OPTIONS_PAR_MENU);
		if (tranche.length === 0) break;

		const premier = Number(tranche[0]?.numero);
		const dernier = Number(tranche[tranche.length - 1]?.numero);
		const bornesConnues = Number.isFinite(premier) && Number.isFinite(dernier);
		const placeholder =
			retenus.length <= OPTIONS_PAR_MENU
				? (options?.placeholder ?? "Choisis un épisode")
				: bornesConnues
					? `Épisodes ${premier} à ${dernier}`
					: `Épisodes ${page * OPTIONS_PAR_MENU + 1} à ${page * OPTIONS_PAR_MENU + tranche.length}`;

		menus.push({
			customId: coupe(`${PREFIXE_MENU_EPISODES}:${cleSure}:${page}`, MAX_CUSTOM_ID),
			placeholder: coupe(placeholder, MAX_PLACEHOLDER),
			options: tranche.map((episode) => {
				const description = (episode.description ?? "").trim();
				const option: { label: string; value: string; description?: string } = {
					label: libelleEpisode(episode),
					value: String(episode.id).trim(),
				};
				if (description) option.description = coupe(description, MAX_DESCRIPTION);
				return option;
			}),
		});
	}
	return menus;
}

/** Vrai si ce `custom_id` est celui d'un menu d'épisodes. */
export function estMenuEpisodes(customId: string): boolean {
	return customId.startsWith(`${PREFIXE_MENU_EPISODES}:`);
}

/** Relit un `custom_id` de menu, `null` s'il est malformé. */
export function lireCustomIdMenu(customId: string): { cle: string; page: number } | null {
	if (!estMenuEpisodes(customId)) return null;
	const reste = customId.slice(PREFIXE_MENU_EPISODES.length + 1);
	const sep = reste.lastIndexOf(":");
	if (sep <= 0) return null;
	const page = Number.parseInt(reste.slice(sep + 1), 10);
	if (!Number.isFinite(page) || page < 0) return null;
	return { cle: reste.slice(0, sep), page };
}

/** Relit une valeur d'option, `null` si ce n'est pas un identifiant d'épisode. */
export function lireValeurEpisode(valeur: string): number | null {
	const n = Number.parseInt(valeur.trim(), 10);
	return Number.isFinite(n) && n > 0 ? n : null;
}
