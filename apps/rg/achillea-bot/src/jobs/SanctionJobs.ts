import type { Job } from "bullmq";
import { Client } from "@aphrody/discordx";

import { MetricsService } from "@/services/MetricsService";
import { SanctionService } from "@/services/SanctionService";
import { CrossSyncService } from "@/services/CrossSyncService";

export class SanctionJobs {
	private sanctionService: SanctionService;

	constructor(private client: Client) {
		this.sanctionService = new SanctionService(
			client,
			new CrossSyncService(),
			new MetricsService()
		);
	}

	async revoke(job: Job): Promise<void> {
		const { sanctionId } = job.data as { sanctionId: string };

		try {
			await this.sanctionService.revoke(sanctionId, "system");
			console.info(`[SanctionJobs] Sanction ${sanctionId} auto-revoked by TTL`);
		} catch (err: unknown) {
			const msg = err instanceof Error ? err.message : String(err);
			console.error(`[SanctionJobs] Failed to auto-revoke sanction ${sanctionId}: ${msg}`);
			throw err;
		}
	}
}
