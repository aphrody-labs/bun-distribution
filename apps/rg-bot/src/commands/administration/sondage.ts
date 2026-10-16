/**
 * `/gestion sondage` — publier et clore un sondage, depuis Discord.
 *
 * ── POURQUOI LE SONDAGE NATIF, ET PAS UN SONDAGE À BOUTONS ─────────────────
 * Un sondage « maison » se construit en dix minutes : des boutons, une table de
 * votes, un décompte. C'est exactement ce qu'il ne faut PAS faire ici. Compter
 * les voix nous-mêmes, c'est écrire QUI a voté QUOI dans notre base — la seule
 * chose que la ligne rouge de ce dépôt interdit (cf. l'en-tête de
 * `lib/sondage-format.ts` et le test de non-dérive qui l'accompagne). Le
 * sondage NATIF de Discord tient ce registre à notre place et ne nous rend que
 * des totaux : la garantie de confidentialité ne repose plus sur notre
 * discipline, mais sur le fait que la donnée nominative n'entre jamais chez
 * nous.
 *
 * ── ET L'ARCHIVE DU SITE ARRIVE TOUTE SEULE ────────────────────────────────
 * `packages/cron/src/tasks/discord-polls.ts` balaye les salons marqués
 * `discord_channels.suivi = true` et sait déjà lire un sondage natif
 * (`parseSondageNatif`) : le sondage publié ici apparaît sur
 * `rosegriffon.fr/sondages` au passage suivant du cron, sans une ligne de code
 * de plus. C'est aussi pourquoi `creer` PRÉVIENT quand le salon visé n'est pas
 * suivi : le sondage fonctionnera parfaitement sur Discord, mais il ne sera
 * jamais archivé, et personne ne s'en apercevrait avant des semaines.
 *
 * ── CE QUI EST REFUSÉ EST REFUSÉ AVANT L'ENVOI ─────────────────────────────
 * Toute la validation vit dans `lib/sondage-creation.ts`, module pur et testé.
 * Les limites de l'API (10 choix, 300 caractères de question, 55 par choix,
 * 1 h à 768 h) y sont écrites une fois ; les dépasser fait répondre `Invalid
 * Form Body` à l'API, un message qui ne dit ni quel champ ni quelle borne.
 * On rend donc TOUS les refus d'un coup, en nommant la valeur fautive.
 */
import { Discord, Slash, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  ChannelType,
  PollLayoutType,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
  type Message,
  type PollData,
} from "discord.js";

import { logAdminAction } from "../../lib/audit";
import { sql } from "../../lib/db";
import {
  clotureDe,
  libelleRegleDeVote,
  LIMITES_SONDAGE,
  preparerSondage,
  referenceMessage,
  type ChoixSondage,
  type ProjetSondage,
} from "../../lib/sondage-creation";
import { attention, echec, fiche, leJour, piedDeCommande, repondre } from "../../lib/ui";
import { differerEnPrive, exigerDroits, messagePanne } from "../staff/garde";
import "./racine-gestion";

/** Salons où un sondage peut être posté — ceux où un message peut l'être. */
const SALONS_ACCEPTES = [
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.PublicThread,
  ChannelType.PrivateThread,
  ChannelType.AnnouncementThread,
] as const;

/**
 * Le salon visé est-il archivé vers le site ?
 *
 * `discord_channels.suivi` est la SEULE porte d'entrée de l'archive : le cron
 * ne regarde aucun autre salon. Une valeur absente veut dire « salon inconnu de
 * la base » — c'est-à-dire non suivi, avec en plus une synchronisation de
 * salons en retard.
 */
async function salonSuivi(salonId: string): Promise<boolean> {
  const lignes = await sql<Array<{ suivi: boolean | null }>>`
		SELECT suivi FROM discord_channels WHERE channel_id = ${salonId} LIMIT 1
	`;
  return lignes[0]?.suivi === true;
}

/** Un choix, tel que l'API des sondages l'attend. */
function choixNatif(choix: ChoixSondage): PollData["answers"][number] {
  return choix.emoji ? { emoji: choix.emoji.id ?? choix.emoji.name, text: choix.texte } : { text: choix.texte };
}

