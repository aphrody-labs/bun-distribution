import { injectable, inject } from "tsyringe";
import { Bot, Discord, Once } from "discordx";
import { CronRegistry } from "~/api/cron-registry";
import { InflationService } from "~/services/InflationService";
import { UrsafService } from "~/services/UrsafService";
import { logger } from "~/lib/logger";

/**
 * Tâches planifiées de l'économie.
 *
 * - `economy-inflation-snapshot` (toutes les 6 h) : instantané de la masse
 *   monétaire et de l'indice des prix. Idempotent par jour, donc le relancer
 *   plus souvent ne crée pas de points en double — il rattrape seulement un
 *   redémarrage tombé à cheval sur minuit.
 * - `ursaf-cycle` (toutes les 24 h) : calcul des avis d'imposition, puis
 *   notification ou recouvrement selon `economy.ursaf.mode` (off par défaut).
 */
@Discord()
@Bot("shenron")
@injectable()
export class EconomyCronEvent {
	constructor(
		@inject(CronRegistry) private cron: CronRegistry,
		@inject(InflationService) private inflation: InflationService,
		@inject(UrsafService) private ursaf: UrsafService
	) {}

	@Once({ event: "clientReady" })
	async register() {
		this.cron.register({
			name: "economy-inflation-snapshot",
			description: "Instantané de la masse monétaire et de l'indice des prix (inflation)",
			intervalMs: 6 * 3_600_000,
			fn: async () => {
				await this.inflation.snapshot();
			},
		});
		this.cron.register({
			name: "ursaf-cycle",
			description: "URSAF : avis d'imposition des tricheurs (notification ou recouvrement)",
			intervalMs: 24 * 3_600_000,
			fn: async () => {
				const r = await this.ursaf.run();
				logger.info(r, "[ursaf] cycle");
			},
		});
		// Premier point d'historique dès le démarrage, sans attendre 6 h.
		await this.inflation.snapshot().catch((err) => logger.warn({ err }, "[inflation] snapshot initial"));
	}
}
