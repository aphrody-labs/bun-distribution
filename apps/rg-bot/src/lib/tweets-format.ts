/**
 * Noyau PUR des tweets : types, filtre de notification, rendu et pagination.
 *
 * Ce module ne connaît NI Postgres NI Discord — c'est délibéré : tout ce qui est
 * décidable sans base (faut-il annoncer ce tweet ? quelle image ? quelle page ?)
 * vit ici et se teste sans démarrer quoi que ce soit. Les accès base sont dans
 * `services/tweets.ts`, l'envoi dans `services/tweetsNotifier.ts`.
 *
 * Le comptage des pages, la grammaire du `customId` et la troncature sont
 * délégués à la trousse de présentation (`lib/ui/etat.ts`, `lib/ui/texte.ts`) :
 * ce sont les mêmes règles pour les cinq surfaces paginées du bot.
 */
import { borner, ilYA } from "./ui/texte";
import {
  MAX_CUSTOM_ID as MAX_CUSTOM_ID_UI,
  bornerPage as bornerPageUi,
  decoderEtat,
  encoderEtat,
  nombreDePages as nombreDePagesUi,
  pageDecodee,
} from "./ui/etat";

/** Ligne de `public.tweets`, réduite aux colonnes que le bot lit. */
export interface LigneTweet {
  id: string;
  text: string | null;
  created_at: string | Date | null;
  author_username: string | null;
  author_name: string | null;
  media: unknown;
  metrics: unknown;
  is_thread: boolean | null;
  tweet_count: number | null;
  translation: string | null;
  category: string | null;
}

/**
 * UN RETWEET N'EST PAS UNE PUBLICATION DU COMPTE.
 *
 * Le texte d'un retweet commence par `RT @pseudo:` — c'est la forme que rend
 * l'API de X, et elle n'a pas changé. Annoncer un retweet dans le salon
 * d'annonces, c'est annoncer le post de QUELQU'UN D'AUTRE sous le nom du compte
 * suivi : le membre clique en croyant lire Azalée et tombe ailleurs.
 */
export function estRetweet(texte: string | null | undefined): boolean {
  return /^RT @[A-Za-z0-9_]{1,15}:/.test((texte ?? "").trimStart());
}

/**
 * UNE RÉPONSE N'EST PAS UNE ANNONCE.
 *
 * X place les pseudos mentionnés en TÊTE du texte d'une réponse
 * (`@compte merci !`). Ces messages sont la moitié d'une conversation : sortis
 * de leur fil, ils sont incompréhensibles, et ils arrivent par dizaines là où le
 * salon attend quelques annonces par jour.
 *
 * ⚠ LA RÈGLE EST ÉTROITE, ET DOIT LE RESTER. Un post ORDINAIRE qui commence par
 * une mention (« @inazuma_project vient d'annoncer… ») serait écarté à tort si
 * l'on élargissait — c'est pourquoi on n'écarte que ce qui commence par une ou
 * plusieurs mentions ET rien d'autre avant, jamais un post contenant une mention
 * quelque part.
 */
export function estReponse(texte: string | null | undefined): boolean {
  return /^(@[A-Za-z0-9_]{1,15}[\s,]+)+\S/.test((texte ?? "").trimStart());
}

/**
 * Ce post a-t-il sa place dans un salon d'annonces ?
 *
 * UNE SEULE définition, partagée par la veille automatique
 * (`services/tweets.ts`) et par `/x annoncer` (`commands/x.ts`). Deux copies
 * divergeraient : la veille filtrerait, la commande manuelle publierait quand
 * même — et c'est exactement ce qui s'est produit avant cette fonction.
 */
export function estAnnoncable(texte: string | null | undefined): boolean {
  return !estRetweet(texte) && !estReponse(texte);
}

/** Média retenu pour un embed : une image, avec son URL absolue. */
export interface ImageTweet {
  url: string;
  largeur: number | null;
  hauteur: number | null;
}

/** Métriques publiques d'un post X. Toutes optionnelles : X n'en renvoie pas toujours. */
export interface MetriquesTweet {
  like_count?: number;
  retweet_count?: number;
  reply_count?: number;
  quote_count?: number;
  view_count?: number;
}

