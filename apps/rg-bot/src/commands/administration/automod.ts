/**
 * `/moderation automod` — l'auto-modération, celle de Discord.
 *
 * ── POURQUOI ON N'ÉCRIT PAS NOTRE PROPRE FILTRE ────────────────────────────
 * Un filtre maison lirait le contenu des messages. Ces applications n'ont PAS
 * l'intent privilégié `MessageContent` — et ne le demanderont pas : c'est la
 * garantie qui permet d'écrire, dans `docs/bot-communaute.md`, qu'on compte les
 * messages sans jamais les lire. Un filtre maison exigerait de renoncer à ça
 * pour un résultat inférieur.
 *
 * L'**AutoMod de Discord** fait le travail mieux, et ailleurs :
 *
 *   - il s'exécute **avant publication**, côté serveur : un message bloqué n'a
 *     jamais existé, là où un filtre maison le supprime après coup — donc après
 *     que tout le monde l'a vu ;
 *   - il ne consomme aucun intent, aucune bande passante, aucune latence ;
 *   - ses jeux de mots-clés (grossièretés, contenu sexuel, insultes) sont
 *     maintenus par Discord dans toutes les langues, ce qu'aucune liste écrite
 *     à la main ne suit.
 *
 * Ce fichier ne filtre donc rien : il **configure** les règles de Discord, et
 * il rend visible depuis Discord ce qui autrement se règle dans les paramètres
 * du serveur, sans trace ni journal.
 *
 * ── LA LIMITE À CONNAÎTRE ──────────────────────────────────────────────────
 * Discord plafonne les règles par type et par serveur : 6 règles à mots-clés,
 * **1** anti-spam, **1** jeu de mots-clés prédéfinis, **1** anti-mention. Créer
 * une deuxième règle du même type échoue avec un message que l'API ne rend pas
 * lisible ; on lit donc l'existant avant d'écrire, et on MET À JOUR plutôt que
 * de créer.
 */
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  AutoModerationActionType,
  AutoModerationRuleEventType,
  AutoModerationRuleKeywordPresetType,
  AutoModerationRuleTriggerType,
  ChannelType,
  PermissionFlagsBits,
  type AutoModerationRule,
  type ChatInputCommandInteraction,
  type Guild,
  type GuildTextBasedChannel,
} from "discord.js";

import { logAdminAction } from "../../lib/audit";
import { attention, echec, fiche, piedDeCommande, repondre, succes } from "../../lib/ui";
import { differerEnPrive, exigerDroits, messagePanne } from "../staff/garde";
import "./racine-moderation";

/** Préfixe de nos règles, pour les distinguer de celles posées à la main. */
const PREFIXE = "RG —";

/** Libellés français des déclencheurs, pour l'affichage de l'état. */
const LIBELLES_DECLENCHEUR: Readonly<Record<number, string>> = Object.freeze({
  [AutoModerationRuleTriggerType.Keyword]: "Mots-clés personnalisés",
  [AutoModerationRuleTriggerType.KeywordPreset]: "Jeux de mots-clés de Discord",
  [AutoModerationRuleTriggerType.MentionSpam]: "Mentions en masse",
  [AutoModerationRuleTriggerType.Spam]: "Spam générique",
});

/**
 * Le bot peut-il gérer l'AutoMod ici ?
 *
 * `ManageGuild` est la permission exigée par l'API pour lire ET écrire les
 * règles. Le dire avant d'essayer évite un `Missing Permissions` opaque.
 */
function manquePermission(guilde: Guild): string | null {
  const moi = guilde.members.me;
  if (!moi) {
    return "Le bot n'est pas résolu comme membre de ce serveur.";
  }
  return moi.permissions.has(PermissionFlagsBits.ManageGuild)
    ? null
    : "Le bot n'a pas « Gérer le serveur » : l'API d'auto-modération lui est fermée.";
}

/** Les règles existantes, à jour (le cache peut être vide au démarrage). */
async function reglesDe(guilde: Guild): Promise<AutoModerationRule[]> {
  const collection = await guilde.autoModerationRules.fetch();
  return [...collection.values()];
}

/** La règle d'un type donné, `null` si elle n'existe pas encore. */
function regleDuType(
  regles: readonly AutoModerationRule[],
  type: AutoModerationRuleTriggerType,
): AutoModerationRule | null {
  return regles.find(regle => regle.triggerType === type) ?? null;
}

