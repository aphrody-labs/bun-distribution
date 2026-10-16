/**
 * `/gestion ticket` — installer et régler le système de tickets.
 *
 * ── CE QUE CETTE COMMANDE ÉVITE ────────────────────────────────────────────
 * La panne la plus coûteuse d'un système de tickets est SILENCIEUSE : les
 * tickets se créent, le membre voit son fil, et personne au staff ne le voit
 * jamais. Un fil privé n'est visible que de ses invités et des porteurs de la
 * permission « Gérer les fils » ; un rôle mentionné dans un fil n'y entre PAS.
 *
 * `diagnostic` vérifie donc, salon par salon et rôle par rôle, ce que la
 * configuration produira réellement — et `panneau` refuse de publier tant qu'un
 * blocage subsiste. Publier un panneau qui fabrique des tickets fantômes serait
 * pire que ne rien publier.
 *
 * ── LES RÉGLAGES SONT DES DONNÉES ──────────────────────────────────────────
 * Tout va dans `bot_reglages_guilde.valeurs` (jsonb validé par zod,
 * `lib/reglages-communaute.ts`). Aucun identifiant de salon ni de rôle n'est
 * écrit dans le code du bot : déplacer le salon des tickets ne doit pas demander
 * un déploiement.
 */
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  ChannelType,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
  type Role,
} from "discord.js";

import { logAdminAction } from "../../lib/audit";
import { fusionnerReglages, manquesTickets, type ReglagesCommunaute } from "../../lib/reglages-communaute";
import {
  CATEGORIES_TICKET,
  libelleCategorieTicket,
  LONGUEUR_MOTIF,
  motifPropre,
  referenceTicket,
} from "../../lib/tickets";
import { enregistrerReglages, reglagesDe } from "../../services/communaute";
import {
  clore,
  compterTickets,
  diagnostiquerAcces,
  fermerTicket,
  publierFermeture,
  reconcilierTicketsOuverts,
  ticketParNumero,
  ticketsOuverts,
} from "../../services/tickets";
import { construirePanneau } from "../ticket";
import { attention, echec, fiche, ilYA, piedDeCommande, repondre, succes } from "../../lib/ui";
import { differerEnPrive, exigerDroits, messagePanne } from "../staff/garde";
import "./racine-gestion";

const SALONS_ACCEPTES = [ChannelType.GuildText, ChannelType.GuildAnnouncement] as const;

/** Résout le salon du panneau depuis les réglages, `null` s'il est absent. */
async function salonDesReglages(
  interaction: ChatInputCommandInteraction,
  reglages: ReglagesCommunaute,
): Promise<GuildTextBasedChannel | null> {
  if (!reglages.tickets.salonPanneau) {
    return null;
  }
  const salon = await interaction.client.channels.fetch(reglages.tickets.salonPanneau).catch(() => null);
  return salon && salon.isTextBased() && !salon.isDMBased() ? (salon as GuildTextBasedChannel) : null;
}