/** Clé de `public.settings` qui pilote la notification. */
export const CLE_REGLAGE_TWEETS = "tweets.notification";

/**
 * Réglage des curseurs d'annonce SUSPENDUS (`settings`).
 *
 * Distinct de `CLE_REGLAGE_TWEETS`, qui est partagé par les deux profils : ici on
 * suspend UN bot sans faire taire l'autre. Valeur attendue : `["azalee"]`.
 */
export const CLE_PAUSE_TWEETS = "tweets.notification.pause";

/** Réglage de la notification des nouveaux tweets. */
export interface FiltreTweets {
  /** Interrupteur général : à `false`, le bot ne publie plus rien (sans redéploiement). */
  actif: boolean;
  /** Liste blanche de comptes X, sans `@`. Vide = aucun compte suivi, donc rien n'est annoncé. */
  comptes: string[];
  /** Catégories jamais annoncées automatiquement. */
  categories_exclues: string[];
  /** Nombre maximum d'embeds détaillés par lot ; au-delà, un seul embed de synthèse. */
  max_par_lot: number;
  /** Salon de destination ; `null` = `DISCORD_NEWS_CHANNEL_ID`. */
  salon: string | null;
}

/**
 * Liste blanche par défaut : les comptes OFFICIELS.
 *
 * Choisie sur l'activité réelle mesurée le 12/8/2026, pas sur le volume total —
 * les gros contributeurs historiques sont morts (`mutugame` 0 post sur 30 j,
 * dernier le 17/6/2026 ; `inazumaSD_L5` dernier post en 2020). Ces huit comptes
 * pèsent ~122 posts sur 30 jours, soit ~4 par jour : une cadence tenable pour un
 * salon. Les 7672 tweets sans catégorie (récoltés par hashtag) et les 249
 * `fan-content` restent hors périmètre par défaut.
 */
export const COMPTES_OFFICIELS = [
  "inazuma_project",
  "inazuma_cross",
  "InazumaSeries",
  "InazumaNational",
  "Level5Hub",
  "LEVEL5_times",
  "Azalee_IE",
  "rose_griffon",
] as const;

/**
 * Catégories JAMAIS annoncées automatiquement, quel que soit le réglage.
 *
 * `leak` (6 lignes) est exclu en dur : une fuite n'a rien à faire dans un salon
 * d'annonces sans relecture humaine. Cette liste s'ajoute à
 * `categories_exclues`, elle ne peut pas être retirée par un `UPDATE`.
 */
export const CATEGORIES_INTERDITES = ["leak"] as const;

export const FILTRE_TWEETS_DEFAUT: FiltreTweets = {
  actif: false,
  comptes: [...COMPTES_OFFICIELS],
  categories_exclues: ["fan-content"],
  max_par_lot: 5,
  salon: null,
};

/** Plafond dur d'un drain, quoi que dise le réglage. Voir `services/tweets.ts`. */
export const PLAFOND_DRAIN = 50;

/**
 * Limites d'un message Discord porteur d'embeds. Elles ne sont vérifiées NI par
 * l'API avant l'envoi, NI par discord.js (aucune validation locale dans la
 * v14.26) : les dépasser donne un rejet `50035` au moment du `send`, donc un lot
 * jamais publié ET un curseur jamais avancé. Elles sont donc appliquées ici.
 */
export const MAX_EMBEDS_PAR_MESSAGE = 10;
export const MAX_CARACTERES_PAR_MESSAGE = 6_000;

/**
 * Découpe une suite d'embeds en messages qui respectent les DEUX bornes.
 *
 * Mesuré le 12/8/2026 sur les vrais posts de la liste blanche : les 5 plus gros
 * embeds pèsent 5 723 caractères (marge de 4,6 %) et il suffit de SIX posts de
 * ce calibre pour dépasser 6 000. Un réglage `max: 6`, pourtant accepté par
 * `/tweets regler`, produisait donc un envoi que l'API refuse — et comme le
 * curseur n'avance qu'après l'envoi, le même lot repartait toutes les 5 minutes
 * en grossissant : panne définitive, réparable par personne.
 *
 * Générique sur `{ length }` pour rester PUR : `EmbedBuilder.length` renvoie
 * exactement la somme comptée par Discord (titre + description + champs + pied +
 * auteur), donc les vrais embeds s'y branchent sans adaptateur.
 */
