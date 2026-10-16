import "server-only";

import { getPgPool } from "@/lib/db/pg";

import {
  collecterIdentifiantsDiscord,
  RESOLUTION_VIDE,
  type ResolutionDiscord,
  resoudreMentions,
} from "./discord-texte";
import {
  type Campagne,
  entierPositif,
  extraireImages,
  type ImageCampagne,
  type MetriquesPost,
  type PostCampagne,
  type StatsCampagne,
  urlImageAsset,
} from "./types";

/*
 * Lectures serveur des campagnes : publications X ET créations Discord.
 *
 * ⚠ `getPgPool()` se connecte avec le rôle `rg`, PROPRIÉTAIRE des tables : la RLS
 * ne s'applique donc pas (exemption propriétaire). Les clauses `publiee`,
 * `not masque`, `deleted_at is null` et `suivi` doivent figurer EXPLICITEMENT
 * dans chaque requête — s'appuyer sur les policies publierait les campagnes
 * dépubliées, les publications modérées, les messages effacés de Discord et les
 * salons retirés de la veille.
 *
 * DEUX SOURCES, UN SEUL TYPE. Mesuré le 12/8/2026 : aucune des 12 998 lignes de
 * `public.tweets` ne porte `#inazumarg`, `#inatoberrg*` ni `#iergday` — les cinq
 * campagnes archivées n'ont donc RIEN à montrer côté X, leurs créations ayant été
 * déposées sur Discord. Les deux sources remontent dans le même `PostCampagne`,
 * discriminé par `source` : c'est le composant qui se branche dessus, jamais la
 * page qui devine.
 *
 * Chaque requête est enveloppée dans un try/catch avec repli neutre : la page
 * publique ne doit jamais renvoyer une 500 parce que Postgres a hoqueté
 * (même motif que `app/community/page.tsx`).
 */

/**
 * Colonnes de campagne, une seule fois : les trois requêtes lisent la même chose.
 *
 * ⚠ `hashtags_rattrapage` en est ABSENTE, et doit le rester. Cette colonne porte
 * les variantes récoltées en silence (la coquille `#InazumaRGday` de l'affiche
 * IERG Day, par exemple) : la récolte les lit, l'écran jamais. Ne pas la
 * sélectionner est ce qui garantit que la page n'a AUCUN moyen de l'afficher.
 * Côté lecture, elle ne sert qu'en ARGUMENT de `x_masquer_hashtags()` (cf.
 * `SELECT_POSTS`), pour retirer ces variantes du texte des posts — jamais en
 * résultat.
 */
const COLONNES_CAMPAGNE = `slug, titre, sur_titre, description, image_couverture,
	       image_affiche, image_reglement, note_affiche, reglement, hashtags,
	       hashtags_affichage, salons_depot, debut_le, fin_le, actif, principale,
	       collecte_le`;

interface LigneCampagne {
  slug: string;
  titre: string;
  sur_titre: string | null;
  description: string | null;
  image_couverture: string | null;
  image_affiche: string | null;
  image_reglement: string | null;
  note_affiche: string | null;
  reglement: string[] | null;
  hashtags: string[] | null;
  hashtags_affichage: string[] | null;
  salons_depot: string[] | null;
  debut_le: Date | string | null;
  fin_le: Date | string | null;
  actif: boolean;
  principale: boolean;
  collecte_le: Date | string | null;
}

/**
 * Une ligne de la galerie, X ou Discord — la forme COMMUNE des deux moitiés de
 * l'`union all`. Les colonnes qui n'ont de sens que d'un côté (métriques,
 * identifiants de salon) sont `null` de l'autre : Postgres exige que les deux
 * branches aient la même arité, et un `null` typé dit exactement la vérité
 * (« X ne publie pas de nom de salon », « Discord ne publie pas de métriques »).
 */
