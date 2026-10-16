/**
 * Copyright 2026 Rose Griffon
 * SPDX-License-Identifier: Apache-2.0
 */

import { iecodeDataPath } from "@aphrody/paths";
import {
  getDiscordClient,
  hasVerifiedDiscordRoster,
  GUILD_ID,
  GUILDES_SUIVIES,
  syncAllMembers,
  syncAllRoles,
  syncStaffPhotos,
} from "../lib/discord.js";
import { sql } from "../lib/db.js";
import { syncDiscordGuildSnapshot, syncOAuthLinkMetadata } from "@rosegriffon/discord-sync";

/**
 * Synchronisation Discord — TOUS les serveurs suivis.
 *
 * La tâche ne connaissait qu'un serveur, celui de Rose Griffon. Elle balaie
 * désormais aussi celui d'Achilléa : le bot y est membre, avec l'intent
 * « Server Members », et la page communauté affiche la hiérarchie réelle des
 * deux — rôles, positions, permissions.
 *
 * Le partage des responsabilités est strict : chaque serveur alimente
 * `discord_appartenances` et `discord_roles`, mais SEUL celui de Rose Griffon
 * alimente `discord_members`, les avatars du site et la pré-création des
 * profils. Ce sont des mécanismes d'identité, pas d'appartenance.
 *
 * Un serveur en échec n'arrête pas les autres : le rapport le dit, et les
 * données du serveur suivant sont quand même rafraîchies.
 */
