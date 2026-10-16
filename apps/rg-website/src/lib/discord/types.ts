// Formes normalisées des données Discord republiées.
//
// Les colonnes `jsonb` de `discord_messages` sont recopiées telles quelles
// depuis l'API Discord par la tâche de synchronisation : on ne leur fait
// aucune confiance ici. Chaque normalisateur est défensif (champ manquant,
// type inattendu, URL non http(s)) et renvoie une forme stable au rendu.

import { couleurDiscord, urlPubliableOuNull, urlSureOuNull } from "./url";

// ── Salons ──────────────────────────────────────────────────────────────────

/** Type Discord d'un salon d'annonces (les messages y sont publiables). */
export const TYPE_SALON_ANNONCES = 5;

export interface SalonDiscord {
	channel_id: string;
	name: string;
	type: number;
	topic: string | null;
	icon_emoji: string | null;
}

// ── Pièces jointes, encarts, réactions, sondages ────────────────────────────

export interface PieceJointeDiscord {
	id: string;
	nom: string;
	url: string;
	type_mime: string | null;
	taille: number | null;
	largeur: number | null;
	hauteur: number | null;
	description: string | null;
	/** Vrai si la pièce jointe peut être affichée en image. */
	est_image: boolean;
}

export interface ChampEncart {
	nom: string;
	valeur: string;
	aligne: boolean;
}

export interface MediaEncart {
	url: string;
	largeur: number | null;
	hauteur: number | null;
}

export interface EncartDiscord {
	titre: string | null;
	description: string | null;
	url: string | null;
	couleur: string | null;
	horodatage: string | null;
	auteur: { nom: string; url: string | null; icone: string | null } | null;
	pied: { texte: string; icone: string | null } | null;
	image: MediaEncart | null;
	vignette: MediaEncart | null;
	champs: ChampEncart[];
}

export interface EmojiDiscord {
	id: string | null;
	nom: string;
	anime: boolean;
}

export interface ReactionDiscord {
	emoji: EmojiDiscord;
	compte: number;
}

export interface ReponseSondage {
	id: number;
	texte: string;
	emoji: EmojiDiscord | null;
	votes: number;
}

export interface SondageDiscord {
	question: string;
	reponses: ReponseSondage[];
	fin: string | null;
	choix_multiple: boolean;
	total_votes: number;
}

export interface AutocollantDiscord {
	id: string;
	nom: string;
	url: string;
}

export interface MessageDiscord {
	message_id: string;
	channel_id: string;
	author_id: string;
	author_username: string;
	author_display_name: string | null;
	author_avatar_url: string | null;
	author_is_bot: boolean;
	type: number;
	content: string;
	attachments: PieceJointeDiscord[];
	embeds: EncartDiscord[];
	stickers: AutocollantDiscord[];
	reactions: ReactionDiscord[];
	poll: SondageDiscord | null;
	reference_message_id: string | null;
	pinned: boolean;
	created_at: string;
	edited_at: string | null;
}

// ── Aides de lecture défensive ──────────────────────────────────────────────

function objet(valeur: unknown): Record<string, unknown> | null {
	return typeof valeur === "object" && valeur !== null && !Array.isArray(valeur)
		? (valeur as Record<string, unknown>)
		: null;
}

function tableau(valeur: unknown): unknown[] {
	if (Array.isArray(valeur)) return valeur;
	// Postgres peut renvoyer du jsonb déjà sérialisé selon le pilote.
	if (typeof valeur === "string") {
		try {
			const analyse: unknown = JSON.parse(valeur);
			return Array.isArray(analyse) ? analyse : [];
		} catch {
			return [];
		}
	}
	return [];
}

function chaine(valeur: unknown, max = 4096): string | null {
	if (typeof valeur !== "string") return null;
	const propre = valeur.trim();
	return propre.length === 0 ? null : propre.slice(0, max);
}

function entier(valeur: unknown): number | null {
	if (typeof valeur === "number" && Number.isFinite(valeur)) return Math.trunc(valeur);
	if (typeof valeur === "string" && /^-?\d+$/.test(valeur)) return Number.parseInt(valeur, 10);
	return null;
}

function identifiant(valeur: unknown): string | null {
	if (typeof valeur === "number") return String(Math.trunc(valeur));
	if (typeof valeur === "string" && /^\d{1,25}$/.test(valeur)) return valeur;
	return null;
}

/** Convertit une date Postgres (`Date` ou texte) en ISO transmissible au client. */
export function dateIso(valeur: unknown): string | null {
	if (valeur instanceof Date) return Number.isNaN(valeur.getTime()) ? null : valeur.toISOString();
	if (typeof valeur === "string" && valeur.length > 0) {
		const date = new Date(valeur);
		return Number.isNaN(date.getTime()) ? null : date.toISOString();
	}
	return null;
}

