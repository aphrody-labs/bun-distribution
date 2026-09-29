import { Client } from "@aphrody/discordx";

import { Injectable, Schedule } from "@/decorators";
import { resolveDependency } from "@/utils/functions";

import { CastNotificationService } from "../services/CastNotificationService";

// CastReminders — T-2.4
// Cron toutes les 15 min — dispatche les rappels J-2 et H-2 aux casters.

@Injectable()
export class CastReminders {
	@Schedule("*/15 * * * *", "cast-reminders")
	async dispatchUpcoming() {
		const client = await resolveDependency(Client);
		const service = await resolveDependency(CastNotificationService);
		await service.dispatchUpcoming(client);
	}
}
