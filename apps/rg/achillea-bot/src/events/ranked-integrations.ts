import { Client } from "@aphrody/discordx";

import { Discord, Injectable, Once } from "@/decorators";
import { resolveDependency } from "@/utils/functions";

import { LeaderboardAnnounceService } from "../services/LeaderboardAnnounceService";
import { RankedPromotionService } from "../services/RankedPromotionService";
import { RankedQueuePanelService } from "../services/RankedQueuePanelService";

/**
 * Démarre les intégrations Discord des salons Ranked (lecture seule sur le ranked web).
 * Handler `ready` dédié : le readyHandler principal (events/ready.ts) écoute "clientReady"
 * et n'est pas déclenché par discord.js v14 → on n'en dépend pas.
 */
@Discord()
@Injectable()
export default class RankedIntegrationsEvent {
	@Once("ready")
	async onReady([_client]: [Client]): Promise<void> {
		console.info("[ranked-integrations] ready — démarrage des intégrations Ranked");
		try {
			const [leaderboard, queuePanel, promotions] = await Promise.all([
				resolveDependency(LeaderboardAnnounceService),
				resolveDependency(RankedQueuePanelService),
				resolveDependency(RankedPromotionService),
			]);
			leaderboard.start();
			queuePanel.start();
			promotions.start();
		} catch (e) {
			console.error("[ranked-integrations] démarrage KO", e);
		}
	}
}
