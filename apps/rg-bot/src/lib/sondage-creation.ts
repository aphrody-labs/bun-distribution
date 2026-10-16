/**
 * Création d'un sondage PAR le bot — noyau pur.
 *
 * Ce module ne connaît ni Discord ni Postgres : il transforme une saisie de
 * slash-commande (« question », « choix », « durée ») en un projet de sondage
 * valide, ou en une liste de refus écrits en français. Tout se teste sans rien
 * démarrer. La pose du sondage et son rendu vivent dans `commands/sondage.ts`.
 *
 * ─── POURQUOI LE SONDAGE *NATIF* DE DISCORD, ET PAS UN SONDAGE MAISON ───────
 * Un sondage maison (des boutons et notre base) suppose d'écrire QUI a voté
 * QUOI : sans ce rattachement, rien n'empêche un membre de voter douze fois.
 * Or ce rattachement est précisément ce que cette unité s'interdit de détenir
 * (cf. la ligne rouge de `sondage-format.ts`). Le sondage natif règle les deux
 * problèmes d'un coup : Discord tient le registre des votes, ne nous le donne
 * jamais, et ne nous expose que des DÉCOMPTES agrégés. Le bot ne devient donc
 * jamais dépositaire d'une opinion nominative — ce n'est pas une commodité
 * d'implémentation, c'est la raison du choix.
 *
 * Trois conséquences heureuses :
 *   1. aucune mémoire de processus, donc aucun bouton mort après redémarrage ;
 *   2. l'interface de vote est celle du client, déjà traduite et déjà
 *      accessible sur mobile ;
 *   3. l'archive est GRATUITE : la tâche `packages/cron/src/tasks/discord-polls.ts`
 *      sait déjà lire un sondage natif (`parseSondageNatif`) et le range dans
 *      `discord_polls` avec `provider = 'discord'`. Un sondage posé par cette
 *      commande apparaît donc sur rosegriffon.fr/sondages sans une ligne de plus.
 *
 * ─── CE QU'ON PERD, ET CE QU'ON REND EN ÉCHANGE ─────────────────────────────
 * Le sondage natif plafonne à dix choix de 55 caractères et ne connaît que deux
 * régimes de vote : un seul choix, ou autant qu'on veut. Le « 3 choix parmi 8 »
 * d'EasyPoll n'existe pas — on le REFUSE explicitement plutôt que de le
 * contrefaire en silence. En échange, l'affiche et la carte de résultats sont
 * les nôtres (charte Rose Griffon), et le sondage est relié au site.
 */

import { borner } from "./ui/texte";

// ─── Limites dures du sondage natif ─────────────────────────────────────────

/**
 * Limites de l'API (documentation Discord, « Poll » — relevé le 14/8/2026).
 *
 * Les dépasser ne tronque pas : l'API refuse le message ENTIER et le membre ne
 * voit rien. Elles sont donc vérifiées ici, avant tout appel réseau, et chaque
 * refus dit quelle limite a sauté.
 */
export const LIMITES_SONDAGE = Object.freeze({
	/** Un sondage sans deux choix n'est pas un sondage. */
	choixMin: 2,
	/** Plafond de l'API : dix réponses. */
	choixMax: 10,
	/** Durée par défaut de Discord, reprise telle quelle. */
	dureeDefautHeures: 24,
	/** Plancher de l'API : une heure. */
	dureeMinHeures: 1,
	/** Plafond de l'API : 32 jours. */
	dureeMaxHeures: 768,
	/** Libellé d'une réponse. */
	longueurChoix: 55,
	/** Texte de la question. */
	longueurQuestion: 300,
} as const);

/** Séparateurs acceptés entre deux choix. Le `/` en est EXCLU : il sépare deux
 *  noms d'un même personnage dans la moitié des sondages du serveur
 *  (« Goldie Lemmon / Nanobana Kinako »), il ne sépare pas deux choix. */
const SEPARATEURS_CHOIX = /[;\n|]/;

// ─── Durées ─────────────────────────────────────────────────────────────────

/** Durées proposées à l'autocomplétion, de la plus courte à la plus longue. */
export const DUREES_PROPOSEES = [
	{ heures: 1, libelle: "1 heure" },
	{ heures: 6, libelle: "6 heures" },
	{ heures: 12, libelle: "12 heures" },
	{ heures: 24, libelle: "1 jour" },
	{ heures: 48, libelle: "2 jours" },
	{ heures: 72, libelle: "3 jours" },
	{ heures: 168, libelle: "1 semaine" },
	{ heures: 336, libelle: "2 semaines" },
	{ heures: 768, libelle: "32 jours (maximum)" },
] as const;