/**
 * Le projet, traduit pour `channel.send({ poll })`.
 *
 * `duration` est en HEURES (et non en millisecondes, comme le laisserait croire
 * le reste de discord.js). `layoutType` n'a qu'une valeur possible à ce jour ;
 * la poser explicitement évite d'hériter d'un défaut si l'API en ajoute une.
 */
function sondageNatif(projet: ProjetSondage): PollData {
  return {
    allowMultiselect: projet.multiple,
    answers: projet.choix.map(choixNatif),
    duration: projet.duree.heures,
    layoutType: PollLayoutType.Default,
    question: { text: projet.question },
  };
}

/** Récapitulatif privé de ce qui vient d'être publié. */
function recapitulatif(
  interaction: ChatInputCommandInteraction,
  projet: ProjetSondage,
  message: Message,
  avertissements: string[],
  archive: boolean,
) {
  const carte = fiche({
    description: projet.question,
    icone: "sondage",
    intention: "succes",
    titre: "Sondage publié",
    url: message.url,
  });
  carte.champ(
    "Choix",
    projet.choix.map((choix, rang) => `**${rang + 1}.** ${choix.emojiTexte ?? ""} ${choix.texte}`.trim()).join("\n"),
  );
  carte.champ("Clôture", leJour(clotureDe(projet), "F"), { enLigne: true });
  carte.champ("Vote", libelleRegleDeVote(projet), { enLigne: true });
  carte.champ(
    "Archive du site",
    archive
      ? "Ce salon est suivi : le sondage rejoindra `rosegriffon.fr/sondages` au prochain passage du cron."
      : "⚠️ Ce salon **n'est pas suivi** (`discord_channels.suivi`). Le sondage marchera sur Discord " +
          "mais ne sera **jamais archivé** sur le site.",
  );
  if (avertissements.length > 0) {
    carte.champ("Ajustements", avertissements.map(texte => `- ${texte}`).join("\n"));
  }
  return piedDeCommande(carte.embed, interaction);
}

