import { Bot, Discord, Once } from "discordx";
import type { Client } from "discord.js";
import { inject, injectable } from "tsyringe";
import { logger } from "~/lib/logger";
import { CronRegistry } from "~/api/cron-registry";
import { TikTokService } from "~/services/TikTokService";

/**
 * Branche la surveillance TikTok au boot : lie le client Discord à
 * `TikTokService` et enregistre le cron de polling (live + nouvelles vidéos).
 *
 * Cadence 2 min : assez réactif pour annoncer un live rapidement, tout en
 * restant léger (un seul GET HTML par tick). Le tick est no-op tant que
 * `tiktok.enabled` est off (configurable via `/tiktok`). Hébergé sur shenron
 * (persona principal, présent dans la guilde avec les perms d'envoi).
 */
@Discord()
@Bot("shenron")
@injectable()
export class TikTokWatchEvent {
	constructor(
		@inject(CronRegistry) private cron: CronRegistry,
		@inject(TikTokService) private tiktok: TikTokService
	) {}

	@Once({ event: "clientReady" })
	ready([client]: [Client]) {
		this.tiktok.setClient(client);
		try {
			this.cron.register({
				name: "tiktok-watch",
				description: "Surveillance TikTok (@goku_dbfr) : notif live + nouvelles vidéos",
				intervalMs: 2 * 60_000,
				fn: () => void this.tiktok.tick(),
			});
		} catch (err) {
			logger.error(err as Error, "[tiktok] impossible d'enregistrer le cron tiktok-watch");
		}
	}
}