export function decouperEnLots<T extends { length: number }>(
  elements: readonly T[],
  maxParLot = MAX_EMBEDS_PAR_MESSAGE,
  maxCaracteres = MAX_CARACTERES_PAR_MESSAGE,
): T[][] {
  const lots: T[][] = [];
  let courant: T[] = [];
  let poids = 0;
  for (const element of elements) {
    const taille = Math.max(0, element.length);
    // Un élément seul plus gros que la borne part quand même seul : le tronquer
    // ici serait une décision de rendu prise au mauvais endroit.
    const debordement = courant.length > 0 && (courant.length >= maxParLot || poids + taille > maxCaracteres);
    if (debordement) {
      lots.push(courant);
      courant = [];
      poids = 0;
    }
    courant.push(element);
    poids += taille;
  }
  if (courant.length > 0) {
    lots.push(courant);
  }
  return lots;
}

/** Longueur maximale d'un `nonce` de message Discord. */
const MAX_NONCE = 25;

/**
 * `nonce` déterministe d'un lot, pour `enforceNonce`.
 *
 * Discord déduplique côté serveur les messages portant le même `nonce` et le
 * même auteur à quelques minutes d'intervalle. C'est le seul garde-fou possible
 * contre le doublon de la fenêtre « publié mais curseur pas encore écrit » (un
 * redémarrage entre les deux) : Postgres et l'API Discord n'ont pas de
 * transaction commune. Dérivé du dernier identifiant du lot, donc identique pour
 * deux processus qui draineraient le même lot.
 */
export function nonceLot(dernierId: string, index = 0): string {
  const propre = dernierId.replaceAll(/[^0-9A-Za-z]/g, "").slice(-18);
  return `tw${index}-${propre}`.slice(0, MAX_NONCE);
}

function estChaineNonVide(valeur: unknown): valeur is string {
  return typeof valeur === "string" && valeur.trim().length > 0;
}

function listeDeChaines(valeur: unknown, repli: string[]): string[] {
  if (!Array.isArray(valeur)) {
    return repli;
  }
  const propres = valeur.filter(estChaineNonVide).map(v => v.trim().replace(/^@/, ""));
  return propres;
}

/**
 * Lit la valeur jsonb de `settings['tweets.notification']` sans jamais lever.
 *
 * Un réglage corrompu ou partiel retombe champ par champ sur le défaut : une
 * faute de frappe dans l'éditeur de table ne doit pas faire taire ni emballer la
 * notification.
 *
 * ⚠ `max_par_lot` n'est PAS une taille de message : c'est le SEUIL au-delà
 * duquel le drain remplace le détail par un embed de synthèse
 * (`services/tweetsNotifier.ts` : `if (retenus.length > filtre.max_par_lot)`).
 * L'envoi détaillé, lui, repasse toujours par `decouperEnLots`, qui borne
 * chaque message à `MAX_EMBEDS_PAR_MESSAGE` (10) embeds et
 * `MAX_CARACTERES_PAR_MESSAGE` (6 000) caractères : un seuil élevé ne peut donc
 * pas produire un rejet `50035`. Le borner à 10 n'avait aucun fondement et
 * écrasait silencieusement un réglage posé par `UPDATE settings` (chemin
 * d'administration documenté). La seule borne qui ait un sens est
 * `PLAFOND_DRAIN` (50) : un drain ne ramène jamais plus de lignes que ça
 * (`services/tweets.ts`), donc au-delà le seuil ne changerait plus rien.
 */
