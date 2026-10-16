/**
 * Noyau PUR des sondages du serveur et des campagnes à hashtag.
 *
 * Ce module ne connaît NI Postgres NI Discord : tout ce qui est décidable sans
 * base (quel état afficher, quelle barre dessiner, quelle image est
 * republiable, quelle page demander) vit ici et se teste sans rien démarrer.
 * Les lectures base sont dans `commands/sondage.ts` et `commands/campagne.ts`.
 *
 * Il porte les DEUX domaines parce qu'ils partagent la même mécanique de
 * pagination par boutons, le même bornage de texte et la même règle sur les
 * visuels republiables. Les deux moitiés sont séparées par des bandeaux.
 *
 * ─── LIGNE ROUGE — VIE PRIVÉE ───────────────────────────────────────────────
 * Un sondage ne publie QUE des décomptes agrégés : combien de voix par choix,
 * combien de votes, combien de participants. Le rattachement d'un membre à son
 * choix est hors de portée de ce chantier — il n'est ni lu, ni agrégé, ni
 * exposé, et la table qui le porte n'est nommée nulle part dans les fichiers de
 * cette unité (un contrôle mécanique le vérifie dans le fichier de test). Aucun
 * croisement non plus (« N membres du rôle X ont voté Y ») : sur un serveur de
 * quelques dizaines de comptes actifs, un tel croisement ré-identifie.
 * ────────────────────────────────────────────────────────────────────────────
 */

import {
	formaterNombre as formaterNombreUi,
	formaterPourcentage as formaterPourcentageUi,
} from "./ui/nombres";
import { borner, ilYA, leJour } from "./ui/texte";
import {
	MAX_CUSTOM_ID as MAX_CUSTOM_ID_UI,
	bornerPage as bornerPageUi,
	decoderEtat,
	encoderEtat,
	nombreDePages as nombreDePagesUi,
	pageDecodee,
	sansSeparateur,
} from "./ui/etat";

// ─── Utilitaires communs ────────────────────────────────────────────────────

/**
 * Entier lisible, ou `null`.
 *
 * Bun.SQL rend les `bigint` en CHAÎNE (mesuré : `sum(...)` renvoie `"14098"`,
 * un `::int` renvoie `14098`). Sans cette normalisation, un `toLocaleString`
 * sur la somme des « j'aime » lèverait ou afficherait la chaîne brute.
 */
export function entier(valeur: unknown): number | null {
	if (typeof valeur === "number") {
		return Number.isFinite(valeur) ? Math.trunc(valeur) : null;
	}
	if (typeof valeur === "string" && valeur.trim().length > 0) {
		const nombre = Number(valeur);
		return Number.isFinite(nombre) ? Math.trunc(nombre) : null;
	}
	if (typeof valeur === "bigint") {
		return Number(valeur);
	}
	return null;
}

/** Nombre décimal, ou `null` (mêmes précautions que `entier`). */
export function decimal(valeur: unknown): number | null {
	if (typeof valeur === "number") {
		return Number.isFinite(valeur) ? valeur : null;
	}
	if (typeof valeur === "string" && valeur.trim().length > 0) {
		const nombre = Number(valeur);
		return Number.isFinite(nombre) ? nombre : null;
	}
	return null;
}

/** Entier groupé à la française (« 14 098 »). */
export function formaterNombre(valeur: number | null | undefined): string {
	return typeof valeur === "number" && Number.isFinite(valeur)
		? formaterNombreUi(Math.trunc(valeur))
		: "—";
}

/** Accorde un nom au pluriel simple. */
export function pluriel(n: number, singulier: string, pluriel_: string): string {
	return n === 1 ? singulier : pluriel_;
}

/**
 * Date sûre : `null` sur une valeur absente ou invalide.
 *
 * Bun.SQL rend déjà des `Date` pour les `timestamptz`, mais les mêmes fonctions
 * sont appelées sur des chaînes ISO (état de bouton, tests).
 */
export function versDate(valeur: Date | string | null | undefined): Date | null {
	if (!valeur) {
		return null;
	}
	const date = valeur instanceof Date ? valeur : new Date(valeur);
	return Number.isNaN(date.getTime()) ? null : date;
}

/** Horodatage relatif Discord (`<t:1234:R>`), ou `—`. */
export function horodatageRelatif(valeur: Date | string | null | undefined): string {
	return ilYA(versDate(valeur));
}

/** Horodatage date longue Discord (`<t:1234:D>`), ou `—`. */
export function horodatageDate(valeur: Date | string | null | undefined): string {
	return leJour(versDate(valeur), "D");
}

/** Coupe proprement un texte, en posant une ellipse. */
export function couper(texte: string, max: number): string {
	return max <= 0 ? "" : borner(texte.replace(/\s+/g, " ").trim(), max);
}

/**
 * Émoji personnalisé Discord : `<:nom:id>` ou `<a:nom:id>` (animé).
 *
 * Ces jetons traversent l'échappement INTACTS : plusieurs questions de sondage
 * en contiennent (mesuré : « Quel personnage aimeriez-vous voir incarner cette
 * émote <:IE_hey1:1089276504657117205> ? »). Échapper leur souligné produit
 * `<:IE\_hey1:…>`, que Discord ne reconnaît plus et affiche en toutes lettres.
 */
const EMOJI_PERSONNALISE = /<a?:[A-Za-z0-9_~]+:\d+>/g;

