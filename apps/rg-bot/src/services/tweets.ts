/**
 * Accès base de la veille X : liste paginée, réglage de notification, curseur.
 *
 * Les tweets ne sont PAS dans `@rosegriffon/azalee` (qui ne connaît que les
 * données de jeu) : ils vivent dans `public.tweets`, alimentée par la récolte du
 * cron. Ce module est la seule porte d'entrée du bot vers cette table ; tout ce
 * qui est décidable sans base est dans `lib/tweets-format.ts`.
 *
 * Le curseur d'annonce est PAR PROFIL (voir `AnnoncePosts` plus bas) : le même
 * programme sert Rose Griffon et Azalée, chacun avec son salon et sa ligne de
 * curseur. Toutes les fonctions de curseur prennent donc un `canal` ; leur
 * valeur par défaut reste celle du profil historique pour que les appelants
 * mono-profil (`/staff veille`, `/administration veille`) restent justes.
 */
import { cached, invalidate } from "../lib/cache";
import { sql } from "../lib/db";
import {
	CLE_PAUSE_TWEETS,
	CLE_REGLAGE_TWEETS,
	FILTRE_TWEETS_DEFAUT,
	PLAFOND_DRAIN,
	categoriesBannies,
	lireFiltreTweets,
	type FiltreTweets,
	type LigneTweet,
} from "../lib/tweets-format";

/**
 * Canal du curseur du profil HISTORIQUE (Rose Griffon).
 *
 * ⚠ Ce n'est plus « le » canal, c'est celui d'un profil parmi d'autres. Depuis
 * qu'un second processus (profil `azalee`) annonce les mêmes posts sur son
 * propre serveur, chaque profil possède SA ligne dans
 * `tweet_notification_curseurs` — la table est clefée par `canal`
 * (`tweet_notification_curseurs_pkey PRIMARY KEY, btree (canal)`, relevé le
 * 13/8/2026), donc deux profils = deux positions indépendantes, et aucun ne
 * consomme les posts de l'autre.
 *
 * La valeur reste `"discord"` : c'est la ligne déjà en base (créée le
 * 12/8/2026 à 23:54:18 UTC) et la renommer relancerait une amorce, donc une
 * journée d'arriéré non annoncée.
 */
export const CANAL_NOTIFICATION = "discord";

/**
 * Où un profil annonce les nouveaux posts, et sous quel curseur.
 *
 * Volontairement réduit à deux champs : le registre de profils
 * (`lib/profil.ts`) décrit bien plus (jeton, guildes, modules, marque), mais le
 * notifieur n'a besoin que de ça. Le type est donc satisfait STRUCTURELLEMENT
 * par le `annoncePosts` du registre — aucun des deux modules n'a besoin
 * d'importer l'autre, et l'identifiant du salon Azalée n'est écrit qu'à un seul
 * endroit : le registre.
 */
export interface AnnoncePosts {
	/** Salon Discord de destination, sur la guilde servie par ce profil. */
	readonly salon: string;
	/** Nom du curseur en base (`canal`). Un par profil, jamais partagé. */
	readonly curseur: string;
	/** Rôle mentionné dans un message séparé après l'annonce, `null` si aucun. */
	readonly roleMention?: string | null;
	/**
	 * Salon où DEMANDER avant de publier, `null`/absent pour publier directement.
	 *
	 * Quand il est posé, le drain ne publie plus rien lui-même : il dépose une
	 * carte de validation, et l'annonce ne part qu'au clic d'un humain habilité.
	 */
	readonly salonValidation?: string | null;
	/**
	 * Comptes X annoncés par ce profil, `null`/absent pour suivre le réglage
	 * partagé. Un salon d'annonce de marque ne relaie que sa marque.
	 */
	readonly comptes?: readonly string[] | null;
}

/**
 * Nom de curseur acceptable, ou `null`.
 *
 * `canal` est la clé primaire de la table : une valeur vide, avec des espaces
 * ou en capitales créerait une ligne fantôme que personne ne retrouverait, et
 * deux graphies du même profil donneraient deux positions — donc un rejeu.
 * On normalise (minuscules, sans espaces autour) et on refuse le reste plutôt
 * que d'écrire n'importe quoi dans une clé primaire.
 */
export function normaliserCanal(nom: string | null | undefined): string | null {
	const propre = (nom ?? "").trim().toLowerCase();
	return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(propre) ? propre : null;
}

