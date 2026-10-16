/*
 * Types et helpers PURS des campagnes à hashtag X — client-safe.
 *
 * Ce module est importé aussi bien par la page serveur (`app/iergday/page.tsx`)
 * que par les îlots `"use client"` de la galerie. Il ne doit donc JAMAIS :
 *   - porter `import "server-only"` ;
 *   - importer `pg`, `@/lib/db/pg`, `node:*` ou quoi que ce soit de serveur.
 * Un seul import serveur remonté ici casserait le bundle navigateur
 * (« Can't resolve 'fs'/'tls' »). Les accès base vivent dans `./queries`.
 */

/** Élément brut du tableau `tweets.media` (jsonb). Toutes les clés sont optionnelles. */
export interface MediaTweet {
	id?: string;
	type?: string;
	url?: string;
	/** Variante camelCase écrite par certaines récoltes historiques. */
	previewUrl?: string;
	preview_url?: string;
	original_url?: string;
	storage_url?: string;
	storage_path?: string;
	width?: number;
	height?: number;
}

/** Campagne éditoriale (`public.x_campagnes`), en camelCase et sérialisable. */
export interface Campagne {
	slug: string;
	titre: string;
	surTitre: string | null;
	description: string | null;
	/** Bannière : le seul visuel recadrable sans mutiler une phrase. */
	imageCouverture: string | null;
	/** Affiche officielle — un document, à montrer ENTIER (jamais en fond recadré). */
	imageAffiche: string | null;
	/**
	 * Avertissement éditorial à afficher SOUS l'affiche, ou `null`.
	 *
	 * Une affiche est une image : ce qu'elle écrit ne se corrige pas en base. Quand
	 * elle porte une coquille (l'affiche IERG Day annonce un hashtag différent de
	 * celui de la carte « Règles »), la seule façon de ne pas la propager en la
	 * publiant est de la rectifier À CÔTÉ, en toutes lettres. Le texte vit en base :
	 * c'est un fait sur CETTE affiche, pas une règle de la page.
	 */
	noteAffiche: string | null;
	/** Carte « Règles » officielle. Son texte lisible vit dans `reglement`. */
	imageReglement: string | null;
	/**
	 * Règles de participation, une par élément, dans l'ordre d'affichage.
	 * Vide = la campagne n'en publie pas ; l'écran ne doit alors rien afficher,
	 * surtout pas un règlement écrit en dur (chaque campagne a les siennes).
	 */
	reglement: string[];
	/**
	 * Hashtags AFFICHABLES, en minuscules et SANS croisillon (contrainte en base).
	 *
	 * ⚠ La colonne `x_campagnes.hashtags_rattrapage` n'est volontairement PAS
	 * exposée ici : elle contient les variantes récoltées en silence (coquille d'un
	 * visuel, faute d'orthographe répandue). Les afficher — même sous un « ou » —
	 * propagerait l'erreur au lieu de la contenir. `queries.ts` ne la sélectionne
	 * pas : la page n'a aucun moyen de la montrer, et c'est délibéré.
	 */
	hashtags: string[];
	/**
	 * Casse d'AFFICHAGE des hashtags, alignée index par index sur `hashtags`.
	 *
	 * `hashtags` est normalisé en minuscules (contrainte en base : la récolte
	 * compare, et X est insensible à la casse) ; les visuels, eux, écrivent
	 * « #IERGDay ». Cette liste ne porte QUE la casse : la contrainte
	 * `x_campagnes_affichage_aligne` exige `lower(hashtags_affichage) = hashtags`,
	 * donc elle ne peut pas contenir un hashtag différent — ni la coquille
	 * `#InazumaRGday`, qui reste cantonnée à `hashtags_rattrapage`.
	 *
	 * Vide = afficher `hashtags` tel quel. Lire par `hashtagsAffichables()`.
	 */
	hashtagsAffichage: string[];
	debutLe: string | null;
	finLe: string | null;
	actif: boolean;
	principale: boolean;
	collecteLe: string | null;
	/**
	 * Salons Discord où les créations de la campagne ont été déposées
	 * (`x_campagnes.salons_depot`, identifiants bruts).
	 *
	 * Sert à DEUX choses, et à rien d'autre : rattacher une création à sa campagne
	 * côté récolte, et dire honnêtement au visiteur où sont les créations quand la
	 * galerie est vide. Ce sont des identifiants publics de salon, pas des liens :
	 * un salon privé le reste, l'écran n'en montre que le nom quand il le connaît.
	 */
	salonsDepot: string[];
}

