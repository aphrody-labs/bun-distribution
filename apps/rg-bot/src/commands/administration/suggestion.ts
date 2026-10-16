/**
 * `/gestion suggestion` — trancher, et ouvrir la boîte.
 *
 * ── LA DÉCISION RÉÉCRIT LE MESSAGE D'ORIGINE ───────────────────────────────
 * Elle ne poste pas un second message. Deux raisons, et la seconde est la vraie
 * : le salon accumulerait deux messages par suggestion, et surtout le VOTE
 * resterait attaché au premier — les gens continueraient de voter une
 * suggestion déjà tranchée.
 *
 * ── LE MOTIF EST OBLIGATOIRE ───────────────────────────────────────────────
 * Une suggestion écartée sans raison est pire qu'une suggestion ignorée : elle
 * dit « non » à quelqu'un qui a pris le temps d'écrire, sans rien lui
 * apprendre. C'est la même règle que le motif de fermeture d'un ticket, et pour
 * la même raison.
 */
import { Discord, Slash, SlashChoice, SlashGroup, SlashOption } from "discordx";
import {
  ApplicationCommandOptionType,
  ChannelType,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
  type TextBasedChannel,
} from "discord.js";

import { logAdminAction } from "../../lib/audit";
import { sql } from "../../lib/db";
import { fusionnerReglages } from "../../lib/reglages-communaute";
import {
  libelleScore,
  motifSuggestionPropre,
  referenceSuggestion,
  refusTransitionSuggestion,
  transitionSuggestionPermise,
  type EtatSuggestion,
} from "../../lib/suggestions";
import { enregistrerReglages, reglagesDe } from "../../services/communaute";
import { COLONNES_SUGGESTION, composerSuggestion, lireScore, suggestionParNumero, versSuggestion } from "../suggestion";
import { attention, echec, fiche, ilYA, piedDeCommande, repondre, succes, vide } from "../../lib/ui";
import { differerEnPrive, exigerDroits, messagePanne } from "../staff/garde";
import "./racine-gestion";