interface LigneCreation {
  source: "x" | "discord" | "instagram";
  /** Identifiant natif : `tweets.id` ou `discord_messages.message_id`. */
  identifiant: string;
  hashtag_trouve: string | null;
  mis_en_avant: boolean;
  publie_le: Date | string | null;
  auteur_nom: string | null;
  auteur_pseudo: string | null;
  texte: string | null;
  /** `tweets.media` côté X, `campagne_creations_discord.images` côté Discord. */
  media: unknown;
  metrics: unknown;
  salon_id: string | null;
  salon_nom: string | null;
  guild_id: string | null;
  /** Permalien Instagram — `null` pour les deux autres sources. */
  permalien: string | null;
}

/** Une entrée de `campagne_creations_discord.images` (jsonb). */
interface ImageDiscordStockee {
  chemin?: string | null;
  nom?: string | null;
  largeur?: number | null;
  hauteur?: number | null;
  url_origine?: string | null;
  /** Absent des lignes récoltées avant le 26/8/2026 : elles sont toutes des images. */
  kind?: string | null;
  type_mime?: string | null;
}

/*
 * `entierPositif` (plafond + rejet de NaN) vit dans `./types`, module PUR partagé
 * avec `page.tsx` : la page et les requêtes DOIVENT normaliser le numéro de page
 * de la même façon, sans quoi la grille et le widget de pagination désignent deux
 * pages différentes.
 */