// ── Normalisateurs ──────────────────────────────────────────────────────────

const EXTENSIONS_IMAGE = /\.(png|jpe?g|gif|webp|avif|bmp)(\?|$)/i;

/*
 * ⚠ UNE PIÈCE JOINTE SANS URL DURABLE N'EST PAS PUBLIÉE.
 * `discord_messages.attachments` recopie les URL de l'API Discord telles
 * quelles, or elles sont SIGNÉES et expirent en moins de 24 h (168 des 566
 * messages archivés en portent une, mesuré le 12/8/2026). La route publique
 * `/api/discord/messages` les servait à un tiers qui les aurait trouvées mortes
 * le lendemain. On les écarte donc ici, au normaliseur, et pas dans la route :
 * un futur écran qui lirait ces messages hériterait sinon de la même fuite.
 * Le remède définitif est la recopie dans le bucket `assets`, comme pour les
 * visuels de sondage ; d'ici là, mieux vaut ne rien servir qu'un lien mort.
 */
function normaliserPieceJointe(brut: unknown): PieceJointeDiscord | null {
	const source = objet(brut);
	if (!source) return null;
	const url = urlPubliableOuNull(source.url) ?? urlPubliableOuNull(source.proxy_url);
	if (!url) return null;
	const nom = chaine(source.filename, 256) ?? "fichier";
	const typeMime = chaine(source.content_type, 128);
	return {
		description: chaine(source.description, 1024),
		est_image: typeMime?.startsWith("image/") === true || EXTENSIONS_IMAGE.test(nom),
		hauteur: entier(source.height),
		id: identifiant(source.id) ?? url,
		largeur: entier(source.width),
		nom,
		taille: entier(source.size),
		type_mime: typeMime,
		url,
	};
}

/** Même règle que pour les pièces jointes : une image d'encart signée est écartée. */
function normaliserMedia(brut: unknown): MediaEncart | null {
	const source = objet(brut);
	if (!source) return null;
	const url = urlPubliableOuNull(source.url) ?? urlPubliableOuNull(source.proxy_url);
	if (!url) return null;
	return { hauteur: entier(source.height), largeur: entier(source.width), url };
}

function normaliserEncart(brut: unknown): EncartDiscord | null {
	const source = objet(brut);
	if (!source) return null;

	const auteurSource = objet(source.author);
	const piedSource = objet(source.footer);
	const nomAuteur = auteurSource ? chaine(auteurSource.name, 256) : null;
	const textePied = piedSource ? chaine(piedSource.text, 2048) : null;

	const champs = tableau(source.fields)
		.map((champ) => {
			const c = objet(champ);
			if (!c) return null;
			const nom = chaine(c.name, 256);
			const valeur = chaine(c.value, 1024);
			if (!nom && !valeur) return null;
			return { aligne: c.inline === true, nom: nom ?? "", valeur: valeur ?? "" };
		})
		.filter((champ): champ is ChampEncart => champ !== null)
		.slice(0, 25);

	const encart: EncartDiscord = {
		auteur: nomAuteur
			? {
					icone: urlSureOuNull(auteurSource?.icon_url) ?? urlSureOuNull(auteurSource?.proxy_icon_url),
					nom: nomAuteur,
					url: urlSureOuNull(auteurSource?.url),
				}
			: null,
		champs,
		couleur: couleurDiscord(entier(source.color)),
		description: chaine(source.description, 4096),
		horodatage: dateIso(source.timestamp),
		image: normaliserMedia(source.image),
		pied: textePied
			? {
					icone: urlSureOuNull(piedSource?.icon_url) ?? urlSureOuNull(piedSource?.proxy_icon_url),
					texte: textePied,
				}
			: null,
		titre: chaine(source.title, 256),
		url: urlSureOuNull(source.url),
		vignette: normaliserMedia(source.thumbnail),
	};

	// Un encart totalement vide n'apporte rien au lecteur.
	const vide =
		!encart.titre &&
		!encart.description &&
		!encart.image &&
		!encart.vignette &&
		!encart.auteur &&
		!encart.pied &&
		encart.champs.length === 0;
	return vide ? null : encart;
}

function normaliserEmoji(brut: unknown): EmojiDiscord | null {
	const source = objet(brut);
	if (!source) return null;
	const nom = chaine(source.name, 64);
	const id = identifiant(source.id);
	if (!nom && !id) return null;
	return { anime: source.animated === true, id, nom: nom ?? "emoji" };
}

function normaliserReaction(brut: unknown): ReactionDiscord | null {
	const source = objet(brut);
	if (!source) return null;
	const emoji = normaliserEmoji(source.emoji);
	if (!emoji) return null;
	return { compte: Math.max(entier(source.count) ?? 0, 0), emoji };
}

