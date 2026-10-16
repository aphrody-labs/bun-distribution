/**
 * `/gestion accueil` — le message de bienvenue et le rôle d'arrivée.
 *
 * ── LE RÔLE D'ARRIVÉE EST LA SURFACE LA PLUS LARGE DU BOT ──────────────────
 * Il est posé à CHAQUE arrivée, sans clic, sans niveau à atteindre : plus large
 * qu'un menu en libre-service, plus large qu'une récompense. Il passe donc par
 * la même garde stricte (`lib/hierarchie.ts`), et `apercu` montre au staff ce
 * que verra vraiment le prochain arrivant — parce qu'un message d'accueil qu'on
 * découvre en production est un message qu'on corrige devant tout le monde.
 */
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  AttachmentBuilder,
  ChannelType,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
  type Role,
} from "discord.js";

import { logAdminAction } from "../../lib/audit";
import { renderCarteAccueil } from "../../lib/canvas/communaute";
import { verifierAttributionAutomatique } from "../../lib/hierarchie";
import { LIEUX_BIENVENUE, fusionnerReglages } from "../../lib/reglages-communaute";
import { enregistrerReglages, reglagesDe } from "../../services/communaute";
import { remplirGabarit } from "../../lib/accueil-gabarit";
import { attention, creerEmbed, echec, fiche, pied, piedDeCommande, repondre, succes } from "../../lib/ui";
import { differerEnPrive, exigerDroits, messagePanne } from "../staff/garde";
import "./racine-gestion";