/** Durée résolue : ce que l'API attend, et ce qu'on montre au membre. */
export interface DureeSondage {
	heures: number;
	libelle: string;
}

/** Libellé français d'une durée en heures, sans jamais écrire « 1 jours ». */
export function libelleDuree(heures: number): string {
	if (heures % 168 === 0 && heures >= 168) {
		const semaines = heures / 168;
		return semaines === 1 ? "1 semaine" : `${semaines} semaines`;
	}
	if (heures % 24 === 0) {
		const jours = heures / 24;
		return jours === 1 ? "1 jour" : `${jours} jours`;
	}
	return heures === 1 ? "1 heure" : `${heures} heures`;
}

/**
 * Résout une durée saisie librement.
 *
 * Formes acceptées : un nombre nu (heures), `12h`, `3j`, `2 jours`, `1 semaine`,
 * `1s`. `null` quand la saisie n'a aucun sens — l'appelant retombe alors sur la
 * durée par défaut plutôt que de refuser la commande pour une coquille.
 */
export function normaliserDuree(valeur: unknown): DureeSondage | null {
	const brut = typeof valeur === "string" ? valeur.trim().toLowerCase() : "";
	if (brut.length === 0) {
		return null;
	}
	const trouve = /^(\d+(?:[.,]\d+)?)\s*(h|heures?|j|jours?|s|semaines?)?$/.exec(brut);
	if (!trouve) {
		return null;
	}
	const nombre = Number(trouve[1]?.replace(",", "."));
	if (!Number.isFinite(nombre) || nombre <= 0) {
		return null;
	}
	const unite = trouve[2] ?? "h";
	const facteur = unite.startsWith("j") ? 24 : unite.startsWith("s") ? 168 : 1;
	const heures = Math.round(nombre * facteur);
	if (heures < LIMITES_SONDAGE.dureeMinHeures || heures > LIMITES_SONDAGE.dureeMaxHeures) {
		return null;
	}
	return { heures, libelle: libelleDuree(heures) };
}

// ─── Emoji de tête ──────────────────────────────────────────────────────────

/** Emoji personnalisé Discord, en tête de chaîne : `<:nom:id>` ou `<a:nom:id>`. */
const EMOJI_PERSONNALISE = /^<(a?):([A-Za-z0-9_~]+):(\d+)>/;

/**
 * Emoji Unicode en tête de chaîne.
 *
 * `\p{Extended_Pictographic}` et non `\p{Emoji}` : le second matche les
 * CHIFFRES, ce qui ferait passer le « 1 » de « 1. Premier choix » pour un
 * emoji. Les trois formes composées du corpus sont couvertes : drapeau
 * (deux indicateurs régionaux, « 🇮🇹 »), pictogramme suivi d'un sélecteur de
 * variante ou d'un modificateur de teinte (« 🕵️ »), et séquences reliées par
 * un liant sans chasse (« 👨‍👩‍👧 »).
 */