/**
 * Annonce du profil historique, quand aucun profil n'est fourni.
 *
 * Conserve exactement le comportement d'avant les profils : le salon vient du
 * réglage partagé, à défaut de `DISCORD_NEWS_CHANNEL_ID`.
 */
export function annonceHistorique(): AnnoncePosts {
	return {
		salon: Bun.env.DISCORD_NEWS_CHANNEL_ID?.trim() ?? "",
		curseur: CANAL_NOTIFICATION,
		roleMention: null,
	};
}

/**
 * Salon effectif d'un profil : registre d'abord, réglage partagé pour le seul
 * profil historique.
 *
 * `settings['tweets.notification']` est UNE ligne, partagée par les deux
 * processus. Ses champs éditoriaux (comptes suivis, catégories exclues, seuil,
 * interrupteur) valent légitimement pour les deux. `salon`, lui, est une
 * DESTINATION : un salon appartient à une guilde, il ne peut pas être partagé.
 *
 * Il garde donc son sens pour le seul canal pour lequel il a été écrit — celui
 * de Rose Griffon, où `/administration veille regler salon:` continue de le
 * poser. Pour tout autre profil, le salon vient exclusivement du registre :
 * sans cette règle, régler le salon côté Rose Griffon détournerait l'annonce
 * d'Azalée vers un salon d'un serveur où son bot n'est même pas présent.
 */
export function salonAnnonce(
	annonce: AnnoncePosts,
	filtre: Pick<FiltreTweets, "salon">
): string | null {
	const duReglage = annonce.curseur === CANAL_NOTIFICATION ? (filtre.salon ?? "").trim() : "";
	const choisi = duReglage.length > 0 ? duReglage : annonce.salon.trim();
	return choisi.length > 0 ? choisi : null;
}

/** Colonnes lues. `raw_tweets` est volontairement exclue : plusieurs ko par ligne, inutile ici. */
const COLONNES = `id, text, created_at, author_username, author_name, media, metrics, is_thread, tweet_count, translation, category`;

const TTL_REGLAGE_MS = 30_000;
/** Court : la reprise d'un profil doit être effective en moins d'une minute. */
const TTL_PAUSE_MS = 20_000;
const TTL_SUGGESTIONS_MS = 10 * 60_000;
const CLE_CACHE_REGLAGE = "tweets:reglage";
const CLE_CACHE_PAUSE = "tweets:pause";
const CLE_CACHE_AUTEURS = "tweets:auteurs";
const CLE_CACHE_CATEGORIES = "tweets:categories";

/**
 * Littéral de tableau Postgres.
 *
 * Bun.SQL sérialise un tableau JS en `a,b` — que Postgres rejette
 * (« malformed array literal », mesuré). On construit donc le littéral
 * `{"a","b"}` nous-mêmes, en échappant `\` et `"`. La chaîne reste un
 * PARAMÈTRE lié (`$n::text[]`), jamais du SQL concaténé.
 */
export function litteralTexteArray(valeurs: readonly string[]): string {
	const echappees = valeurs.map(
		(valeur) => `"${valeur.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`
	);
	return `{${echappees.join(",")}}`;
}

export interface FiltresListe {
	auteur?: string | null;
	categorie?: string | null;
	recherche?: string | null;
	page?: number;
	parPage?: number;
}

export interface PageTweets {
	lignes: LigneTweet[];
	total: number;
	page: number;
	parPage: number;
}

function nettoyer(valeur: string | null | undefined): string | null {
	const propre = valeur?.trim().replace(/^@/, "") ?? "";
	return propre.length > 0 ? propre : null;
}

/**
 * Page de tweets, filtrable par auteur, catégorie et recherche plein texte.
 *
 * La recherche couvre le texte ORIGINAL et la TRADUCTION : sans elle, chercher
 * « stade » ne trouverait rien dans les 6000 posts japonais de l'archive.
 */