@Discord()
@SlashGroup({
  description: "Installer et régler les tickets d'assistance",
  name: "ticket",
  root: "gestion",
})
@SlashGroup("ticket", "gestion")
export class GestionTicketCommand {
  @Slash({ description: "Voir la configuration actuelle des tickets", name: "reglages" })
  async voirReglages(interaction: ChatInputCommandInteraction) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", "Les tickets se règlent sur un serveur."));
      return;
    }
    try {
      const reglages = await reglagesDe(guildId);
      const manques = manquesTickets(reglages);
      const carte = fiche({
        icone: "reglage",
        intention: manques.length === 0 ? "marque" : "attention",
        titre: "Réglages des tickets",
      });
      carte
        .champ("Actif", reglages.tickets.actif ? "oui" : "non", { enLigne: true })
        .champ("Mode", reglages.tickets.mode === "fil" ? "fils privés" : "salons", {
          enLigne: true,
        })
        .champ("Salon du panneau", reglages.tickets.salonPanneau ? `<#${reglages.tickets.salonPanneau}>` : "—", {
          enLigne: true,
        })
        .champ(
          "Salon d'historique",
          reglages.tickets.salonHistorique ? `<#${reglages.tickets.salonHistorique}>` : "—",
          { enLigne: true },
        )
        .champ(
          "Catégorie Support",
          reglages.tickets.categorieSupport ? `<#${reglages.tickets.categorieSupport}>` : "—",
          { enLigne: true },
        )
        .champ("Prise en charge", reglages.tickets.rolesStaff.map(id => `<@&${id}>`).join(" ") || "—")
        .champ("Direction (signalements)", reglages.tickets.rolesDirection.map(id => `<@&${id}>`).join(" ") || "—")
        .champ(
          "Catégories proposées",
          CATEGORIES_TICKET.map(
            categorie => `${categorie.emoji} ${categorie.libelle}${categorie.sensible ? " *(direction)*" : ""}`,
          ).join("\n"),
        );
      if (manques.length > 0) {
        carte.champ("Il manque", manques.map(manque => `- ${manque}`).join("\n"));
      }
      await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
    } catch (err) {
      await repondre(interaction, echec("Réglages illisibles", messagePanne(err)));
    }
  }

  @Slash({ description: "Poser un salon ou un rôle du système de tickets", name: "poser" })
  async poser(
    @SlashChoice({ name: "Salon du panneau", value: "salonPanneau" })
    @SlashChoice({ name: "Salon d'historique", value: "salonHistorique" })
    @SlashChoice({ name: "Catégorie Support", value: "categorieSupport" })
    @SlashOption({
      description: "Quel réglage de salon poser",
      name: "reglage",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    cle: string,
    @SlashOption({
      channelTypes: [...SALONS_ACCEPTES, ChannelType.GuildCategory],
      description: "Le salon (ou la catégorie) à poser",
      name: "salon",
      required: true,
      type: ApplicationCommandOptionType.Channel,
    })
    salon: GuildTextBasedChannel,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", "Les tickets se règlent sur un serveur."));
      return;
    }
    try {
      const actuels = await reglagesDe(guildId);
      const modifies = fusionnerReglages(actuels, { tickets: { [cle]: salon.id } });
      await enregistrerReglages(guildId, modifies);
      await logAdminAction({
        action: "ticket.reglage",
        adminId: admin.profileId,
        details: { cle, valeur: salon.id },
        discordId: interaction.user.id,
        targetId: guildId,
        targetType: "bot_reglages_guilde",
      });
      await repondre(interaction, succes("Réglage posé", `\`${cle}\` → ${salon.toString()}`, { prive: true }));
    } catch (err) {
      await repondre(interaction, echec("Réglage refusé", messagePanne(err)));
    }
  }

  @Slash({ description: "Ajouter ou retirer un rôle de prise en charge", name: "role" })
  async role(
    @SlashChoice({ name: "Prise en charge (tickets ordinaires)", value: "rolesStaff" })
    @SlashChoice({ name: "Direction (signalements)", value: "rolesDirection" })
    @SlashOption({
      description: "Quelle liste modifier",
      name: "liste",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    liste: string,
    @SlashOption({
      description: "Le rôle",
      name: "role",
      required: true,
      type: ApplicationCommandOptionType.Role,
    })
    role: Role,
    @SlashChoice({ name: "Ajouter", value: "ajouter" })
    @SlashChoice({ name: "Retirer", value: "retirer" })
    @SlashOption({
      description: "Ajouter ou retirer (ajouter par défaut)",
      name: "action",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    action: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", "Les tickets se règlent sur un serveur."));
      return;
    }
    try {
      const actuels = await reglagesDe(guildId);
      const cle = liste === "rolesDirection" ? "rolesDirection" : "rolesStaff";
      const avant = actuels.tickets[cle];
      const apres = action === "retirer" ? avant.filter(id => id !== role.id) : [...new Set([...avant, role.id])];
      const modifies = fusionnerReglages(actuels, { tickets: { [cle]: apres } });
      await enregistrerReglages(guildId, modifies);

      await logAdminAction({
        action: "ticket.role",
        adminId: admin.profileId,
        details: { action: action ?? "ajouter", liste: cle, role: role.id },
        discordId: interaction.user.id,
        targetId: guildId,
        targetType: "bot_reglages_guilde",
      });

      // La vérification qui compte : ce rôle VERRA-T-IL les tickets ?
      // Les DEUX listes sont passées, jamais celle qu'on vient de modifier
      // seule : le diagnostic signale aussi les rôles qui voient les tickets
      // sans y être habilités, et la direction en ferait partie à tort.
      const salon = await salonDesReglages(interaction, modifies);
      const habilites = [...modifies.tickets.rolesStaff, ...modifies.tickets.rolesDirection];
      const diagnostic =
        salon && interaction.guild
          ? await diagnostiquerAcces(interaction.guild, salon, habilites)
          : { avertissements: [], blocages: [] };

      const carte = fiche({
        description: `${role.toString()} ${action === "retirer" ? "retiré de" : "ajouté à"} \`${cle}\`.`,
        icone: "reglage",
        intention: diagnostic.blocages.length > 0 ? "attention" : "succes",
        titre: "Rôle de tickets",
      });
      carte.champ("Liste à jour", apres.map(id => `<@&${id}>`).join(" ") || "—");
      if (diagnostic.blocages.length > 0) {
        carte.champ("À corriger", diagnostic.blocages.map(ligne => `- ${ligne}`).join("\n"));
      }
      await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
    } catch (err) {
      await repondre(interaction, echec("Modification refusée", messagePanne(err)));
    }
  }

  @Slash({
    description: "Vérifier que les tickets fonctionneront VRAIMENT",
    name: "diagnostic",
  })
  async diagnostic(interaction: ChatInputCommandInteraction) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId || !interaction.guild) {
      await repondre(interaction, echec("Hors serveur", "Le diagnostic s'exécute sur un serveur."));
      return;
    }
    try {
      const reglages = await reglagesDe(guildId);
      const manques = manquesTickets(reglages);
      const salon = await salonDesReglages(interaction, reglages);

      const roles = [...reglages.tickets.rolesStaff, ...reglages.tickets.rolesDirection];
      const diagnostic = salon
        ? await diagnostiquerAcces(interaction.guild, salon, roles)
        : { avertissements: [], blocages: ["Aucun salon de panneau configuré."] };

      const compte = await compterTickets(guildId);
      const bloque = manques.length > 0 || diagnostic.blocages.length > 0;
      const carte = fiche({
        description: bloque
          ? "Le système NE fonctionnera PAS en l'état."
          : "Tout est en place : un membre peut ouvrir un ticket, et le staff le verra.",
        icone: "service",
        intention: bloque ? "echec" : "succes",
        titre: "Diagnostic des tickets",
      });
      if (manques.length > 0) {
        carte.champ("Réglages manquants", manques.map(manque => `- ${manque}`).join("\n"));
      }
      if (diagnostic.blocages.length > 0) {
        carte.champ("Blocages", diagnostic.blocages.map(ligne => `- ${ligne}`).join("\n"));
      }
      if (diagnostic.avertissements.length > 0) {
        carte.champ("À savoir", diagnostic.avertissements.map(ligne => `- ${ligne}`).join("\n"));
      }
      carte.champ("Tickets", `${compte.ouvert} en attente · ${compte.pris} pris en charge · ${compte.ferme} fermés`);
      await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
    } catch (err) {
      await repondre(interaction, echec("Diagnostic impossible", messagePanne(err)));
    }
  }

  @Slash({ description: "Publier le panneau d'ouverture de tickets", name: "panneau" })
  async panneau(
    @SlashOption({
      channelTypes: [...SALONS_ACCEPTES],
      description: "Où publier (le salon du panneau par défaut)",
      name: "salon",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    })
    salonChoisi: GuildTextBasedChannel | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId || !interaction.guild) {
      await repondre(interaction, echec("Hors serveur", "Le panneau se publie sur un serveur."));
      return;
    }
    try {
      const reglages = await reglagesDe(guildId);
      const cible = salonChoisi ?? (await salonDesReglages(interaction, reglages));
      if (!cible) {
        await repondre(
          interaction,
          echec("Salon indéterminé", "Pose `salonPanneau` avec `/gestion ticket poser`, ou passe l'option `salon`."),
        );
        return;
      }

      // Le refus qui compte : publier un panneau qui fabrique des tickets que
      // personne ne voit est pire que ne rien publier.
      const roles = [...reglages.tickets.rolesStaff, ...reglages.tickets.rolesDirection];
      const diagnostic = await diagnostiquerAcces(interaction.guild, cible, roles);
      if (diagnostic.blocages.length > 0) {
        await repondre(
          interaction,
          attention(
            "Panneau non publié",
            `${diagnostic.blocages.map(ligne => `- ${ligne}`).join("\n")}\n\nCorrige d'abord : un panneau qui crée des tickets invisibles ne se voit qu'au premier signalement perdu.`,
            { prive: true },
          ),
        );
        return;
      }

      const message = await cible.send(construirePanneau());
      await logAdminAction({
        action: "ticket.panneau",
        adminId: admin.profileId,
        details: { salon: cible.id },
        discordId: interaction.user.id,
        targetId: message.id,
        targetType: "discord_message",
      });
      await repondre(interaction, succes("Panneau publié", `${message.url}`, { prive: true }));
    } catch (err) {
      await repondre(interaction, echec("Publication impossible", messagePanne(err)));
    }
  }

  @Slash({ description: "Les tickets encore ouverts, avec leur âge", name: "encours" })
  async encours(interaction: ChatInputCommandInteraction) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", "Les tickets vivent sur un serveur."));
      return;
    }
    try {
      // Un fil supprimé laisse sa ligne « ouverte » : la liste du staff doit
      // montrer les tickets qui existent, pas des salons introuvables.
      const bruts = await ticketsOuverts(guildId, 25);
      const ouverts = interaction.guild ? await reconcilierTicketsOuverts(interaction.guild, bruts) : bruts;
      const compte = await compterTickets(guildId);
      const fantomes = bruts.length - ouverts.length;
      const carte = fiche({
        description:
          ouverts.length === 0
            ? "Aucun ticket en attente."
            : ouverts
                .map(ticket =>
                  [
                    `**${referenceTicket(ticket.numero)}**`,
                    `<#${ticket.salonId}>`,
                    libelleCategorieTicket(ticket.categorie),
                    `<@${ticket.auteurId}>`,
                    ilYA(ticket.ouvertLe),
                    ticket.prisPar ? `pris par <@${ticket.prisPar}>` : null,
                  ]
                    .filter(Boolean)
                    .join(" · "),
                )
                .join("\n"),
        icone: "ticket",
        titre: `${ouverts.length} ticket(s) en cours`,
      });
      carte.champ("Total", `${compte.ouvert} en attente · ${compte.pris} pris en charge · ${compte.ferme} fermés`);
      if (fantomes > 0) {
        carte.champ(
          "Fermés d'office",
          `${fantomes} ticket(s) dont le fil avait été supprimé — leur auteur peut de nouveau en ouvrir un.`,
        );
      }
      await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
    } catch (err) {
      await repondre(interaction, echec("Liste illisible", messagePanne(err)));
    }
  }

  @Slash({
    description: "Fermer d'office un ticket par son numéro, depuis n'importe où",
    name: "fermer",
  })
  async fermerDoffice(
    @SlashOption({
      description: "Numéro du ticket, celui de « ticket-0086 »",
      minValue: 1,
      name: "numero",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    numero: number,
    @SlashOption({
      description: "Pourquoi il est fermé — obligatoire",
      maxLength: LONGUEUR_MOTIF,
      minLength: 3,
      name: "motif",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    motifBrut: string,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", "Les tickets vivent sur un serveur."));
      return;
    }
    try {
      const ticket = await ticketParNumero(guildId, numero);
      if (!ticket) {
        await repondre(interaction, attention("Inconnu", `Aucun ticket ${referenceTicket(numero)} sur ce serveur.`));
        return;
      }
      if (ticket.statut === "ferme") {
        await repondre(
          interaction,
          attention(
            "Déjà fermé",
            `${referenceTicket(numero)} est fermé depuis ${ilYA(ticket.fermeLe ?? ticket.ouvertLe)}.`,
          ),
        );
        return;
      }
      const motif = motifPropre(motifBrut);
      if (!motif) {
        await repondre(interaction, echec("Motif vide", "Toujours fermer avec un motif."));
        return;
      }

      const ferme = await fermerTicket(ticket.id, interaction.user.id, motif);
      if (!ferme) {
        await repondre(interaction, attention("Déjà fermé", "Quelqu'un a été plus rapide."));
        return;
      }

      const salon = await interaction.client.channels.fetch(ferme.salonId).catch(() => null);
      const fil = salon?.isThread() ? salon : null;
      await publierFermeture({
        client: interaction.client,
        fermePar: interaction.user.id,
        guildId,
        motif,
        ticket: ferme,
        urlFil: fil?.url ?? null,
      });
      if (fil) {
        await clore(fil, `Fermé d'office par ${interaction.user.tag} — ${motif}`);
      }
      await logAdminAction({
        action: "ticket.fermeture-office",
        adminId: admin.profileId,
        details: { auteur: ferme.auteurId, filPresent: fil !== null, motif, numero },
        discordId: interaction.user.id,
        targetId: String(ferme.id),
        targetType: "bot_tickets",
      });

      await repondre(
        interaction,
        succes(
          `Ticket ${referenceTicket(ferme.numero)} fermé`,
          [
            `**Motif** ${motif}`,
            `Ouvert par <@${ferme.auteurId}> — il peut de nouveau ouvrir un ticket.`,
            fil ? "Le fil est archivé et verrouillé." : "Son fil n'existait plus.",
          ].join("\n"),
          { prive: true },
        ),
      );
    } catch (err) {
      await repondre(interaction, echec("Fermeture impossible", messagePanne(err)));
    }
  }
}
