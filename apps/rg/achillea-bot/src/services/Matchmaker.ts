import { Client } from "@aphrody/discordx";
import { asyncScheduler } from "rxjs";

import { Schedule, Service } from "@/decorators";
import { Lobby, Ranked } from "@/entities";

import { EventTypeEnum, RankedState } from "../utils/enums";
import { AnnouncementService } from "./AnnouncementService";
import { Database } from "./Database";
import { RankedQueueService } from "./RankedQueueService";

@Service()
export class Matchmaker {
	constructor(
		private db: Database,
		private queueService: RankedQueueService,
		private announcer: AnnouncementService,
		private client: Client
	) {}

	// @Schedule('*/30 * * * *')
	async initMatchmaking() {
		const rankedIndex = (await this.db.em.count(Ranked)) + 1;
		const ranked = new Ranked();
		ranked.name = `Ranked Session ${rankedIndex}`;
		ranked.description = `Automated Ranked Session n.${rankedIndex}`;
		ranked.type = EventTypeEnum.RANKED;
		ranked.queueEndsAt = new Date(Date.now() + 30 * 60_000); // 30 minutes from now

		await this.db.em.persist(ranked).flush();

		await this.queueService.initFromDatabase(ranked);

		asyncScheduler.schedule(() => this.queueService.startSession(ranked, this.client), 30_000);

		await this.db.em.persist(ranked).flush();

		await this.announcer.announceRankedQueue(this.client, ranked);
	}

	async getEventFromCustomId(customId: string): Promise<Ranked> {
		const [, id] = customId.split(":");

		return this.db.em.findOneOrFail(Ranked, { id: Number(id) });
	}

	async getLobbyFromCustomId(customId: string): Promise<Lobby> {
		const [, id] = customId.split(":");

		return this.db.em.findOneOrFail(Lobby, { id: Number(id) });
	}

	@Schedule("*/1 * * * *") // every minute
	async checkQueueExpirations() {
		const now = new Date();
		const due = await this.db.em.find(Ranked, {
			status: RankedState.OPEN,
			queueEndsAt: { $lte: now },
		});
		for (const ranked of due) {
			await this.queueService.startSession(ranked, this.client);
		}
	}
}
