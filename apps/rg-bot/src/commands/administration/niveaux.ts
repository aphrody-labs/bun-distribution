/**
 * `/gestion niveaux` — régler la progression, et surtout ses RÉCOMPENSES.
 *
 * ── LA COMMANDE LA PLUS DANGEREUSE DU BOT ──────────────────────────────────
 * Une récompense de niveau attribue un rôle TOUTE SEULE, sans qu'un humain
 * regarde. Pointée vers un rôle de modération, elle ouvre le bannissement à
 * quiconque écrit assez de messages. Sur ce serveur, 29 rôles sur 94 portent au
 * moins une permission sensible (relevé du 14/8/2026) : la faute est à un clic.
 *
 * `recompense` refuse donc quatre familles de rôles (`lib/hierarchie.ts`) :
 * `@everyone`, les rôles gérés par une intégration, ceux situés au niveau ou
 * au-dessus du bot, et **tous ceux qui portent une permission sensible**. Le
 * refus est expliqué, jamais silencieux — et il est rejoué à chaque attribution
 * (`events/experience.ts`), parce qu'un rôle peut gagner des permissions APRÈS
 * son enregistrement.
 *
 * ── DISCRÉTION ─────────────────────────────────────────────────────────────
 * `annonce` vaut `aucune` par défaut sur une guilde vierge. Là où elle est
 * posée, `palier` ne laisse passer que les niveaux ronds : sur deux mille
 * membres, annoncer chaque montée rend un salon illisible en une semaine, et le
 * staff finit toujours par couper le bot. On ne fête que ce qui se fête.
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
import { sql } from "../../lib/db";
import { NIVEAU_MAX, RANGS, xpPourAtteindre } from "../../lib/experience";
import { filtrerRecompenses, verifierAttributionAutomatique } from "../../lib/hierarchie";
import { LIEUX_ANNONCE, fusionnerReglages } from "../../lib/reglages-communaute";
import { enregistrerReglages, recompensesDe, reglagesDe } from "../../services/communaute";
import { attention, echec, entierLisible, fiche, piedDeCommande, repondre, succes } from "../../lib/ui";
import { differerEnPrive, exigerDroits, messagePanne } from "../staff/garde";
import "./racine-gestion";

/** Faits d'un rôle, dans la forme que `lib/hierarchie.ts` attend. */
function faitsDe(role: Role) {
  return {
    estEveryone: role.id === role.guild.id,
    gereParIntegration: role.managed,
    id: role.id,
    nom: role.name,
    permissions: role.permissions.bitfield.toString(),
    position: role.position,
  };
}

/** Faits du bot dans la guilde du rôle. */
function faitsBotDe(role: Role) {
  const moi = role.guild.members.me;
  return {
    peutGererRoles: moi?.permissions.has("ManageRoles") ?? false,
    positionMax: moi?.roles.highest.position ?? 0,
  };
}