export async function runDiscordSync(): Promise<{ success: boolean; error?: string }> {
  console.log("[Cron Discord] Démarrage de la synchronisation Discord...");

  const client = getDiscordClient();
  if (!client) {
    const msg = "Client Discord non initialisé (vérifiez DISCORD_BOT_TOKEN).";
    console.warn(`[Cron Discord] ${msg}`);
    return { success: false, error: msg };
  }

  if (!GUILD_ID) {
    const msg = "DISCORD_GUILD_ID n'est pas configuré.";
    console.warn(`[Cron Discord] ${msg}`);
    return { success: false, error: msg };
  }

  const debut = new Date();
  let totalMembres = 0;
  let totalMisAJour = 0;
  let totalErreurs = 0;
  const resume: string[] = [];
  const echecs: string[] = [];

  for (const serveur of GUILDES_SUIVIES) {
    try {
      const guild = await client.guilds.fetch(serveur.id);
      if (!guild) {
        throw new Error(`serveur introuvable (${serveur.id})`);
      }

      console.log(`[Cron Discord] ${serveur.nom} (${guild.id}) — rôles...`);
      let snapshotMembersComplete = false;
      if (client.user) {
        const cachedRosterVerified = hasVerifiedDiscordRoster(guild.id);
        const instantane = await syncDiscordGuildSnapshot(
          guild,
          {
            sourceBotId: client.user.id,
            profile: "rg",
          },
          cachedRosterVerified
            ? {
                members: guild.members.cache,
                membersComplete: true,
              }
            : {},
        );
        if (instantane) {
          snapshotMembersComplete = instantane.membersComplete;
          console.log(
            `[Cron Discord] ${serveur.nom} — miroir SQLite : ${instantane.memberCount} membres, complétude=${instantane.membersComplete}`,
          );
        }
      }
      const rapportRoles = await syncAllRoles(guild);
      console.log(
        `[Cron Discord] ${serveur.nom} — rôles : ${rapportRoles.upserted}/${rapportRoles.fetched} en ${rapportRoles.durationMs} ms`,
      );

      console.log(`[Cron Discord] ${serveur.nom} — membres...`);
      const rapportMembres = await syncAllMembers(guild, snapshotMembersComplete ? guild.members.cache : undefined);
      console.log(
        `[Cron Discord] ${serveur.nom} — membres : ${rapportMembres.upserted}/${rapportMembres.fetched}, ${rapportMembres.partis} parti(s) en ${rapportMembres.durationMs} ms`,
      );
      for (const e of rapportMembres.errors.slice(0, 3)) {
        console.error(`  - ${serveur.nom} / membre ${e.discordId} : ${e.reason}`);
      }

      totalMembres += rapportMembres.fetched;
      totalMisAJour += rapportMembres.upserted;
      totalErreurs += rapportMembres.errors.length + rapportRoles.errors.length;
      if (rapportMembres.errors.length || rapportRoles.errors.length) {
        echecs.push(
          `${serveur.nom} : ${rapportMembres.errors.length} membre(s), ${rapportRoles.errors.length} rôle(s) en échec`,
        );
      }
      resume.push(
        `${serveur.nom} : ${rapportMembres.upserted}/${rapportMembres.fetched} membres, ${rapportRoles.upserted} rôles`,
      );
    } catch (err) {
      const motif = err instanceof Error ? err.message : String(err);
      console.error(`[Cron Discord] ${serveur.nom} : ${motif}`);
      echecs.push(`${serveur.nom} : ${motif}`);
      totalErreurs++;
    }
  }

  // Better Auth owns credentials. The shared bot mirror gets only stable link
  // identifiers and timestamps, including providers without a Discord guild.
  try {
    const links = await sql`SELECT id, user_id, provider_id, account_id, created_at, updated_at FROM account`;
    const typedLinks = links as unknown as {
      id: string;
      user_id: string;
      provider_id: string;
      account_id: string;
      created_at: Date | string | null;
      updated_at: Date | string | null;
    }[];
    const linked = await syncOAuthLinkMetadata(
      typedLinks.map(row => ({
        id: String(row.id),
        userId: String(row.user_id),
        providerId: String(row.provider_id),
        providerAccountId: String(row.account_id),
        linkedAt: row.created_at ? new Date(row.created_at).toISOString() : null,
        updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
      })),
    );
    if (linked !== null) resume.push(`liens OAuth : ${linked}`);
  } catch (error) {
    const motif = error instanceof Error ? error.message : String(error);
    console.error("[Cron Discord] liens OAuth :", motif);
    echecs.push(`liens OAuth : ${motif}`);
    totalErreurs++;
  }

  // Les avatars du staff ne dépendent pas d'un serveur : le service lit la
  // table `team_members`, qui n'a pas de notion de guilde.
  try {
    const rapportStaff = await syncStaffPhotos(client);
    console.log(
      `[Cron Discord] Staff : ${rapportStaff.updated}/${rapportStaff.total} mis à jour, ${rapportStaff.unchanged} inchangés en ${rapportStaff.durationMs} ms`,
    );
    resume.push(`staff : ${rapportStaff.updated}/${rapportStaff.total}`);
    totalErreurs += rapportStaff.errors.length;
  } catch (err) {
    const motif = err instanceof Error ? err.message : String(err);
    console.error(`[Cron Discord] avatars du staff : ${motif}`);
    echecs.push(`staff : ${motif}`);
    totalErreurs++;
  }

  const message = [resume.join(" · "), ...echecs.map(e => `ÉCHEC ${e}`)].filter(Boolean).join(" | ");

  await sql`
		INSERT INTO discord_sync_logs (status, total_members, updated_count, error_count, message, created_at)
		VALUES (${echecs.length === 0 ? "success" : "error"}, ${totalMembres}, ${totalMisAJour}, ${totalErreurs}, ${message}, NOW())
	`.catch(err => console.error("[Cron Discord] log de synchro non enregistré :", err));

  console.log(`[Cron Discord] terminé en ${Date.now() - debut.getTime()} ms — ${message}`);

  return totalErreurs === 0 ? { success: true } : { success: false, error: echecs.join(" | ") };
}

/**
 * Exécute une fonction asynchrone sur un tableau d'éléments en parallèle avec une limite de concurrence.
 */
async function runParallelWithLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += limit) {
    const chunk = items.slice(i, i + limit);
    const chunkResults = await Promise.all(chunk.map(fn));
    results.push(...chunkResults);
  }
  return results;
}

interface MessageScanData {
  id: string;
  authorId: string;
  authorTag: string;
  contentLength: number;
  timestamp: string;
}

interface ChannelScanResult {
  channelId: string;
  name: string;
  type: string;
  messageCount: number;
  error?: string;
  messages?: MessageScanData[];
}

/**
 * Scanne en parallèle tous les salons textuels et fils actifs du serveur.
 * Analyse les derniers messages et écrit un rapport JSON sur disque via les APIs natives de Bun.
 */
