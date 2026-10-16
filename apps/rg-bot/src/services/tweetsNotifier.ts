/**
 * Notification Discord des nouveaux tweets — le drain.
 *
 * ── QUI PUBLIE ─────────────────────────────────────────────────────────────
 * Le bot, et lui seul. `rg-cron.service` et `rg-bot.service` ouvrent une
 * passerelle Discord avec LE MÊME jeton : tout ce qui est fait des deux côtés
 * produit un doublon visible par les ~1984 membres. Le risque ne vient pourtant
 * pas de la passerelle mais du CURSEUR — la détection est une lecture de base,
 * pas un événement. Deux démons, deux curseurs, deux annonces. Il n'y a donc
 * qu'un curseur, et il appartient à celui qui publie.
 *
 * Le cron ne poste JAMAIS un tweet, même si le bot est injoignable : il
 * n'avance rien, le bot draine au réveil. Un repli « le cron poste si le bot est
 * down » recréerait le doublon au retour du bot.
 *
 * ── DEUX DÉCLENCHEURS, UNE SEULE VÉRITÉ ────────────────────────────────────
 *  1. `tweets.signal` poussé par le cron sur la socket UNIX — réactivité.
 *  2. un rattrapage toutes les 5 minutes — garantie.
 * Les deux drainent le MÊME curseur, donc les deux sont idempotents. C'est le
 * motif déjà en production pour la veille des messages Discord côté cron
 * (« Filet de sécurité du temps réel… ce rattrapage rejoue tout ce qui a été
 * manqué »).
 *
 * ── QUATRE VERROUS CONTRE LE REJEU ET LE DOUBLON ───────────────────────────
 *  1. curseur persisté en Postgres (`tweet_notification_curseurs`) ;
 *  2. première exécution : la ligne est créée à `now()` et rien n'est annoncé ;
 *  3. fenêtre de rattrapage (48 h, cf. `services/tweets.ts`) + plafond par
 *     exécution : rejouer l'archive est impossible même curseur corrompu ;
 *  4. échange-comparaison sur le curseur (`avancerCurseur`) + `enforceNonce`
 *     côté Discord : deux processus qui draineraient en même temps, ou un
 *     redémarrage tombé entre l'envoi et l'écriture du curseur, ne produisent
 *     pas deux annonces. Le booléen `drainEnCours` ne protège, lui, que d'un
 *     seul processus — il ne suffit pas.
 *
 * ── UN DRAIN PAR PROFIL, ET SEULEMENT UN ───────────────────────────────────
 * Le même programme sert deux serveurs sous deux identités Discord : profil
 * `rg` (Rose Griffon) et profil `azalee`. Chacun annonce les mêmes posts, mais
 * dans SON salon, sur SON serveur — et surtout derrière SON curseur
 * (`AnnoncePosts.curseur`, une ligne par profil dans
 * `tweet_notification_curseurs`, table clefée par `canal`).
 *
 * Les quatre verrous ci-dessus restent entiers PAR PROFIL, et rien n'est
 * partagé entre profils :
 *   - le curseur est une ligne distincte, donc un profil ne consomme jamais les
 *     posts de l'autre et ne peut pas le faire taire ;
 *   - l'amorce à `now()` vaut aussi pour un canal neuf : le premier démarrage
 *     d'Azalée part de son propre présent, sans rejouer l'archive ni ce que
 *     Rose Griffon a déjà publié ;
 *   - l'échange-comparaison porte sur `(canal, curseur_le)` : il départage deux
 *     drains du même profil et ignore l'autre ;
 *   - le `nonce` est comparé par salon : deux profils publient dans deux salons
 *     distincts, la déduplication de l'un ne peut pas supprimer l'annonce de
 *     l'autre.
 *
 * Le salon et le nom du curseur viennent du REGISTRE DE PROFILS
 * (`lib/profil.ts`), jamais d'une constante écrite ici : ce fichier ne connaît
 * aucun identifiant de salon, et le registre reste le seul endroit où l'on
 * regarde pour savoir qui publie où.
 */
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { Client, EmbedBuilder, SendableChannels } from "discord.js";