export async function listerTweets(filtres: FiltresListe = {}): Promise<PageTweets> {
	const auteur = nettoyer(filtres.auteur);
	const categorie = nettoyer(filtres.categorie);
	const recherche = nettoyer(filtres.recherche);
	const motif = recherche ? `%${recherche}%` : null;
	const parPage = Math.min(10, Math.max(1, Math.trunc(filtres.parPage ?? 5)));
	const page = Math.max(1, Math.trunc(filtres.page ?? 1));
	const decalage = (page - 1) * parPage;

	const [totalRow] = await sql<Array<{ total: number }>>`
		SELECT count(*)::int AS total
		FROM public.tweets
		WHERE (${auteur}::text IS NULL OR lower(author_username) = lower(${auteur}))
		  AND (${categorie}::text IS NULL OR lower(coalesce(category, '')) = lower(${categorie}))
		  AND (${motif}::text IS NULL
		       OR text ILIKE ${motif}
		       OR translation ILIKE ${motif}
		       OR author_name ILIKE ${motif}
		       OR author_username ILIKE ${motif})
	`;
	const total = totalRow?.total ?? 0;

	const lignes = await sql<LigneTweet[]>`
		SELECT ${sql.unsafe(COLONNES)}
		FROM public.tweets
		WHERE (${auteur}::text IS NULL OR lower(author_username) = lower(${auteur}))
		  AND (${categorie}::text IS NULL OR lower(coalesce(category, '')) = lower(${categorie}))
		  AND (${motif}::text IS NULL
		       OR text ILIKE ${motif}
		       OR translation ILIKE ${motif}
		       OR author_name ILIKE ${motif}
		       OR author_username ILIKE ${motif})
		ORDER BY created_at DESC NULLS LAST, id DESC
		LIMIT ${parPage} OFFSET ${decalage}
	`;

	return { lignes, total, page, parPage };
}

/** Un tweet précis, par identifiant. */
export async function lireTweet(id: string): Promise<LigneTweet | null> {
	const lignes = await sql<LigneTweet[]>`
		SELECT ${sql.unsafe(COLONNES)} FROM public.tweets WHERE id = ${id} LIMIT 1
	`;
	return lignes[0] ?? null;
}

// ─── Réglage de notification (table `settings`) ─────────────────────────────

/** Réglage courant, mis en cache brièvement (Redis partagé du bot). */
/**
 * Curseurs d'annonce MIS EN PAUSE, lus en base.
 *
 * ── POURQUOI PAR CURSEUR, ET PAS L'INTERRUPTEUR GÉNÉRAL ────────────────────
 * `FiltreTweets.actif` existe déjà, mais il vit dans le réglage PARTAGÉ
 * (`settings['tweets.notification']`) : le baisser couperait les annonces des
 * DEUX profils. Or on a besoin de suspendre un seul bot — celui d'Azalée
 * annonçait des posts indésirables pendant que celui de Rose Griffon faisait
 * correctement son travail.
 *
 * La liste est en BASE, pas en variable d'environnement : suspendre ou relancer
 * un profil ne doit pas demander un redéploiement, et surtout pas un
 * redémarrage — c'est précisément quand quelque chose déraille qu'on veut
 * pouvoir couper en une requête.
 *
 * Relue à chaque drain (TTL court) : la reprise est donc effective en moins
 * d'une minute, sans toucher au service.
 */
export async function curseursEnPause(): Promise<string[]> {
	const brut = await cached<unknown>(CLE_CACHE_PAUSE, TTL_PAUSE_MS, async () => {
		const lignes = await sql<Array<{ value: unknown }>>`
			SELECT value FROM public.settings WHERE key = ${CLE_PAUSE_TWEETS} LIMIT 1
		`;
		return lignes[0]?.value ?? null;
	});

	// Deux formes acceptées : `["azalee"]` et `{"curseurs":["azalee"]}`. Une
	// valeur illisible NE MET RIEN EN PAUSE — un réglage cassé ne doit pas faire
	// taire tous les bots en silence.
	const liste = Array.isArray(brut)
		? brut
		: typeof brut === "object" && brut !== null && Array.isArray((brut as { curseurs?: unknown }).curseurs)
			? ((brut as { curseurs: unknown[] }).curseurs)
			: [];
	return liste.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim().toLowerCase());
}

export async function lireFiltreNotification(): Promise<FiltreTweets> {
	const brut = await cached<unknown>(CLE_CACHE_REGLAGE, TTL_REGLAGE_MS, async () => {
		const lignes = await sql<Array<{ value: unknown }>>`
			SELECT value FROM public.settings WHERE key = ${CLE_REGLAGE_TWEETS} LIMIT 1
		`;
		return lignes[0]?.value ?? null;
	});
	return lireFiltreTweets(brut);
}

/**
 * Écrit un réglage partiel et renvoie le réglage complet résultant.
 * Le `UPDATE` réveille le déclencheur `rg_realtime_settings` : la page
 * d'administration voit le changement sans rechargement.
 */