/**
 * Un salon de dépôt, tel que la base le connaît — pour l'état vide de la page.
 *
 * `archive` dit la seule chose qui compte pour le visiteur : est-ce que le site
 * peut, oui ou non, montrer ce qui a été déposé là. Un salon déclaré par la
 * campagne mais absent de `discord_channels` (ou non suivi) donne `archive:
 * false` et `nom: null` — c'est le cas des quatre salons de la catégorie
 * « Archives », auxquels le bot n'a pas accès.
 */
export interface DepotCampagne {
	salonId: string;
	nom: string | null;
	archive: boolean;
	/** Créations effectivement consultables sur le site pour ce salon. */
	creations: number;
}

/** Image affichable d'un post, déjà résolue vers sa meilleure source. */
export interface ImageCampagne {
	/** URL à donner à `next/image` (relative si servie par le Storage self-host). */
	src: string;
	largeur: number | null;
	hauteur: number | null;
	/** URL d'origine (pbs.twimg.com le plus souvent) — attribution et téléchargement. */
	source: string;
	/**
	 * Image ou vidéo.
	 *
	 * Le nom du type dit « image » parce que ce fut vrai jusqu'au 26/8/2026 : une
	 * participation d'IERG Day déposée en `.mov` a montré qu'une création n'est
	 * pas forcément une image. Le renommer toucherait six écrans pour rien ; ce
	 * champ, lui, est OBLIGATOIRE — sans quoi une vidéo repartirait en silence
	 * dans `next/image`, qui ne sait pas la décoder, et la vignette resterait
	 * vide sans qu'aucune erreur ne soit levée.
	 */
	kind: "image" | "video";
}

/** Métriques publiques d'un post X. Toutes optionnelles : X n'en renvoie pas toujours. */
export interface MetriquesPost {
	like_count?: number;
	retweet_count?: number;
	reply_count?: number;
	quote_count?: number;
	view_count?: number;
}

/**
 * D'où vient une création de la galerie.
 *
 * ⚠ CE DISCRIMINANT N'EST PAS DÉCORATIF. Une création Discord n'a ni identifiant
 * de tweet, ni pseudo X, ni métriques : lui en fabriquer pour la faire entrer
 * dans le moule d'un post X produirait un lien `x.com/…` qui ne mène nulle part
 * et des compteurs de « j'aime » inventés. C'est exactement le défaut que ce
 * chantier répare. Le type est donc une UNION, et le rendu doit se brancher
 * dessus (`post.source === "discord"`), jamais deviner.
 */
export type SourceCreation = "x" | "discord" | "instagram";

/** Ce que les deux sources ont réellement en commun. */
interface BasePostCampagne {
	source: SourceCreation;
	/** Nom affiché de l'auteur (nom X, nom d'affichage Discord). */
	auteurNom: string;
	texte: string;
	publieLe: string | null;
	misEnAvant: boolean;
	/**
	 * Hashtag de la campagne trouvé dans cette publication — UNIQUEMENT s'il fait
	 * partie des hashtags affichables. Une publication captée par un hashtag de
	 * rattrapage arrive donc ici à `null` : elle est bien dans la galerie, mais sa
	 * carte n'affiche pas la variante fautive (filtrage fait en SQL, cf.
	 * `queries.ts`). `null` aussi pour une création rattachée par son SALON de
	 * dépôt : le message n'en portait alors aucun, et c'est un fait, pas un trou.
	 */
	hashtagTrouve: string | null;
	images: ImageCampagne[];
}