@Discord()
@SlashGroup({
  description: "Message de bienvenue et rôle d'arrivée",
  name: "accueil",
  root: "gestion",
})
@SlashGroup("accueil", "gestion")
export class GestionAccueilCommand {
  @Slash({ description: "La configuration actuelle de l'accueil", name: "reglages" })
  async voirReglages(interaction: ChatInputCommandInteraction) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", "L'accueil se règle sur un serveur."));
      return;
    }
    try {
      const reglages = await reglagesDe(guildId);
      const carte = fiche({ icone: "membre", titre: "Réglages de l'accueil" });
      carte
        .champ("Actif", reglages.accueil.actif ? "oui" : "non", { enLigne: true })
        .champ("Lieu", reglages.accueil.lieu, { enLigne: true })
        .champ("Salon", reglages.accueil.salon ? `<#${reglages.accueil.salon}>` : "—", {
          enLigne: true,
        })
        .champ("Carte image", reglages.accueil.carte ? "jointe" : "non", { enLigne: true })
        .champ("Rôle d'arrivée", reglages.accueil.roleArrivee ? `<@&${reglages.accueil.roleArrivee}>` : "aucun", {
          enLigne: true,
        })
        .champ("Texte", reglages.accueil.texte ?? "*(texte par défaut du bot)*")
        .champ(
          "Jetons disponibles",
          "`{membre}` la mention · `{serveur}` le nom du serveur · `{compte}` le nombre de membres",
        );
      await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
    } catch (err) {
      await repondre(interaction, echec("Réglages illisibles", messagePanne(err)));
    }
  }

  @Slash({ description: "Où souhaiter la bienvenue", name: "lieu" })
  async lieu(
    @SlashChoice(
      ...LIEUX_BIENVENUE.map(valeur => ({
        name:
          valeur === "salon"
            ? "Dans un salon"
            : valeur === "prive"
              ? "En message privé au nouveau membre"
              : "Nulle part",
        value: valeur,
      })),
    )
    @SlashOption({
      description: "Où publier le message d'accueil",
      name: "lieu",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    lieu: string,
    @SlashOption({
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      description: "Le salon, si le lieu est « dans un salon »",
      name: "salon",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    })
    salon: GuildTextBasedChannel | undefined,
    @SlashOption({
      description: "Joindre la carte image (oui par défaut)",
      name: "carte",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    carte: boolean | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", "L'accueil se règle sur un serveur."));
      return;
    }
    if (lieu === "salon" && !salon) {
      await repondre(
        interaction,
        echec("Salon manquant", "Le lieu « dans un salon » a besoin d'un salon. Sans lui, rien ne serait publié."),
      );
      return;
    }
    try {
      const actuels = await reglagesDe(guildId);
      const modifies = fusionnerReglages(actuels, {
        accueil: {
          lieu: lieu as (typeof LIEUX_BIENVENUE)[number],
          ...(salon ? { salon: salon.id } : {}),
          ...(carte === undefined ? {} : { carte }),
        },
      });
      await enregistrerReglages(guildId, modifies);
      await logAdminAction({
        action: "accueil.lieu",
        adminId: admin.profileId,
        details: { carte: modifies.accueil.carte, lieu, salon: salon?.id },
        discordId: interaction.user.id,
        targetId: guildId,
        targetType: "bot_reglages_guilde",
      });
      await repondre(
        interaction,
        succes(
          "Accueil réglé",
          lieu === "aucune"
            ? "Plus aucun message d'accueil ne sera publié."
            : `${lieu === "salon" ? salon?.toString() : "message privé"} · carte ${modifies.accueil.carte ? "jointe" : "non jointe"}.`,
          { prive: true },
        ),
      );
    } catch (err) {
      await repondre(interaction, echec("Réglage refusé", messagePanne(err)));
    }
  }

  @Slash({ description: "Le texte du message d'accueil", name: "texte" })
  async texte(
    @SlashOption({
      description: "Utilise {membre}, {serveur}, {compte}. Laisse vide pour le texte par défaut.",
      maxLength: 1_000,
      name: "texte",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    texte: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", "L'accueil se règle sur un serveur."));
      return;
    }
    try {
      const actuels = await reglagesDe(guildId);
      const modifies = fusionnerReglages(actuels, {
        accueil: { texte: texte?.trim() ? texte.trim() : null },
      });
      await enregistrerReglages(guildId, modifies);
      await logAdminAction({
        action: "accueil.texte",
        adminId: admin.profileId,
        details: { longueur: texte?.length ?? 0 },
        discordId: interaction.user.id,
        targetId: guildId,
        targetType: "bot_reglages_guilde",
      });
      await repondre(
        interaction,
        succes(
          texte?.trim() ? "Texte enregistré" : "Texte remis par défaut",
          "`/gestion accueil apercu` montre ce que verra le prochain arrivant.",
          { prive: true },
        ),
      );
    } catch (err) {
      await repondre(interaction, echec("Réglage refusé", messagePanne(err)));
    }
  }

  @Slash({ description: "Le rôle posé à chaque arrivée", name: "role" })
  async role(
    @SlashOption({
      description: "Le rôle d'arrivée (laisse vide pour n'en poser aucun)",
      name: "role",
      required: false,
      type: ApplicationCommandOptionType.Role,
    })
    role: Role | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", "L'accueil se règle sur un serveur."));
      return;
    }

    if (role) {
      // LE VERROU. Un rôle d'arrivée touche TOUT LE MONDE, sans clic.
      const moi = interaction.guild?.members.me;
      const verdict = verifierAttributionAutomatique(
        {
          estEveryone: role.id === role.guild.id,
          gereParIntegration: role.managed,
          id: role.id,
          nom: role.name,
          permissions: role.permissions.bitfield.toString(),
          position: role.position,
        },
        {
          peutGererRoles: moi?.permissions.has("ManageRoles") ?? false,
          positionMax: moi?.roles.highest.position ?? 0,
        },
      );
      if (!verdict.ok) {
        await repondre(
          interaction,
          attention(
            "Rôle d'arrivée refusé",
            `${verdict.motif}\n\nUn rôle d'arrivée est posé sur CHAQUE nouveau membre, sans qu'un humain regarde.`,
            { prive: true },
          ),
        );
        return;
      }
    }

    try {
      const actuels = await reglagesDe(guildId);
      const modifies = fusionnerReglages(actuels, {
        accueil: { roleArrivee: role?.id ?? null },
      });
      await enregistrerReglages(guildId, modifies);
      await logAdminAction({
        action: "accueil.role",
        adminId: admin.profileId,
        details: { role: role?.id ?? null },
        discordId: interaction.user.id,
        targetId: guildId,
        targetType: "bot_reglages_guilde",
      });
      await repondre(
        interaction,
        succes(
          role ? "Rôle d'arrivée posé" : "Rôle d'arrivée retiré",
          role
            ? `${role.toString()} sera posé sur chaque nouveau membre. Les membres déjà présents ne sont PAS touchés.`
            : "Aucun rôle ne sera plus posé à l'arrivée.",
          { prive: true },
        ),
      );
    } catch (err) {
      await repondre(interaction, echec("Réglage refusé", messagePanne(err)));
    }
  }

  @Slash({
    description: "Voir ce que verra le prochain arrivant (sans rien publier)",
    name: "apercu",
  })
  async apercu(interaction: ChatInputCommandInteraction) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId || !interaction.guild) {
      await repondre(interaction, echec("Hors serveur", "L'aperçu s'exécute sur un serveur."));
      return;
    }
    try {
      const reglages = await reglagesDe(guildId);
      const compte = interaction.guild.memberCount;
      const membre = interaction.member;
      const pseudo = membre && "displayName" in membre ? membre.displayName : interaction.user.username;

      const texte = reglages.accueil.texte
        ? remplirGabarit(reglages.accueil.texte, {
            compte,
            membre: interaction.user.toString(),
            serveur: interaction.guild.name,
          })
        : `${interaction.user.toString()} vient d'arriver sur **${interaction.guild.name}**.`;

      const embed = creerEmbed({
        description: texte,
        icone: "membre",
        intention: reglages.accueil.lieu === "aucune" ? "muet" : "succes",
        titre: "Bienvenue",
      });
      pied(embed, { note: `${compte} membres · aperçu, rien n'a été publié` });

      const fichiers: AttachmentBuilder[] = [];
      if (reglages.accueil.carte) {
        const image = await renderCarteAccueil({
          avatarUrl: interaction.user.displayAvatarURL({ extension: "png", size: 256 }),
          message: reglages.accueil.texte
            ? remplirGabarit(reglages.accueil.texte, {
                compte,
                membre: pseudo,
                serveur: interaction.guild.name,
              })
            : null,
          pseudo,
          rang: compte,
          serveur: interaction.guild.name,
        });
        fichiers.push(new AttachmentBuilder(image, { name: "apercu-bienvenue.png" }));
      }

      const avertissement =
        reglages.accueil.lieu === "aucune"
          ? "⚠️ L'accueil est réglé sur « nulle part » : RIEN ne sera publié à l'arrivée."
          : reglages.accueil.lieu === "salon" && !reglages.accueil.salon
            ? "⚠️ Le lieu est « dans un salon » mais aucun salon n'est posé : rien ne sera publié."
            : null;

      await interaction.editReply({
        content: avertissement ?? undefined,
        embeds: [embed],
        files: fichiers,
      });
    } catch (err) {
      await repondre(interaction, echec("Aperçu impossible", messagePanne(err)));
    }
  }
}