export async function ecrireFiltreNotification(
	patch: Partial<FiltreTweets>
): Promise<FiltreTweets> {
	const courant = await lireFiltreNotification();
	const fusionne: FiltreTweets = { ...courant, ...patch };
	// Pas de `JSON.stringify(fusionne)` : Bun.SQL encode déjà en JSON une valeur
	// liée à un paramètre `::jsonb` — la stringifier double l'encodage.
	await sql`
		INSERT INTO public.settings (key, value, description)
		VALUES (
			${CLE_REGLAGE_TWEETS},
			${fusionne}::jsonb,
			'Notification Discord des nouveaux tweets (piloté depuis /tweets suivi).'
		)
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()
	`;
	invalidate(CLE_CACHE_REGLAGE);
	return fusionne;
}

// ─── Curseur de publication ─────────────────────────────────────────────────

export interface Curseur {
	canal: string;
	curseurLe: Date;
	dernierTweetId: string | null;
	annonces: number;
	/** Vrai si la ligne vient d'être créée : ce drain-là ne doit RIEN annoncer. */
	cree: boolean;
}

/**
 * Lit le curseur, et le crée à `now()` s'il n'existe pas.
 *
 * ⚠ VERROU N°2 CONTRE LE REJEU. La première exécution ne notifie jamais : sans
 * cette règle, « tout ce qui dépasse un curseur absent » voudrait dire les
 * 12 998 tweets de l'archive, d'un coup, dans un salon de ~1984 membres.
 * `ON CONFLICT DO NOTHING` rend la création idempotente même si deux drains se
 * croisent au démarrage.
 *
 * Le verrou vaut IDENTIQUEMENT pour un canal neuf : le tout premier démarrage
 * du profil Azalée insère sa ligne à `now()` et repart de là. Il n'annonce donc
 * ni l'archive, ni ce que Rose Griffon a déjà publié — il commence à son propre
 * présent, et `cree: true` fait sortir le drain avant tout envoi.
 */
export async function assurerCurseur(canal = CANAL_NOTIFICATION): Promise<Curseur> {
	const inseres = await sql<
		Array<{ canal: string; curseur_le: Date; dernier_tweet_id: string | null; annonces: number }>
	>`
		INSERT INTO public.tweet_notification_curseurs (canal, curseur_le)
		VALUES (${canal}, date_trunc('milliseconds', now()))
		ON CONFLICT (canal) DO NOTHING
		RETURNING canal, curseur_le, dernier_tweet_id, annonces
	`;
	if (inseres.length > 0) {
		const ligne = inseres[0]!;
		console.info(
			`[tweets] curseur « ${canal} » créé à ${ligne.curseur_le.toISOString()} — aucun rattrapage de l'archive.`
		);
		return {
			canal,
			curseurLe: ligne.curseur_le,
			dernierTweetId: ligne.dernier_tweet_id,
			annonces: ligne.annonces,
			cree: true,
		};
	}
	const lignes = await sql<
		Array<{ canal: string; curseur_le: Date; dernier_tweet_id: string | null; annonces: number }>
	>`
		SELECT canal, curseur_le, dernier_tweet_id, annonces
		FROM public.tweet_notification_curseurs
		WHERE canal = ${canal}
		LIMIT 1
	`;
	const ligne = lignes[0]!;
	return {
		canal,
		curseurLe: ligne.curseur_le,
		dernierTweetId: ligne.dernier_tweet_id,
		annonces: ligne.annonces,
		cree: false,
	};
}

/** Curseur sans création : `null` s'il n'existe pas encore. */
export async function lireCurseur(canal = CANAL_NOTIFICATION): Promise<Curseur | null> {
	const lignes = await sql<
		Array<{ curseur_le: Date; dernier_tweet_id: string | null; annonces: number }>
	>`
		SELECT curseur_le, dernier_tweet_id, annonces
		FROM public.tweet_notification_curseurs
		WHERE canal = ${canal}
		LIMIT 1
	`;
	const ligne = lignes[0];
	if (!ligne) {
		return null;
	}
	return {
		canal,
		curseurLe: ligne.curseur_le,
		dernierTweetId: ligne.dernier_tweet_id,
		annonces: ligne.annonces,
		cree: false,
	};
}