/** Publication X rattachée à une campagne (100 % sérialisable). */
export interface PostCampagneX extends BasePostCampagne {
	source: "x";
	tweetId: string;
	auteurPseudo: string;
	metriques: MetriquesPost | null;
}

/**
 * Création déposée sur le serveur DISCORD (100 % sérialisable).
 *
 * Pas de `metriques` : Discord ne publie ni « j'aime » ni repartages, et les
 * réactions d'un message ne sont pas la même chose — les afficher sous les mêmes
 * pictogrammes que X serait un chiffre inventé.
 *
 * `images[].src` pointe TOUJOURS vers notre Storage : les URL `cdn.discordapp.com`
 * sont signées et expirent en moins de 24 h (cf. `lib/discord/url.ts`), une
 * création servie par son lien d'origine casserait le lendemain.
 */
export interface PostCampagneDiscord extends BasePostCampagne {
	source: "discord";
	messageId: string;
	salonId: string;
	/** Nom du salon (« ⚡〡inatober-rg ») quand la base le connaît. */
	salonNom: string | null;
	guildId: string;
	/** Pseudo Discord de l'auteur — l'attribution reste au nom d'affichage. */
	auteurPseudo: string | null;
}

/**
 * Une création déposée sur Instagram.
 *
 * ⚠ PAS DE MÉTRIQUES. `like_count` n'existe que via l'API Graph officielle, que
 * nous n'avons pas : afficher un compteur à zéro serait un chiffre inventé. Le
 * champ est donc absent du type, pas mis à zéro — la carte ne peut pas
 * l'afficher par accident.
 */
export interface PostCampagneInstagram extends BasePostCampagne {
	source: "instagram";
	/** Identifiant de la publication chez Instagram (`Db_AxXAlywQ`). */
	shortcode: string;
	permalien: string;
	/** Pseudo Instagram, saisi par le déposant. `null` si inconnu. */
	auteurPseudo: string | null;
}

/** Publication rattachée à une campagne, quelle que soit sa source. */
export type PostCampagne = PostCampagneX | PostCampagneDiscord | PostCampagneInstagram;

/**
 * Clé stable et unique d'une publication, toutes sources confondues.
 *
 * Le préfixe de source n'est pas cosmétique : un identifiant de message Discord
 * et un identifiant de tweet sont tous deux des entiers décimaux, rien
 * n'interdit une collision dans une liste qui mélange les deux.
 */
export function clePost(post: PostCampagne): string {
	// Un `switch` et non un ternaire : à la troisième source, un ternaire binaire
	// rangeait silencieusement Instagram avec Discord, et deux créations d'un même
	// numéro se seraient écrasées dans la liste.
	switch (post.source) {
		case "x":
			return `x-${post.tweetId}`;
		case "discord":
			return `discord-${post.messageId}`;
		case "instagram":
			return `instagram-${post.shortcode}`;
	}
}

/**
 * Lien vers le message d'origine sur Discord.
 *
 * Il mène au vrai message, pas à une page de repli : c'est la contrepartie
 * honnête du « Voir sur X ». Discord refusera l'accès à qui n'est pas membre du
 * serveur (ou n'a pas le rôle qui ouvre le salon) — le libellé le dit.
 */
export function urlMessageDiscord(guildId: string, salonId: string, messageId: string): string {
	return `https://discord.com/channels/${guildId}/${salonId}/${messageId}`;
}

/** Segment de chemin du bucket `assets` (visuels de campagne, créations Discord). */
const CHEMIN_ASSETS = "/storage/v1/object/public/assets/";

/**
 * URL d'une image ré-hébergée dans le bucket public `assets`, à partir de son
 * chemin (`campagnes/<slug>/discord/<message>-<piece>.png`).
 *
 * RELATIVE, comme pour le bucket `tweets` : nginx sert `/storage/v1/` sur
 * l'origine du site, donc zéro cross-origin et aucun `remotePatterns` à tenir à
 * jour. Un chemin vide rend une chaîne vide, que l'appelant filtre.
 */
