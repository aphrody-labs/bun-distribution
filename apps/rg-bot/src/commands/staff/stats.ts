/**
 * `/staff stats` — les compteurs du site et du serveur Discord.
 *
 * Reprend `commands/admin/stats.ts` (l'ancienne `/rg-admin`, une commande
 * unique sans arborescence) et lui ajoute la moitié qui manquait : le serveur
 * Discord lui-même, dont les tables `discord_*` sont peuplées par
 * `rg-cron.service` et n'étaient consultables qu'en SQL.
 *
 * ── LIGNE ROUGE VIE PRIVÉE ─────────────────────────────────────────────────
 * Les sondages sont comptés par leurs AGRÉGATS (`discord_polls.total_votes`,
 * `discord_poll_options.votes`). Le rattachement d'un membre à son choix n'est
 * lu nulle part ici, et n'a pas à l'être : un décompte n'a jamais eu besoin de
 * savoir qui a voté quoi. Aucune adresse e-mail ni postale ne sort de ces
 * embeds — `getAdminStats()` ne renvoie que des entiers.
 */
import { Discord, Slash, SlashGroup } from "discordx";
import type { ChatInputCommandInteraction } from "discord.js";

import { sql } from "../../lib/db";
import { cached } from "../../lib/cache";
import { rgEmbed } from "../../lib/embeds";
import { getAdminStats } from "../../services/admin";
import { formaterNombre, horodatageRelatif } from "./format";
import { differerEnPrive, exigerDroits, messagePanne } from "./garde";
import "./racine";
import { echec, piedTexte, repondre } from "../../lib/ui";

/** Compteurs du serveur Discord, tels que le cron les a synchronisés. */
interface StatsDiscord {
  membres: number;
  bots: number;
  partis: number;
  arrivees_30j: number;
  boosteurs: number;
  salons: number;
  salons_suivis: number;
  messages: number;
  messages_30j: number;
  sondages: number;
  sondages_ouverts: number;
  votes_cumules: number;
  dernier_sync: Date | null;
}

const TTL_STATS_DISCORD_MS = 60_000;

/**
 * Une seule requête, un seul aller-retour.
 *
 * Dix `count(*)` en dix requêtes, c'est dix tours de pooler pour un embed que
 * personne ne regarde plus de trois secondes.
 */
async function statsDiscord(): Promise<StatsDiscord> {
  return await cached("staff:stats:discord", TTL_STATS_DISCORD_MS, async () => {
    const [ligne] = await sql<StatsDiscord[]>`
      SELECT
        (SELECT count(*) FROM discord_members WHERE is_bot = false AND left_at IS NULL)::int   AS membres,
        (SELECT count(*) FROM discord_members WHERE is_bot = true)::int                        AS bots,
        -- « partis » et « arrivées » sont affichés SOUS le décompte des membres,
        -- qui exclut les bots : les compter ici sans le même filtre ferait un
        -- bloc dont les trois lignes ne parlent pas de la même population.
        (SELECT count(*) FROM discord_members WHERE is_bot = false AND left_at IS NOT NULL)::int AS partis,
        (SELECT count(*) FROM discord_members
           WHERE is_bot = false AND joined_at >= NOW() - INTERVAL '30 days')::int               AS arrivees_30j,
        (SELECT count(*) FROM discord_members WHERE premium_since IS NOT NULL)::int            AS boosteurs,
        (SELECT count(*) FROM discord_channels)::int                                           AS salons,
        (SELECT count(*) FROM discord_channels WHERE suivi = true)::int                        AS salons_suivis,
        (SELECT count(*) FROM discord_messages WHERE deleted_at IS NULL)::int                  AS messages,
        (SELECT count(*) FROM discord_messages
           WHERE deleted_at IS NULL AND created_at >= NOW() - INTERVAL '30 days')::int         AS messages_30j,
        (SELECT count(*) FROM discord_polls)::int                                              AS sondages,
        (SELECT count(*) FROM discord_polls WHERE ended = false)::int                          AS sondages_ouverts,
        (SELECT COALESCE(sum(total_votes), 0) FROM discord_polls)::int                         AS votes_cumules,
        (SELECT max(synced_at) FROM discord_messages)                                          AS dernier_sync
    `;
    return ligne!;
  });
}