@Discord()
@SlashGroup({
  description: "Auto-modération native de Discord : spam, mentions, mots-clés",
  name: "automod",
  root: "moderation",
})
@SlashGroup("automod", "moderation")
export class ModerationAutomodCommand {
  @Slash({ description: "L'état des règles d'auto-modération du serveur", name: "etat" })
  async etat(interaction: ChatInputCommandInteraction) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    if (!interaction.guild) {
      await repondre(interaction, echec("Hors serveur", "L'auto-modération se règle sur un serveur."));
      return;
    }
    const manque = manquePermission(interaction.guild);
    if (manque) {
      await repondre(interaction, echec("Permission manquante", manque));
      return;
    }
    try {
      const regles = await reglesDe(interaction.guild);
      const carte = fiche({
        description:
          regles.length === 0
            ? "Aucune règle d'auto-modération. Discord ne filtre rien pour l'instant."
            : `${regles.length} règle(s) actives — appliquées par Discord AVANT publication.`,
        icone: "service",
        intention: regles.length === 0 ? "attention" : "marque",
        titre: "Auto-modération",
      });
      for (const regle of regles) {
        const actions = regle.actions
          .map(action =>
            action.type === AutoModerationActionType.BlockMessage
              ? "bloque le message"
              : action.type === AutoModerationActionType.SendAlertMessage
                ? // `channelId` à la LECTURE, `channel` à l'écriture : les deux
                  // formes ne portent pas le même nom dans discord.js.
                  `alerte <#${action.metadata.channelId ?? "?"}>`
                : "exclusion temporaire",
          )
          .join(" · ");
        carte.champ(
          `${regle.enabled ? "🟢" : "⚪"} ${regle.name}`,
          [
            LIBELLES_DECLENCHEUR[regle.triggerType] ?? `type ${regle.triggerType}`,
            actions || "aucune action",
            regle.exemptRoles.size > 0 ? `${regle.exemptRoles.size} rôle(s) exemptés` : "aucune exemption de rôle",
          ].join("\n"),
        );
      }
      await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
    } catch (err) {
      await repondre(interaction, echec("État illisible", messagePanne(err)));
    }
  }

  @Slash({
    description: "Bloquer les mentions en masse (raids, pings de masse)",
    name: "mentions",
  })
  async mentions(
    @SlashOption({
      description: "Nombre de mentions à partir duquel le message est bloqué (5 à 50)",
      maxValue: 50,
      minValue: 5,
      name: "maximum",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    maximum: number,
    @SlashOption({
      channelTypes: [ChannelType.GuildText],
      description: "Salon où prévenir le staff (facultatif)",
      name: "alerte",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    })
    alerte: GuildTextBasedChannel | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await this.poser(interaction, {
      action: "automod.mentions",
      alerte,
      construire: () => ({
        actions: [
          { type: AutoModerationActionType.BlockMessage },
          ...(alerte
            ? [
                {
                  metadata: { channel: alerte.id },
                  type: AutoModerationActionType.SendAlertMessage,
                },
              ]
            : []),
        ],
        enabled: true,
        eventType: AutoModerationRuleEventType.MessageSend,
        name: `${PREFIXE} mentions en masse`,
        triggerMetadata: { mentionTotalLimit: maximum },
        triggerType: AutoModerationRuleTriggerType.MentionSpam,
      }),
      details: { maximum },
      reussite: `Un message contenant plus de ${maximum} mentions sera bloqué avant publication.`,
      type: AutoModerationRuleTriggerType.MentionSpam,
    });
  }

  @Slash({ description: "Activer le filtre anti-spam de Discord", name: "spam" })
  async spam(
    @SlashOption({
      channelTypes: [ChannelType.GuildText],
      description: "Salon où prévenir le staff (facultatif)",
      name: "alerte",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    })
    alerte: GuildTextBasedChannel | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await this.poser(interaction, {
      action: "automod.spam",
      alerte,
      construire: () => ({
        actions: [
          { type: AutoModerationActionType.BlockMessage },
          ...(alerte
            ? [
                {
                  metadata: { channel: alerte.id },
                  type: AutoModerationActionType.SendAlertMessage,
                },
              ]
            : []),
        ],
        enabled: true,
        eventType: AutoModerationRuleEventType.MessageSend,
        name: `${PREFIXE} spam`,
        triggerMetadata: {},
        triggerType: AutoModerationRuleTriggerType.Spam,
      }),
      details: {},
      reussite:
        "Le filtre anti-spam de Discord est actif. Il s'appuie sur leurs propres signaux, " +
        "pas sur une liste de mots — rien à maintenir de notre côté.",
      type: AutoModerationRuleTriggerType.Spam,
    });
  }

  @Slash({
    description: "Activer les jeux de mots-clés maintenus par Discord",
    name: "mots",
  })
  async mots(
    @SlashChoice({ name: "Grossièretés", value: "profanity" })
    @SlashChoice({ name: "Contenu sexuel", value: "sexual" })
    @SlashChoice({ name: "Insultes et injures", value: "slurs" })
    @SlashChoice({ name: "Les trois", value: "tous" })
    @SlashOption({
      description: "Quels jeux activer",
      name: "jeux",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    jeux: string,
    @SlashOption({
      channelTypes: [ChannelType.GuildText],
      description: "Salon où prévenir le staff (facultatif)",
      name: "alerte",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    })
    alerte: GuildTextBasedChannel | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    const presets =
      jeux === "tous"
        ? [
            AutoModerationRuleKeywordPresetType.Profanity,
            AutoModerationRuleKeywordPresetType.SexualContent,
            AutoModerationRuleKeywordPresetType.Slurs,
          ]
        : jeux === "sexual"
          ? [AutoModerationRuleKeywordPresetType.SexualContent]
          : jeux === "slurs"
            ? [AutoModerationRuleKeywordPresetType.Slurs]
            : [AutoModerationRuleKeywordPresetType.Profanity];

    await this.poser(interaction, {
      action: "automod.mots",
      alerte,
      construire: () => ({
        actions: [
          { type: AutoModerationActionType.BlockMessage },
          ...(alerte
            ? [
                {
                  metadata: { channel: alerte.id },
                  type: AutoModerationActionType.SendAlertMessage,
                },
              ]
            : []),
        ],
        enabled: true,
        eventType: AutoModerationRuleEventType.MessageSend,
        name: `${PREFIXE} mots-clés`,
        triggerMetadata: { presets },
        triggerType: AutoModerationRuleTriggerType.KeywordPreset,
      }),
      details: { jeux },
      reussite:
        "Les jeux de mots-clés de Discord sont actifs. Ils sont maintenus par eux, " +
        "dans toutes les langues — aucune liste à tenir à jour ici.",
      type: AutoModerationRuleTriggerType.KeywordPreset,
    });
  }

  @Slash({ description: "Désactiver une règle d'auto-modération", name: "couper" })
  async couper(
    @SlashChoice({ name: "Mentions en masse", value: "mentions" })
    @SlashChoice({ name: "Spam", value: "spam" })
    @SlashChoice({ name: "Mots-clés", value: "mots" })
    @SlashOption({
      description: "Quelle règle couper",
      name: "regle",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    quelle: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin || !interaction.guild) {
      if (!interaction.guild) {
        await repondre(interaction, echec("Hors serveur", "L'auto-modération se règle sur un serveur."));
      }
      return;
    }
    const type =
      quelle === "spam"
        ? AutoModerationRuleTriggerType.Spam
        : quelle === "mots"
          ? AutoModerationRuleTriggerType.KeywordPreset
          : AutoModerationRuleTriggerType.MentionSpam;
    try {
      const regle = regleDuType(await reglesDe(interaction.guild), type);
      if (!regle) {
        await repondre(
          interaction,
          attention("Rien à couper", "Cette règle n'existe pas sur ce serveur.", { prive: true }),
        );
        return;
      }
      // On DÉSACTIVE plutôt que de supprimer : la règle garde ses exemptions de
      // rôle et de salon, souvent réglées à la main, et se rallume d'un geste.
      await regle.setEnabled(false, "Coupée depuis /moderation automod couper");
      await logAdminAction({
        action: "automod.couper",
        adminId: admin.profileId,
        details: { regle: regle.name, type },
        discordId: interaction.user.id,
        targetId: regle.id,
        targetType: "automod_rule",
      });
      await repondre(
        interaction,
        succes(
          "Règle coupée",
          `« ${regle.name} » est désactivée. Elle n'est PAS supprimée : ses exemptions sont conservées.`,
          { prive: true },
        ),
      );
    } catch (err) {
      await repondre(interaction, echec("Coupure impossible", messagePanne(err)));
    }
  }

  /**
   * Crée ou met à jour la règle d'un type.
   *
   * Le chemin commun aux trois commandes : Discord n'autorise qu'UNE règle par
   * type de déclencheur, et une seconde création échoue avec une erreur que
   * l'API ne rend pas lisible. On lit donc l'existant d'abord.
   */
  private async poser(
    interaction: ChatInputCommandInteraction,
    options: {
      type: AutoModerationRuleTriggerType;
      construire: () => Parameters<Guild["autoModerationRules"]["create"]>[0];
      reussite: string;
      action: string;
      details: Record<string, unknown>;
      alerte: GuildTextBasedChannel | undefined;
    },
  ): Promise<void> {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    if (!interaction.guild) {
      await repondre(interaction, echec("Hors serveur", "L'auto-modération se règle sur un serveur."));
      return;
    }
    const manque = manquePermission(interaction.guild);
    if (manque) {
      await repondre(interaction, echec("Permission manquante", manque));
      return;
    }

    try {
      const existante = regleDuType(await reglesDe(interaction.guild), options.type);
      const charge = options.construire();
      let regle: AutoModerationRule;
      if (existante) {
        regle = await existante.edit({
          actions: charge.actions,
          enabled: true,
          triggerMetadata: charge.triggerMetadata,
        });
      } else {
        regle = await interaction.guild.autoModerationRules.create(charge);
      }

      await logAdminAction({
        action: options.action,
        adminId: admin.profileId,
        details: { ...options.details, alerte: options.alerte?.id ?? null, regle: regle.name },
        discordId: interaction.user.id,
        targetId: regle.id,
        targetType: "automod_rule",
      });

      await repondre(
        interaction,
        succes(
          existante ? "Règle mise à jour" : "Règle créée",
          [
            options.reussite,
            options.alerte ? `Les déclenchements sont signalés dans ${options.alerte.toString()}.` : null,
            "⚠️ Les rôles à permission « Gérer le serveur » échappent nativement à l'AutoMod : Discord ne le filtre pas.",
          ]
            .filter(Boolean)
            .join("\n"),
          { prive: true },
        ),
      );
    } catch (err) {
      await repondre(interaction, echec("Règle refusée par Discord", messagePanne(err)));
    }
  }
}
