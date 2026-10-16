/**
 * `/administration veille regler` — le pilotage de la notification des nouveaux
 * posts X, sans redéploiement.
 *
 * ── LA COUPURE AVEC `/staff veille` ────────────────────────────────────────
 * `/staff veille suivi` DIT l'état (filtre, curseur, salon réellement
 * joignable) ; cette commande-ci le CHANGE. Le réglage vit dans
 * `settings['tweets.notification']` (`lib/tweets-format.ts` pour sa forme,
 * `services/tweets.ts` pour sa lecture et son écriture), et le drain le relit
 * toutes les 30 secondes au plus : un changement fait effet sans redémarrer le
 * bot.
 *
 * ── TROIS DÉFAUTS RÉELS CORRIGÉS PAR RAPPORT À `/tweets regler` ────────────
 *  1. **La liste des comptes était réécrite à chaque appel**, même en ne
 *     touchant que le salon. Deux personnes réglant à quelques secondes d'écart
 *     et le second effaçait l'ajout du premier avec la liste qu'il avait lue
 *     avant. `construirePatchVeille` (module pur, testé) ne met `comptes` dans
 *     le patch que s'il change vraiment.
 *  2. **`max` était plafonné à 10** sans fondement, alors que le seuil n'est PAS
 *     une taille de message : l'envoi détaillé repasse toujours par
 *     `decouperEnLots`, qui borne chaque message à 10 embeds et 6 000
 *     caractères. La seule borne qui ait un sens est `PLAFOND_DRAIN` (50),
 *     au-delà de laquelle un drain ne ramène de toute façon plus rien.
 *  3. **Aucun moyen de replacer le curseur.** Rallumer la notification après
 *     une coupure annonçait d'un coup tout l'arriéré de la fenêtre de
 *     rattrapage (48 h). L'option `curseur` le pose à maintenant, en
 *     échange-comparaison, donc sans jamais écraser un drain en cours.
 *
 * ── CE QUI RESTE INTOUCHABLE ───────────────────────────────────────────────
 * La catégorie `leak` est exclue EN DUR (`CATEGORIES_INTERDITES`) : aucune
 * option de cette commande ne peut la faire annoncer.
 */
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  ChannelType,
  type AutocompleteInteraction,
  type ChatInputCommandInteraction,
  type GuildBasedChannel,
} from "discord.js";

import { logAdminAction } from "../../lib/audit";
import { rgEmbed } from "../../lib/embeds";
import { CLE_REGLAGE_TWEETS, PLAFOND_DRAIN } from "../../lib/tweets-format";
import {
  CANAL_NOTIFICATION,
  auteursConnus,
  avancerCurseur,
  categoriesConnues,
  ecrireFiltreNotification,
  lireCurseur,
  lireFiltreNotification,
} from "../../services/tweets";
import { resoudreSalon } from "../../services/tweetsNotifier";
import { borner, formaterNombre, horodatageAbsolu } from "../staff/format";
import { differerEnPrive, exigerDroits, messagePanne } from "../staff/garde";
import { construirePatchVeille } from "./valeurs";
import "./racine";
import { echec, piedTexte, repondre } from "../../lib/ui";