export function urlImageAsset(chemin: string | null | undefined): string {
	if (!estChaineNonVide(chemin)) {
		return "";
	}
	const propre = chemin.trim().replace(/^\/+/, "");
	return `${CHEMIN_ASSETS}${propre}`;
}

/** Compteurs affichés dans l'en-tête de campagne. */
export interface StatsCampagne {
	posts: number;
	auteurs: number;
	derniere: string | null;
}

/**
 * Borne haute d'un numéro de page. Sans plafond, `?page=999999999999999999999`
 * donne un `offset` de 2,4e22 que `pg` sérialise en notation exponentielle
 * (« 2.4e+22 ») : Postgres refuse (`invalid input syntax for type bigint`), la
 * requête part en erreur et la galerie s'affiche vide — le tout en journalisant
 * une erreur à chaque visite, ce qu'un robot peut déclencher en boucle.
 */
export const PAGE_MAXIMUM = 1_000_000;

/**
 * Entier positif sûr pour un paramètre d'URL.
 *
 * ⚠ Ce helper vit ici, dans le module PUR, parce qu'il doit servir des deux côtés
 * de la frontière serveur/client : `queries.ts` s'en sert pour ne pas envoyer
 * `NaN` ni `2.4e+22` à Postgres, et `page.tsx` pour ne pas passer au widget de
 * pagination un numéro de page que les requêtes ont, elles, déjà normalisé. Deux
 * normalisations divergentes donnaient une page 1 affichée sous une pagination
 * qui se croyait ailleurs (boutons « précédent »/« suivant » inertes).
 *
 * `parseSearchParams` renvoie `Math.max(1, parseInt("abc", 10))`, c'est-à-dire
 * `NaN` : tout ce qui n'est pas un entier fini retombe sur le repli, tout ce qui
 * dépasse est plafonné.
 */
export function entierPositif(valeur: number, repli: number, maximum = PAGE_MAXIMUM): number {
	if (!Number.isFinite(valeur)) {
		return repli;
	}
	return Math.min(maximum, Math.max(1, Math.trunc(valeur)));
}

/** Segment de chemin des médias ré-hébergés dans le Storage self-host. */
const CHEMIN_STOCKAGE = "/storage/v1/object/public/tweets/";

function estChaineNonVide(valeur: unknown): valeur is string {
	return typeof valeur === "string" && valeur.trim().length > 0;
}

/** Vrai si l'URL pointe vers le bucket `tweets` du Storage self-host, quel que soit l'hôte. */
export function estUrlStockage(url: string): boolean {
	return url.includes(CHEMIN_STOCKAGE);
}

/**
 * Ramène une URL de média à la forme la plus économique pour `next/image`.
 *
 * - Média ré-hébergé (quel que soit l'hôte : `azalee.rosegriffon.fr`,
 *   `rosegriffon.fr`, `storage.rosegriffon.fr`) → chemin RELATIF. nginx sert
 *   `/storage/v1/` sur l'origine du site : zéro cross-origin, et `next/image`
 *   traite une URL relative comme locale (aucun `remotePatterns` requis).
 * - Média encore chez X (`pbs.twimg.com`) → renvoyé tel quel, l'hôte est déjà
 *   autorisé dans `next.config.ts`.
 * - Tout le reste (chaîne vide, `javascript:`, chemin bizarre) → chaîne vide,
 *   l'appelant filtre.
 */
export function normaliserUrlMedia(url: string | undefined | null): string {
	if (!estChaineNonVide(url)) {
		return "";
	}
	const propre = url.trim();
	const position = propre.indexOf(CHEMIN_STOCKAGE);
	if (position >= 0) {
		return propre.slice(position);
	}
	if (propre.startsWith("https://") || propre.startsWith("/")) {
		return propre;
	}
	return "";
}

/**
 * Extrait les IMAGES d'un `tweets.media` brut (jsonb).
 *
 * On ne garde que `type === "photo"` : les vidéos vivent sur `video.twimg.com`,
 * hôte volontairement absent de `remotePatterns` — et la page ne montre que des
 * images. Priorité de source : le Storage self-host quand le fichier y existe,
 * repli sur l'URL d'origine sinon (exigence du chantier).
 */