export async function runDiscordChannelScan(): Promise<{
  success: boolean;
  error?: string;
  stats?: any;
}> {
  console.log("[Cron Discord] Démarrage du scan parallèle des salons...");

  const client = getDiscordClient();
  if (!client) {
    const msg = "Client Discord non initialisé.";
    console.warn(`[Cron Discord] ${msg}`);
    return { success: false, error: msg };
  }

  if (!GUILD_ID) {
    const msg = "DISCORD_GUILD_ID non configuré.";
    console.warn(`[Cron Discord] ${msg}`);
    return { success: false, error: msg };
  }

  const start = Date.now();

  try {
    const guild = await client.guilds.fetch(GUILD_ID);
    if (!guild) {
      throw new Error(`Serveur non trouvé : ${GUILD_ID}`);
    }

    // Récupère tous les salons et les fils actifs du serveur
    const channels = await guild.channels.fetch();
    const activeThreads = await guild.channels.fetchActiveThreads();

    const allChannels = [...channels.values(), ...activeThreads.threads.values()];

    // Filtre uniquement les salons textuels
    const textChannels = allChannels.filter(c => c && c.isTextBased());
    console.log(`[Cron Discord] ${textChannels.length} salons textuels à scanner.`);

    // Limite de concurrence à 5 pour éviter d'être banni par le rate limit Discord
    const results = await runParallelWithLimit(textChannels, 5, async (chan): Promise<ChannelScanResult> => {
      const channel = chan as any;
      try {
        // Récupère les 50 derniers messages du salon
        const messages = await channel.messages.fetch({ limit: 50 });

        const scanData: MessageScanData[] = [...messages.values()].map(m => ({
          id: m.id,
          authorId: m.author.id,
          authorTag: m.author.tag,
          contentLength: m.content.length,
          timestamp: m.createdAt.toISOString(),
        }));

        return {
          channelId: channel.id,
          name: channel.name,
          type: channel.type.toString(),
          messageCount: messages.size,
          messages: scanData,
        };
      } catch (err: any) {
        return {
          channelId: channel.id,
          name: channel.name,
          type: channel.type.toString(),
          messageCount: 0,
          error: err.message || String(err),
        };
      }
    });

    // Calcul des statistiques globales
    let totalMessages = 0;
    let totalCharacters = 0;
    const authorMessageCount: Record<string, number> = {};
    const channelMessageCount: Record<string, number> = {};

    for (const r of results) {
      totalMessages += r.messageCount;
      if (r.messages) {
        channelMessageCount[r.name] = r.messageCount;
        for (const m of r.messages) {
          totalCharacters += m.contentLength;
          authorMessageCount[m.authorTag] = (authorMessageCount[m.authorTag] || 0) + 1;
        }
      }
    }

    const mostActiveAuthors = Object.entries(authorMessageCount)
      .map(([author, count]) => ({ author, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const mostActiveChannels = Object.entries(channelMessageCount)
      .map(([channel, count]) => ({ channel, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const stats = {
      scanDate: new Date().toISOString(),
      durationMs: Date.now() - start,
      totalChannelsScanned: textChannels.length,
      totalMessages,
      totalCharacters,
      averageMessageLength: totalMessages > 0 ? Math.round(totalCharacters / totalMessages) : 0,
      mostActiveAuthors,
      mostActiveChannels,
    };

    // Écriture du rapport sur le disque en utilisant Bun.write (API native rapide)
    const reportPath = iecodeDataPath("discord-channels-scan.json");
    const reportContent = JSON.stringify({ stats, channels: results }, null, 2);

    await Bun.write(reportPath, reportContent);
    console.log(`✓ Scan terminé en ${stats.durationMs}ms. Rapport écrit sur : ${reportPath}`);

    // Insertion du log du scan
    await sql`
			INSERT INTO discord_sync_logs (status, total_members, updated_count, error_count, message, created_at)
			VALUES ('scan_success', ${guild.memberCount}, ${totalMessages}, 0, ${`Scan de ${textChannels.length} salons terminé. Total messages : ${totalMessages}`}, NOW())
		`.catch(err => console.error("[Cron Discord] Échec log scan:", err));

    return { success: true, stats };
  } catch (err: any) {
    const errMsg = err.message || String(err);
    console.error("[Cron Discord] Échec lors du scan parallèle :", err);

    await sql`
			INSERT INTO discord_sync_logs (status, total_members, updated_count, error_count, message, created_at)
			VALUES ('scan_error', 0, 0, 1, ${errMsg}, NOW())
		`.catch(dbErr => console.error("[Cron Discord] Échec log d'erreur scan:", dbErr));

    return { success: false, error: errMsg };
  }
}