@Discord()
@SlashGroup({
  description: "Ouvrir la boîte à suggestions et trancher les propositions",
  name: "suggestion",
  root: "gestion",
})
@SlashGroup("suggestion", "gestion")
export class GestionSuggestionCommand {
  @Slash({ description: "Le salon où atterrissent les suggestions", name: "salon" })
  async salon(
    @SlashOption({
      channelTypes: [ChannelType.GuildText],
      description: "Le salon (laisse vide pour FERMER la boîte)",
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
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", "La boîte s'ouvre sur un serveur."));
      return;
    }
    try {
      const actuels = await reglagesDe(guildId);
      const modifies = fusionnerReglages(actuels, {
        suggestions: { actif: salon !== undefined, salon: salon?.id ?? null },
      });
      await enregistrerReglages(guildId, modifies);
      await logAdminAction({
        action: "suggestion.salon",
        adminId: admin.profileId,
        details: { salon: salon?.id ?? null },
        discordId: interaction.user.id,
        targetId: guildId,
        targetType: "bot_reglages_guilde",
      });
      await repondre(
        interaction,
        succes(
          salon ? "Boîte à suggestions ouverte" : "Boîte à suggestions fermée",
          salon
            ? `Les propositions de \`/suggestion proposer\` atterriront dans ${salon.toString()}.`
            : "`/suggestion proposer` refusera les nouvelles propositions. Les anciennes restent en place.",
          { prive: true },
        ),
      );
    } catch (err) {
      await repondre(interaction, echec("Réglage refusé", messagePanne(err)));
    }
  }

  @Slash({ description: "Trancher une suggestion", name: "trancher" })
  async trancher(
    @SlashOption({
      description: "Numéro de la suggestion",
      minValue: 1,
      name: "numero",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    numero: number,
    @SlashChoice({ name: "Retenue", value: "acceptee" })
    @SlashChoice({ name: "Écartée", value: "refusee" })
    @SlashChoice({ name: "Faite", value: "faite" })
    @SlashChoice({ name: "Remettre au vote", value: "ouverte" })
    @SlashOption({
      description: "La décision",
      name: "decision",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    decision: string,
    @SlashOption({
      description: "Pourquoi — obligatoire, et lu par l'auteur de la suggestion",
      maxLength: 500,
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
      await repondre(interaction, echec("Hors serveur", "Les suggestions vivent sur un serveur."));
      return;
    }
    try {
      const suggestion = await suggestionParNumero(guildId, numero);
      if (!suggestion) {
        await repondre(
          interaction,
          echec("Suggestion introuvable", `Aucune suggestion ne porte le numéro ${referenceSuggestion(numero)}.`),
        );
        return;
      }
      if (!transitionSuggestionPermise(suggestion.statut, decision)) {
        await repondre(
          interaction,
          attention("Décision impossible", refusTransitionSuggestion(suggestion.statut, decision), { prive: true }),
        );
        return;
      }
      const motif = motifSuggestionPropre(motifBrut);
      if (!motif) {
        await repondre(interaction, echec("Motif vide", "Dis pourquoi : l'auteur de la suggestion le lira."));
        return;
      }

      const [ligne] = await sql`
				UPDATE bot_suggestions
				   SET statut = ${decision}, motif = ${motif}, decide_par = ${interaction.user.id},
				       decide_le = NOW(), maj_le = NOW()
				 WHERE id = ${suggestion.id}
				RETURNING ${COLONNES_SUGGESTION}
			`;
      const apres = ligne ? versSuggestion(ligne as never) : { ...suggestion, motif, statut: decision };

      // On réécrit le message d'origine, avec le score figé au moment de la
      // décision : le vote s'arrête là, et la trace reste lisible.
      let resultat: string | null = null;
      if (apres.messageId) {
        try {
          const salon = (await interaction.client.channels
            .fetch(apres.salonId)
            .catch(() => null)) as TextBasedChannel | null;
          const message = salon ? await salon.messages.fetch(apres.messageId) : null;
          if (message) {
            resultat = libelleScore(lireScore(message));
            await message.edit({ embeds: [composerSuggestion(apres, { resultat })] });
            if (decision !== "ouverte") {
              // Les réactions partent : la suggestion est tranchée, continuer à
              // voter n'a plus de sens et laisse croire le contraire.
              await message.reactions.removeAll().catch(() => undefined);
            }
          }
        } catch (err) {
          console.warn(
            `[suggestion] message ${apres.messageId} non réécrit :`,
            err instanceof Error ? err.message : err,
          );
        }
      }

      await logAdminAction({
        action: "suggestion.trancher",
        adminId: admin.profileId,
        details: { decision, numero: apres.numero, resultat },
        discordId: interaction.user.id,
        targetId: String(apres.id),
        targetType: "bot_suggestions",
      });

      // L'auteur est prévenu en privé : c'est lui que la décision concerne, et
      // le prévenir dans le salon ferait un second message pour rien.
      await interaction.client.users
        .fetch(apres.auteurId)
        .then(async auteur =>
          auteur.send({
            embeds: [composerSuggestion(apres, { resultat })],
          }),
        )
        .catch(() => undefined);

      await repondre(
        interaction,
        succes(
          `Suggestion ${referenceSuggestion(apres.numero)} tranchée`,
          [
            `Décision enregistrée et publiée sur le message d'origine.`,
            resultat ? `Vote au moment de la décision : ${resultat}` : null,
            "L'auteur a été prévenu en message privé.",
          ]
            .filter(Boolean)
            .join("\n"),
          { prive: true },
        ),
      );
    } catch (err) {
      await repondre(interaction, echec("Décision impossible", messagePanne(err)));
    }
  }

  @Slash({ description: "Toutes les suggestions, tranchées ou non", name: "liste" })
  async liste(
    @SlashChoice({ name: "En vote", value: "ouverte" })
    @SlashChoice({ name: "Retenues", value: "acceptee" })
    @SlashChoice({ name: "Écartées", value: "refusee" })
    @SlashChoice({ name: "Faites", value: "faite" })
    @SlashOption({
      description: "Filtrer par état (toutes par défaut)",
      name: "etat",
      required: false,
      type: ApplicationCommandOptionType.String,
    })
    etat: string | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", "Les suggestions vivent sur un serveur."));
      return;
    }
    try {
      const lignes = etat
        ? await sql`
					SELECT ${COLONNES_SUGGESTION} FROM bot_suggestions
					 WHERE guild_id = ${guildId} AND statut = ${etat as EtatSuggestion}
					 ORDER BY cree_le DESC LIMIT 20
				`
        : await sql`
					SELECT ${COLONNES_SUGGESTION} FROM bot_suggestions
					 WHERE guild_id = ${guildId}
					 ORDER BY cree_le DESC LIMIT 20
				`;
      if (lignes.length === 0) {
        await repondre(interaction, vide("Aucune suggestion", "La boîte est vide pour ce filtre."));
        return;
      }
      const carte = fiche({ icone: "sondage", titre: `${lignes.length} suggestion(s)` });
      carte.bloc(
        "Liste",
        (lignes as never[])
          .map(brut => {
            const suggestion = versSuggestion(brut);
            const titre = (suggestion.texte.split("\n")[0] ?? suggestion.texte).slice(0, 60);
            return `**${referenceSuggestion(suggestion.numero)}** ${titre} · <@${suggestion.auteurId}> · ${ilYA(suggestion.creeLe)}`;
          })
          .join("\n"),
        5,
      );
      await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
    } catch (err) {
      await repondre(interaction, echec("Liste illisible", messagePanne(err)));
    }
  }
}