// Type seulement : l'import est erasé à la compilation, le pont cron n'entre
// donc PAS dans le graphe de ce module (voir l'import paresseux plus bas).
import type { EvenementIpc } from "../lib/cron-ipc";
import { rgEmbed } from "../lib/embeds";
import { encoderValidation, texteCarteValidation } from "../lib/validation-annonce";
import {
	corpsTweet,
	dateTweet,
	decouperEnLots,
	formaterMetriques,
	imagesTweet,
	messageAnnonce,
	messagePing,
	nonceLot,
	resumeLot,
	tweetEstNotifiable,
	urlTweet,
	type FiltreTweets,
	type LigneTweet,
	CLE_PAUSE_TWEETS,
} from "../lib/tweets-format";
import {
	CANAL_NOTIFICATION,
	annonceHistorique,
	assurerCurseur,
	avancerCurseur,
	lireCurseur,
	lireFiltreNotification,
	normaliserCanal,
	salonAnnonce,
	tweetsAPublier,
	type AnnoncePosts,
	curseursEnPause,
} from "./tweets";

/** Rattrapage périodique — la garantie, indépendante de toute poussée. */
export const INTERVALLE_FILET_MS = 5 * 60_000;

/** Fenêtre d'agrégation après un signal : laisse le lot se constituer. */
const DELAI_APRES_SIGNAL_MS = 15_000;

export type EtatDrain =
	| "inactif"
	/** Cartes de validation déposées ; rien n'est publié tant que personne n'a cliqué. */
	| "propose"
	| "amorce"
	| "rien"
	| "publie"
	| "resume"
	| "sans-salon"
	| "concurrent"
	/** Le drain a levé : ce n'est PAS « rien à annoncer », et ça se dit. */
	| "echec";

export interface ResultatDrain {
	etat: EtatDrain;
	candidats: number;
	publies: number;
	detail?: string;
}

let drainEnCours = false;
let minuteurFilet: ReturnType<typeof setInterval> | null = null;
let minuteurSignal: ReturnType<typeof setTimeout> | null = null;
let couperAbonnement: (() => void) | null = null;
/** Dernier message d'exception journalisé — évite d'écrire la même pile toutes les 5 min. */
let derniereErreur: string | null = null;

/**
 * Le profil qui annonce, tel que le registre `lib/profil.ts` le décrit.
 *
 * On prend le PROFIL, pas son salon : `annoncePosts` absent veut dire « ce
 * profil n'annonce rien », et c'est une information que le salon seul ne peut
 * pas porter. Passer `profil.annoncePosts` avec un `?? annonceHistorique()`
 * oublié quelque part enverrait le bot Azalée publier dans le salon de Rose
 * Griffon ; passer le profil rend ce contresens impossible à écrire.
 *
 * Le type n'est qu'un sous-ensemble structurel du profil complet : ce module
 * n'importe pas le registre, et le registre n'importe pas ce module.
 */
export interface ProfilAnnonceur {
	/** Nom du profil (`rg`, `azalee`) — sert au journal, rien d'autre. */
	readonly nom?: string;
	/** Salon + curseur d'annonce. Absent ou `null` = ce profil n'annonce pas. */
	readonly annoncePosts?: AnnoncePosts | null;
}

/** États dont la cause DURE : les rejournaliser à chaque tour noierait le journal. */
const ETATS_PERSISTANTS: ReadonlySet<EtatDrain> = new Set<EtatDrain>([
	"sans-salon",
	"echec",
	"concurrent",
]);

export interface TraceJournal {
	/** Ligne à écrire, ou `null` pour rester muet ce tour-ci. */
	ligne: string | null;
	/** Empreinte à mémoriser pour le tour suivant (`null` = état nominal). */
	empreinte: string | null;
	niveau: "info" | "warn";
}

/**
 * Décide ce qu'un tour de drain met dans le journal — fonction PURE.
 *
 * Le cas normal d'un premier démarrage est « le bot n'est pas encore invité sur
 * la guilde Azalée », donc `sans-salon` à chaque tour, indéfiniment. Le dire
 * une fois est un diagnostic ; le dire toutes les 5 minutes est une panne de
 * journal — et ça enterre les lignes qui comptent.
 *
 * La règle : un état persistant n'est écrit que lorsque sa cause CHANGE
 * (l'empreinte porte l'état ET son détail), et le retour à la normale est
 * signalé une fois, pour qu'un silence ne se lise jamais comme un oubli.
 */