export function extraireImages(media: unknown): ImageCampagne[] {
	if (!Array.isArray(media)) {
		return [];
	}
	const images: ImageCampagne[] = [];
	for (const brut of media) {
		if (!brut || typeof brut !== "object") {
			continue;
		}
		const item = brut as MediaTweet;
		if (item.type !== "photo") {
			continue;
		}
		const candidats = [
			item.storage_url,
			item.url,
			item.previewUrl,
			item.preview_url,
			item.original_url,
		].filter(estChaineNonVide);
		if (candidats.length === 0) {
			continue;
		}
		// Le Storage self-host d'abord : fichier servi depuis notre origine, donc
		// pas de dépendance à la disponibilité de pbs.twimg.com.
		const preferee = candidats.find(estUrlStockage) ?? candidats[0];
		const src = normaliserUrlMedia(preferee);
		if (!src) {
			continue;
		}
		images.push({
			src,
			// `type !== "photo"` est déjà écarté plus haut : côté X, tout ce qui
			// arrive ici est une image.
			kind: "image",
			largeur: typeof item.width === "number" ? item.width : null,
			hauteur: typeof item.height === "number" ? item.height : null,
			source: normaliserUrlMedia(item.original_url ?? preferee) || src,
		});
	}
	return images;
}

/** Lien vers le post d'origine sur X. */
export function urlPostX(pseudo: string, tweetId: string): string {
	return `https://x.com/${pseudo}/status/${tweetId}`;
}

/** Lien vers la recherche X en direct pour un hashtag (« voir le fil »). */
export function urlRechercheX(hashtag: string): string {
	return `https://x.com/search?q=${encodeURIComponent(`#${hashtag}`)}&f=live`;
}

/**
 * Lien vers l'écran de RÉDACTION de X, hashtag déjà saisi.
 *
 * ⚠ À ne pas confondre avec `urlRechercheX` : un bouton « Publier sur X » ou
 * « Participer sur X » qui ouvre un fil de recherche — vide, tant que personne
 * n'a participé — ne tient pas sa promesse. `intent/post` ouvre la fenêtre de
 * composition avec le bon hashtag, ce qui est exactement l'action demandée.
 *
 * Accepte la forme normalisée comme la forme d'affichage (croisillon compris) :
 * ce hashtag-là finit DANS la publication du participant, il doit donc porter la
 * casse officielle (« #IERGDay »), pas la forme minuscule de comparaison.
 */
export function urlPublicationX(hashtag: string): string {
	return `https://x.com/intent/post?text=${encodeURIComponent(`#${hashtag.replace(/^#/, "")} `)}`;
}

/** Affichage d'un hashtag : la base le stocke sans croisillon, l'écran le remet. */
export function afficherHashtag(hashtag: string): string {
	return `#${hashtag}`;
}

/** Un hashtag de campagne : la valeur canonique (recherche) et son libellé (écran). */
export interface HashtagAffichable {
	/** Forme normalisée, sans croisillon — celle qui sert aux URL de recherche. */
	valeur: string;
	/** Forme montrée à l'écran et copiée par le visiteur, croisillon compris. */
	libelle: string;
}

/**
 * Hashtags publics d'une campagne, prêts à être affichés ET copiés.
 *
 * ⚠ Ne renvoie QUE `hashtags` : `hashtags_rattrapage` n'est même pas chargé par
 * `queries.ts`, et cette fonction n'a donc aucun moyen de le faire remonter.
 */
export function hashtagsAffichables(
	campagne: Pick<Campagne, "hashtags" | "hashtagsAffichage">
): HashtagAffichable[] {
	return campagne.hashtags.map((valeur, position) => ({
		libelle: afficherHashtag(campagne.hashtagsAffichage[position] ?? valeur),
		valeur,
	}));
}

