import { Bot, Discord, Once } from "discordx";
import type { Client } from "discord.js";
import { inject, injectable } from "tsyringe";
import { logger } from "~/lib/logger";
import { CronRegistry } from "~/api/cron-registry";
import { CanonService } from "~/services/CanonService";

/**
 * Branche le « canon du jour » au boot : lie le client Discord à
 * `CanonService` et enregistre le cron de publication.
 *
 * Cadence 15 min : le tick est no-op tant que `canon.daily_enabled` est off,
 * tant que l'heure réglée (`canon.daily_hour`, UTC) n'est pas atteinte, et une
 * fois la publication du jour faite. Un tick raté (redémarrage) se rattrape au
 * suivant, sans doublon grâce à `canon.last_posted_day`.
 */
@Discord()
@Bot("shenron")
@injectable()
export class CanonWatchEvent {
	constructor(
		@inject(CronRegistry) private cron: CronRegistry,
		@inject(CanonService) private canon: CanonService
	) {}

	@Once({ event: "clientReady" })
	ready([client]: [Client]) {
		this.canon.setClient(client);
		try {
			this.cron.register({
				name: "canon-daily",
				description: "Canon du jour : publie un sujet tranché de la doctrine de canonicité",
				intervalMs: 15 * 60_000,
				fn: () => void this.canon.tick(),
			});
		} catch (err) {
			logger.error(err as Error, "[canon] impossible d'enregistrer le cron canon-daily");
		}
	}
}