@Discord()
@SlashGroup({
  name: "stats",
  description: "Compteurs du site et du serveur Discord",
  root: "staff",
})
@SlashGroup("stats", "staff")
export class StaffStatsCommand {
  @Slash({ name: "site", description: "Profils, articles, événements et équipe de rosegriffon.fr" })
  async site(interaction: ChatInputCommandInteraction) {
    await differerEnPrive(interaction);
    const admin = await exigerDroits(interaction);
    if (!admin) {
      return;
    }
    try {
      const stats = await getAdminStats();
      const embed = rgEmbed()
        .setTitle("Site Rose Griffon — état des compteurs")
        .setDescription(`Consulté avec le rôle **${admin.role}**.`)
        .addFields(
          {
            name: "Profils",
            value: `**${formaterNombre(stats.profiles_total)}** · +${formaterNombre(stats.profiles_24h)} en 24 h`,
            inline: true,
          },
          {
            name: "Administrateurs",
            value: formaterNombre(stats.admins),
            inline: true,
          },
          { name: "Bannis", value: formaterNombre(stats.banned), inline: true },
          {
            name: "Articles",
            value: `${formaterNombre(stats.articles_published)} publiés · ${formaterNombre(stats.articles_draft)} brouillons`,
            inline: true,
          },
          {
            name: "Événements",
            value: `${formaterNombre(stats.events_upcoming)} à venir · ${formaterNombre(stats.events_past)} passés`,
            inline: true,
          },
          {
            name: "Membres d'équipe",
            value: formaterNombre(stats.team_members),
            inline: true,
          },
        )
        .setFooter(
          piedTexte({
            note: "Compteurs mis en cache 30 s · aucune donnée personnelle affichée",
          }),
        );
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }

  @Slash({
    name: "discord",
    description: "Membres, salons, messages et sondages du serveur (décomptes agrégés)",
  })
  async discord(interaction: ChatInputCommandInteraction) {
    await differerEnPrive(interaction);
    if (!(await exigerDroits(interaction))) {
      return;
    }
    try {
      const stats = await statsDiscord();
      const embed = rgEmbed()
        .setTitle("Serveur Discord — état des compteurs")
        .setDescription(`Dernière synchronisation des messages : ${horodatageRelatif(stats.dernier_sync)}.`)
        .addFields(
          {
            name: "Membres",
            value:
              `**${formaterNombre(stats.membres)}** présents\n` +
              `${formaterNombre(stats.arrivees_30j)} arrivés en 30 j\n` +
              `${formaterNombre(stats.partis)} partis · ${formaterNombre(stats.bots)} bots`,
            inline: true,
          },
          {
            name: "Boosteurs",
            value: formaterNombre(stats.boosteurs),
            inline: true,
          },
          {
            name: "Salons",
            value: `${formaterNombre(stats.salons)} connus\n${formaterNombre(stats.salons_suivis)} suivis`,
            inline: true,
          },
          {
            name: "Messages archivés",
            value:
              `**${formaterNombre(stats.messages)}** au total\n` +
              `${formaterNombre(stats.messages_30j)} sur 30 jours\n` +
              "*(seuls les salons suivis sont archivés)*",
            inline: true,
          },
          {
            name: "Sondages",
            value:
              `${formaterNombre(stats.sondages)} au total\n` +
              `${formaterNombre(stats.sondages_ouverts)} encore ouverts\n` +
              `${formaterNombre(stats.votes_cumules)} votes cumulés`,
            inline: true,
          },
        )
        .setFooter(
          piedTexte({
            note: "Décomptes agrégés uniquement — le rattachement d'un membre à son vote n'est jamais lu",
          }),
        );
      await interaction.editReply({ embeds: [embed] });
    } catch (err) {
      await repondre(interaction, echec("Le service n'a pas répondu", messagePanne(err)));
    }
  }
}
