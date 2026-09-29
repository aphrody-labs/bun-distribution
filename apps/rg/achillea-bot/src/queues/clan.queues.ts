import { Queue } from "bullmq";

import { PREFIXE_FILES, redisConnection } from "@/configs";

export const clanQueue = new Queue("clan", { connection: redisConnection, prefix: PREFIXE_FILES });

// Schedule a job that will run in 24 hours
export async function scheduleClanCheck(clanId: number) {
	const delay = 24 * 60 * 60 * 1000; // 24 hours
	const jobId = `checkClan_${clanId}`;

	await clanQueue.add(
		"checkClanMemberCount",
		{ clanId },
		{
			delay,
			jobId, // 🧩 Ensures only one job per clan
			removeOnComplete: true,
			removeOnFail: false,
		}
	);

	console.info(`🕒 Scheduled clan check for clan #${clanId} in 24 hours (jobId=${jobId})`);
}