/*
 * ─────────────────────────────────────────────────────────────────────────────
 * Dates : TOUJOURS en heure de Paris, jamais en heure serveur
 * ─────────────────────────────────────────────────────────────────────────────
 * Les bornes de campagne sont des instants absolus (`timestamptz`), mais elles
 * ont été annoncées en heure française (« 22 août 2026 23h59 (FR) »). Le VPS
 * tourne en UTC (`timedatectl` → Etc/UTC) et le navigateur du visiteur dans son
 * propre fuseau : formater avec le fuseau LOCAL afficherait « 21:59 » côté
 * serveur et autre chose côté client — un écart d'hydratation en prime.
 *
 * `timeZone: "Europe/Paris"` rend le rendu identique des deux côtés de la
 * frontière, quel que soit le fuseau de la machine.
 */
const FUSEAU_CAMPAGNE = "Europe/Paris";

const FORMAT_DATE_PARIS = new Intl.DateTimeFormat("fr-FR", {
	day: "numeric",
	month: "long",
	timeZone: FUSEAU_CAMPAGNE,
	year: "numeric",
});

const FORMAT_HEURE_PARIS = new Intl.DateTimeFormat("fr-FR", {
	hour: "2-digit",
	hourCycle: "h23",
	minute: "2-digit",
	timeZone: FUSEAU_CAMPAGNE,
});

/** Date ISO → `Date` valide, ou `null` (une borne absente n'est pas une erreur). */
export function dateValide(iso: string | null | undefined): Date | null {
	if (!iso) {
		return null;
	}
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? null : date;
}

/** « 22 août 2026 », en heure de Paris. */
export function formaterDateParis(iso: string | null | undefined): string | null {
	const date = dateValide(iso);
	return date ? FORMAT_DATE_PARIS.format(date) : null;
}

/**
 * « 22 août 2026 à 23 h 59 », en heure de Paris.
 *
 * L'espace autour du « h » suit la typographie française ; l'affiche écrit
 * « 23h59 », c'est la même minute.
 */
export function formaterDateHeureParis(iso: string | null | undefined): string | null {
	const date = dateValide(iso);
	if (!date) {
		return null;
	}
	return `${FORMAT_DATE_PARIS.format(date)} à ${FORMAT_HEURE_PARIS.format(date).replace(":", " h ")}`;
}

/** Reste à courir, découpé — jamais négatif (le passage à zéro s'arrête à zéro). */
export interface DureeRestante {
	jours: number;
	heures: number;
	minutes: number;
	secondes: number;
}

/**
 * Découpe une durée en millisecondes. Fonction PURE : c'est elle qui est
 * testable, l'îlot client ne fait que l'appeler à chaque seconde.
 */
export function decouperDuree(millisecondes: number): DureeRestante {
	const secondesTotales = Math.max(0, Math.floor(millisecondes / 1000));
	return {
		heures: Math.floor(secondesTotales / 3600) % 24,
		jours: Math.floor(secondesTotales / 86_400),
		minutes: Math.floor(secondesTotales / 60) % 60,
		secondes: secondesTotales % 60,
	};
}

/**
 * Une règle qui INTERDIT quelque chose mérite d'être vue avant les autres.
 *
 * Heuristique sur le français, pas sur le contenu d'une campagne précise : elle
 * vaut pour « L'utilisation d'IA est absolument interdite » comme pour la règle
 * d'une campagne future. Un faux négatif rend simplement la règle sans accent —
 * elle reste affichée, à sa place, en entier.
 */
export function estInterdiction(regle: string): boolean {
	return /\b(interdit|interdite|interdits|interdites|proscrit|proscrite|prohibé|prohibée)\b/i.test(
		regle
	);
}

/**
 * Réseaux — autres que X — nommés par le règlement d'une campagne.
 *
 * Sert à dire la vérité sur la couverture du mur : le règlement IERG Day accepte
 * « Twitter ou Instagram », or il n'existe AUCUN collecteur Instagram ici (seul
 * `hashtag-harvest.ts`, qui interroge X, alimente la galerie). La liste est lue
 * dans le règlement plutôt qu'écrite en dur : une campagne qui n'accepterait que
 * X n'affichera aucun avertissement, et une campagne qui ouvrirait à TikTok
 * l'affichera sans redéploiement.
 */
