/**
 * `/x` — l'ARCHIVE des posts X récoltés par le cron, consultable dans Discord.
 *
 *  - `/x liste` : parcours paginé de l'archive, filtrable par compte, par
 *    catégorie et par texte (l'original ET la traduction française) ;
 *  - `/x voir`  : un post précis, avec ses images, sa traduction et sa portée.
 *
 * PÉRIMÈTRE — cette commande ne fait QUE lire l'archive rangée dans
 * `public.tweets`. Tout ce qui touche à la NOTIFICATION (état du suivi,
 * réglages) et tout ce qui interroge X EN DIRECT vit ailleurs, par construction :
 * ce qui se consulte est sous `/staff veille`, ce qui se modifie est sous
 * `/administration veille`. Rien de tout cela ne doit revenir ici : `/x` est
 * ouvert à tous les membres, les deux autres sont réservés au staff.
 *
 * Toute la logique décidable sans base (rendu d'une ligne, choix des images,
 * bornage des pages, encodage de l'état des boutons) vit dans
 * `lib/tweets-format.ts`, qui est pur et couvert par ses propres tests. Ce
 * fichier ne fait que du câblage Discord.
 */
import { ButtonComponent, Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ActionRowBuilder,
  ApplicationCommandOptionType,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  type AutocompleteInteraction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type InteractionEditReplyOptions,
} from "discord.js";

import { appelerCron } from "../lib/cron-ipc";
import { rgEmbed, truncate } from "../lib/embeds";
import { NotAdminError, requireRgAdmin } from "../lib/rbac";
import { PROFIL_ANNONCEUR } from "../lib/config";
import {
  bornerPage,
  corpsTweet,
  couper,
  decoderEtatListe,
  encoderEtatListe,
  formaterMetriques,
  horodatageDiscord,
  imagesTweet,
  ligneListe,
  estAnnoncable,
  estRetweet,
  messageAnnonce,
  messagePing,
  nombreDePages,
  PREFIXE_BOUTON_TWEETS,
  texteSansLienMedia,
  urlTweet,
  type LigneTweet,
  type EtatListeTweets,
} from "../lib/tweets-format";
import { auteursConnus, categoriesConnues, listerTweets, lireTweet } from "../services/tweets";
import { resoudreSalon } from "../services/tweetsNotifier";
import { pied, rangeePagination } from "../lib/ui";

/** Posts par page. 5 lignes tiennent largement dans les 4 096 caractères d'une description. */
const PAR_PAGE = 5;

/** Images montrées au maximum sur un post. Discord n'agrège pas au-delà de 4. */
const MAX_IMAGES = 4;

/**
 * Réponse d'erreur.
 *
 * Le message brut d'une erreur Postgres (fragment de requête, nom d'hôte du
 * pooler) n'a rien à faire dans un salon public : il est journalisé côté
 * service, et le membre reçoit une phrase utile. Ne lève jamais — un `editReply`
 * qui échoue à son tour ne doit pas remonter en exception non capturée.
 */
async function repondreErreur(interaction: ChatInputCommandInteraction, contexte: string, err: unknown): Promise<void> {
  console.error(`[x] ${contexte} :`, err);
  try {
    await interaction.editReply({
      content: "❌ L'archive des posts est momentanément illisible. Réessaie dans un instant.",
      embeds: [],
      components: [],
    });
  } catch (secondaire) {
    console.error("[x] réponse d'erreur impossible :", secondaire);
  }
}