function normaliserSondage(brut: unknown): SondageDiscord | null {
	const source = objet(brut);
	if (!source) return null;

	const question = objet(source.question);
	const texteQuestion = question ? chaine(question.text, 512) : null;

	// Les décomptes vivent dans `results.answer_counts`, indexés par `answer_id`.
	const resultats = objet(source.results);
	const comptes = new Map<number, number>();
	for (const compte of tableau(resultats?.answer_counts)) {
		const c = objet(compte);
		const id = entier(c?.id);
		if (id === null) continue;
		comptes.set(id, Math.max(entier(c?.count) ?? 0, 0));
	}

	const reponses = tableau(source.answers)
		.map((reponse, index): ReponseSondage | null => {
			const r = objet(reponse);
			if (!r) return null;
			const media = objet(r.poll_media);
			const texte = media ? chaine(media.text, 256) : null;
			const id = entier(r.answer_id) ?? index + 1;
			if (!texte) return null;
			return {
				emoji: media ? normaliserEmoji(media.emoji) : null,
				id,
				texte,
				votes: comptes.get(id) ?? 0,
			};
		})
		.filter((reponse): reponse is ReponseSondage => reponse !== null)
		.slice(0, 10);

	if (!texteQuestion || reponses.length === 0) return null;

	return {
		choix_multiple: source.allow_multiselect === true,
		fin: dateIso(source.expiry),
		question: texteQuestion,
		reponses,
		total_votes: reponses.reduce((total, reponse) => total + reponse.votes, 0),
	};
}

function normaliserAutocollant(brut: unknown): AutocollantDiscord | null {
	const source = objet(brut);
	if (!source) return null;
	const id = identifiant(source.id);
	if (!id) return null;
	// Format 3 = Lottie (non rendu ici), 4 = GIF ; les autres sont des PNG.
	const format = entier(source.format_type) ?? 1;
	if (format === 3) return null;
	return {
		id,
		nom: chaine(source.name, 128) ?? "autocollant",
		url: `https://media.discordapp.net/stickers/${id}.${format === 4 ? "gif" : "png"}`,
	};
}

/** Ligne brute telle que renvoyée par Postgres. */
export type LigneMessage = Record<string, unknown>;

/** Normalise une ligne `discord_messages` en message prêt à rendre. */
export function normaliserMessage(ligne: LigneMessage): MessageDiscord | null {
	const messageId = identifiant(ligne.message_id);
	const channelId = identifiant(ligne.channel_id);
	if (!messageId || !channelId) return null;

	return {
		attachments: tableau(ligne.attachments)
			.map((piece) => normaliserPieceJointe(piece))
			.filter((piece): piece is PieceJointeDiscord => piece !== null)
			.slice(0, 10),
		author_avatar_url: urlSureOuNull(ligne.author_avatar_url),
		author_display_name: chaine(ligne.author_display_name, 128),
		author_id: identifiant(ligne.author_id) ?? "0",
		author_is_bot: ligne.author_is_bot === true,
		author_username: chaine(ligne.author_username, 128) ?? "inconnu",
		channel_id: channelId,
		content: typeof ligne.content === "string" ? ligne.content.slice(0, 8000) : "",
		created_at: dateIso(ligne.created_at) ?? new Date(0).toISOString(),
		edited_at: dateIso(ligne.edited_at),
		embeds: tableau(ligne.embeds)
			.map((encart) => normaliserEncart(encart))
			.filter((encart): encart is EncartDiscord => encart !== null)
			.slice(0, 10),
		message_id: messageId,
		pinned: ligne.pinned === true,
		poll: normaliserSondage(ligne.poll),
		reactions: tableau(ligne.reactions)
			.map((reaction) => normaliserReaction(reaction))
			.filter((reaction): reaction is ReactionDiscord => reaction !== null)
			.slice(0, 20),
		reference_message_id: identifiant(ligne.reference_message_id),
		stickers: tableau(ligne.stickers)
			.map((autocollant) => normaliserAutocollant(autocollant))
			.filter((autocollant): autocollant is AutocollantDiscord => autocollant !== null)
			.slice(0, 3),
		type: entier(ligne.type) ?? 0,
	};
}

/** Vrai si le message n'a strictement rien à afficher. */
export function messageEstVide(message: MessageDiscord): boolean {
	return (
		message.content.trim().length === 0 &&
		message.embeds.length === 0 &&
		message.attachments.length === 0 &&
		message.stickers.length === 0 &&
		!message.poll
	);
}

/** Pseudo à afficher pour l'auteur d'un message. */
export function nomAuteur(message: MessageDiscord): string {
	return message.author_display_name ?? message.author_username;
}
