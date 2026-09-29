import { injectable, inject } from "tsyringe";
import { Bot, Discord, Once } from "discordx";
import type { Client } from "discord.js";
import { CronRegistry } from "~/api/cron-registry";
import { LevelService } from "~/services/LevelService";
import { SettingsService } from "~/services/SettingsService";
import { logger } from "~/lib/logger";

/** Intervalle par défaut : toutes les 6 h (override via `cron.level-role-reconcile.interval_ms`). */
const DEFAULT_INTERVAL_MS = 6 * 3_600_000;

/**
 * Vérifie périodiquement que chaque membre possède les rôles de palier
 * correspondant à sa race et à son niveau (XP en base).
 */
@Discord()
@Bot("shenron")
@injectable()
export class LevelRoleSyncEvent {
	constructor(
		@inject(CronRegistry) private cron: CronRegistry,
		@inject(LevelService) private levels: LevelService,
		@inject(SettingsService) private settings: SettingsService
	) {}

	@Once({ event: "clientReady" })
	async onReady([client]: [Client]) {
		this.cron.register({
			name: "level-role-reconcile",
			description:
				"Vérifie que chaque membre a les rôles de palier correspondant à sa race et son niveau",
			intervalMs: DEFAULT_INTERVAL_MS,
			fn: () => this.reconcileAll(client),
		});
		// Rattrapage immédiat au boot (ex. après refonte des échelles).
		void this.reconcileAll(client).catch((err) =>
			logger.warn({ err }, "level-role-reconcile boot run failed")
		);
	}

	private async reconcileAll(client: Client) {
		if (!(await this.settings.getBool("features.level_role_sync", true))) return;

		const guild = client.guilds.cache.first();
		if (!guild) return;

		await guild.members.fetch().catch(() => null);
		const stats = await this.levels.reconcileAllRaceLevelRoles(guild);
		logger.info(stats, "level-role-reconcile completed");
	}
}