/**
 * Neutralise le markdown Discord d'un texte repris d'ailleurs.
 *
 * Un libellé de choix ou un post X peut contenir `*`, `_`, `` ` `` ou `~` : sans
 * échappement, une paire d'astérisques dans un pseudo passe le reste de l'embed
 * en italique. On échappe aussi `|` (spoiler) et `>` en début de ligne (citation).
 * Les émojis personnalisés sont préservés (cf. `EMOJI_PERSONNALISE`).
 *
 * ⚠ `[` et `]` sont échappés EUX AUSSI, et pas par excès de zèle : la plupart de
 * ces textes finissent dans le libellé d'un lien masqué (`[libellé](url)`, cf.
 * `ligneListeSondage`, `ligneListeCampagne`, `lignePost`). Un crochet fermant
 * dans une question terminerait le libellé trop tôt et déverserait l'URL brute
 * dans l'embed. Aucune question ne le fait aujourd'hui, mais l'archive grossit à
 * chaque passe du cron et la question suivante n'est pas sous notre contrôle.
 */
export function echapperMarkdown(texte: string): string {
	const morceaux: string[] = [];
	let curseur = 0;
	EMOJI_PERSONNALISE.lastIndex = 0;
	for (
		let trouve = EMOJI_PERSONNALISE.exec(texte);
		trouve !== null;
		trouve = EMOJI_PERSONNALISE.exec(texte)
	) {
		morceaux.push(echapperBrut(texte.slice(curseur, trouve.index)), trouve[0]);
		curseur = trouve.index + trouve[0].length;
	}
	morceaux.push(echapperBrut(texte.slice(curseur)));
	return morceaux.join("");
}