/**
 * Fenêtre de rattrapage, en heures.
 *
 * ⚠ NE PAS redescendre à 24 h. La récolte des comptes officiels (`x-accounts`)
 * ne tourne QU'UNE FOIS PAR JOUR (`crawl`, `0 5 * * *`) et met jusqu'à 22 min
 * (mesuré le 12/8/2026, exécution en 1 327 306 ms). Un post publié entre 05:00
 * et 05:22 a donc déjà plus de 24 h quand sa ligne est écrite : avec l'ancienne
 * borne il était jeté SANS TRACE (5 posts sur 290 mesurés, dont les 3 derniers
 * d'@inazuma_cross). Et un seul crawl sauté — celui du 12/8 a échoué — faisait
 * disparaître la journée entière. 48 h couvre un crawl manqué ; le plafond par
 * exécution reste le vrai garde-fou contre l'inondation.
 */
export const FENETRE_RATTRAPAGE_HEURES = 48;

/**
 * Tweets candidats à l'annonce, du plus ancien au plus récent.
 *
 * ⚠ VERROU N°3 CONTRE LE REJEU : la fenêtre de rattrapage est appliquée EN PLUS
 * du curseur, et `LIMIT` plafonne l'exécution. Même curseur corrompu ou remis à
 * l'époque Unix, rejouer l'archive est impossible.
 *
 * Le filtre par compte et par catégorie est appliqué EN SQL — pas après
 * rapatriement : sur le pire lot mesuré (629 lignes réécrites en une minute),
 * ramener puis jeter serait du gâchis pur. `lib/tweets-format.ts` rejoue la même
 * décision ligne à ligne côté drain.
 */
export async function tweetsAPublier(
	curseur: Curseur,
	filtre: FiltreTweets,
	plafond = PLAFOND_DRAIN
): Promise<LigneTweet[]> {
	if (filtre.comptes.length === 0) {
		return [];
	}
	const comptes = litteralTexteArray(filtre.comptes.map((compte) => compte.toLowerCase()));
	const bannies = litteralTexteArray(categoriesBannies(filtre).map((c) => c.toLowerCase()));
	const limite = Math.min(PLAFOND_DRAIN, Math.max(1, Math.trunc(plafond)));

	return await sql<LigneTweet[]>`
		SELECT ${sql.unsafe(COLONNES)}
		FROM public.tweets
		WHERE created_at > ${curseur.curseurLe}
		  AND created_at > now() - make_interval(hours => ${FENETRE_RATTRAPAGE_HEURES})
		  AND lower(author_username) = ANY(${comptes}::text[])
		  AND (category IS NULL OR lower(category) <> ALL(${bannies}::text[]))
		  -- NI RETWEET, NI REPONSE. Un retweet annonce le post de QUELQU'UN
		  -- D'AUTRE sous le nom du compte suivi ; une reponse est la moitie d'une
		  -- conversation, incomprehensible hors de son fil et bien plus frequente
		  -- qu'une annonce. Les deux formes sont reconnues a leur TEXTE, parce que
		  -- public.tweets ne porte aucune colonne qui les distingue (releve le
		  -- 13/8/2026 : ni is_retweet, ni in_reply_to).
		  --
		  -- Ces deux motifs sont le miroir SQL de estRetweet/estReponse
		  -- (lib/tweets-format.ts). Les deux doivent bouger ensemble : le test
		  -- tweetsNotifier.test.ts couvre la version TypeScript, et c'est elle
		  -- qui fait foi pour la commande /x annoncer.
		  AND text !~ '^\s*RT @[A-Za-z0-9_]{1,15}:'
		  AND text !~ '^\s*(@[A-Za-z0-9_]{1,15}[[:space:],]+)+[^[:space:]]'
		ORDER BY created_at ASC, id ASC
		LIMIT ${limite}
	`;
}