/** Construit la réponse (embed + boutons) d'une page de liste. */
async function rendrePage(etat: EtatListeTweets): Promise<InteractionEditReplyOptions> {
  const premier = await listerTweets({
    auteur: etat.auteur,
    categorie: etat.categorie,
    recherche: etat.recherche,
    page: etat.page,
    parPage: PAR_PAGE,
  });
  // Une page demandée au-delà de la dernière ne doit pas répondre « vide » :
  // on la ramène dans les bornes et on relit.
  const page = bornerPage(etat.page, premier.total, PAR_PAGE);
  const resultat =
    page === premier.page
      ? premier
      : await listerTweets({
          auteur: etat.auteur,
          categorie: etat.categorie,
          recherche: etat.recherche,
          page,
          parPage: PAR_PAGE,
        });

  const criteres = [
    etat.auteur ? `@${etat.auteur}` : null,
    etat.categorie,
    etat.recherche ? `« ${etat.recherche} »` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const pages = nombreDePages(resultat.total, PAR_PAGE);

  const embed = rgEmbed()
    .setTitle(`Archive X — ${resultat.total.toLocaleString("fr-FR")} post${resultat.total > 1 ? "s" : ""}`)
    .setURL("https://rosegriffon.fr/iergday");
  if (criteres.length > 0) {
    embed.setAuthor({ name: `Filtres : ${truncate(criteres, 200)}` });
  }
  if (resultat.lignes.length === 0) {
    // Une réponse vide sans explication se lit comme une panne. On dit
    // laquelle des deux situations on est, selon qu'un filtre est posé.
    embed.setDescription(
      criteres.length > 0
        ? "Aucun post ne correspond à ces filtres. Essaie sans le filtre de compte, ou avec un texte plus court."
        : "L'archive ne contient aucun post.",
    );
  } else {
    embed.setDescription(resultat.lignes.map(tweet => ligneListe(tweet)).join("\n\n"));
  }
  // Le pied est posé dans les deux cas : « page 1/1 » sur une liste vide reste
  // une information, et son absence donnait deux rendus différents pour rien.
  pied(embed, { page: page, pages: pages });

  // Boutons de la trousse : mêmes glyphes, même repère de position et mêmes
  // sauts de bout de liste que sur `/azalee`, `/cpk`, `/cdn` et `/sondage`.
  const composants = rangeePagination({
    prefixe: PREFIXE_BOUTON_TWEETS,
    page,
    pages,
    identifiant: cible => encoderEtatListe({ ...etat, page: cible }),
  });
  return { embeds: [embed], components: composants };
}

/**
 * Les seules personnes autorisées à déclencher une annonce publique.
 *
 * Relevés dans `discord_members` le 13/8/2026 : `yoyo__goat` (Yoyo),
 * `inazo__` (Inazo), `koltilasko` (Kolti). On garde l'IDENTIFIANT et non le
 * pseudo : un pseudo Discord se change en un clic, un identifiant jamais.
 */
export const ANNONCEURS_AUTORISES: ReadonlySet<string> = new Set([
  "281114294152724491", // yoyo__goat
  "531549483067244566", // inazo__
  "299502648317444096", // koltilasko
]);

@Discord()
@SlashGroup({
  name: "x",
  description: "Archive des posts X récoltés par la veille : parcours et consultation",
})
@SlashGroup("x")
export class XCommand {
  @Slash({ name: "liste", description: "Parcourt l'archive des posts X, avec filtres et pages" })
  async liste(
    @SlashOption({
      name: "compte",
      description: "Compte X dont on veut les posts (sans @)",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: async (interaction: AutocompleteInteraction) => {
        try {
          const saisie = String(interaction.options.getFocused() ?? "").toLowerCase();
          const auteurs = await auteursConnus();
          await interaction.respond(
            auteurs
              .filter(a => a.toLowerCase().includes(saisie))
              .slice(0, 25)
              .map(a => ({ name: `@${a}`, value: a })),
          );
        } catch (err) {
          console.error("[x] autocomplétion des comptes :", err);
          await interaction.respond([]);
        }
      },
    })
    compte: string | undefined,
    @SlashOption({
      name: "categorie",
      description: "Catégorie du post (news, patch-note, media…)",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: async (interaction: AutocompleteInteraction) => {
        try {
          const saisie = String(interaction.options.getFocused() ?? "").toLowerCase();
          const categories = await categoriesConnues();
          await interaction.respond(
            categories
              .filter(c => c.toLowerCase().includes(saisie))
              .slice(0, 25)
              .map(c => ({ name: c, value: c })),
          );
        } catch (err) {
          console.error("[x] autocomplétion des catégories :", err);
          await interaction.respond([]);
        }
      },
    })
    categorie: string | undefined,
    @SlashOption({
      name: "recherche",
      description: "Texte à chercher (dans l'original ET dans la traduction)",
      type: ApplicationCommandOptionType.String,
      required: false,
    })
    recherche: string | undefined,
    @SlashOption({
      name: "page",
      description: "Numéro de page",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
    })
    page: number | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      await interaction.editReply(
        await rendrePage({
          page: page ?? 1,
          auteur: compte ?? null,
          categorie: categorie ?? null,
          recherche: recherche ?? null,
        }),
      );
    } catch (err) {
      await repondreErreur(interaction, "liste", err);
    }
  }

  /**
   * Boutons de pagination. Tout l'état tient dans le `customId` : aucune
   * mémoire de processus à conserver, donc un redémarrage du bot ne laisse
   * jamais de boutons morts.
   */
  @ButtonComponent({ id: /^tw\|/ })
  async paginer(interaction: ButtonInteraction) {
    const etat = decoderEtatListe(interaction.customId);
    if (!etat) {
      await interaction.reply({
        content: "Pagination illisible — relance `/x liste`.",
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    await interaction.deferUpdate();
    try {
      await interaction.editReply(await rendrePage(etat));
    } catch (err) {
      console.error("[x] pagination :", err);
      await interaction.followUp({
        content: "❌ L'archive des posts est momentanément illisible. Réessaie dans un instant.",
        flags: MessageFlags.Ephemeral,
      });
    }
  }

  @Slash({ name: "voir", description: "Affiche un post archivé : images, traduction et portée" })
  async voir(
    @SlashOption({
      name: "post",
      description: "Identifiant du post X, ou quelques mots pour le retrouver",
      type: ApplicationCommandOptionType.String,
      required: true,
      autocomplete: async (interaction: AutocompleteInteraction) => {
        // Personne ne connaît un identifiant X par cœur : la saisie sert de
        // recherche, et la valeur renvoyée est l'identifiant exact.
        try {
          const saisie = String(interaction.options.getFocused() ?? "").trim();
          const resultat = await listerTweets({
            recherche: saisie.length >= 2 ? saisie : null,
            page: 1,
            parPage: 10,
          });
          await interaction.respond(
            resultat.lignes.map(tweet => {
              const auteur = tweet.author_username ? `@${tweet.author_username}` : "compte inconnu";
              const extrait = texteSansLienMedia(tweet.translation) || texteSansLienMedia(tweet.text);
              // 100 caractères est la borne DURE d'un libellé de proposition.
              return {
                name: couper(`${auteur} · ${extrait || "(sans texte)"}`, 100),
                value: tweet.id,
              };
            }),
          );
        } catch (err) {
          console.error("[x] autocomplétion des posts :", err);
          await interaction.respond([]);
        }
      },
    })
    post: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await interaction.deferReply();
    try {
      const identifiant = post.trim();
      const tweet = await lireTweet(identifiant);
      if (!tweet) {
        await interaction.editReply({
          content:
            `Aucun post archivé sous l'identifiant \`${truncate(identifiant, 40)}\`. ` +
            "Passe par la liste de suggestions, ou par `/x liste` pour retrouver le post.",
        });
        return;
      }

      const auteur = tweet.author_username ? `@${tweet.author_username}` : "Post X";
      const images = imagesTweet(tweet.media);
      // 126 posts de l'archive n'ont pour tout texte que leur `https://t.co/…`,
      // que `texteSansLienMedia` retire : `corpsTweet` rend alors la chaîne
      // vide, et `setDescription("")` LÈVE (discord.js exige au moins un
      // caractère). Sans ce repli, `/x voir` répondait « archive illisible »
      // sur des posts parfaitement lisibles, image comprise.
      const corps = corpsTweet(tweet, 1_500);
      const description =
        corps.length > 0
          ? corps
          : images.length > 0
            ? `*Ce post n'a pas de texte : il ne porte que ${images.length > 1 ? "ses images" : "son image"}.*`
            : "*Ce post n'a pas de texte.*";
      const embed = rgEmbed()
        .setTitle(truncate(tweet.author_name ? `${tweet.author_name} (${auteur})` : auteur, 256))
        .setURL(urlTweet(tweet))
        .setDescription(description);

      if (images[0]) {
        embed.setImage(images[0].url);
      }
      const metriques = formaterMetriques(tweet.metrics);
      if (metriques) {
        embed.addFields({ name: "Portée", value: truncate(metriques, 1_024) });
      }
      embed.addFields({ name: "Publié", value: horodatageDiscord(tweet), inline: true });
      if (tweet.category) {
        embed.addFields({
          name: "Catégorie",
          value: truncate(tweet.category, 1_024),
          inline: true,
        });
      }
      if (tweet.is_thread) {
        embed.addFields({
          name: "Fil",
          value: `${tweet.tweet_count ?? 1} post${(tweet.tweet_count ?? 1) > 1 ? "s" : ""}`,
          inline: true,
        });
      }

      // Un post porte jusqu'à 4 photos et n'en montrer qu'une perdait le reste.
      // Discord agrège en une galerie les embeds qui partagent la même `url` :
      // les compagnons ne portent donc QUE l'url et l'image — leur donner un
      // pied ou une couleur afficherait des doublons si l'agrégation n'a pas
      // lieu (client trop ancien).
      const compagnons = images
        .slice(1, MAX_IMAGES)
        .map(image => new EmbedBuilder().setURL(urlTweet(tweet)).setImage(image.url));
      if (images.length > MAX_IMAGES) {
        embed.addFields({
          name: "Images",
          value: `${MAX_IMAGES} affichées sur ${images.length} — les autres sont sur [le post d'origine](${urlTweet(tweet)}).`,
        });
      }

      await interaction.editReply({ embeds: [embed, ...compagnons] });
    } catch (err) {
      await repondreErreur(interaction, "voir", err);
    }
  }

  /**
   * `/x annoncer` — récolte le DERNIER post et le publie tout de suite.
   *
   * La veille horaire (`rg-cron`, tâche `x`) suffit au quotidien ; cette
   * commande sert quand on ne veut pas l'attendre : elle interroge X EN DIRECT
   * par le pont cron (verbe `x.posts`, un seul post), puis publie dans le salon
   * d'annonce du profil.
   *
   * Le message suit le motif du salon À LA LETTRE, et c'est tout l'intérêt :
   * une amorce suivie de l'URL `fixvx.com` — c'est Discord qui déplie alors
   * l'aperçu complet (texte intégral, image en pleine résolution, auteur) —
   * puis le ping du rôle en SPOILER, dans un message séparé. Un embed fabriqué
   * ici afficherait moins que ce que le miroir sait montrer.
   *
   * Réservée au staff : elle écrit dans un salon public.
   */
  @Slash({
    name: "annoncer",
    description: "Récolter le dernier post d'un compte et l'annoncer maintenant (réservé)",
  })
  async annoncer(
    @SlashOption({
      name: "compte",
      description: "Compte X à récolter (défaut : Azalee_IE)",
      type: ApplicationCommandOptionType.String,
      required: false,
      maxLength: 15,
    })
    compte: string | undefined,
    interaction: ChatInputCommandInteraction,
  ): Promise<void> {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    // Liste NOMINATIVE, en plus du rôle Rose Griffon : cette commande publie
    // dans un salon public et mentionne un rôle — c'est-à-dire qu'elle notifie
    // tout le serveur. Un rôle « admin » se donne et se retire au fil de l'eau ;
    // ici on veut exactement trois personnes, et qu'un quatrième administrateur
    // nommé demain n'en hérite pas sans décision explicite.
    if (!ANNONCEURS_AUTORISES.has(interaction.user.id)) {
      await interaction.editReply({
        content: "⛔ Cette commande est réservée à Yoyo, Inazo et Kolti.",
      });
      return;
    }
    try {
      await requireRgAdmin(interaction.user.id);
    } catch (err) {
      await interaction.editReply({
        content: err instanceof NotAdminError ? `⛔ ${err.message}` : "⛔ Droits insuffisants.",
      });
      return;
    }

    const annonce = PROFIL_ANNONCEUR.annoncePosts;
    if (!annonce || annonce.salon.length === 0) {
      await interaction.editReply({
        content: "Ce bot n'a pas de salon d'annonce dans son registre de profils : il n'y a nulle part où publier.",
      });
      return;
    }

    const pseudo = (compte ?? "Azalee_IE").trim().replace(/^@/, "");

    try {
      // Un seul post : la veille a déjà l'archive, et X limite le débit.
      const reponse = await appelerCron<{
        success: boolean;
        error?: string;
        posts?: Array<{ id: string; texte?: string; date?: string; url?: string }>;
      }>({ cmd: "x.posts", pseudo, limite: 1 }, { timeoutMs: 50_000 });

      if (!reponse.success) {
        await interaction.editReply({
          content: `La récolte a échoué : ${truncate(reponse.error ?? "raison inconnue", 300)}`,
        });
        return;
      }

      const post = reponse.posts?.[0];
      if (!post) {
        await interaction.editReply({ content: `Aucun post trouvé pour @${pseudo}.` });
        return;
      }

      const { salon, raison } = await resoudreSalon(interaction.client, annonce.salon);
      if (!salon) {
        await interaction.editReply({
          content: `Salon d'annonce \`${annonce.salon}\` injoignable : ${raison ?? "le bot doit y voir et y écrire"}.`,
        });
        return;
      }

      // Le DERNIER post d'un compte est souvent un retweet ou une réponse : la
      // commande le prendrait tel quel et l'annoncerait au serveur entier,
      // ping du rôle compris. Même règle que la veille automatique, même
      // fonction — jamais une seconde copie qui divergerait.
      if (!estAnnoncable(post.texte)) {
        await interaction.editReply({
          content: `Le dernier post de @${pseudo} est ${estRetweet(post.texte) ? "un retweet" : "une réponse"} : il n'a pas sa place dans un salon d'annonces. Rien n'a été publié.`,
        });
        return;
      }

      const ligne = { id: post.id, author_username: pseudo, text: post.texte ?? "" } as LigneTweet;
      await salon.send({ content: messageAnnonce(ligne) });
      if (annonce.roleMention) {
        await salon.send({
          content: messagePing(annonce.roleMention),
          allowedMentions: { roles: [annonce.roleMention] },
        });
      }

      await interaction.editReply({
        content: `✅ Post \`${post.id}\` de @${pseudo} annoncé dans <#${annonce.salon}>${annonce.roleMention ? " avec le ping du rôle" : ""}.`,
      });
    } catch (err) {
      await repondreErreur(interaction, "annoncer", err);
    }
  }
}