export function lireFiltreTweets(valeur: unknown): FiltreTweets {
  if (!valeur || typeof valeur !== "object" || Array.isArray(valeur)) {
    return { ...FILTRE_TWEETS_DEFAUT, comptes: [...FILTRE_TWEETS_DEFAUT.comptes] };
  }
  const brut = valeur as Record<string, unknown>;
  const max = Number(brut.max_par_lot);
  return {
    actif: brut.actif === true,
    comptes: listeDeChaines(brut.comptes, [...FILTRE_TWEETS_DEFAUT.comptes]),
    categories_exclues: listeDeChaines(brut.categories_exclues, [...FILTRE_TWEETS_DEFAUT.categories_exclues]),
    max_par_lot: Number.isFinite(max)
      ? Math.min(PLAFOND_DRAIN, Math.max(1, Math.trunc(max)))
      : FILTRE_TWEETS_DEFAUT.max_par_lot,
    salon: estChaineNonVide(brut.salon) ? brut.salon.trim() : null,
  };
}

/** Toutes les catégories bannies : celles du réglage PLUS celles interdites en dur. */
export function categoriesBannies(filtre: FiltreTweets): string[] {
  const toutes = new Set<string>(CATEGORIES_INTERDITES);
  for (const categorie of filtre.categories_exclues) {
    toutes.add(categorie.toLowerCase());
  }
  return [...toutes];
}

/** Compare deux pseudos X : la casse n'a aucun sens sur X (`@Level5Hub` = `@level5hub`). */
export function memeCompte(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  return a.trim().replace(/^@/, "").toLowerCase() === b.trim().replace(/^@/, "").toLowerCase();
}

/**
 * Ce tweet doit-il être annoncé ?
 *
 * Décision unique, partagée par la requête SQL (qui applique les mêmes règles
 * pour ne pas rapatrier 12 998 lignes) et par le drain (qui revérifie ligne à
 * ligne). Deux implémentations qui divergeraient produiraient soit un silence
 * inexplicable, soit une annonce non voulue.
 */
export function tweetEstNotifiable(tweet: LigneTweet, filtre: FiltreTweets): boolean {
  if (!filtre.actif) {
    return false;
  }
  if (!filtre.comptes.some(compte => memeCompte(compte, tweet.author_username))) {
    return false;
  }
  const categorie = (tweet.category ?? "").toLowerCase();
  if (categorie.length > 0 && categoriesBannies(filtre).includes(categorie)) {
    return false;
  }
  return true;
}

/** Lien canonique vers le post d'origine. */
export function urlTweet(tweet: Pick<LigneTweet, "id" | "author_username">): string {
  const auteur = tweet.author_username?.trim().replace(/^@/, "") || "i";
  return `https://x.com/${auteur}/status/${tweet.id}`;
}

/**
 * URL `fixvx` du post — celle qui fait déplier un aperçu COMPLET par Discord.
 *
 * Discord ne déplie plus les liens `x.com` : ni texte intégral, ni image. Le
 * salon d'annonce d'Azalée contourne ça depuis toujours en publiant l'URL
 * `fixvx.com`, un miroir qui sert les métadonnées Open Graph que Discord sait
 * lire — l'aperçu obtenu porte alors le texte entier, l'image en `?name=orig`
 * et l'auteur. C'est le motif relevé sur les vrais messages du salon d’annonce d’Azalée
 * du salon d’annonce d’Azalée, et il est reproduit à la lettre ici.
 *
 * `?s=20` est conservé tel quel : c'est ce que le partage mobile de X ajoute,
 * et c'est ce que portent les messages existants.
 */
export function urlFixvx(tweet: Pick<LigneTweet, "id" | "author_username">): string {
  const auteur = tweet.author_username?.trim().replace(/^@/, "") || "i";
  return `https://fixvx.com/${auteur}/status/${tweet.id}?s=20`;
}

/**
 * Le message d'annonce : une amorce courte, puis l'URL qui porte l'aperçu.
 *
 * L'amorce reprend la première phrase du post — c'est ce que font les messages
 * du salon (« Mosaique collaborative : <url> »). Sans elle, la ligne se réduit
 * à une URL nue et le fil devient illisible quand l'aperçu tarde à charger.
 */
