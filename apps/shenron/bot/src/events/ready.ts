import { Bot, Discord, Once } from "discordx";
import type { Client } from "discord.js";
import { inject, injectable } from "tsyringe";
import { logger } from "~/lib/logger";
import { RedisIndexerService } from "~/lib/redis-indexer";
import { CronRegistry } from "~/api/cron-registry";

@Discord()
@Bot("shenron")
@injectable()
export class ReadyEvent {
	constructor(
		@inject(RedisIndexerService) private redisIndexer: RedisIndexerService,
		@inject(CronRegistry) private cron: CronRegistry
	) {}

	@Once({ event: "clientReady" })
	async ready([client]: [Client]) {
		logger.info(`✓ Bot ready — ${client.user?.username} on ${client.guilds.cache.size} guild(s)`);

		// Lancer l'indexation Redis globale en arrière-plan au boot
		try {
			this.redisIndexer.indexAll(client).catch((e) => {
				logger.error(e as Error, "[REDIS INDEXER] Échec de l'indexation complète au démarrage");
			});
		} catch (err) {
			logger.error(err as Error, "[REDIS INDEXER] Erreur lors du lancement de l'indexation");
		}

		// Enregistrer la tâche planifiée d'indexation Redis (toutes les 15 minutes)
		try {
			this.cron.register({
				name: "redis-indexer",
				description:
					"Indexation périodique de tous les messages, utilisateurs et salons dans Redis",
				intervalMs: 15 * 60_000,
				fn: () => this.redisIndexer.indexAll(client),
			});
		} catch (err) {
			logger.error(err as Error, "[REDIS INDEXER] Impossible d'enregistrer la tâche cron");
		}

	}
}
