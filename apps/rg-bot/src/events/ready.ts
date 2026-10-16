import { Discord, Once } from "discordx";
import type { Client } from "discord.js";

import { syncAllMembers } from "../services/syncMembers";
import { syncStaffPhotos } from "../services/teamPhotos";
import { BOT_SYNC_MEMBRES, GUILD_ID, SYNC_INTERVAL_MS } from "../lib/config";

/**
 * Événement `ready` du bot.
 *
 * Le serveur HTTP d'annonces (`POST :3006/announce`) qui vivait ici a été
 * retiré : `rg-cron.service` écoute déjà sur ce port (voir
 * `packages/cron/src/index.ts`, `ANNOUNCE_PORT = 3006`). Le garder aurait fait
 * échouer le démarrage du bot en `EADDRINUSE`, ou volé le port au cron.
 *
 * La synchronisation périodique est elle aussi laissée au cron par défaut ; le
 * drapeau `BOT_SYNC_MEMBRES=1` la rend au bot (voir `lib/config.ts`).
 */
@Discord()
export class ReadyEvent {
	// `clientReady` : `ready` est déprécié en discord.js 14.26 et ne sera plus
	// émis en v15 (cf. `index.ts`).
	@Once({ event: "clientReady" })
	async ready([client]: [Client]) {
		console.log(`✓ Prêt en tant que ${client.user?.tag} — ${client.guilds.cache.size} serveur(s)`);

		if (!BOT_SYNC_MEMBRES) {
			console.log(
				"↔ Synchronisation des membres laissée à rg-cron.service (BOT_SYNC_MEMBRES≠1) — ce bot ne sert que les slash commands."
			);
			return;
		}

		if (!GUILD_ID) {
			console.warn("⚠ GUILD_ID absent — synchronisation des membres ignorée");
			return;
		}

		const guild = client.guilds.cache.get(GUILD_ID);
		if (!guild) {
			console.warn(`⚠ Le bot n'est pas présent sur le serveur ${GUILD_ID}`);
			return;
		}

		await this.runSync(guild.id, client);
		setInterval(() => {
			void this.runSync(guild.id, client);
		}, SYNC_INTERVAL_MS);
	}

	private async runSync(guildId: string, client: Client): Promise<void> {
		const guild = client.guilds.cache.get(guildId);
		if (!guild) return;
		try {
			const report = await syncAllMembers(guild);
			console.log(
				`[sync] ${report.upserted}/${report.fetched} membres écrits en ${report.durationMs}ms` +
					(report.errors.length ? ` — ${report.errors.length} erreur(s)` : "")
			);
			for (const e of report.errors.slice(0, 5)) {
				console.error(`  ✗ ${e.discordId}: ${e.reason}`);
			}
		} catch (err) {
			console.error("[sync] échec :", err);
		}

		// Sync ciblé staff (team_members) — propage l'avatar vers 3 tables
		try {
			const photos = await syncStaffPhotos(client);
			console.log(
				`[staff-photos] ${photos.updated}/${photos.total} mis à jour, ${photos.unchanged} inchangés en ${photos.durationMs}ms` +
					(photos.errors.length ? ` — ${photos.errors.length} erreur(s)` : "")
			);
			for (const e of photos.errors.slice(0, 3)) {
				console.error(`  ✗ ${e.name}: ${e.reason}`);
			}
		} catch (err) {
			console.error("[staff-photos] échec :", err);
		}
	}
}