@Discord()
@SlashGroup({
  description: "Régler la progression et ses récompenses",
  name: "niveaux",
  root: "gestion",
})
@SlashGroup("niveaux", "gestion")
export class GestionNiveauxCommand {
  @Slash({ description: "La configuration actuelle de la progression", name: "reglages" })
  async voirReglages(interaction: ChatInputCommandInteraction) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", "La progression se règle sur un serveur."));
      return;
    }
    try {
      const [reglages, recompenses] = await Promise.all([reglagesDe(guildId), recompensesDe(guildId)]);
      const carte = fiche({
        description:
          `Courbe du jeu : ${entierLisible(NIVEAU_MAX)} niveaux, ` +
          `${entierLisible(xpPourAtteindre(NIVEAU_MAX))} XP au plafond.`,
        icone: "niveau",
        titre: "Réglages de la progression",
      });
      carte
        .champ("Actif", reglages.niveaux.actif ? "oui" : "non", { enLigne: true })
        .champ(
          "Gain",
          `${reglages.niveaux.gain.minimum}–${reglages.niveaux.gain.maximum} XP / ${reglages.niveaux.gain.delaiSecondes} s`,
          { enLigne: true },
        )
        .champ("Annonce", reglages.niveaux.annonce, { enLigne: true })
        .champ("Salon d'annonce", reglages.niveaux.salonAnnonce ? `<#${reglages.niveaux.salonAnnonce}>` : "—", {
          enLigne: true,
        })
        .champ(
          "Palier d'annonce",
          reglages.niveaux.palierAnnonce === 1 ? "chaque niveau" : `tous les ${reglages.niveaux.palierAnnonce} niveaux`,
          { enLigne: true },
        )
        .champ("Changements de rang", reglages.niveaux.annoncerRang ? "annoncés" : "silencieux", {
          enLigne: true,
        })
        .champ("Salons exclus", reglages.niveaux.salonsExclus.map(id => `<#${id}>`).join(" ") || "aucun")
        .champ("Rôles exclus", reglages.niveaux.rolesExclus.map(id => `<@&${id}>`).join(" ") || "aucun")
        .champ("Rangs", RANGS.map(rang => `${rang.nom} dès ${rang.depuis}`).join(" · "));

      if (recompenses.length === 0) {
        carte.champ("Récompenses", "aucune — `/gestion niveaux recompense` en ajoute");
      } else {
        // On dit lesquelles fonctionnent RÉELLEMENT : une ligne en base ne
        // garantit rien si le rôle est passé au-dessus du bot depuis.
        const faits = new Map(
          recompenses
            .map(recompense => interaction.guild?.roles.cache.get(recompense.roleId))
            .filter((role): role is Role => role !== undefined)
            .map(role => [role.id, faitsDe(role)]),
        );
        const moi = interaction.guild?.members.me;
        const { bloquees, posables } = filtrerRecompenses(recompenses, faits, {
          peutGererRoles: moi?.permissions.has("ManageRoles") ?? false,
          positionMax: moi?.roles.highest.position ?? 0,
        });
        carte.champ(
          "Récompenses actives",
          posables.map(recompense => `Niveau ${recompense.niveau} → <@&${recompense.roleId}>`).join("\n") || "aucune",
        );
        if (bloquees.length > 0) {
          carte.champ(
            "Récompenses BLOQUÉES",
            bloquees.map(bloquee => `Niveau ${bloquee.recompense.niveau} — ${bloquee.motif}`).join("\n"),
          );
        }
      }
      await interaction.editReply({ embeds: [piedDeCommande(carte.embed, interaction)] });
    } catch (err) {
      await repondre(interaction, echec("Réglages illisibles", messagePanne(err)));
    }
  }

  @Slash({ description: "Attribuer un rôle à un palier de niveau", name: "recompense" })
  async recompense(
    @SlashOption({
      description: "Le niveau atteint",
      maxValue: NIVEAU_MAX,
      minValue: 2,
      name: "niveau",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    niveau: number,
    @SlashOption({
      description: "Le rôle à poser — jamais un rôle à permissions sensibles",
      name: "role",
      required: true,
      type: ApplicationCommandOptionType.Role,
    })
    role: Role,
    @SlashOption({
      description: "Garder aussi les rôles des paliers précédents (non par défaut)",
      name: "cumulable",
      required: false,
      type: ApplicationCommandOptionType.Boolean,
    })
    cumulable: boolean | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", "La progression se règle sur un serveur."));
      return;
    }

    // LE VERROU. Il vient avant toute écriture, et son message dit quoi faire.
    const verdict = verifierAttributionAutomatique(faitsDe(role), faitsBotDe(role));
    if (!verdict.ok) {
      await repondre(interaction, attention("Récompense refusée", verdict.motif, { prive: true }));
      return;
    }

    try {
      await sql`
				INSERT INTO bot_recompenses_niveau (guild_id, niveau, role_id, cumulable)
				VALUES (${guildId}, ${niveau}, ${role.id}, ${cumulable === true})
				ON CONFLICT (guild_id, niveau) DO UPDATE
					SET role_id = EXCLUDED.role_id, cumulable = EXCLUDED.cumulable
			`;
      await logAdminAction({
        action: "niveaux.recompense",
        adminId: admin.profileId,
        details: { cumulable: cumulable === true, niveau, role: role.id },
        discordId: interaction.user.id,
        targetId: guildId,
        targetType: "bot_recompenses_niveau",
      });
      await repondre(
        interaction,
        succes(
          `Niveau ${niveau} → ${role.name}`,
          `${entierLisible(xpPourAtteindre(niveau))} XP à accumuler. ` +
            (cumulable === true
              ? "Les rôles des paliers précédents sont conservés."
              : "Les rôles des paliers précédents seront retirés."),
          { prive: true },
        ),
      );
    } catch (err) {
      await repondre(interaction, echec("Enregistrement impossible", messagePanne(err)));
    }
  }

  @Slash({ description: "Retirer la récompense d'un palier", name: "retirer" })
  async retirer(
    @SlashOption({
      description: "Le niveau dont on retire la récompense",
      maxValue: NIVEAU_MAX,
      minValue: 1,
      name: "niveau",
      required: true,
      type: ApplicationCommandOptionType.Integer,
    })
    niveau: number,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", "La progression se règle sur un serveur."));
      return;
    }
    try {
      // `RETURNING` : un DELETE qui ne touche rien ne doit pas produire une
      // confirmation mensongère.
      const lignes = await sql<Array<{ role_id: string }>>`
				DELETE FROM bot_recompenses_niveau
				 WHERE guild_id = ${guildId} AND niveau = ${niveau}
				RETURNING role_id
			`;
      if (lignes.length === 0) {
        await repondre(
          interaction,
          attention("Rien à retirer", `Aucune récompense n'était posée au niveau ${niveau}.`, {
            prive: true,
          }),
        );
        return;
      }
      await logAdminAction({
        action: "niveaux.retirer",
        adminId: admin.profileId,
        details: { niveau, role: lignes[0]?.role_id },
        discordId: interaction.user.id,
        targetId: guildId,
        targetType: "bot_recompenses_niveau",
      });
      await repondre(
        interaction,
        succes(
          `Récompense du niveau ${niveau} retirée`,
          "Les rôles déjà attribués restent en place : les retirer ferait perdre un acquis.",
          { prive: true },
        ),
      );
    } catch (err) {
      await repondre(interaction, echec("Retrait impossible", messagePanne(err)));
    }
  }

  @Slash({ description: "Où et à quelle fréquence annoncer les montées", name: "annonce" })
  async annonce(
    @SlashChoice(
      ...LIEUX_ANNONCE.map(lieu => ({
        name:
          lieu === "salon"
            ? "Dans un salon dédié"
            : lieu === "place"
              ? "Dans le salon du message (bruyant)"
              : lieu === "prive"
                ? "En message privé"
                : "Nulle part",
        value: lieu,
      })),
    )
    @SlashOption({
      description: "Où annoncer",
      name: "lieu",
      required: true,
      type: ApplicationCommandOptionType.String,
    })
    lieu: string,
    @SlashOption({
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      description: "Le salon, si le lieu est « salon dédié »",
      name: "salon",
      required: false,
      type: ApplicationCommandOptionType.Channel,
    })
    salon: GuildTextBasedChannel | undefined,
    @SlashOption({
      description: "N'annoncer que les niveaux multiples de (5 par défaut, 1 = tous)",
      maxValue: 100,
      minValue: 1,
      name: "palier",
      required: false,
      type: ApplicationCommandOptionType.Integer,
    })
    palier: number | undefined,
    interaction: ChatInputCommandInteraction,
  ) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    const guildId = interaction.guildId;
    if (!guildId) {
      await repondre(interaction, echec("Hors serveur", "La progression se règle sur un serveur."));
      return;
    }
    if (lieu === "salon" && !salon) {
      await repondre(
        interaction,
        echec("Salon manquant", "Le lieu « salon dédié » a besoin d'un salon. Sans lui, rien ne serait annoncé."),
      );
      return;
    }
    try {
      const actuels = await reglagesDe(guildId);
      const modifies = fusionnerReglages(actuels, {
        niveaux: {
          annonce: lieu as (typeof LIEUX_ANNONCE)[number],
          ...(salon ? { salonAnnonce: salon.id } : {}),
          ...(palier ? { palierAnnonce: palier } : {}),
        },
      });
      await enregistrerReglages(guildId, modifies);
      await logAdminAction({
        action: "niveaux.annonce",
        adminId: admin.profileId,
        details: { lieu, palier: modifies.niveaux.palierAnnonce, salon: salon?.id },
        discordId: interaction.user.id,
        targetId: guildId,
        targetType: "bot_reglages_guilde",
      });
      await repondre(
        interaction,
        succes(
          "Annonce réglée",
          lieu === "aucune"
            ? "Plus aucune montée de niveau ne sera annoncée."
            : `${lieu === "salon" ? salon?.toString() : lieu} · ` +
                `${modifies.niveaux.palierAnnonce === 1 ? "chaque niveau" : `tous les ${modifies.niveaux.palierAnnonce} niveaux`}` +
                `${modifies.niveaux.annoncerRang ? ", plus les changements de rang" : ""}.`,
          { prive: true },
        ),
      );
    } catch (err) {
      await repondre(interaction, echec("Réglage refusé", messagePanne(err)));
    }
  }

  @Slash({ description: "Exclure (ou réinclure) un salon du gain d'XP", name: "salon" })
  async salonExclu(
    @SlashOption({
      channelTypes: [ChannelType.GuildText, ChannelType.GuildAnnouncement],
      description: "Le salon",
      name: "salon",
      required: true,
      type: ApplicationCommandOptionType.Channel,
    })
    salon: GuildTextBasedChannel,
    @SlashChoice({ name: "Exclure", value: "exclure" })
    @SlashChoice({ name: "Réinclure", value: "reinclure" })
    @SlashOption({
      description: "Exclure ou réinclure (exclure par défaut)",
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
      await repondre(interaction, echec("Hors serveur", "La progression se règle sur un serveur."));
      return;
    }
    try {
      const actuels = await reglagesDe(guildId);
      const exclus =
        action === "reinclure"
          ? actuels.niveaux.salonsExclus.filter(id => id !== salon.id)
          : [...new Set([...actuels.niveaux.salonsExclus, salon.id])];
      const modifies = fusionnerReglages(actuels, { niveaux: { salonsExclus: exclus } });
      await enregistrerReglages(guildId, modifies);
      await logAdminAction({
        action: "niveaux.salon",
        adminId: admin.profileId,
        details: { action: action ?? "exclure", salon: salon.id },
        discordId: interaction.user.id,
        targetId: guildId,
        targetType: "bot_reglages_guilde",
      });
      await repondre(
        interaction,
        succes(
          action === "reinclure" ? "Salon réinclus" : "Salon exclu",
          `${salon.toString()} ${action === "reinclure" ? "rapporte de nouveau de l'XP" : "ne rapporte plus d'XP"}. ` +
            "Les fils de ce salon suivent la même règle.",
          { prive: true },
        ),
      );
    } catch (err) {
      await repondre(interaction, echec("Réglage refusé", messagePanne(err)));
    }
  }
}