const EMOJI_UNICODE =
	/^(?:\p{RI}\p{RI}|\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier})?)*|[\d#*]\uFE0F?\u20E3)/u;

/** Emoji d'un choix, tel que l'API l'attend (`{ id }` ou `{ name }`). */
export interface EmojiChoix {
	/** Identifiant d'un emoji personnalisé du serveur. */
	id?: string;
	/** Caractère Unicode, ou nom de l'emoji personnalisé. */
	name?: string;
	animated?: boolean;
}

/** Choix découpé : l'emoji de vote d'un côté, le libellé de l'autre. */
export interface ChoixSondage {
	emoji: EmojiChoix | null;
	/** Emoji tel qu'il s'écrit, pour un affichage hors API. */
	emojiTexte: string | null;
	texte: string;
}

/**
 * Sépare l'emoji de tête du libellé.
 *
 * Cette séparation n'est pas cosmétique : un emoji laissé DANS le libellé
 * consomme le budget de 55 caractères et n'apparaît pas comme emoji de vote
 * dans le client. C'est la forme qu'EasyPoll donnait à ses choix
 * (« 🥞 Goldie Lemmon / Nanobana Kinako »), c'est donc celle que les habitués
 * du salon écrivent.
 */
export function separerEmojiDeTete(brut: string): ChoixSondage {
	const texte = brut.trim();
	const personnalise = EMOJI_PERSONNALISE.exec(texte);
	if (personnalise) {
		const reste = texte.slice(personnalise[0].length).trim();
		if (reste.length > 0) {
			return {
				emoji: { animated: personnalise[1] === "a", id: personnalise[3], name: personnalise[2] },
				emojiTexte: personnalise[0],
				texte: reste,
			};
		}
	}
	const unicode = EMOJI_UNICODE.exec(texte);
	if (unicode) {
		const reste = texte.slice(unicode[0].length).trim();
		// Un emoji collé à son libellé (« 🥞Goldie ») compte comme un emoji de
		// tête : la séparation est ce que le membre voulait, l'espace lui a
		// simplement manqué. En revanche un emoji SEUL reste le libellé — sinon
		// le choix n'aurait plus de texte du tout.
		if (reste.length > 0) {
			return { emoji: { name: unicode[0] }, emojiTexte: unicode[0], texte: reste };
		}
	}
	return { emoji: null, emojiTexte: null, texte };
}

// ─── Découpage des choix ────────────────────────────────────────────────────

/**
 * Découpe la saisie « choix » en libellés.
 *
 * Les doublons ne sont PAS écartés : deux choix homonymes sont peut-être une
 * maladresse, mais les distinguer n'appartient pas à ce module — un sondage du
 * serveur porte déjà quatre choix au libellé identique, et les refuser
 * reviendrait à refuser un sondage réel.
 */
export function decouperChoix(brut: unknown): string[] {
	if (typeof brut !== "string") {
		return [];
	}
	return brut
		.split(SEPARATEURS_CHOIX)
		.map((morceau) => morceau.trim())
		.filter((morceau) => morceau.length > 0);
}

// ─── Projet de sondage ──────────────────────────────────────────────────────

/** Ce qu'un membre saisit dans la commande. */
export interface SaisieSondage {
	question: unknown;
	choix: unknown;
	duree?: unknown;
	/** `true` = autant de choix qu'on veut ; `false` = un seul. */
	multiple?: unknown;
}

/** Sondage prêt à poser, toutes limites vérifiées. */
export interface ProjetSondage {
	question: string;
	choix: ChoixSondage[];
	duree: DureeSondage;
	/** Régime de vote natif : un seul choix, ou autant qu'on veut. */
	multiple: boolean;
}

export type ResultatPreparation =
	| { ok: true; projet: ProjetSondage; avertissements: string[] }
	| { ok: false; erreurs: string[] };

/**
 * Valide une saisie et rend un projet de sondage.
 *
 * TOUS les refus sont rendus d'un coup, jamais le premier seul : corriger une
 * commande à sept options en apprenant ses erreurs une par une est le meilleur
 * moyen de renoncer. Les avertissements, eux, ne bloquent pas — ils disent ce
 * que la pose va faire du texte (troncature, emoji promu).
 */
export function preparerSondage(saisie: SaisieSondage): ResultatPreparation {
	const erreurs: string[] = [];
	const avertissements: string[] = [];

	const question = typeof saisie.question === "string" ? saisie.question.trim() : "";
	if (question.length === 0) {
		erreurs.push("La question est vide.");
	} else if (question.length > LIMITES_SONDAGE.longueurQuestion) {
		erreurs.push(
			`La question fait ${question.length} caractères ; Discord en accepte ${LIMITES_SONDAGE.longueurQuestion} au maximum.`
		);
	}

	const bruts = decouperChoix(saisie.choix);
	if (bruts.length < LIMITES_SONDAGE.choixMin) {
		erreurs.push(
			`Il faut au moins ${LIMITES_SONDAGE.choixMin} choix, séparés par un point-virgule (exemple : \`Oui ; Non\`).`
		);
	}
	if (bruts.length > LIMITES_SONDAGE.choixMax) {
		erreurs.push(
			`${bruts.length} choix ont été saisis ; un sondage Discord en accepte ${LIMITES_SONDAGE.choixMax} au maximum.`
		);
	}

	const choix = bruts.slice(0, LIMITES_SONDAGE.choixMax).map((brut) => separerEmojiDeTete(brut));
	for (const [index, entree] of choix.entries()) {
		if (entree.texte.length === 0) {
			erreurs.push(`Le choix nº ${index + 1} est vide.`);
			continue;
		}
		if (entree.texte.length > LIMITES_SONDAGE.longueurChoix) {
			avertissements.push(
				`Le choix nº ${index + 1} dépasse ${LIMITES_SONDAGE.longueurChoix} caractères : il sera abrégé.`
			);
			entree.texte = borner(entree.texte, LIMITES_SONDAGE.longueurChoix);
		}
	}

	// Une durée illisible ne fait pas échouer la commande : on retombe sur le
	// défaut de Discord et on le DIT, plutôt que de renvoyer le membre à sa
	// saisie pour un « 3 jrs ».
	const dureeSaisie = saisie.duree === undefined || saisie.duree === null ? null : saisie.duree;
	let duree = normaliserDuree(dureeSaisie);
	if (dureeSaisie !== null && String(dureeSaisie).trim().length > 0 && !duree) {
		avertissements.push(
			`Durée « ${borner(String(dureeSaisie), 40)} » incomprise : le sondage durera ${libelleDuree(LIMITES_SONDAGE.dureeDefautHeures)}. ` +
				`Formes acceptées : \`12h\`, \`3j\`, \`1 semaine\` (de ${LIMITES_SONDAGE.dureeMinHeures} h à ${LIMITES_SONDAGE.dureeMaxHeures} h).`
		);
	}
	duree ??= {
		heures: LIMITES_SONDAGE.dureeDefautHeures,
		libelle: libelleDuree(LIMITES_SONDAGE.dureeDefautHeures),
	};

	if (erreurs.length > 0) {
		return { erreurs, ok: false };
	}
	return {
		avertissements,
		ok: true,
		projet: { choix, duree, multiple: saisie.multiple === true, question },
	};
}

/** Instant de clôture d'un projet, tel que Discord le calculera. */
export function clotureDe(projet: Pick<ProjetSondage, "duree">, maintenant = new Date()): Date {
	return new Date(maintenant.getTime() + projet.duree.heures * 3_600_000);
}

/** Règle de vote, dite comme sur le site (`libelleChoixAutorises`). */
export function libelleRegleDeVote(projet: Pick<ProjetSondage, "multiple">): string {
	return projet.multiple ? "Choix illimités" : "1 choix par personne";
}

// ─── Désignation d'un sondage déjà publié ───────────────────────────────────

/** Salon et message désignés par une saisie de clôture. */
export interface ReferenceMessage {
	/** `null` quand la saisie ne portait qu'un identifiant : au caller de choisir. */
	salonId: string | null;
	messageId: string;
}

/**
 * Comprend ce qu'un membre du staff colle pour désigner un sondage à clore.
 *
 * ── POURQUOI ACCEPTER LE LIEN ──────────────────────────────────────────────
 * Personne ne connaît par cœur l'identifiant d'un message. Ce qu'on a sous la
 * main, c'est « Copier le lien du message » — la seule action que le client
 * Discord propose sans activer le mode développeur. Refuser cette forme, c'est
 * refuser la seule que l'utilisateur sait produire.
 *
 * Le lien porte le SALON, et c'est ce qui compte : sans lui, il faut deviner
 * dans lequel des 159 salons chercher le message. Trois hôtes sont acceptés
 * (`discord.com`, `discordapp.com`, `canary.discord.com`) parce que les trois
 * apparaissent dans les liens copiés selon le client utilisé.
 *
 * Une saisie qui n'est ni un lien ni un flocon rend `null` : c'est une erreur
 * de saisie, pas un cas à deviner.
 */
export function referenceMessage(brut: unknown): ReferenceMessage | null {
	if (typeof brut !== "string") {
		return null;
	}
	const valeur = brut.trim();
	if (valeur === "") {
		return null;
	}
	const lien = valeur.match(
		/^https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(\d{15,25}|@me)\/(\d{15,25})\/(\d{15,25})/
	);
	if (lien) {
		return { messageId: lien[3] as string, salonId: lien[2] as string };
	}
	// Flocon nu : Discord les rend sur 17 à 20 chiffres aujourd'hui, la borne
	// large (15–25) laisse la place à leur croissance sans rien casser.
	return /^\d{15,25}$/.test(valeur) ? { messageId: valeur, salonId: null } : null;
}