export function messageAnnonce(tweet: LigneTweet, maxAmorce = 120): string {
  const texte = texteSansLienMedia(tweet.text).split(/\r?\n/)[0]?.trim() ?? "";
  const amorce = texte.length > maxAmorce ? `${texte.slice(0, maxAmorce - 1).trimEnd()}…` : texte;
  const url = urlFixvx(tweet);
  return amorce.length > 0 ? `${amorce} : ${url}` : url;
}

/**
 * Mention de rôle en SPOILER, dans son propre message.
 *
 * Deux détails repris du salon, et aucun n'est cosmétique : le ping part dans un
 * message SÉPARÉ (le mettre dans le message d'annonce empêcherait Discord d'en
 * déplier l'aperçu proprement), et il est entouré de `||` pour rester discret
 * dans le fil.
 */
export function messagePing(roleId: string): string {
  return `||<@&${roleId}> ||`;
}

/** Segment de chemin des médias ré-hébergés dans le Storage self-host. */
const CHEMIN_STOCKAGE = "/storage/v1/object/public/tweets/";

/**
 * Rend une URL de média ABSOLUE.
 *
 * Discord va chercher l'image lui-même : une URL relative (la forme que sert le
 * site, cf. `apps/website/src/lib/x-campagnes/types.ts`) ne serait jamais
 * résolue. On repasse donc par l'origine publique.
 */
export function urlMediaAbsolue(url: string | null | undefined): string | null {
  if (!estChaineNonVide(url)) {
    return null;
  }
  const propre = url.trim();
  const position = propre.indexOf(CHEMIN_STOCKAGE);
  if (position >= 0) {
    return `https://rosegriffon.fr${propre.slice(position)}`;
  }
  if (propre.startsWith("https://")) {
    return propre;
  }
  return null;
}

/**
 * Images d'un `tweets.media` brut (jsonb), meilleure source d'abord.
 *
 * Seules les photos sont retenues : les vidéos vivent sur `video.twimg.com` et
 * Discord n'en ferait rien dans un embed. Le Storage self-host passe devant
 * `pbs.twimg.com` — 5529 médias y ont été ré-hébergés justement parce que les
 * URLs d'origine finissent par expirer.
 */
export function imagesTweet(media: unknown): ImageTweet[] {
  if (!Array.isArray(media)) {
    return [];
  }
  const images: ImageTweet[] = [];
  for (const brut of media) {
    if (!brut || typeof brut !== "object") {
      continue;
    }
    const item = brut as Record<string, unknown>;
    if (item.type !== "photo") {
      continue;
    }
    const candidats = [item.storage_url, item.url, item.preview_url, item.previewUrl, item.original_url]
      .filter(estChaineNonVide)
      .map(valeur => valeur.trim());
    const stockee = candidats.find(valeur => valeur.includes(CHEMIN_STOCKAGE));
    const url = urlMediaAbsolue(stockee ?? candidats[0]);
    if (!url) {
      continue;
    }
    images.push({
      url,
      largeur: typeof item.width === "number" ? item.width : null,
      hauteur: typeof item.height === "number" ? item.height : null,
    });
  }
  return images;
}

/** Métriques exploitables, ou `null` si X n'en a renvoyé aucune. */
export function metriquesTweet(metrics: unknown): MetriquesTweet | null {
  if (!metrics || typeof metrics !== "object" || Array.isArray(metrics)) {
    return null;
  }
  const brut = metrics as Record<string, unknown>;
  const retenues: MetriquesTweet = {};
  for (const clef of ["like_count", "retweet_count", "reply_count", "quote_count", "view_count"] as const) {
    const valeur = brut[clef];
    if (typeof valeur === "number" && Number.isFinite(valeur)) {
      retenues[clef] = valeur;
    }
  }
  return Object.keys(retenues).length > 0 ? retenues : null;
}