export function ligneJournal(
	resultat: ResultatDrain,
	contexte: { origine: string; canal: string },
	precedent: string | null
): TraceJournal {
	const detail = resultat.detail ? ` — ${resultat.detail}` : "";
	const base = `[tweets:${contexte.canal}] drain (${contexte.origine}) : ${resultat.etat}, ${resultat.publies}/${resultat.candidats}${detail}`;

	if (ETATS_PERSISTANTS.has(resultat.etat)) {
		const empreinte = `${resultat.etat}|${resultat.detail ?? ""}`;
		if (empreinte === precedent) {
			return { ligne: null, empreinte, niveau: "warn" };
		}
		return {
			ligne: `${base} (répétition silencieuse tant que la cause dure)`,
			empreinte,
			niveau: "warn",
		};
	}

	const reprise = precedent !== null;
	const digneDeTrace = resultat.publies > 0 || resultat.etat === "amorce";
	if (!reprise && !digneDeTrace) {
		return { ligne: null, empreinte: null, niveau: "info" };
	}
	return {
		ligne: reprise ? `${base} — la cause du blocage précédent a disparu.` : base,
		empreinte: null,
		niveau: "info",
	};
}

/** Embed d'un tweet : traduction en tête, lien vers l'original, image, métriques. */
export function embedTweet(tweet: LigneTweet): EmbedBuilder {
	const lien = urlTweet(tweet);
	const auteur = tweet.author_username ? `@${tweet.author_username}` : "compte inconnu";
	const embed = rgEmbed()
		.setAuthor({
			name: tweet.author_name ? `${tweet.author_name} (${auteur})` : auteur,
			url: `https://x.com/${tweet.author_username ?? "i"}`,
		})
		.setURL(lien)
		.setTitle(tweet.is_thread ? `Fil de ${tweet.tweet_count ?? 1} posts` : "Nouveau post");

	const corps = corpsTweet(tweet, 1_000);
	if (corps.length > 0) {
		embed.setDescription(corps);
	}

	const images = imagesTweet(tweet.media);
	if (images[0]) {
		embed.setImage(images[0].url);
	}

	const metriques = formaterMetriques(tweet.metrics);
	if (metriques) {
		embed.addFields({ name: "Portée", value: metriques, inline: false });
	}
	if (tweet.category) {
		embed.addFields({ name: "Catégorie", value: tweet.category, inline: true });
	}

	const date = dateTweet(tweet);
	if (date) {
		embed.setTimestamp(date);
	}
	return embed;
}

/** Embed de synthèse quand le lot dépasse `max_par_lot`. */
export function embedResume(tweets: LigneTweet[], filtre: FiltreTweets): EmbedBuilder {
	const dernier = tweets.at(-1);
	return rgEmbed()
		.setTitle("Veille X — nouveaux posts")
		.setDescription(
			`${resumeLot(tweets)}\n\nTrop de posts pour les détailler (seuil : ${filtre.max_par_lot}). ` +
				`Ouvre \`/tweets liste\` pour tout parcourir.`
		)
		.setURL(dernier ? urlTweet(dernier) : "https://x.com/inazuma_project");
}

/**
 * Dernier refus journalisé, par salon.
 *
 * Un salon injoignable est le cas NORMAL au premier démarrage d'un profil : le
 * bot Azalée n'est pas encore invité sur sa guilde, donc `channels.fetch` lève
 * à chaque tour du filet. On garde le diagnostic, on supprime la boucle.
 */
const refusParSalon = new Map<string, string>();

function journaliserRefus(salonId: string, raison: string): void {
	if (refusParSalon.get(salonId) === raison) {
		return;
	}
	refusParSalon.set(salonId, raison);
	console.warn(`[tweets] ${raison} (répétition silencieuse tant que la cause dure)`);
}

/**
 * Résout le salon de destination, et dit POURQUOI quand ça échoue.
 *
 * Le cas mesuré n'est pas théorique : `DISCORD_NEWS_CHANNEL_ID` pointe sur un
 * salon dont `@everyone` est privé de `VIEW_CHANNEL` et où le rôle du bot n'a
 * pas été ajouté → l'API répond `50001 Missing Access`. Sans explication, le
 * symptôme se lit « la notification ne marche pas », alors que c'est un droit
 * Discord à donner au bot, pas une ligne de code à changer.
 *
 * Le second profil ajoute un cas tout aussi ordinaire : `10003 Unknown Channel`
 * tant que le bot Azalée n'a pas été autorisé sur sa guilde. La raison est donc
 * toujours RENVOYÉE à l'appelant (qui l'affiche ou la résume), mais elle n'est
 * écrite au journal qu'au premier passage et à chaque changement de cause.
 */