/** Comptes X connus de l'archive — pour ne pas suivre un pseudo mal orthographié. */
async function suggererComptes(interaction: AutocompleteInteraction): Promise<void> {
  const saisie = String(interaction.options.getFocused() ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  try {
    const comptes = await auteursConnus();
    await interaction.respond(
      comptes
        .filter(compte => saisie.length === 0 || compte.toLowerCase().includes(saisie))
        .slice(0, 25)
        .map(compte => ({ name: `@${borner(compte, 98)}`, value: compte })),
    );
  } catch {
    await interaction.respond([]);
  }
}

/** Comptes actuellement suivis — la seule liste dans laquelle `retirer` a un sens. */
async function suggererComptesSuivis(interaction: AutocompleteInteraction): Promise<void> {
  const saisie = String(interaction.options.getFocused() ?? "")
    .trim()
    .replace(/^@/, "")
    .toLowerCase();
  try {
    const filtre = await lireFiltreNotification();
    await interaction.respond(
      filtre.comptes
        .filter(compte => saisie.length === 0 || compte.toLowerCase().includes(saisie))
        .slice(0, 25)
        .map(compte => ({ name: `@${borner(compte, 98)}`, value: compte })),
    );
  } catch {
    await interaction.respond([]);
  }
}

/** Catégories réellement présentes dans `tweets.category` (colonne libre). */
async function suggererCategories(interaction: AutocompleteInteraction): Promise<void> {
  const saisie = String(interaction.options.getFocused() ?? "")
    .trim()
    .toLowerCase();
  try {
    const categories = await categoriesConnues();
    await interaction.respond(
      categories
        .filter(categorie => saisie.length === 0 || categorie.toLowerCase().includes(saisie))
        .slice(0, 25)
        .map(categorie => ({ name: borner(categorie, 100), value: categorie })),
    );
  } catch {
    await interaction.respond([]);
  }
}

@Discord()
@SlashGroup({
  name: "veille",
  description: "Réglage de la notification des nouveaux posts X",
  root: "administration",
})
@SlashGroup("veille", "administration")
export class AdministrationVeilleCommand {
  @Slash({
    name: "regler",
    description: "Change la notification des posts X : salon, comptes, filtre, curseur (rôle admin)",
  })
  async regler(
    @SlashOption({
      name: "actif",
      description: "Allume ou coupe la notification",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    actif: boolean | undefined,
    @SlashOption({
      name: "salon",
      description: "Salon de destination des annonces",
      type: ApplicationCommandOptionType.Channel,
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      required: false,
    })
    salon: GuildBasedChannel | undefined,
    @SlashOption({
      name: "max",
      description: "Posts détaillés au maximum par lot ; au-delà, un embed de synthèse (1 à 50)",
      type: ApplicationCommandOptionType.Integer,
      required: false,
      minValue: 1,
      maxValue: PLAFOND_DRAIN,
    })
    max: number | undefined,
    @SlashOption({
      name: "ajouter",
      description: "Compte X à suivre",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: suggererComptes,
    })
    ajouter: string | undefined,
    @SlashOption({
      name: "retirer",
      description: "Compte X à ne plus suivre",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: suggererComptesSuivis,
    })
    retirer: string | undefined,
    @SlashOption({
      name: "exclure",
      description: "Catégorie à ne plus annoncer",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: suggererCategories,
    })
    exclure: string | undefined,
    @SlashOption({
      name: "inclure",
      description: "Catégorie à annoncer de nouveau",
      type: ApplicationCommandOptionType.String,
      required: false,
      autocomplete: suggererCategories,
    })
    inclure: string | undefined,
    @SlashOption({
      name: "curseur",
      description: "Replace le curseur à maintenant : l'arriéré ne sera pas annoncé",
      type: ApplicationCommandOptionType.Boolean,
      required: false,
    })
    curseur: boolean | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction, { strict: true });
    if (!admin) {
      return;
    }

    try {
      const avant = await lireFiltreNotification();

      // Le salon se vérifie AVANT d'enregistrer : accepter un salon que le bot
      // ne voit pas, c'est promettre une notification qui n'arrivera jamais et
      // qui ne se signalera que dans le journal du service. Le cas est réel —
      // `50001 Missing Access` quand le rôle du bot n'a pas « Voir le salon ».
      if (salon) {
        const { salon: joignable, raison } = await resoudreSalon(interaction.client, salon.id);
        if (!joignable) {
          await repondre(
            interaction,
            echec("Rien n'a été fait", `Rien n'a été enregistré. ${borner(raison ?? "Salon injoignable.", 1_500)}`),
          );
          return;
        }
      }

      const { patch, changements } = construirePatchVeille(avant, {
        actif,
        salon: salon?.id,
        maxParLot: max,
        ajouter,
        retirer,
        exclure,
        inclure,
      });

      // ── Curseur ──────────────────────────────────────────────────────────
      // Traité à part du réglage : il vit dans une autre table
      // (`tweet_notification_curseurs`) et son avancement est un
      // échange-comparaison, pas un simple `UPDATE`.
      let ligneCurseur: string | null = null;
      let curseurDeplace = false;
      if (curseur === true) {
        const position = await lireCurseur();
        if (!position) {
          ligneCurseur = "Aucun curseur en base : il sera créé à `now()` au premier drain, sans rejouer l'archive.";
        } else {
          const maintenant = new Date();
          const avance = await avancerCurseur(
            CANAL_NOTIFICATION,
            position.curseurLe,
            maintenant,
            position.dernierTweetId,
            0,
          );
          ligneCurseur = avance
            ? `Curseur replacé : ${horodatageAbsolu(position.curseurLe)} → ${horodatageAbsolu(maintenant)} — l'arriéré ne sera pas annoncé.`
            : "⚠ Curseur inchangé : un drain l'a déplacé pendant la commande. Relance si besoin.";
          curseurDeplace = avance;
          if (avance) {
            changements.push("Curseur replacé à maintenant");
          }
        }
      }

      if (changements.length === 0 && ligneCurseur === null) {
        await interaction.editReply({
          content:
            "Aucune modification : les valeurs demandées sont déjà celles en place. " +
            "L'état complet se lit avec `/staff veille suivi`.",
        });
        return;
      }

      let apres = avant;
      if (Object.keys(patch).length > 0) {
        await logAdminAction({
          adminId: admin.profileId,
          discordId: admin.discordId,
          action: "veille.regler",
          targetType: "settings",
          targetId: CLE_REGLAGE_TWEETS,
          details: { avant, patch, changements },
        });
        apres = await ecrireFiltreNotification(patch);
      } else if (curseurDeplace) {
        // Uniquement si le curseur a VRAIMENT bougé : un journal d'audit qui
        // consigne des actions sans effet cesse d'être une preuve.
        await logAdminAction({
          adminId: admin.profileId,
          discordId: admin.discordId,
          action: "veille.curseur",
          targetType: "tweet_notification_curseurs",
          targetId: CANAL_NOTIFICATION,
          details: { detail: ligneCurseur },
        });
      }

      const salonEffectif = apres.salon ?? Bun.env.DISCORD_NEWS_CHANNEL_ID ?? null;
      // `changements` peut être VIDE alors qu'on arrive ici : c'est le cas quand
      // seul `curseur:true` a été demandé et que le curseur n'a pas bougé (aucune
      // ligne en base, ou un drain l'a déplacé entre-temps). Une description
      // d'embed vide est refusée par l'API Discord — l'envoi entier échouerait,
      // et la personne verrait une panne au lieu d'une explication.
      const resume =
        changements.length > 0
          ? changements.map(ligne => `• ${ligne}`).join("\n")
          : "Aucun champ du réglage n'a changé — voir le curseur ci-dessous.";
      const embed = rgEmbed()
        .setTitle(changements.length > 0 ? "Notification X — réglage mis à jour" : "Notification X — réglage inchangé")
        // Borné à 1 500 et non 4 000 : le total d'un embed est plafonné à 6 000
        // par Discord, et deux champs de 1 000 suivent.
        .setDescription(borner(resume, 1_500))
        .addFields({
          name: "État après",
          value: borner(
            [
              `Notification : **${apres.actif ? "active" : "coupée"}**`,
              `Comptes suivis (${formaterNombre(apres.comptes.length)}) : ${
                apres.comptes.length > 0
                  ? borner(apres.comptes.map(compte => `@${compte}`).join(", "), 700)
                  : "*aucun* — rien ne sera annoncé"
              }`,
              `Catégories exclues : ${
                apres.categories_exclues.length > 0 ? apres.categories_exclues.join(", ") : "*aucune*"
              } (+ leak, exclu en dur)`,
              `Seuil de détail : **${apres.max_par_lot}** posts par lot`,
              salonEffectif
                ? `Salon : <#${salonEffectif}> (\`${salonEffectif}\`)`
                : "Salon : **aucun** — ni réglage, ni `DISCORD_NEWS_CHANNEL_ID`",
            ].join("\n"),
            1_000,
          ),
        })
        .setFooter(piedTexte({ note: "État complet et curseur : /staff veille suivi" }));

      if (ligneCurseur !== null) {
        embed.addFields({ name: "Curseur", value: borner(ligneCurseur, 1_000) });
      }
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }
}