/** Ligne compacte de métriques, ou `null` si tout est à zéro ou absent. */
export function formaterMetriques(metrics: unknown): string | null {
  const m = metriquesTweet(metrics);
  if (!m) {
    return null;
  }
  const morceaux: string[] = [];
  if (m.like_count) morceaux.push(`♥ ${m.like_count.toLocaleString("fr-FR")}`);
  if (m.retweet_count) morceaux.push(`RT ${m.retweet_count.toLocaleString("fr-FR")}`);
  if (m.reply_count) morceaux.push(`↩ ${m.reply_count.toLocaleString("fr-FR")}`);
  if (m.quote_count) morceaux.push(`❝ ${m.quote_count.toLocaleString("fr-FR")}`);
  if (m.view_count) morceaux.push(`👁 ${m.view_count.toLocaleString("fr-FR")}`);
  return morceaux.length > 0 ? morceaux.join(" · ") : null;
}

/** Retire les `https://t.co/…` de fin, qui ne sont que le lien du média déjà affiché. */
export function texteSansLienMedia(texte: string | null | undefined): string {
  if (!estChaineNonVide(texte)) {
    return "";
  }
  return texte.replaceAll(/\s*https:\/\/t\.co\/\w+\s*$/gu, "").trim();
}

/** Coupe proprement, avec une ellipse, sans jamais dépasser `max`. */
export function couper(texte: string, max: number): string {
  return borner(texte, max);
}

/**
 * Met un texte en citation Markdown SANS dépasser le budget donné.
 *
 * Le préfixe `> ` coûte 2 caractères par ligne : tronquer d'abord puis préfixer
 * faisait déborder de 2 caractères par saut de ligne (mesuré : `corpsTweet(t,
 * 1000)` rendait jusqu'à 1028 sur les vrais posts). Ces caractères-là comptent :
 * ils grignotent la marge du plafond de 6 000 par message.
 */
export function citer(texte: string, budget: number): string {
  if (budget <= 2 || texte.length === 0) {
    return "";
  }
  let cible = budget - 2;
  for (let garde = 0; garde < 8; garde++) {
    const rendu = `> ${couper(texte, Math.max(1, cible)).replaceAll("\n", "\n> ")}`;
    if (rendu.length <= budget) {
      return rendu;
    }
    cible -= rendu.length - budget;
    if (cible < 1) {
      return "";
    }
  }
  return "";
}

/**
 * Corps affichable d'un tweet, garanti ≤ `max` caractères.
 *
 * La traduction française passe DEVANT l'original : le salon est francophone et
 * la moitié de l'archive est en japonais. L'original suit en citation quand il
 * diffère, pour que rien ne soit perdu.
 */
export function corpsTweet(tweet: LigneTweet, max = 700): string {
  const original = texteSansLienMedia(tweet.text);
  const traduction = texteSansLienMedia(tweet.translation);
  if (traduction.length > 0 && traduction !== original) {
    const part = Math.max(80, Math.floor(max * 0.6));
    const bloc = couper(traduction, part);
    // 2 = le `\n\n` qui sépare la traduction de la citation. En dessous de 40
    // caractères utiles, la citation n'apprend rien : on garde la traduction seule.
    const budget = max - bloc.length - 2;
    const citation = original.length > 0 && budget >= 40 ? citer(original, budget) : "";
    if (citation.length > 0) {
      return `${bloc}\n\n${citation}`;
    }
    return bloc;
  }
  return couper(original.length > 0 ? original : traduction, max);
}