export async function resoudreSalon(
	client: Client,
	salonId: string
): Promise<{ salon: SendableChannels | null; raison?: string }> {
	try {
		const salon = await client.channels.fetch(salonId);
		if (salon?.isSendable()) {
			refusParSalon.delete(salonId);
			return { salon };
		}
		const raison = `Le salon ${salonId} existe mais le bot ne peut pas y écrire (salon non textuel, ou permission « Envoyer des messages » absente).`;
		journaliserRefus(salonId, raison);
		return { salon: null, raison };
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err);
		const droits = /missing access|50001/i.test(message)
			? " — le bot ne voit pas ce salon : donne à son rôle la permission « Voir le salon » (et « Envoyer des messages ») dessus."
			: /unknown channel|10003/i.test(message)
				? " — salon inconnu de ce bot : il n'est probablement pas encore invité sur le serveur du profil (URL OAuth2), ou l'identifiant du registre de profils est faux."
				: "";
		const raison = `Salon ${salonId} injoignable (${message})${droits}`;
		journaliserRefus(salonId, raison);
		return { salon: null, raison };
	}
}

/**
 * Draine le curseur d'UN profil, une fois. Idempotent : deux appels simultanés
 * ne publient jamais deux fois (garde `drainEnCours` + curseur avancé après
 * l'envoi).
 *
 * @param options.salonForce salon de destination imposé (`/tweets test`).
 * @param options.simulation ne publie pas et n'avance PAS le curseur.
 * @param options.annonce    salon + curseur du profil ; à défaut, le profil
 *                           historique (Rose Griffon), pour que les appelants
 *                           mono-profil (`/tweets test`, `/staff veille`)
 *                           gardent exactement leur comportement.
 */
/**
 * Les deux boutons d'une carte de validation, ou `null` si l'identifiant ne
 * tient pas dans la limite de Discord.
 *
 * Vert à gauche, gris à droite : l'action qui PUBLIE est celle qui se distingue,
 * et le refus reste neutre — on ne colore pas en rouge un geste éditorial
 * ordinaire.
 */
export function rangeeValidation(tweetId: string): ActionRowBuilder<ButtonBuilder>[] | null {
	const oui = encoderValidation(tweetId, "ok");
	const non = encoderValidation(tweetId, "non");
	if (!oui || !non) return null;
	return [
		new ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder().setCustomId(oui).setLabel("Annoncer").setStyle(ButtonStyle.Success),
			new ButtonBuilder().setCustomId(non).setLabel("Ignorer").setStyle(ButtonStyle.Secondary)
		),
	];
}