function echapperBrut(fragment: string): string {
	return fragment.replace(/([\\*_`~|[\]])/g, "\\$1").replace(/^>/gm, "\\>");
}

/**
 * Texte destiné à un TITRE d'embed, où Discord ne rend ni markdown ni émoji
 * personnalisé : un `<:IE_hey1:1089…>` laissé tel quel s'y afficherait en
 * toutes lettres, identifiant compris. On le ramène à `:IE_hey1:`, lisible.
 */
export function texteTitre(texte: string): string {
	return texte.replace(EMOJI_PERSONNALISE, (jeton) => `:${jeton.split(":")[1] ?? ""}:`);
}

// ─── Visuels republiables ───────────────────────────────────────────────────

/** Chemin public du seau `assets` du service de stockage. */
export const CHEMIN_ASSETS = "/storage/v1/object/public/assets/";

/**
 * Hôtes dont une URL ne doit JAMAIS être republiée dans un embed.
 *
 * Les pièces jointes Discord sont servies signées (`?ex=…&is=…&hm=…`) et
 * périment en moins de 24 h : republier ce lien produit une image morte dès le
 * lendemain. La copie durable vit dans le seau public `assets`, c'est elle
 * qu'on sert. La vérification porte sur l'HÔTE, pas sur la présence de la
 * signature : une URL Discord privée de sa query rend 404, elle n'est donc pas
 * davantage republiable.
 */
const HOTES_INTERDITS = ["cdn.discordapp.com", "media.discordapp.net"] as const;

/** L'URL pointe-t-elle vers une pièce jointe Discord (donc signée et périssable) ? */
export function estUrlDiscordSignee(url: string): boolean {
	try {
		const hote = new URL(url).hostname.toLowerCase();
		return HOTES_INTERDITS.some((interdit) => hote === interdit || hote.endsWith(`.${interdit}`));
	} catch {
		return false;
	}
}

/**
 * URL absolue d'un fichier recopié dans le seau public `assets`.
 *
 * `chemin` est un chemin RELATIF stocké en base (« discord/sondages/… »). Une
 * valeur qui ressemble à une URL absolue est refusée : la seule façon qu'un
 * `://` arrive ici serait une régression de la récolte, et on préfère un embed
 * sans image à un embed qui republie un lien signé.
 */
export function urlAsset(chemin: string | null | undefined, origine: string): string | null {
	if (typeof chemin !== "string") {
		return null;
	}
	const propre = chemin.trim().replace(/^\/+/, "");
	if (propre.length === 0 || propre.includes("://")) {
		return null;
	}
	return `${origine.replace(/\/+$/, "")}${CHEMIN_ASSETS}${propre}`;
}

/**
 * URL d'image déjà absolue, gardée seulement si elle est republiable.
 *
 * Sert aux visuels de campagne (`x_campagnes.image_couverture`, stockés en
 * absolu) et aux médias de post X.
 */
export function urlImageRepubliable(valeur: unknown): string | null {
	if (typeof valeur !== "string") {
		return null;
	}
	const propre = valeur.trim();
	if (!/^https:\/\//i.test(propre) || estUrlDiscordSignee(propre)) {
		return null;
	}
	return propre;
}

// ─── Sondages ───────────────────────────────────────────────────────────────

/** Un choix d'un sondage, tel que la base le connaît. */
export interface OptionSondage {
	/** Rang d'origine dans l'encart, 0-indexé : c'est la CLÉ (deux choix peuvent
	 *  porter le même libellé dans un même sondage). */
	position: number;
	/** Emoji de vote : caractère Unicode, ou `<:nom:id>` / `<a:nom:id>`. */
	emoji: string | null;
	label: string;
	/** `null` quand le sondage n'a jamais publié de décompte. */
	votes: number | null;
	/** Pourcentage TEL QUE PUBLIÉ par le bot (arrondi maison, somme 99 → 101). */
	percentage: number | null;
}

/** Ligne brute de `discord_polls`, réduite aux colonnes lues par le bot. */
export interface LigneSondage {
	poll_id: string;
	provider: string | null;
	source: string | null;
	language: string | null;
	message_id: string | null;
	channel_id: string;
	guild_id: string;
	question: string;
	creator_username: string | null;
	command: string | null;
	max_choices: number | string | null;
	locked: boolean | null;
	ended: boolean | null;
	ends_at: Date | string | null;
	created_at: Date | string | null;
	total_votes: number | string | null;
	total_voters: number | string | null;
	results_hidden: boolean | null;
	visual_path: string | null;
	visual_width: number | string | null;
	visual_height: number | string | null;
	visual_alt: string | null;
	options: unknown;
}

/**
 * D'où viennent les DÉCOMPTES d'un sondage (pas ses métadonnées) :
 * - `embed` : lus dans l'encart publié par le bot — chiffres officiels ;
 * - `reactions` : RECONSTITUÉS depuis les réactions archivées du salon, pour
 *   les sondages dont l'encart n'a jamais publié de résultat (± 1 vote) ;
 * - `api` : réservé, aucun sondage n'en porte aujourd'hui.
 *
 * C'est la colonne `discord_polls.source` : elle porte à elle seule la
 * distinction « résultat officiel » / « estimation », et l'embed DOIT la dire.
 */
export type SourceSondage = "embed" | "reactions" | "api";

/** Sondage de bot EasyPoll, ou sondage natif Discord. */
export type FournisseurSondage = "easypoll" | "discord";

/** Visuel d'un sondage, déjà résolu vers sa copie republiable. */
export interface VisuelSondage {
	url: string;
	largeur: number | null;
	hauteur: number | null;
	/** Texte alternatif saisi sur Discord ; `null` = rien d'honnête à dire. */
	alt: string | null;
}

/** Sondage normalisé, prêt à rendre. */
export interface Sondage {
	pollId: string;
	provider: FournisseurSondage;
	source: SourceSondage;
	/**
	 * Langue d'INTERFACE de l'encart, jamais celle de la question : deux
	 * sondages portant la même question française sont classés l'un « fr »,
	 * l'autre « en ». Valeur de diagnostic, à ne jamais présenter comme
	 * « sondage en anglais ».
	 */
	language: "fr" | "en" | null;
	messageId: string | null;
	channelId: string;
	guildId: string;
	question: string;
	creatorUsername: string | null;
	command: string | null;
	/** 0 = choix illimités. */
	maxChoices: number;
	locked: boolean;
	ended: boolean;
	endsAt: Date | null;
	createdAt: Date | null;
	totalVotes: number | null;
	totalVoters: number | null;
	resultsHidden: boolean;
	visuel: VisuelSondage | null;
	options: OptionSondage[];
}

function normaliserOptions(brut: unknown): OptionSondage[] {
	if (!Array.isArray(brut)) {
		return [];
	}
	const options: OptionSondage[] = [];
	for (const entree of brut) {
		if (!entree || typeof entree !== "object") {
			continue;
		}
		const item = entree as Record<string, unknown>;
		const label = typeof item.label === "string" ? item.label : "";
		options.push({
			emoji: typeof item.emoji === "string" && item.emoji.length > 0 ? item.emoji : null,
			label,
			percentage: decimal(item.percentage),
			position: entier(item.position) ?? options.length,
			votes: entier(item.votes),
		});
	}
	return options.sort((a, b) => a.position - b.position);
}

/** Ligne base → sondage rendable. `origine` sert à construire l'URL du visuel. */
export function normaliserSondage(ligne: LigneSondage, origine: string): Sondage {
	const urlVisuel = urlAsset(ligne.visual_path, origine);
	const alt = ligne.visual_alt?.trim();
	return {
		channelId: ligne.channel_id,
		command: ligne.command,
		createdAt: versDate(ligne.created_at),
		creatorUsername: ligne.creator_username,
		ended: ligne.ended === true,
		endsAt: versDate(ligne.ends_at),
		guildId: ligne.guild_id,
		language: ligne.language === "fr" || ligne.language === "en" ? ligne.language : null,
		locked: ligne.locked === true,
		maxChoices: entier(ligne.max_choices) ?? 1,
		messageId: ligne.message_id,
		options: normaliserOptions(ligne.options),
		pollId: ligne.poll_id,
		provider: ligne.provider === "discord" ? "discord" : "easypoll",
		question: ligne.question,
		resultsHidden: ligne.results_hidden === true,
		source: ligne.source === "reactions" ? "reactions" : ligne.source === "api" ? "api" : "embed",
		totalVoters: entier(ligne.total_voters),
		totalVotes: entier(ligne.total_votes),
		visuel: urlVisuel
			? {
					alt: alt && alt.length > 0 ? alt : null,
					hauteur: entier(ligne.visual_height),
					largeur: entier(ligne.visual_width),
					url: urlVisuel,
				}
			: null,
	};
}

/**
 * État d'un sondage — TROIS valeurs, parce que la base n'en connaît que deux et
 * que la troisième est la vérité pour la moitié du corpus.
 *
 * `ended` vaut `false` par défaut dès que l'encart ne porte pas de clôture :
 * c'est le cas des 25 sondages reconstitués depuis les réactions (2023-08 →
 * 2024-04), qui n'ont jamais publié ni clôture ni date de fin. Les annoncer
 * « En cours » en 2026 reviendrait à affirmer ce que l'encart n'a jamais dit.
 * `ends_at IS NULL` est le marqueur exact (mesuré le 13/8/2026 : 26 sondages
 * terminés, 25 sans état publié, 0 réellement en cours).
 */
export type EtatSondage = "termine" | "en-cours" | "inconnu";

export function etatSondage(sondage: Pick<Sondage, "ended" | "endsAt">): EtatSondage {
	if (sondage.ended) {
		return "termine";
	}
	return sondage.endsAt === null ? "inconnu" : "en-cours";
}

/** « Terminé » / « En cours » / « État non publié », avec sa pastille. */
export function libelleEtat(sondage: Pick<Sondage, "ended" | "endsAt">): string {
	switch (etatSondage(sondage)) {
		case "termine": {
			return "⚫ Terminé";
		}
		case "en-cours": {
			return "🟢 En cours";
		}
		default: {
			return "⚪ État non publié";
		}
	}
}

/**
 * Le sondage a-t-il des chiffres à montrer ?
 *
 * Un sondage dont l'encart n'a rien publié ET dont les réactions n'ont pas pu
 * être exploitées n'en a aucun : il faut alors afficher ses choix SANS barre,
 * jamais une barre à zéro qui se lirait « personne n'a voté ».
 */
export function aDesResultats(sondage: Pick<Sondage, "totalVotes" | "options">): boolean {
	if (sondage.totalVotes === null) {
		return false;
	}
	return sondage.options.some((option) => option.votes !== null);
}

/**
 * Pourcentage à afficher pour un choix.
 *
 * On RECALCULE sur `totalVotes` au lieu de servir `percentage` :
 * 1. le bot arrondit (somme observée de 99,0 à 101,0) ;
 * 2. le pourcentage est absent des décomptes reconstitués par réactions ;
 * 3. `totalVoters` n'est JAMAIS le bon diviseur — sur un sondage multi-choix il
 *    vaut environ la moitié du total des votes (mesuré : 67 participants pour
 *    120 votes), et diviser par lui donnerait des barres au-delà de 100 %.
 */
export function pourcentage(option: OptionSondage, sondage: Pick<Sondage, "totalVotes">): number {
	const total = sondage.totalVotes;
	if (option.votes === null || total === null || total <= 0) {
		return 0;
	}
	return (option.votes / total) * 100;
}

/** Choix triés par voix décroissantes ; ex æquo départagés par `position`. */
export function classement(sondage: Pick<Sondage, "options">): OptionSondage[] {
	return [...sondage.options].sort((a, b) => {
		const ecart = (b.votes ?? -1) - (a.votes ?? -1);
		return ecart === 0 ? a.position - b.position : ecart;
	});
}

/**
 * Choix en tête, uniquement s'il y a un vrai vainqueur : pas de résultats, un
 * seul choix, ou une égalité en tête ⇒ `null` (on ne couronne pas un ex æquo).
 */
export function gagnant(sondage: Pick<Sondage, "totalVotes" | "options">): OptionSondage | null {
	if (!aDesResultats(sondage) || sondage.options.length < 2) {
		return null;
	}
	const [premier, second] = classement(sondage);
	if (!premier || !second || premier.votes === null || premier.votes <= 0) {
		return null;
	}
	return premier.votes === second.votes ? null : premier;
}

/** Caractères de la barre : plein / vide. */
const BARRE_PLEIN = "█";
const BARRE_VIDE = "░";

/**
 * Barre de résultat en caractères, de largeur fixe.
 *
 * Un pourcentage strictement positif rend au moins UN bloc plein : une barre
 * entièrement vide en face de « 1 vote » se lit « zéro », ce qui est faux.
 * Symétriquement, seul 100 % remplit toute la barre.
 */
export function barre(pourcent: number, largeur = 12): string {
	const taille = Math.max(1, Math.trunc(largeur));
	if (!Number.isFinite(pourcent) || pourcent <= 0) {
		return BARRE_VIDE.repeat(taille);
	}
	const borne = Math.min(100, pourcent);
	let pleins = Math.round((borne / 100) * taille);
	if (pleins === 0) {
		pleins = 1;
	}
	if (pleins === taille && borne < 100) {
		pleins = taille - 1;
	}
	return BARRE_PLEIN.repeat(pleins) + BARRE_VIDE.repeat(taille - pleins);
}

/** Pourcentage à une décimale, à la française (« 25,8 % »). */
export function formaterPourcentage(valeur: number): string {
	return formaterPourcentageUi(valeur, { decimales: 1, absent: "0 %" });
}

/**
 * Une ligne de résultat : libellé, barre, pourcentage et voix.
 *
 * Le libellé est échappé (un pseudo contenant `*` ne doit pas passer la suite
 * de l'embed en italique) ; l'emoji, lui, ne l'est pas : `<:nom:id>` est une
 * syntaxe Discord qu'on veut voir rendue.
 */
export function ligneResultat(
	option: OptionSondage,
	sondage: Pick<Sondage, "totalVotes" | "options">,
	largeur = 12
): string {
	const titre = option.emoji
		? `${option.emoji} ${echapperMarkdown(couper(option.label, 60))}`
		: echapperMarkdown(couper(option.label, 60));
	if (option.votes === null || !aDesResultats(sondage)) {
		return `${titre}\n\`${BARRE_VIDE.repeat(Math.max(1, Math.trunc(largeur)))}\` *décompte non publié*`;
	}
	const part = pourcentage(option, sondage);
	const voix = `${formaterNombre(option.votes)} ${pluriel(option.votes, "voix", "voix")}`;
	return `${titre}\n\`${barre(part, largeur)}\` **${formaterPourcentage(part)}** · ${voix}`;
}

/** Le décompte affiché est-il une estimation plutôt qu'un résultat officiel ? */
export function estEstimation(sondage: Pick<Sondage, "source">): boolean {
	return sondage.source === "reactions";
}

/**
 * Mention de fiabilité à afficher SOUS les résultats, ou `null` quand les
 * chiffres sont exactement ceux publiés par le bot.
 *
 * C'est l'exigence centrale de `/sondage voir` : un décompte reconstitué depuis
 * les réactions archivées ne doit jamais passer pour un résultat officiel.
 */
export function mentionSource(sondage: Pick<Sondage, "source" | "resultsHidden">): string | null {
	if (estEstimation(sondage)) {
		return (
			"⚠️ **Estimation, pas un résultat officiel.** Ce sondage n'a jamais publié ses " +
			"chiffres : le décompte ci-dessus est reconstitué à partir des réactions archivées " +
			"du salon, à un vote près."
		);
	}
	if (sondage.resultsHidden) {
		return "🔒 Résultats masqués : le bot ne les publie pas tant que le sondage tourne.";
	}
	return null;
}

/** Marqueur court pour une ligne de liste : « ≈ » signale une estimation. */
export function marqueurSource(sondage: Pick<Sondage, "source">): string {
	return estEstimation(sondage) ? "≈" : "";
}

/**
 * Participation : « 120 votes de 67 participants », ou seulement le total quand
 * le nombre de participants est inconnu (cas des décomptes reconstitués — on ne
 * l'invente pas).
 */
export function libelleParticipation(
	sondage: Pick<Sondage, "totalVotes" | "totalVoters">
): string | null {
	const votes = sondage.totalVotes;
	if (votes === null) {
		return null;
	}
	const partie = `${formaterNombre(votes)} ${pluriel(votes, "vote", "votes")}`;
	const votants = sondage.totalVoters;
	if (votants === null) {
		return partie;
	}
	return `${partie} de ${formaterNombre(votants)} ${pluriel(votants, "participant", "participants")}`;
}

/** Nombre de choix autorisés par personne (0 = illimité). */
export function libelleChoixAutorises(sondage: Pick<Sondage, "maxChoices">): string {
	if (sondage.maxChoices <= 0) {
		return "Choix illimités";
	}
	return sondage.maxChoices === 1
		? "1 choix par personne"
		: `${sondage.maxChoices} choix par personne`;
}

/**
 * Identifiant de sondage acceptable : identifiant court EasyPoll (hexadécimal)
 * ou identifiant Discord pour un sondage natif. Tout le reste est refusé sans
 * même toucher la base.
 */
export function estIdentifiantSondage(valeur: string): boolean {
	return /^[0-9a-f]{6,32}$/.test(valeur) || /^\d{15,25}$/.test(valeur);
}

/** Lien du message d'origine, quand il est connu. */
export function lienMessageSondage(sondage: Sondage): string | null {
	if (!sondage.messageId) {
		return null;
	}
	return `https://discord.com/channels/${sondage.guildId}/${sondage.channelId}/${sondage.messageId}`;
}

/** Une ligne de la liste des sondages. */
export function ligneListeSondage(sondage: Sondage, origineSite: string): string {
	const marqueur = marqueurSource(sondage);
	// Le libellé d'un lien masqué ne rend pas les émojis personnalisés : on les
	// ramène à leur nom (`:IE_hey1:`) plutôt que de laisser passer un jeton brut
	// avec son identifiant. L'échappement qui suit est consommé par le rendu,
	// donc le souligné reste visible tel quel.
	const question = echapperMarkdown(texteTitre(couper(sondage.question, 110)));
	const lien = `${origineSite.replace(/\/+$/, "")}/sondages/${sondage.pollId}`;
	const meneur = gagnant(sondage);
	const details = [
		libelleEtat(sondage),
		libelleParticipation(sondage) ?? "décompte non publié",
		meneur
			? `en tête : ${echapperMarkdown(couper(meneur.label, 40))} (${formaterPourcentage(pourcentage(meneur, sondage))})`
			: null,
	]
		.filter((valeur): valeur is string => valeur !== null)
		.join(" · ");
	return `**[${question}](${lien})**${marqueur ? ` ${marqueur}` : ""}\n${details} · ${horodatageDate(sondage.createdAt)}`;
}

// ─── Filtres de la liste des sondages ───────────────────────────────────────

/**
 * Statut demandé. `en-cours` exige une date de fin, pas seulement
 * `ended = false` : sans cela les 25 sondages sans état publié seraient
 * annoncés « en cours » deux ans après leur clôture (cf. `etatSondage`).
 */
export type StatutSondage = "tous" | "en-cours" | "termines" | "etat-inconnu";

const STATUTS: readonly StatutSondage[] = ["tous", "en-cours", "termines", "etat-inconnu"];

export function normaliserStatut(valeur: unknown): StatutSondage {
	return typeof valeur === "string" && (STATUTS as readonly string[]).includes(valeur)
		? (valeur as StatutSondage)
		: "tous";
}

export function libelleStatut(statut: StatutSondage): string {
	switch (statut) {
		case "en-cours": {
			return "en cours";
		}
		case "termines": {
			return "terminés";
		}
		case "etat-inconnu": {
			return "état non publié";
		}
		default: {
			return "tous";
		}
	}
}

/** Fenêtre temporelle demandée, résolue en bornes absolues. */
export interface Periode {
	/** Clé canonique, telle qu'elle voyage dans le `customId` d'un bouton. */
	cle: string;
	libelle: string;
	/** Borne basse incluse, ou `null` (pas de borne). */
	depuis: Date | null;
	/** Borne haute EXCLUE, ou `null`. */
	jusqua: Date | null;
}

/** Fenêtres relatives proposées, en plus des années réelles du corpus. */
export const PERIODES_RELATIVES = [
	{ cle: "30-jours", jours: 30, libelle: "30 derniers jours" },
	{ cle: "6-mois", jours: 183, libelle: "6 derniers mois" },
	{ cle: "12-mois", jours: 365, libelle: "12 derniers mois" },
] as const;

const MS_PAR_JOUR = 86_400_000;

/**
 * Résout une période. Une valeur inconnue retombe sur « toutes » plutôt que de
 * rendre une liste vide : une saisie libre dans un champ à autocomplétion ne
 * doit pas donner l'impression qu'il n'y a rien à voir.
 *
 * Les années sont bornées en UTC : la base stocke des `timestamptz`, et un
 * décalage d'un fuseau ferait basculer un sondage du 31 décembre d'une année à
 * l'autre selon la machine qui exécute le bot.
 */
export function normaliserPeriode(valeur: unknown, maintenant = new Date()): Periode {
	const brut = typeof valeur === "string" ? valeur.trim() : "";
	const relative = PERIODES_RELATIVES.find((entree) => entree.cle === brut);
	if (relative) {
		return {
			cle: relative.cle,
			depuis: new Date(maintenant.getTime() - relative.jours * MS_PAR_JOUR),
			jusqua: null,
			libelle: relative.libelle,
		};
	}
	if (/^\d{4}$/.test(brut)) {
		const an = Number(brut);
		if (an >= 2000 && an <= 2999) {
			return {
				cle: brut,
				depuis: new Date(Date.UTC(an, 0, 1)),
				jusqua: new Date(Date.UTC(an + 1, 0, 1)),
				libelle: `année ${an}`,
			};
		}
	}
	return { cle: "tout", depuis: null, jusqua: null, libelle: "toutes périodes" };
}

// ─── Campagnes ──────────────────────────────────────────────────────────────

/** Ligne brute de `x_campagnes`, réduite aux colonnes lues par le bot. */
export interface LigneCampagne {
	slug: string;
	titre: string;
	sur_titre: string | null;
	description: string | null;
	image_couverture: string | null;
	image_affiche: string | null;
	/** Hashtags PUBLICS, en minuscules et sans croisillon. */
	hashtags: string[] | null;
	/** Casse d'affichage, alignée index par index sur `hashtags`. */
	hashtags_affichage: string[] | null;
	salons_depot: string[] | null;
	debut_le: Date | string | null;
	fin_le: Date | string | null;
	actif: boolean | null;
	principale: boolean | null;
	collecte_le: Date | string | null;
}

/** Campagne normalisée, prête à rendre. */
export interface Campagne {
	slug: string;
	titre: string;
	surTitre: string | null;
	description: string | null;
	imageCouverture: string | null;
	imageAffiche: string | null;
	hashtags: string[];
	hashtagsAffichage: string[];
	salonsDepot: string[];
	debutLe: Date | null;
	finLe: Date | null;
	actif: boolean;
	principale: boolean;
	collecteLe: Date | null;
}

function chaines(valeur: unknown): string[] {
	if (!Array.isArray(valeur)) {
		return [];
	}
	return valeur.filter(
		(entree): entree is string => typeof entree === "string" && entree.length > 0
	);
}

/**
 * Ligne base → campagne rendable.
 *
 * ⚠ `x_campagnes.hashtags_rattrapage` n'est volontairement PAS reprise ici : elle
 * porte les variantes récoltées en silence (la coquille d'une affiche, par
 * exemple). La récolte les lit, un écran jamais — les afficher propagerait
 * l'erreur au lieu de la contenir. Ne pas la sélectionner est ce qui garantit
 * que l'embed n'a aucun moyen de la montrer.
 */
export function normaliserCampagne(ligne: LigneCampagne): Campagne {
	return {
		actif: ligne.actif === true,
		collecteLe: versDate(ligne.collecte_le),
		debutLe: versDate(ligne.debut_le),
		description: ligne.description,
		finLe: versDate(ligne.fin_le),
		hashtags: chaines(ligne.hashtags),
		hashtagsAffichage: chaines(ligne.hashtags_affichage),
		imageAffiche: urlImageRepubliable(ligne.image_affiche),
		imageCouverture: urlImageRepubliable(ligne.image_couverture),
		principale: ligne.principale === true,
		salonsDepot: chaines(ligne.salons_depot),
		slug: ligne.slug,
		surTitre: ligne.sur_titre,
		titre: ligne.titre,
	};
}

export type EtatCampagne = "a-venir" | "en-cours" | "terminee" | "indetermine";

/**
 * État d'une campagne d'après ses dates, pas d'après `actif` : `actif` dit si la
 * RÉCOLTE tourne encore, ce qui reste vrai quelques jours après la clôture le
 * temps de rattraper les derniers posts.
 */
export function etatCampagne(
	campagne: Pick<Campagne, "debutLe" | "finLe">,
	maintenant = new Date()
): EtatCampagne {
	const instant = maintenant.getTime();
	const debut = campagne.debutLe?.getTime() ?? null;
	const fin = campagne.finLe?.getTime() ?? null;
	if (fin !== null && instant > fin) {
		return "terminee";
	}
	if (debut !== null && instant < debut) {
		return "a-venir";
	}
	if (debut === null && fin === null) {
		return "indetermine";
	}
	return "en-cours";
}

export function libelleEtatCampagne(
	campagne: Pick<Campagne, "debutLe" | "finLe">,
	maintenant = new Date()
): string {
	switch (etatCampagne(campagne, maintenant)) {
		case "a-venir": {
			return "🔵 À venir";
		}
		case "en-cours": {
			return "🟢 En cours";
		}
		case "terminee": {
			return "⚫ Terminée";
		}
		default: {
			return "⚪ Période non publiée";
		}
	}
}

/** Période lisible en horodatages Discord, ou `null` si aucune date connue. */
export function periodeCampagne(campagne: Pick<Campagne, "debutLe" | "finLe">): string | null {
	if (campagne.debutLe && campagne.finLe) {
		return `du ${horodatageDate(campagne.debutLe)} au ${horodatageDate(campagne.finLe)}`;
	}
	if (campagne.finLe) {
		return `jusqu'au ${horodatageDate(campagne.finLe)}`;
	}
	if (campagne.debutLe) {
		return `depuis le ${horodatageDate(campagne.debutLe)}`;
	}
	return null;
}

/**
 * Hashtags tels qu'ils doivent s'AFFICHER (« #IERGDay »), la casse venant de
 * `hashtags_affichage` quand elle existe. Une liste d'affichage plus courte que
 * la liste normalisée retombe sur la forme minuscule, ce qui reste exact.
 */
export function hashtagsAffichables(
	campagne: Pick<Campagne, "hashtags" | "hashtagsAffichage">
): string[] {
	return campagne.hashtags.map((tag, index) => `#${campagne.hashtagsAffichage[index] ?? tag}`);
}

/** Chemin public d'une campagne sur le site. */
export function cheminCampagne(campagne: Pick<Campagne, "principale" | "slug">): string {
	return campagne.principale
		? "/iergday"
		: `/iergday?campagne=${encodeURIComponent(campagne.slug)}`;
}

/** Slug acceptable : ce que la base contient, rien d'autre. */
export function estSlugCampagne(valeur: string): boolean {
	return /^[a-z0-9][a-z0-9-]{0,63}$/.test(valeur);
}

/** Métriques agrégées d'une campagne, toutes issues de sommes SQL. */
export interface StatsCampagne {
	/** Publications X retenues (non masquées, avec image). */
	posts: number;
	/** Comptes X distincts ayant participé. */
	auteurs: number;
	jaime: number;
	repartages: number;
	vues: number;
	/** Créations déposées sur Discord et recopiées dans le seau public. */
	creations: number;
	derniere: Date | null;
}

/** Ligne « métriques » d'un embed de campagne. */
export function ligneMetriques(
	stats: Pick<StatsCampagne, "jaime" | "repartages" | "vues">
): string {
	return `❤️ ${formaterNombre(stats.jaime)} · 🔁 ${formaterNombre(stats.repartages)} · 👁️ ${formaterNombre(stats.vues)}`;
}

/** Ligne « participations » d'un embed de campagne. */
export function ligneParticipations(stats: StatsCampagne): string {
	const morceaux = [
		`${formaterNombre(stats.posts)} ${pluriel(stats.posts, "publication X", "publications X")}`,
		`${formaterNombre(stats.auteurs)} ${pluriel(stats.auteurs, "compte", "comptes")}`,
	];
	morceaux.push(
		stats.creations > 0
			? `${formaterNombre(stats.creations)} ${pluriel(stats.creations, "création Discord", "créations Discord")}`
			: "aucune création Discord republiable"
	);
	return morceaux.join(" · ");
}

/**
 * Explication à afficher quand une campagne n'a RIEN à montrer, ou `null`.
 *
 * Une campagne sans publication n'est pas forcément un échec : cinq des sept
 * campagnes publiées ont vu leurs créations déposées sur Discord et non sur X
 * (mesuré le 13/8/2026 : aucune ligne de `tweets` ne porte `#inazumarg`,
 * `#inatoberrg*` ni `#iergday`). Afficher « 0 publication » sans le dire
 * laisserait croire que personne n'a participé.
 */
export function noteCampagneVide(
	campagne: Pick<Campagne, "salonsDepot" | "collecteLe">,
	stats: Pick<StatsCampagne, "posts" | "creations">
): string | null {
	if (stats.posts > 0 || stats.creations > 0) {
		return null;
	}
	const morceaux = [
		"Rien n'a encore été récolté pour cette campagne sur X, et aucune création Discord n'a été recopiée dans notre stockage.",
	];
	if (campagne.salonsDepot.length > 0) {
		morceaux.push(
			`Les créations ont été déposées dans ${campagne.salonsDepot.map((salon) => `<#${salon}>`).join(", ")}.`
		);
	}
	if (campagne.collecteLe) {
		morceaux.push(`Dernière passe de récolte ${horodatageRelatif(campagne.collecteLe)}.`);
	}
	return morceaux.join(" ");
}

/** Une ligne de la liste des campagnes. */
export function ligneListeCampagne(
	campagne: Campagne,
	stats: StatsCampagne,
	origineSite: string,
	maintenant = new Date()
): string {
	const lien = `${origineSite.replace(/\/+$/, "")}${cheminCampagne(campagne)}`;
	const titre = echapperMarkdown(couper(campagne.titre, 80));
	const tags = hashtagsAffichables(campagne).slice(0, 3).join(" ");
	const details = [
		libelleEtatCampagne(campagne, maintenant),
		`${formaterNombre(stats.posts)} ${pluriel(stats.posts, "publication", "publications")}`,
		tags.length > 0 ? echapperMarkdown(tags) : null,
	]
		.filter((valeur): valeur is string => valeur !== null)
		.join(" · ");
	return `**[${titre}](${lien})**\n${details}`;
}

/** Une publication de campagne, réduite à ce qu'un embed montre. */
export interface PostCampagne {
	tweetId: string;
	auteur: string | null;
	texte: string | null;
	publieLe: Date | null;
	/** Hashtag public qui a mordu, déjà ramené à `null` s'il n'est pas affichable. */
	hashtag: string | null;
	image: string | null;
}

/**
 * Première image republiable d'un média X.
 *
 * Le fichier recopié dans notre stockage est préféré : il ne dépend pas de la
 * disponibilité de `pbs.twimg.com`. Une URL de pièce jointe Discord est refusée
 * (signée, périmée en moins de 24 h).
 */
export function imagePost(media: unknown): string | null {
	if (!Array.isArray(media)) {
		return null;
	}
	for (const brut of media) {
		if (!brut || typeof brut !== "object") {
			continue;
		}
		const item = brut as Record<string, unknown>;
		if (item.type !== "photo") {
			continue;
		}
		const candidats = [item.storage_url, item.url, item.preview_url, item.original_url]
			.map((valeur) => urlImageRepubliable(valeur))
			.filter((valeur): valeur is string => valeur !== null);
		const preferee = candidats.find((url) => url.includes("/storage/v1/object/")) ?? candidats[0];
		if (preferee) {
			return preferee;
		}
	}
	return null;
}

/** Lien canonique d'un post X. */
export function lienPost(post: Pick<PostCampagne, "tweetId" | "auteur">): string {
	return `https://x.com/${post.auteur ?? "i"}/status/${post.tweetId}`;
}

/** Une ligne de la sélection de publications d'une campagne. */
export function lignePost(post: PostCampagne): string {
	const auteur = post.auteur ? `@${echapperMarkdown(post.auteur)}` : "*compte inconnu*";
	const extrait = post.texte ? echapperMarkdown(couper(post.texte, 120)) : "*sans texte*";
	return `[${auteur}](${lienPost(post)}) · ${horodatageDate(post.publieLe)}\n${extrait}`;
}

// ─── Pagination par boutons ─────────────────────────────────────────────────

/** Limite Discord sur un `customId`. */
export const MAX_CUSTOM_ID = MAX_CUSTOM_ID_UI;

export const PREFIXE_BOUTON_SONDAGES = "sdg";
export const PREFIXE_BOUTON_CAMPAGNES = "cmp";

export function nombreDePages(total: number, parPage: number): number {
	return nombreDePagesUi(Math.trunc(total), Math.max(1, Math.trunc(parPage)));
}

/** Ramène une page dans les bornes réelles du jeu de résultats. */
export function bornerPage(page: number, total: number, parPage: number): number {
	return bornerPageUi(page, Math.trunc(total), Math.max(1, Math.trunc(parPage)));
}

export interface EtatListeSondages {
	page: number;
	statut: StatutSondage;
	/** Clé de période (`tout`, `12-mois`, `2024`…). */
	periode: string;
	recherche: string | null;
}

/**
 * Encode l'état d'une liste dans un `customId`.
 *
 * Tout l'état tient dans l'identifiant : aucune mémoire de processus, donc un
 * redémarrage du bot ne laisse jamais de boutons morts. `null` quand la limite
 * de 100 caractères est dépassée — l'appelant n'affiche alors pas les boutons
 * plutôt que d'envoyer un composant que Discord rejetterait.
 */
export function encoderEtatSondages(etat: EtatListeSondages): string | null {
	return encoderEtat(PREFIXE_BOUTON_SONDAGES, [
		Math.max(1, Math.trunc(etat.page)),
		normaliserStatut(etat.statut),
		sansSeparateur(etat.periode) || "tout",
		etat.recherche,
	]);
}

export function decoderEtatSondages(customId: string): EtatListeSondages | null {
	const champs = decoderEtat(PREFIXE_BOUTON_SONDAGES, customId, 4);
	const page = pageDecodee(champs?.[0]);
	if (!champs || page === null) {
		return null;
	}
	return {
		page,
		periode: champs[2] || "tout",
		recherche: champs[3] || null,
		statut: normaliserStatut(champs[1]),
	};
}

export interface EtatListeCampagnes {
	page: number;
	/** `true` = ne montrer que les campagnes ouvertes ou à venir. */
	enCours: boolean;
}

export function encoderEtatCampagnes(etat: EtatListeCampagnes): string | null {
	return encoderEtat(PREFIXE_BOUTON_CAMPAGNES, [
		Math.max(1, Math.trunc(etat.page)),
		etat.enCours ? "1" : "0",
	]);
}

export function decoderEtatCampagnes(customId: string): EtatListeCampagnes | null {
	const champs = decoderEtat(PREFIXE_BOUTON_CAMPAGNES, customId, 2);
	const page = pageDecodee(champs?.[0]);
	if (!champs || page === null) {
		return null;
	}
	return { enCours: champs[1] === "1", page };
}