/** Date ISO d'un tweet, ou `null` si la colonne est vide. */
export function dateTweet(tweet: LigneTweet): Date | null {
  if (!tweet.created_at) {
    return null;
  }
  const date = tweet.created_at instanceof Date ? tweet.created_at : new Date(tweet.created_at);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Horodatage Discord relatif (`<t:…:R>`), qui se localise chez chaque membre. */
export function horodatageDiscord(tweet: LigneTweet): string {
  return ilYA(dateTweet(tweet));
}

/** Ligne d'un tweet dans la liste paginée. */
export function ligneListe(tweet: LigneTweet, maxTexte = 180): string {
  const auteur = tweet.author_username ? `@${tweet.author_username}` : "compte inconnu";
  const etiquettes: string[] = [];
  if (tweet.category) etiquettes.push(`*${tweet.category}*`);
  if (tweet.is_thread) etiquettes.push(`fil de ${tweet.tweet_count ?? 1}`);
  const images = imagesTweet(tweet.media);
  if (images.length > 0) etiquettes.push(`${images.length} image${images.length > 1 ? "s" : ""}`);
  const suffixe = etiquettes.length > 0 ? ` · ${etiquettes.join(" · ")}` : "";
  const corps = couper(texteSansLienMedia(tweet.translation) || texteSansLienMedia(tweet.text), maxTexte);
  return `**[${auteur}](${urlTweet(tweet)})** · ${horodatageDiscord(tweet)}${suffixe}\n${corps || "*(sans texte)*"}`;
}

/** Nombre total de pages pour un total et une taille de page donnés (jamais 0). */
export function nombreDePages(total: number, parPage: number): number {
  return nombreDePagesUi(total, parPage);
}

/**
 * Borne un numéro de page dans `[1, nombreDePages]`.
 *
 * Sans plafond, `page:999999999` produit un `OFFSET` que Postgres refuse en
 * bigint : la commande répondrait par une erreur au lieu d'une liste vide. Même
 * garde que `entierPositif` côté site (`lib/x-campagnes/types.ts`).
 */
export function bornerPage(page: number, total: number, parPage: number): number {
  return bornerPageUi(page, total, parPage);
}

/** Décompte par auteur, du plus prolifique au moins, pour la synthèse d'un gros lot. */
export function compterParAuteur(tweets: LigneTweet[]): Array<{ compte: string; n: number }> {
  const compteurs = new Map<string, number>();
  for (const tweet of tweets) {
    const compte = tweet.author_username?.trim().replace(/^@/, "") || "inconnu";
    compteurs.set(compte, (compteurs.get(compte) ?? 0) + 1);
  }
  return [...compteurs.entries()]
    .map(([compte, n]) => ({ compte, n }))
    .toSorted((a, b) => b.n - a.n || a.compte.localeCompare(b.compte, "fr"));
}

// ─── État de pagination transporté par les boutons ──────────────────────────

/** Préfixe du `customId` des boutons de pagination. */
export const PREFIXE_BOUTON_TWEETS = "tw";

/** Longueur maximale d'un `customId` Discord. */
export const MAX_CUSTOM_ID = MAX_CUSTOM_ID_UI;

export interface EtatListeTweets {
  page: number;
  auteur: string | null;
  categorie: string | null;
  recherche: string | null;
}

/**
 * Encode l'état d'une liste dans un `customId`.
 *
 * Renvoie `null` si l'état ne tient pas dans les 100 caractères imposés par
 * Discord : on préfère alors NE PAS afficher de boutons plutôt que de tronquer
 * la recherche — des boutons qui changeraient silencieusement les critères
 * seraient pires que pas de boutons du tout.
 */
export function encoderEtatListe(etat: EtatListeTweets): string | null {
  return encoderEtat(PREFIXE_BOUTON_TWEETS, [etat.page, etat.auteur, etat.categorie, etat.recherche]);
}

/** Décode un `customId` produit par `encoderEtatListe`. `null` si ce n'en est pas un. */
export function decoderEtatListe(customId: string): EtatListeTweets | null {
  const champs = decoderEtat(PREFIXE_BOUTON_TWEETS, customId, 4);
  const page = pageDecodee(champs?.[0]);
  if (!champs || page === null) {
    return null;
  }
  return {
    page,
    auteur: champs[1] || null,
    categorie: champs[2] || null,
    recherche: champs[3] || null,
  };
}

/**
 * Synthèse d'un lot trop gros pour être détaillé.
 *
 * Pire cas mesuré le 12/8/2026 : 245 tweets réellement neufs en une minute. Sans
 * regroupement, c'est 245 messages d'affilée dans le salon.
 */
export function resumeLot(tweets: LigneTweet[]): string {
  const parAuteur = compterParAuteur(tweets)
    .slice(0, 6)
    .map(({ compte, n }) => `@${compte} (${n})`);
  return `**${tweets.length} nouveaux tweets** — ${parAuteur.join(", ")}`;
}