export async function drainerTweets(
	client: Client,
	options: { salonForce?: string; simulation?: boolean; annonce?: AnnoncePosts } = {}
): Promise<ResultatDrain> {
	if (drainEnCours) {
		return { etat: "concurrent", candidats: 0, publies: 0 };
	}
	drainEnCours = true;
	let echecCeTour = false;
	try {
		const annonce = options.annonce ?? annonceHistorique();
		// Le nom du curseur est une CLÉ PRIMAIRE : un registre mal rempli doit
		// s'arrêter net, pas insérer une ligne fantôme que le prochain démarrage
		// ne retrouverait pas — ce serait une amorce à chaque redémarrage, donc
		// des posts perdus en silence.
		const canal = normaliserCanal(annonce.curseur);
		// PAUSE PAR PROFIL, relue à chaque drain. C'est la seule façon de couper un
		// bot sans couper l'autre : l'interrupteur `filtre.actif` vit dans le
		// réglage PARTAGÉ et ferait taire les deux. Une simulation reste permise —
		// on veut pouvoir vérifier ce qui SERAIT publié pendant la pause.
		if (canal && !options.simulation && (await curseursEnPause()).includes(canal)) {
			return {
				etat: "inactif",
				candidats: 0,
				publies: 0,
				detail: `Annonces suspendues pour le curseur « ${canal} » (réglage ${CLE_PAUSE_TWEETS}).`,
			};
		}
		if (!canal) {
			return {
				etat: "echec",
				candidats: 0,
				publies: 0,
				detail:
					`Nom de curseur inutilisable (« ${annonce.curseur} ») : corrige \`annoncePosts.curseur\` ` +
					"dans le registre de profils (minuscules, chiffres, `-` ou `_`, 32 caractères au plus).",
			};
		}
		const filtrePartage = await lireFiltreNotification();
		if (!filtrePartage.actif && !options.simulation) {
			return { etat: "inactif", candidats: 0, publies: 0 };
		}

		// ── LA LISTE DE COMPTES DU PROFIL L'EMPORTE ─────────────────────────────
		// Le réglage partagé porte huit comptes : c'est la bonne liste pour une
		// veille thématique, pas pour un salon d'annonce de MARQUE. Le salon
		// d'Azalée ne parle que d'Azalée — y voir arriver un post de
		// `@rose_griffon` est une erreur d'adressage, pas un choix éditorial.
		//
		// Seule `comptes` est remplacée : l'interrupteur, les catégories exclues et
		// le seuil de synthèse restent communs, ils décrivent la POLITIQUE
		// d'annonce, pas sa destination.
		const filtre =
			annonce.comptes && annonce.comptes.length > 0
				? { ...filtrePartage, comptes: [...annonce.comptes] }
				: filtrePartage;

		// ⚠ En simulation, AUCUNE écriture — pas même la création du curseur, qui
		// est une écriture de production : `/tweets test` affirme « le curseur n'a
		// pas bougé », cette affirmation doit rester vraie.
		const curseur = options.simulation ? await lireCurseur(canal) : await assurerCurseur(canal);
		if (!curseur) {
			return {
				etat: "amorce",
				candidats: 0,
				publies: 0,
				detail: `Aucun curseur « ${canal} » en base : il sera créé à \`now()\` au premier drain réel, sans rejouer l'archive.`,
			};
		}
		if (curseur.cree) {
			return {
				etat: "amorce",
				candidats: 0,
				publies: 0,
				detail: `Curseur « ${canal} » initialisé à ${curseur.curseurLe.toISOString()} — ni l'archive ni l'arriéré ne seront rejoués.`,
			};
		}

		const candidats = await tweetsAPublier(curseur, filtre);
		const retenus = candidats.filter((tweet) => tweetEstNotifiable(tweet, filtre));
		if (candidats.length === 0) {
			return { etat: "rien", candidats: 0, publies: 0 };
		}

		const salonId = options.salonForce ?? salonAnnonce(annonce, filtre) ?? "";
		if (salonId.length === 0) {
			return {
				etat: "sans-salon",
				candidats: candidats.length,
				publies: 0,
				detail:
					canal === CANAL_NOTIFICATION
						? "Aucun salon configuré (`settings['tweets.notification'].salon`, `DISCORD_NEWS_CHANNEL_ID`, ni `annoncePosts.salon` du profil)."
						: `Aucun salon d'annonce pour le profil au curseur « ${canal} » : renseigne \`annoncePosts.salon\` dans le registre de profils.`,
			};
		}
		const { salon, raison } = await resoudreSalon(client, salonId);
		if (!salon) {
			return {
				etat: "sans-salon",
				candidats: candidats.length,
				publies: 0,
				detail: raison ?? `Salon ${salonId} injoignable.`,
			};
		}

		const dernier = candidats.at(-1)!;
		const borneFinale = dateTweet(dernier) ?? new Date();
		// Le curseur avance sur TOUS les candidats, y compris ceux écartés par le
		// filtre : sinon un post filtré serait réexaminé à chaque drain, indéfiniment.
		let attendu = curseur.curseurLe;

		if (retenus.length === 0) {
			if (!options.simulation) {
				await avancerCurseur(canal, attendu, borneFinale, dernier.id, 0);
			}
			return { etat: "rien", candidats: candidats.length, publies: 0 };
		}

		if (retenus.length > filtre.max_par_lot) {
			if (!options.simulation) {
				await salon.send({
					embeds: [embedResume(retenus, filtre)],
					enforceNonce: true,
					nonce: nonceLot(dernier.id),
				});
				await avancerCurseur(canal, attendu, borneFinale, dernier.id, retenus.length);
			}
			return { etat: "resume", candidats: candidats.length, publies: retenus.length };
		}

		// ── VALIDATION HUMAINE : on PROPOSE, on ne publie pas ───────────────────
		// Quand le profil déclare un salon de validation, le drain n'annonce plus
		// rien de lui-même. Il dépose une carte par post, et l'annonce ne part
		// qu'au clic (`commands/validation.ts`).
		//
		// ⚠ LE CURSEUR AVANCE QUAND MÊME, ET IL AVANCE D'ABORD. Sans ça, le même
		// post serait proposé toutes les cinq minutes jusqu'à ce que quelqu'un
		// tranche — c'est-à-dire une carte de plus toutes les cinq minutes dans un
		// salon de communauté. C'est arrivé : l'échange-comparaison échouait à
		// tous les coups (microsecondes de `timestamptz` contre millisecondes de
		// `Date`, cf. `avancerCurseur`), et rien ne le disait puisque l'état
		// renvoyé restait « propose ». On avance donc AVANT d'envoyer, et un
		// refus arrête le drain sans rien déposer : une proposition perdue se
		// rattrape à la main (`/x annoncer`), une boucle de propositions non.
		if (annonce.salonValidation && !options.simulation) {
			const { salon: salonValidation, raison: raisonValidation } = await resoudreSalon(
				client,
				annonce.salonValidation
			);
			if (!salonValidation) {
				// On n'avance PAS le curseur : le salon de validation est
				// peut-être momentanément injoignable, et les posts doivent être
				// reproposés une fois qu'il l'est de nouveau.
				return {
					etat: "sans-salon",
					candidats: candidats.length,
					publies: 0,
					detail: `Salon de validation \`${annonce.salonValidation}\` injoignable : ${raisonValidation ?? "le bot doit y voir et y écrire"}.`,
				};
			}

			if (!(await avancerCurseur(canal, attendu, borneFinale, dernier.id, 0))) {
				// Un autre drain du même profil a déjà pris ce lot : le laisser
				// proposer seul, sinon chaque post reçoit deux cartes.
				console.warn(
					`[tweets:${canal}] curseur déplacé par un autre drain — ${retenus.length} proposition(s) abandonnée(s).`
				);
				return { etat: "concurrent", candidats: candidats.length, publies: 0 };
			}

			let proposes = 0;
			for (const tweet of retenus) {
				const composants = rangeeValidation(tweet.id);
				if (!composants) {
					// `encoderValidation` a refusé : plutôt que d'envoyer une carte
					// aux boutons morts, on passe. Le cas est théorique (un id de
					// tweet est numérique et court), mais un composant refusé ferait
					// échouer le message ENTIER.
					continue;
				}
				await salonValidation.send({
					content: texteCarteValidation({
						auteur: tweet.author_username ?? "inconnu",
						salonAnnonce: annonce.salon.trim(),
						url: urlTweet(tweet),
					}),
					components: composants,
					allowedMentions: { parse: [] },
					enforceNonce: true,
					nonce: nonceLot(tweet.id, 1),
				});
				proposes += 1;
			}

			return { etat: "propose", candidats: candidats.length, publies: proposes };
		}

		// ── Envoi détaillé, par TRANCHES ────────────────────────────────────────
		// Discord refuse un message de plus de 10 embeds ou de plus de 6 000
		// caractères cumulés, et le curseur n'avance qu'après un envoi réussi :
		// sans découpage, un lot un peu fourni bloquait la notification POUR
		// TOUJOURS (le même lot repartait toutes les 5 min en grossissant).
		const lots = decouperEnLots(retenus.map(embedTweet));
		let publies = 0;
		let index = 0;
		for (const lot of lots) {
			const consommes = publies + lot.length;
			const dernierDuLot = retenus[consommes - 1]!;
			const final = consommes >= retenus.length;
			// Le dernier lot consomme aussi les candidats filtrés qui suivent.
			const borne = final ? borneFinale : (dateTweet(dernierDuLot) ?? borneFinale);
			const idBorne = final ? dernier.id : dernierDuLot.id;

			if (!options.simulation) {
				// ── LE MOTIF DU SALON, À LA LETTRE ──────────────────────────────
				// On ne compose PLUS d'embed maison. Les messages du salon
				// d’annonce d’Azalée publient une amorce suivie de l'URL
				// `fixvx.com`, et c'est Discord qui déplie alors un aperçu complet
				// (texte intégral, image en `?name=orig`, auteur) à partir des
				// métadonnées du miroir. Un embed fabriqué à partir de la base ne
				// peut pas égaler ça : la ligne archivée n'a ni la vidéo, ni le fil,
				// ni la carte de citation.
				// Un message PAR POST : deux aperçus dans un même message ne se
				// déplient pas tous les deux.
				for (const [rang, tweet] of retenus.slice(publies, consommes).entries()) {
					await salon.send({
						content: messageAnnonce(tweet),
						enforceNonce: true,
						nonce: nonceLot(tweet.id, index * 100 + rang),
					});
				}
				// Le ping part APRÈS, dans son propre message et en spoiler —
				// l'inclure dans l'annonce empêcherait l'aperçu de se déplier.
				if (annonce.roleMention) {
					await salon.send({
						content: messagePing(annonce.roleMention),
						allowedMentions: { roles: [annonce.roleMention] },
						enforceNonce: true,
						nonce: nonceLot(idBorne, index * 100 + 99),
					});
				}
				const avance = await avancerCurseur(canal, attendu, borne, idBorne, lot.length);
				if (!avance) {
					// Un autre drain a bougé le curseur pendant l'envoi : on s'arrête là
					// plutôt que d'écraser sa position et de tout ré-annoncer.
					console.warn(
						`[tweets:${canal}] curseur déplacé par un autre drain — arrêt après ${consommes}/${retenus.length} posts.`
					);
					return { etat: "concurrent", candidats: candidats.length, publies: consommes };
				}
				attendu = borne;
			}
			publies = consommes;
			index += 1;
		}

		return { etat: "publie", candidats: candidats.length, publies };
	} catch (err) {
		// Une panne qui dure (base injoignable) revient à CHAQUE tour du filet :
		// la trace complète n'est écrite qu'au premier passage, puis tant que la
		// cause change. Sans ça, cinq minutes suffisent à noyer le journal du
		// service sous la même pile d'appels.
		const message = err instanceof Error ? err.message : String(err);
		echecCeTour = true;
		if (message !== derniereErreur) {
			derniereErreur = message;
			console.error("[tweets] drain en échec :", err);
		}
		return { etat: "echec", candidats: 0, publies: 0, detail: message };
	} finally {
		if (!echecCeTour) {
			derniereErreur = null;
		}
		drainEnCours = false;
	}
}

