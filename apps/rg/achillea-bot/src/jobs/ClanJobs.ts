import type { Job } from "bullmq";
import { Client } from "@aphrody/discordx";

import { Clan, ClanMember } from "@/entities";
import { Database } from "@/services";
import { disbandClan } from "@/utils/functions";

export class ClanJobs {
	constructor(
		private db: Database,
		private client: Client
	) {}

	async checkClanMemberCount(job: Job) {
		const em = this.db.em.fork();
		const { clanId } = job.data;

		const clan = await em.findOneOrFail(Clan, clanId);
		const memberCount = await em.count(ClanMember, { clan });

		if (memberCount < 5 && clan.underMemberLimit) {
			console.warn(`⚠️ Clan ${clan.name} still under 5 members after 24h. Disbanding...`);

			return await disbandClan(clan, this.db, this.client, true);
		}

		if (memberCount >= 5 && clan.underMemberLimit) {
			console.info(`✅ Clan ${clan.name} has recovered to ${memberCount} members.`);
			clan.underMemberLimit = false;
			await em.flush();
		}

		console.warn(
			`⚙️ Clan ${clan.name}: no action needed (count=${memberCount}, flag=${clan.underMemberLimit})`
		);
	}
}