/**
 * Avance le curseur, en ÉCHANGE-COMPARAISON sur sa valeur attendue.
 *
 * ⚠ C'est ici que vit la vraie exclusion mutuelle. Le booléen de processus
 * `drainEnCours` ne protège que d'un seul processus : deux instances du bot (un
 * redéploiement qui se chevauche, une exécution manuelle à côté du service)
 * publiaient le MÊME lot deux fois — reproduit sur la vraie base, 17 tweets
 * annoncés deux fois et un compteur d'annonces à 34 pour 17 posts.
 *
 * `WHERE curseur_le = <valeur lue>` fait perdre le second : son `UPDATE` ne
 * touche aucune ligne, il le sait, et il s'arrête au lieu de continuer. Ça
 * interdit aussi le RECUL du curseur (un drain lent qui finit après un drain
 * rapide ré-annonçait tout l'intervalle).
 *
 * Appelé APRÈS la publication : si l'envoi Discord échoue, le curseur ne bouge
 * pas et le drain suivant réessaie.
 *
 * L'exclusion porte sur `(canal, curseur_le)` : elle départage deux drains du
 * MÊME profil, et ne gêne jamais un autre profil, qui écrit sa propre ligne.
 *
 * ⚠ LA COMPARAISON SE FAIT À LA MILLISECONDE, et c'est indispensable.
 * `timestamptz` porte des MICROsecondes, `Date` de JavaScript s'arrête à la
 * milliseconde : une ligne posée par `now()` vaut `10:29:09.045051`, revient
 * dans le drain comme `10:29:09.045` et ne se retrouve JAMAIS avec un
 * `curseur_le = ${attendu}` brut. L'échange-comparaison échouait donc à tous
 * les coups — silencieusement, puisqu'il ne fait que ne toucher aucune ligne.
 * Le curseur d'Azalée est resté figé au 13/8/2026 pendant onze jours, et le
 * drain a reproposé le même post toutes les cinq minutes dans le salon de
 * validation (`propose, 1/1` en boucle dans le journal). Le `date_trunc` des
 * deux côtés remet la comparaison dans la précision que le lecteur peut
 * représenter ; l'écriture est tronquée de même pour que la valeur relue soit
 * exactement celle qui a été écrite.
 *
 * @returns `false` si un autre drain a déjà avancé le curseur.
 */
export async function avancerCurseur(
	canal: string,
	attendu: Date,
	jusqua: Date,
	dernierTweetId: string | null,
	publies: number
): Promise<boolean> {
	const lignes = await sql<Array<{ canal: string }>>`
		UPDATE public.tweet_notification_curseurs
		SET curseur_le = date_trunc('milliseconds', ${jusqua}::timestamptz),
		    dernier_tweet_id = ${dernierTweetId},
		    annonces = annonces + ${publies},
		    maj_le = now()
		WHERE canal = ${canal}
		  AND date_trunc('milliseconds', curseur_le) = date_trunc('milliseconds', ${attendu}::timestamptz)
		RETURNING canal
	`;
	return lignes.length > 0;
}

// ─── Suggestions d'autocomplétion ───────────────────────────────────────────

/** Comptes les plus actifs sur 90 jours, puis les plus fournis de l'archive. */
export async function auteursConnus(): Promise<string[]> {
	return await cached<string[]>(CLE_CACHE_AUTEURS, TTL_SUGGESTIONS_MS, async () => {
		const lignes = await sql<Array<{ author_username: string }>>`
			SELECT author_username
			FROM public.tweets
			WHERE author_username IS NOT NULL AND author_username <> ''
			GROUP BY author_username
			ORDER BY count(*) FILTER (WHERE created_at > now() - interval '90 days') DESC,
			         count(*) DESC
			LIMIT 100
		`;
		return lignes.map((ligne) => ligne.author_username);
	});
}

/** Catégories réellement présentes en base (la colonne est libre, pas une énumération). */
export async function categoriesConnues(): Promise<string[]> {
	return await cached<string[]>(CLE_CACHE_CATEGORIES, TTL_SUGGESTIONS_MS, async () => {
		const lignes = await sql<Array<{ category: string }>>`
			SELECT category
			FROM public.tweets
			WHERE category IS NOT NULL AND category <> ''
			GROUP BY category
			ORDER BY count(*) DESC
			LIMIT 25
		`;
		return lignes.map((ligne) => ligne.category);
	});
}

/** Dernier tweet d'un compte de la liste blanche — support de `/tweets test`. */
export async function dernierTweetSuivi(filtre: FiltreTweets): Promise<LigneTweet | null> {
	const comptes = litteralTexteArray(
		(filtre.comptes.length > 0 ? filtre.comptes : FILTRE_TWEETS_DEFAUT.comptes).map((c) =>
			c.toLowerCase()
		)
	);
	const lignes = await sql<LigneTweet[]>`
		SELECT ${sql.unsafe(COLONNES)}
		FROM public.tweets
		WHERE lower(author_username) = ANY(${comptes}::text[])
		ORDER BY created_at DESC NULLS LAST
		LIMIT 1
	`;
	return lignes[0] ?? null;
}