@Discord()
@SlashGroup({
  description: "Publier et clore les sondages du serveur",
  name: "sondage",
  root: "gestion",
})
@SlashGroup("sondage", "gestion")
export class GestionSondageCommand {
  @Slash({
    description: "Publier un sondage natif Discord (archivé ensuite sur le site)",
    name: "creer",
  })
  async creer(
    @SlashOption({
      description: "La question posée, telle qu'elle s'affichera",
      maxLength: LIMITES_SONDAGE.longueurQuestion,
      minLength: 1,
      name: "question",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    question: string,
    @SlashOption({
      description: "Les choix, séparés par « ; » — un emoji en tête devient l'emoji du choix",
      minLength: 1,
      name: "choix",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    choix: string,
    @SlashOption({
      description: "Durée : 12h, 3j, 1 semaine… (24 h par défaut, 32 jours au maximum)",
      name: "duree",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    duree: string | undefined,
    @SlashOption({
      description: "Autoriser plusieurs choix par personne (un seul par défaut)",
      name: "multiple",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    multiple: boolean | undefined,
    @SlashOption({
      channelTypes: [...SALONS_ACCEPTES],
      description: "Où publier (le salon courant par défaut)",
      name: "salon",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    })
    salon: GuildTextBasedChannel | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }

    const preparation = preparerSondage({ choix, duree, multiple, question });
    if (!preparation.ok) {
      await repondre(interaction, echec("Sondage refusé", preparation.erreurs.map(erreur => `- ${erreur}`).join("\n")));
      return;
    }

    // `interaction.channel` peut être `null` quand la commande est lancée
    // depuis un salon que le bot ne voit pas en cache ; on le dit plutôt que
    // de laisser un `Cannot read properties of null`.
    const cible = salon ?? (interaction.channel as GuildTextBasedChannel | null);
    if (!cible || !("send" in cible)) {
      await repondre(
        interaction,
        echec(
          "Salon indéterminé",
          "Relance la commande en précisant l'option `salon` : le salon courant n'est pas exploitable ici.",
        ),
      );
      return;
    }

    try {
      const message = await cible.send({ poll: sondageNatif(preparation.projet) });
      const archive = await salonSuivi(cible.id).catch(() => false);

      await logAdminAction({
        action: "sondage.creer",
        adminId: admin.profileId,
        details: {
          choix: preparation.projet.choix.length,
          duree_heures: preparation.projet.duree.heures,
          multiple: preparation.projet.multiple,
          salon: cible.id,
        },
        discordId: interaction.user.id,
        targetId: message.id,
        targetType: "discord_poll",
      });

      await interaction.editReply({
        embeds: [recapitulatif(interaction, preparation.projet, message, preparation.avertissements, archive)],
      });
    } catch (err) {
      await repondre(
        interaction,
        echec(
          "Publication impossible",
          `${messagePanne(err)}\nVérifie que le bot peut écrire dans ${cible.toString()} ` +
            "(permission « Envoyer des messages », et « Créer des sondages » pour ce salon).",
        ),
      );
    }
  }

  @Slash({
    description: "Arrêter un sondage avant sa fin et publier ses résultats",
    name: "cloturer",
  })
  async cloturer(
    @SlashOption({
      description: "Lien du message du sondage (clic droit → Copier le lien) ou son identifiant",
      name: "message",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    messageBrut: string,
    @SlashOption({
      channelTypes: [...SALONS_ACCEPTES],
      description: "Salon du sondage — inutile si tu colles le lien du message",
      name: "salon",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    })
    salon: GuildTextBasedChannel | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }

    const reference = referenceMessage(messageBrut);
    if (!reference) {
      await repondre(
        interaction,
        echec(
          "Message introuvable",
          "Colle le **lien** du message (clic droit sur le sondage → « Copier le lien du message ») " +
            "ou son identifiant numérique.",
        ),
      );
      return;
    }

    // Le lien porte son propre salon et l'emporte : il désigne le message sans
    // ambiguïté, là où l'option `salon` peut être restée sur une valeur d'un
    // appel précédent.
    const salonId = reference.salonId ?? salon?.id ?? interaction.channelId;
    try {
      const cible = await interaction.client.channels.fetch(salonId);
      if (!cible || !cible.isTextBased()) {
        await repondre(
          interaction,
          echec("Salon illisible", "Ce salon n'est pas un salon textuel, ou le bot n'y a pas accès."),
        );
        return;
      }

      const message = await cible.messages.fetch(reference.messageId);
      if (!message.poll) {
        await repondre(
          interaction,
          echec(
            "Ce message n'est pas un sondage",
            "Seuls les sondages **natifs** se clôturent ainsi. Un sondage EasyPoll se clôt depuis EasyPoll.",
          ),
        );
        return;
      }
      if (message.poll.resultsFinalized) {
        await repondre(
          interaction,
          attention(
            "Sondage déjà clos",
            `Ses résultats sont définitifs depuis ${leJour(message.poll.expiresAt, "R")}.`,
            { prive: true },
          ),
        );
        return;
      }
      if (message.author.id !== interaction.client.user?.id) {
        // L'API n'autorise QUE l'auteur du sondage à le clore. Le dire ici évite
        // un `Missing Permissions` illisible.
        await repondre(
          interaction,
          echec(
            "Sondage d'un autre auteur",
            `Discord ne laisse clore un sondage qu'à celui qui l'a publié — ici ${message.author.tag}. ` +
              "Ce bot ne peut clore que **ses propres** sondages.",
          ),
        );
        return;
      }

      await message.poll.end();

      await logAdminAction({
        action: "sondage.cloturer",
        adminId: admin.profileId,
        details: { salon: salonId },
        discordId: interaction.user.id,
        targetId: reference.messageId,
        targetType: "discord_poll",
      });

      const carte = fiche({
        description:
          "Les votes sont clos et les résultats sont définitifs. " +
          "L'archive du site les reprendra au prochain passage du cron.",
        icone: "sondage",
        intention: "succes",
        titre: "Sondage clos",
        url: message.url,
      });
      await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
    } catch (err) {
      await repondre(
        interaction,
        echec(
          "Clôture impossible",
          `${messagePanne(err)}\nVérifie que le message existe encore et que le bot voit ce salon.`,
        ),
      );
    }
  }
}