const RESEAUX_CONNUS = [
	"Instagram",
	"TikTok",
	"Bluesky",
	"Facebook",
	"YouTube",
	"Tumblr",
	"Mastodon",
	"Threads",
	"Discord",
	"Twitch",
] as const;

export function reseauxHorsX(reglement: readonly string[]): string[] {
	const texte = reglement.join(" ");
	return RESEAUX_CONNUS.filter((reseau) => new RegExp(`\\b${reseau}\\b`, "i").test(texte));
}

/**
 * Énumération française : « Instagram », « Instagram et TikTok »,
 * « Instagram, TikTok et Bluesky ». `Intl.ListFormat` ferait la même chose, mais
 * une jointure explicite évite de dépendre de la présence du typage `es2021.intl`.
 */
export function listerEnFrancais(elements: readonly string[]): string {
	if (elements.length <= 1) {
		return elements[0] ?? "";
	}
	return `${elements.slice(0, -1).join(", ")} et ${elements[elements.length - 1]}`;
}

/** Où en est la campagne par rapport à ses bornes éditoriales. */
export function etatCampagne(
	campagne: Pick<Campagne, "debutLe" | "finLe">,
	maintenant: Date = new Date()
): "a-venir" | "en-cours" | "terminee" {
	const debut = campagne.debutLe ? new Date(campagne.debutLe) : null;
	const fin = campagne.finLe ? new Date(campagne.finLe) : null;
	if (fin && maintenant > fin) {
		return "terminee";
	}
	if (debut && maintenant < debut) {
		return "a-venir";
	}
	return "en-cours";
}

/** Libellé français de l'état d'une campagne. */
export function libelleEtatCampagne(etat: ReturnType<typeof etatCampagne>): string {
	switch (etat) {
		case "a-venir":
			return "À venir";
		case "terminee":
			return "Terminée";
		default:
			return "En cours";
	}
}

const FORMAT_COMPACT = new Intl.NumberFormat("fr-FR", {
	maximumFractionDigits: 1,
	notation: "compact",
});

/** Nombre compact en français (1 200 → « 1,2 k »). */
export function formaterNombre(valeur: number | undefined | null): string {
	if (typeof valeur !== "number" || !Number.isFinite(valeur)) {
		return "0";
	}
	return FORMAT_COMPACT.format(valeur);
}

/**
 * Texte d'un post nettoyé pour l'affichage : les liens `t.co` de fin (ceux des
 * médias joints) n'apportent rien dans une carte et mangent la place.
 *
 * ⚠ LA COUPE SE FAIT AU MOT, ET L'ELLIPSE EST COMPTÉE DANS `maximum`.
 * Un `slice(0, maximum)` seul tranchait au milieu d'un mot et rendait
 * `maximum + 1` caractères : la balise `description` de `/iergday` sortait à 161
 * caractères et finissait par « … elle rejoint la gale… » — dans le résultat
 * Google comme dans la carte sociale, où cette phrase est tout ce qui est lu.
 * Repli sur la coupe brute quand le fragment ne contient aucune espace (un seul
 * « mot » plus long que la limite : URL collée, hashtag japonais…).
 */
export function extraitTexte(texte: string, maximum = 220): string {
	const sansTco = texte.replace(/https:\/\/t\.co\/\w+/g, "").replace(/\s+\n/g, "\n").trim();
	if (sansTco.length <= maximum) {
		return sansTco;
	}
	const limite = Math.max(1, maximum - 1);
	const brut = sansTco.slice(0, limite);
	// Le caractère suivant est une espace → le dernier mot est complet, on le garde.
	const motComplet = /\s/.test(sansTco.charAt(limite));
	const coupe = motComplet ? brut : brut.replace(/\s+\S*$/, "");
	return `${(coupe || brut).trimEnd()}…`;
}