/** Les dates traversent la frontière serveur → client : toujours en chaîne ISO. */
function versISO(valeur: Date | string | null | undefined): string | null {
  if (!valeur) {
    return null;
  }
  if (valeur instanceof Date) {
    return Number.isNaN(valeur.getTime()) ? null : valeur.toISOString();
  }
  const date = new Date(valeur);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function versCampagne(ligne: LigneCampagne): Campagne {
  return {
    actif: ligne.actif,
    collecteLe: versISO(ligne.collecte_le),
    debutLe: versISO(ligne.debut_le),
    description: ligne.description,
    finLe: versISO(ligne.fin_le),
    hashtags: ligne.hashtags ?? [],
    hashtagsAffichage: ligne.hashtags_affichage ?? [],
    imageAffiche: ligne.image_affiche,
    imageCouverture: ligne.image_couverture,
    imageReglement: ligne.image_reglement,
    noteAffiche: ligne.note_affiche,
    principale: ligne.principale,
    reglement: ligne.reglement ?? [],
    salonsDepot: ligne.salons_depot ?? [],
    slug: ligne.slug,
    surTitre: ligne.sur_titre,
    titre: ligne.titre,
  };
}

/**
 * Images d'une création Discord, telles qu'elles sont SERVABLES.
 *
 * Une entrée sans `chemin` est une recopie encore en échec : son seul lien
 * connu est l'URL `cdn.discordapp.com` signée, périmée en moins de 24 h. On ne
 * la rend donc pas — l'écran préfère une création de moins à une image morte.
 * `url_origine` (débarrassée de sa signature) n'alimente que `source`, utilisée
 * pour le téléchargement quand notre copie manque : elle est déjà écartée par
 * `next/image` faute d'hôte autorisé, et sert de trace de provenance.
 */
function imagesDiscord(brut: unknown): ImageCampagne[] {
  if (!Array.isArray(brut)) {
    return [];
  }
  const images: ImageCampagne[] = [];
  for (const entree of brut) {
    if (!entree || typeof entree !== "object") {
      continue;
    }
    const image = entree as ImageDiscordStockee;
    const src = urlImageAsset(image.chemin);
    if (!src) {
      continue;
    }
    images.push({
      hauteur: typeof image.hauteur === "number" ? image.hauteur : null,
      // Le `kind` écrit par la récolte fait foi ; à défaut — lignes d'avant le
      // 26/8/2026 — le type MIME tranche, et sinon c'est une image. Aucune de
      // ces trois lectures ne devine : la dernière décrit l'état réel du stock
      // à cette date (aucune vidéo récoltée avant elle).
      kind: image.kind === "video" || (image.type_mime ?? "").startsWith("video/") ? "video" : "image",
      largeur: typeof image.largeur === "number" ? image.largeur : null,
      source: src,
      src,
    });
  }
  return images;
}

/**
 * Traduit les identifiants Discord d'un lot de textes en noms lisibles.
 *
 * TROIS REQUÊTES POUR TOUTE UNE PAGE, jamais une par carte : la galerie en affiche vingt-quatre,
 * et une résolution par publication ferait soixante-douze allers-retours pour afficher trois noms.
 * Un texte sans mention ne déclenche AUCUNE requête.
 *
 * Le nom retenu est celui que Discord affiche lui-même : le surnom de serveur d'abord, sinon le nom
 * global, sinon le pseudo. Un membre parti (`left_at`) reste résolu — il a bel et bien été nommé
 * dans un message, et le remplacer par « membre » réécrirait l'histoire de la conversation.
 *
 * Un échec de lecture n'est pas fatal : on rend la résolution vide, les mentions retombent sur
 * « @membre » et la galerie s'affiche. Personne ne doit tomber sur une 500 en venant voir des dessins.
 */
async function resoudreDiscord(lignes: readonly LigneCreation[]): Promise<ResolutionDiscord> {
  const { membres, roles, salons } = collecterIdentifiantsDiscord(lignes.map(ligne => ligne.texte ?? ""));
  if (membres.length === 0 && roles.length === 0 && salons.length === 0) {
    return RESOLUTION_VIDE;
  }

  const pool = getPgPool();
  try {
    const [lignesMembres, lignesRoles, lignesSalons] = await Promise.all([
      membres.length > 0
        ? pool.query<{ discord_id: string; nom: string }>(
            `select discord_id,
						        coalesce(nullif(btrim(nickname), ''), nullif(btrim(display_name), ''),
						                 nullif(btrim(username), ''), 'membre') as nom
						   from public.discord_members where discord_id = any($1::text[])`,
            [membres],
          )
        : null,
      roles.length > 0
        ? pool.query<{ role_id: string; name: string }>(
            `select role_id, name from public.discord_roles where role_id = any($1::text[])`,
            [roles],
          )
        : null,
      salons.length > 0
        ? pool.query<{ channel_id: string; name: string }>(
            `select channel_id, name from public.discord_channels where channel_id = any($1::text[])`,
            [salons],
          )
        : null,
    ]);

    return {
      membres: Object.fromEntries((lignesMembres?.rows ?? []).map(r => [r.discord_id, r.nom])),
      roles: Object.fromEntries((lignesRoles?.rows ?? []).map(r => [r.role_id, r.name])),
      salons: Object.fromEntries((lignesSalons?.rows ?? []).map(r => [r.channel_id, r.name])),
    };
  } catch (error) {
    console.error("Erreur de résolution des identifiants Discord :", error);
    return RESOLUTION_VIDE;
  }
}

function versPost(ligne: LigneCreation, resolution: ResolutionDiscord = RESOLUTION_VIDE): PostCampagne {
  const commun = {
    // ⚠ `||` ET NON `??`. Mesuré le 13/8/2026 : 55 des 451 créations Discord ont
    // un `author_display_name` VIDE (chaîne vide, pas `null`) — `??` les
    // laissait passer telles quelles et la carte s'affichait sans nom d'auteur.
    // Aucune création n'est réellement anonyme : `author_username` est renseigné
    // sur les 451 lignes Discord comme sur les 493 lignes X (compté en base).
    // Le repli final ne devrait donc jamais servir ; il rend une chaîne vide
    // plutôt qu'un « Anonyme » qui affirmerait quelque chose de faux.
    auteurNom: ligne.auteur_nom || ligne.auteur_pseudo || "",
    hashtagTrouve: ligne.hashtag_trouve,
    misEnAvant: ligne.mis_en_avant,
    publieLe: versISO(ligne.publie_le),
    /*
     * ⚠ LES MENTIONS SONT RÉSOLUES ICI, UNE FOIS, ET PAS DANS LES ÉCRANS.
     * `<@198209347589898240>` s'affichait tel quel sur la galerie publique. La résolution
     * demande la base : la faire côté écran obligerait chaque composant à devenir serveur,
     * ou à recevoir un dictionnaire dont il n'a que faire. Les émojis personnalisés, eux,
     * traversent intacts : `<TexteDiscord>` les rendra en images.
     */
    texte: resoudreMentions(ligne.texte ?? "", resolution),
  };

  if (ligne.source === "instagram") {
    return {
      ...commun,
      auteurPseudo: ligne.auteur_pseudo,
      // Même forme de stockage que Discord : un tableau d'objets portant le
      // `chemin` dans le bucket `assets`. Les URL `cdninstagram.com` sont
      // signées et expirent, elles ne sont jamais servies.
      images: imagesDiscord(ligne.media),
      permalien: ligne.permalien ?? "",
      shortcode: ligne.identifiant,
      source: "instagram",
    };
  }

  if (ligne.source === "discord") {
    return {
      ...commun,
      auteurPseudo: ligne.auteur_pseudo,
      guildId: ligne.guild_id ?? "",
      images: imagesDiscord(ligne.media),
      messageId: ligne.identifiant,
      salonId: ligne.salon_id ?? "",
      salonNom: ligne.salon_nom,
      source: "discord",
    };
  }

  const metriques =
    ligne.metrics && typeof ligne.metrics === "object" && !Array.isArray(ligne.metrics)
      ? (ligne.metrics as MetriquesPost)
      : null;
  return {
    ...commun,
    auteurPseudo: ligne.auteur_pseudo ?? "",
    images: extraireImages(ligne.media),
    metriques,
    source: "x",
    tweetId: ligne.identifiant,
  };
}

/**
 * Le salon de dépôt PUBLIC de la campagne, prêt à être ouvert.
 *
 * ── POURQUOI UNE REQUÊTE, ET PAS UNE CONSTANTE ─────────────────────────────
 * L'identifiant du salon vit déjà dans `x_campagnes.salons_depot` ; ce qui
 * manque pour en faire un lien, c'est la GUILDE — `discord.com/channels/` en a
 * besoin, et elle n'est nulle part dans la campagne. On la lit dans
 * `discord_channels`, c'est-à-dire là où la veille l'a écrite : une constante
 * serait fausse le jour où l'association ouvre un second serveur.
 *
 * ⚠ `suivi` EST EXIGÉ. Un salon retiré de la veille n'est plus archivé : y
 * envoyer un participant lui promettrait que sa création rejoindra la galerie,
 * ce qui serait faux. Mieux vaut ne pas afficher le bouton.
 */
export async function lienDepotDiscord(slug: string): Promise<{ url: string; nom: string | null } | null> {
  try {
    const { rows } = await getPgPool().query<{ channel_id: string; guild_id: string | null; name: string | null }>(
      `select c.channel_id, c.guild_id, c.name
			   from public.x_campagnes camp
			   join public.discord_channels c on c.channel_id = any(camp.salons_depot)
			  where camp.slug = $1 and camp.publiee and c.suivi and c.guild_id is not null
			  order by c.position nulls last
			  limit 1`,
      [slug],
    );
    const ligne = rows[0];
    if (!ligne?.guild_id) return null;
    return {
      nom: ligne.name,
      url: `https://discord.com/channels/${ligne.guild_id}/${ligne.channel_id}`,
    };
  } catch (error) {
    console.error("Erreur de lecture du salon de dépôt :", error);
    return null;
  }
}

/** Toutes les campagnes publiées — alimente le sélecteur de campagne. */
export async function listerCampagnesPubliees(): Promise<Campagne[]> {
  try {
    const { rows } = await getPgPool().query<LigneCampagne>(
      `select ${COLONNES_CAMPAGNE}
			   from public.x_campagnes
			  where publiee
			  order by principale desc, debut_le desc nulls last, slug`,
    );
    return rows.map(versCampagne);
  } catch (error) {
    console.error("Erreur de lecture des campagnes X publiées :", error);
    return [];
  }
}

/**
 * Campagne à afficher. Sans `slug`, on prend la campagne « à la une »
 * (`principale`), puis la plus récente. Avec un `slug` inconnu ou dépublié, on
 * retombe sur ce même choix par défaut plutôt que de rendre une page vide :
 * une URL partagée après la dépublication d'une campagne reste utilisable.
 */
export async function chargerCampagne(slug?: string): Promise<Campagne | null> {
  try {
    // `getPgPool()` DOIT être appelé dans le try : il lève de façon synchrone
    // quand `DATABASE_URL` est absent ou corrompu (garde-fou `eyJ2Ijo`), et une
    // exception qui remonte ici fait tomber la page entière sur `error.tsx`.
    const pool = getPgPool();
    if (slug) {
      const { rows } = await pool.query<LigneCampagne>(
        `select ${COLONNES_CAMPAGNE}
				   from public.x_campagnes
				  where publiee and slug = $1
				  limit 1`,
        [slug],
      );
      const demandee = rows[0];
      if (demandee) {
        return versCampagne(demandee);
      }
    }
    const { rows } = await pool.query<LigneCampagne>(
      `select ${COLONNES_CAMPAGNE}
			   from public.x_campagnes
			  where publiee
			  order by principale desc, debut_le desc nulls last, slug
			  limit 1`,
    );
    const defaut = rows[0];
    return defaut ? versCampagne(defaut) : null;
  } catch (error) {
    console.error("Erreur de lecture de la campagne X :", error);
    return null;
  }
}

/**
 * Compteurs de l'en-tête : publications avec image, participants distincts, dernière.
 *
 * ⚠ CE COMPTEUR DOIT LIRE LA MÊME CHOSE QUE LA GALERIE. Il n'interrogeait que
 * `x_campagne_posts`, c'est-à-dire X seul, alors que `SELECT_POSTS` est devenue
 * le 13/8/2026 l'union des TROIS sources. Résultat mesuré sur `iergday` le
 * 23/8/2026 : la page annonçait « 9 créations · 9 participants » juste au-dessus
 * d'une galerie qui en affichait 20 (9 X + 9 Discord + 2 Instagram). Le correctif
 * de l'union avait réparé l'affichage sans emmener le compteur avec lui.
 *
 * Un en-tête qui contredit ce qu'on voit dessous n'est pas un détail cosmétique :
 * il fait douter du décompte au moment précis où le décompte compte, par exemple
 * si l'on annonce un jour un tirage parmi ces créations.
 *
 * `auteurs` compte les PERSONNES quand le roster de la campagne a été construit,
 * et les PSEUDONYMES DISTINCTS sinon.
 *
 * ⚠ CE N'EST PAS UN DÉTAIL DE PRÉSENTATION. Sur `iergday`, Sanada a publié deux
 * dessins différents : l'un sur X sous « San_La_Vraie », l'autre sur Discord sous
 * « san_la_vraie ». Compter les pseudonymes en fait DEUX participantes, et
 * l'en-tête annoncerait 15 personnes juste au-dessus d'un tirage qui en désigne
 * 14. Le premier participant qui compare les deux chiffres conclut que le
 * périmètre a bougé au moment du tirage — et la vérifiabilité de tout le
 * dispositif ne survit pas à ce doute-là.
 *
 * Le repli sur les pseudonymes n'est pas un pis-aller : tant qu'aucun roster
 * n'existe, rapprocher deux pseudonymes serait une DEVINETTE. Ça l'était encore
 * ce matin. Ça ne l'est plus : `x_campagne_participants` matérialise des fusions
 * PROUVÉES (empreinte perceptuelle du dessin, signature lisible dans
 * l'illustration), chacune avec son niveau de preuve. Un compteur peut lire un
 * acte de modération déjà posé ; ce qu'il ne doit pas faire, c'est en inventer un.
 */
export async function compterPostsCampagne(slug: string): Promise<StatsCampagne> {
  try {
    const { rows } = await getPgPool().query<{
      posts: number;
      auteurs: number;
      derniere: Date | string | null;
    }>(
      `select count(*)::int   as posts,
			        -- ⚠ PAS de \`coalesce\` ici : \`count(*)\` rend 0, jamais NULL, donc
			        -- le repli ne se serait JAMAIS déclenché et les six campagnes
			        -- archivées auraient affiché « 0 participants ». Mesuré sur
			        -- \`inatober-rg-2024\` : 63 créations et 0 auteur. C'est l'existence
			        -- du roster qui décide, pas la valeur du compte.
			        case
			          when exists (select 1 from public.x_campagne_participants pa
			                        where pa.campagne_slug = $1)
			          then (select count(*)::int
			                  from public.x_campagne_participants pa
			                 where pa.campagne_slug = $1
			                   and pa.eligible
			                   and pa.fusionne_dans is null)
			          else count(distinct auteur_pseudo)::int
			        end              as auteurs,
			        max(publie_le)   as derniere
			   from (${SELECT_POSTS}) as creations
			  where campagne_slug = $1 and not masque and a_media`,
      [slug],
    );
    const ligne = rows[0];
    return {
      auteurs: ligne?.auteurs ?? 0,
      derniere: versISO(ligne?.derniere ?? null),
      posts: ligne?.posts ?? 0,
    };
  } catch (error) {
    console.error("Erreur de comptage des publications de campagne :", error);
    return { auteurs: 0, derniere: null, posts: 0 };
  }
}

/*
 * ⚠ ORDRE DE TRI — ne PAS ajouter `nulls last`.
 * L'index `x_campagne_posts_galerie_idx (campagne_slug, publie_le desc)
 * where not masque and a_media` est NULLS FIRST (défaut d'un DESC). Mesuré sur
 * 2000 lignes avec `enable_seqscan = off` :
 *   `order by publie_le desc`                -> Index Scan            [optimal]
 *   `order by publie_le desc nulls last`     -> Sort + Bitmap Heap Scan
 *   `order by publie_le desc, tweet_id desc` -> Incremental Sort      [bon]
 * `tweet_id desc` en second critère rend la pagination déterministe (deux posts
 * à la même seconde ne peuvent pas permuter d'une page à l'autre).
 */
/*
 * ⚠ LE HASHTAG D'UN POST N'EST RENDU QUE S'IL EST AFFICHABLE.
 * `x_campagne_posts.hashtag_trouve` enregistre CELUI QUI A MORDU, y compris un
 * hashtag de rattrapage (`x_campagnes.hashtags_rattrapage` : coquille d'un visuel,
 * variante fautive). Le rendre tel quel afficherait la faute sur la carte du post,
 * exactement ce que le rattrapage silencieux cherche à éviter. Le `case` ci-dessous
 * le ramène à NULL quand il ne fait pas partie des hashtags publics de la campagne.
 * Le filtrage est fait ICI, en SQL, et pas dans le composant : un futur écran qui
 * lirait ces posts hériterait sinon de la fuite.
 *
 * Quand il est affichable, il ressort dans la CASSE de la campagne
 * (`hashtags_affichage`, aligné index par index sur `hashtags`) et non dans celle
 * qu'a tapée l'auteur : la carte annonce « #InazumaDay » là où le post écrivait
 * « #inazumaday ». `hashtags_affichage` vide → indice hors bornes → NULL →
 * `coalesce` retombe sur la forme normalisée, ce qui reste exact.
 *
 * ⚠ LE TEXTE DU POST EST LE SECOND CHEMIN, ET IL EXISTE VRAIMENT.
 * Masquer `hashtag_trouve` ne suffit pas : `t.text` est rendu tel quel dans
 * l'extrait de la carte (`PostCarte`) et dans la légende de la visionneuse, donc
 * le premier participant qui recopie la coquille d'un visuel la reproduit sur
 * notre page — exactement ce que le rattrapage silencieux cherche à éviter.
 * `x_masquer_hashtags()` retire du texte les seuls hashtags de rattrapage de LA
 * campagne concernée (les autres hashtags de l'auteur, eux, ne nous appartiennent
 * pas et restent intacts). C'est fait ICI, en SQL, avec `c.hashtags_rattrapage`
 * qui n'est jamais RENVOYÉE : la colonne reste hors de portée du rendu, et un
 * futur écran qui lirait ces posts hériterait du masquage plutôt que de la fuite.
 *
 * La jointure sur `x_campagnes` sert aussi à REPOSER `c.publiee` : `getPgPool()` se
 * connecte en rôle propriétaire, donc SANS RLS (cf. l'avertissement en tête de
 * fichier). Sans elle, ces requêtes publieraient les posts d'une campagne dépubliée
 * à qui en connaîtrait le slug.
 */
const SELECT_POSTS = `
	select 'x'::text as source, p.tweet_id as identifiant, p.mis_en_avant, p.publie_le,
	       case when p.hashtag_trouve = any(c.hashtags)
	            then coalesce(c.hashtags_affichage[array_position(c.hashtags, p.hashtag_trouve)],
	                          p.hashtag_trouve)
	       end as hashtag_trouve,
	       t.author_username as auteur_pseudo, t.author_name as auteur_nom,
	       public.x_masquer_hashtags(t.text, c.hashtags_rattrapage) as texte,
	       t.media, t.metrics,
	       null::text as salon_id, null::text as salon_nom, null::text as guild_id,
	       null::text as permalien,
	       p.campagne_slug, p.masque, p.a_media
	  from public.x_campagne_posts p
	  join public.tweets t on t.id = p.tweet_id
	  join public.x_campagnes c on c.slug = p.campagne_slug and c.publiee
	 where not public.x_creation_doublon_ecarte(p.campagne_slug, 'x', p.tweet_id)

	union all

	select 'discord'::text, d.message_id, d.mis_en_avant, d.publie_le,
	       case when d.hashtag_trouve = any(c.hashtags)
	            then coalesce(c.hashtags_affichage[array_position(c.hashtags, d.hashtag_trouve)],
	                          d.hashtag_trouve)
	       end,
	       m.author_username, m.author_display_name,
	       public.x_masquer_hashtags(m.content, c.hashtags_rattrapage),
	       d.images, null::jsonb,
	       m.channel_id, s.name, m.guild_id,
	       null::text,
	       d.campagne_slug, d.masque, d.a_media
	  from public.campagne_creations_discord d
	  join public.discord_messages m on m.message_id = d.message_id
	  join public.discord_channels s on s.channel_id = m.channel_id
	  join public.x_campagnes c on c.slug = d.campagne_slug and c.publiee
	 where m.deleted_at is null and s.suivi
	   and not public.x_creation_doublon_ecarte(d.campagne_slug, 'discord', d.message_id)

	union all

	select 'instagram'::text, i.shortcode, i.mis_en_avant, i.publie_le,
	       case when i.hashtag_trouve = any(c.hashtags)
	            then coalesce(c.hashtags_affichage[array_position(c.hashtags, i.hashtag_trouve)],
	                          i.hashtag_trouve)
	       end,
	       i.auteur_pseudo, i.auteur_pseudo,
	       public.x_masquer_hashtags(i.legende, c.hashtags_rattrapage),
	       i.images, null::jsonb,
	       null::text, null::text, null::text,
	       i.permalink,
	       i.campagne_slug, i.masque, i.a_media
	  from public.campagne_creations_instagram i
	  join public.x_campagnes c on c.slug = i.campagne_slug and c.publiee
	 where not public.x_creation_doublon_ecarte(i.campagne_slug, 'instagram', i.shortcode)`;

/**
 * La galerie, TOUTES SOURCES — enveloppe de l'`union all` ci-dessus.
 *
 * ⚠ CE QUE CETTE UNION RÉPARE. Jusqu'au 13/8/2026, `SELECT_POSTS` n'interrogeait
 * que `x_campagne_posts`. Mesuré ce jour-là : **450 créations Discord** étaient
 * en base, non masquées, avec image ré-hébergée — et INVISIBLES sur le site. Les
 * six campagnes archivées affichaient toutes « Aucune publication » alors que
 * leurs créations avaient bien été récoltées ; le mapper `versPost` savait déjà
 * les traduire, mais aucune requête ne les lui donnait.
 *
 * Les trois branches ont la même arité et le même ORDRE de colonnes : Postgres
 * l'exige, et un décalage d'une colonne mettrait silencieusement le pseudo dans
 * le texte. Les colonnes qui n'ont de sens que d'un côté sont `null` TYPÉES —
 * `null` tout court laisserait Postgres deviner le type et refuser l'union.
 *
 * Les gardes de publication sont RECOPIÉES dans chaque branche
 * (`c.publiee`, `not masque`, `a_media`, `m.deleted_at is null`, `s.suivi`) :
 * `getPgPool()` se connecte en rôle propriétaire, donc SANS RLS. Sans elles, la
 * page publierait les créations d'une campagne dépubliée, d'un salon retiré de
 * la veille ou masquées par un modérateur.
 *
 * ⚠ LE MÊME DESSIN N'APPARAÎT QU'UNE FOIS, ET C'EST LA PUBLICATION X QUI GAGNE.
 * Quatre personnes ont posté leur dessin sur X ET sur Discord : le mur montrait
 * donc 20 vignettes pour 16 dessins. `x_creation_doublon_ecarte()` (migration
 * `20260823_02_galerie_privilegie_x.sql`) écarte la publication qui n'a pas été
 * retenue dans `x_campagne_oeuvres` — en pratique le dépôt Discord, puisque
 * c'est la publication sur un réseau social qui atteste la participation, le
 * salon n'étant qu'un miroir. Le choix est DANS LA DONNÉE, avec son motif écrit
 * en clair (`motif_regroupement`), pas dans cette requête.
 *
 * La clause est posée dans les TROIS branches, jamais dans l'enveloppe : sinon
 * `compterPostsCampagne`, qui lit `SELECT_POSTS` directement et non `GALERIE`,
 * compterait les doublons que la galerie n'affiche pas — et l'en-tête
 * recommencerait à contredire le mur juste dessous.
 *
 * Une campagne sans ligne dans `x_campagne_oeuvres` n'est pas filtrée du tout :
 * les six campagnes archivées gardent exactement la galerie qu'elles avaient.
 */
const GALERIE = `select * from (${SELECT_POSTS}) as creations`;

/** Page de la galerie, chronologique stricte (posts avec image, non masqués). */
export async function listerPostsCampagne(slug: string, page: number, parPage: number): Promise<PostCampagne[]> {
  // `Math.max(1, NaN)` vaut NaN : sans `entierPositif`, `?page=abc` envoyait
  // littéralement « NaN » à Postgres (`invalid input syntax for type bigint`),
  // la requête partait en erreur et la galerie s'affichait vide alors que la
  // campagne compte des publications.
  const taille = entierPositif(parPage, 24);
  const offset = (entierPositif(page, 1) - 1) * taille;
  try {
    const { rows } = await getPgPool().query<LigneCreation>(
      `${GALERIE}
			 where campagne_slug = $1 and not masque and a_media
			 order by publie_le desc, identifiant desc
			 limit $2 offset $3`,
      [slug, taille, offset],
    );
    const resolution = await resoudreDiscord(rows);
    return rows.map(ligne => versPost(ligne, resolution));
  } catch (error) {
    console.error("Erreur de lecture des publications de campagne :", error);
    return [];
  }
}

/**
 * Sélection « À la une ». Requête SÉPARÉE de la grille : mettre `mis_en_avant`
 * dans l'`ORDER BY` de la grille neutraliserait l'index ET rendrait la
 * pagination instable (un post promu depuis la page 3 décalerait tout).
 */
export async function listerPostsEnAvant(slug: string, limite = 6): Promise<PostCampagne[]> {
  try {
    const { rows } = await getPgPool().query<LigneCreation>(
      `${GALERIE}
			 where campagne_slug = $1 and mis_en_avant and not masque and a_media
			 order by publie_le desc, identifiant desc
			 limit $2`,
      [slug, entierPositif(limite, 6)],
    );
    const resolution = await resoudreDiscord(rows);
    return rows.map(ligne => versPost(ligne, resolution));
  } catch (error) {
    console.error("Erreur de lecture des publications à la une :", error);
    return [];
  }
}