/**
 * Démarre le notifieur DU PROFIL COURANT : amorce du curseur, filet de
 * 5 minutes, abonnement aux poussées du cron. Renvoie la fonction d'arrêt.
 *
 * @param profil profil issu de `lib/profil.ts`. Omis = profil historique (Rose
 *   Griffon), pour que l'appel d'origine garde son sens. Fourni SANS
 *   `annoncePosts` = ce profil n'annonce pas : rien ne démarre, et c'est dit
 *   une seule fois.
 */
export function demarrerNotifieurTweets(client: Client, profil?: ProfilAnnonceur): () => void {
	const nom = profil?.nom ?? "rg";
	const annonce = profil === undefined ? annonceHistorique() : (profil.annoncePosts ?? null);

	// Aucun salon d'annonce : c'est un choix de configuration valable (un profil
	// peut n'exposer que des commandes). On ne lance donc NI minuteur NI
	// abonnement — sans quoi le journal répéterait « sans-salon » toutes les cinq
	// minutes pour un bot qui n'a jamais eu à publier.
	if (!annonce) {
		console.info(
			`[tweets] profil « ${nom} » : aucun salon d'annonce dans le registre (\`annoncePosts\` absent) — notifieur non démarré, aucun post ne sera publié.`
		);
		return () => {};
	}

	const canal = normaliserCanal(annonce.curseur);
	if (!canal) {
		// Refuser de démarrer plutôt que d'écrire une clé primaire douteuse : un
		// curseur qu'on ne sait pas relire, c'est une amorce à chaque redémarrage,
		// donc des posts silencieusement perdus.
		console.warn(
			`[tweets] profil « ${nom} » : \`annoncePosts.curseur\` inutilisable (« ${annonce.curseur} ») — notifieur non démarré. Attendu : minuscules, chiffres, \`-\` ou \`_\`, 32 caractères au plus.`
		);
		return () => {};
	}

	console.info(
		`[tweets:${canal}] notifieur démarré pour le profil « ${nom} » — salon ${
			annonce.salon.trim().length > 0 ? annonce.salon.trim() : "issu du réglage partagé"
		}, filet toutes les ${Math.round(INTERVALLE_FILET_MS / 60_000)} min.`
	);

	// Mémoire de la dernière cause journalisée : c'est elle qui transforme une
	// boucle d'erreurs en une seule ligne suivie d'un silence.
	let empreinteJournal: string | null = null;

	const drainer = (origine: string): void => {
		void (async () => {
			const resultat = await drainerTweets(client, { annonce });
			const trace = ligneJournal(resultat, { origine, canal }, empreinteJournal);
			empreinteJournal = trace.empreinte;
			if (trace.ligne) {
				if (trace.niveau === "warn") {
					console.warn(trace.ligne);
				} else {
					console.info(trace.ligne);
				}
			}
		})();
	};

	// Amorce immédiate : crée la ligne de curseur de CE profil à `now()` si elle
	// n'existe pas, pour que son tout premier drain réel ne puisse jamais
	// rattraper l'archive — ni l'arriéré déjà annoncé par l'autre profil.
	drainer("démarrage");

	minuteurFilet = setInterval(() => drainer("filet"), INTERVALLE_FILET_MS);

	// Le signal du cron dit « de nouveaux posts sont en base », pas « publie
	// ceci » : les deux profils peuvent l'écouter sans se marcher dessus, chacun
	// drainant ensuite son propre curseur.
	//
	// ⚠ Import PARESSEUX, et c'est délibéré. `lib/cron-ipc` fige le chemin de sa
	// socket (`RG_CRON_SOCKET`) au moment où il est chargé : le faire entrer dans
	// le graphe de tout module qui importe seulement `resoudreSalon` (trois
	// commandes le font) fixait ce chemin bien avant qu'un notifieur en ait
	// besoin. On ne charge donc le pont qu'ici, au seul moment où on s'y abonne.
	let abandonne = false;
	void import("../lib/cron-ipc")
		.then(({ abonnerCron }) => {
			// L'arrêt a pu être demandé pendant le chargement : ne pas ouvrir une
			// socket que plus personne ne fermera.
			if (abandonne) {
				return;
			}
			couperAbonnement = abonnerCron(surEvenementCron);
		})
		.catch((err: unknown) => {
			// Le pont est une OPTIMISATION (réactivité) : sans lui, le filet de
			// 5 minutes garantit toujours l'annonce. On le dit, et on continue.
			console.warn(
				`[tweets:${canal}] pont cron indisponible (${err instanceof Error ? err.message : String(err)}) — seul le filet de rattrapage reste actif.`
			);
		});

	function surEvenementCron(evenement: EvenementIpc): void {
		// `task.done` est la réponse différée d'un `/cron lancer` : le pont ne sait
		// pas dans quel salon la commande a été tapée (et le jeton d'interaction
		// peut avoir expiré), donc le verdict va au journal, d'où `/cron statut` le
		// relit à la demande.
		if (evenement.event === "task.done") {
			const verdict = evenement.success ? "succès" : `échec — ${String(evenement.error ?? "?")}`;
			console.info(
				`[cron-ipc] tâche « ${String(evenement.nom)} » terminée : ${verdict} (${String(evenement.durationMs)} ms)`
			);
			return;
		}
		if (evenement.event !== "tweets.signal") {
			return;
		}
		// Le signal est une OPTIMISATION : on laisse le lot se constituer avant de
		// drainer, sinon une récolte qui écrit 245 lignes en une minute
		// déclencherait autant de drains d'un seul tweet.
		if (minuteurSignal) {
			return;
		}
		minuteurSignal = setTimeout(() => {
			minuteurSignal = null;
			drainer("signal");
		}, DELAI_APRES_SIGNAL_MS);
	}

	return () => {
		abandonne = true;
		if (minuteurFilet) {
			clearInterval(minuteurFilet);
			minuteurFilet = null;
		}
		if (minuteurSignal) {
			clearTimeout(minuteurSignal);
			minuteurSignal = null;
		}
		couperAbonnement?.();
		couperAbonnement = null;
	};
}
