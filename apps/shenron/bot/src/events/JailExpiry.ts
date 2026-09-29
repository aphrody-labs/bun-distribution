import { injectable, inject } from "tsyringe";
import { Bot, Discord, Once } from "discordx";
import type { Client } from "discord.js";
import { and, isNull, lte } from "drizzle-orm";
import { DatabaseService } from "~/db/index";
import { jails } from "~/db/schema";
import { ModerationService } from "~/services/ModerationService";
import { MessageTemplateService } from "~/services/MessageTemplateService";
import { env } from "~/lib/env";
import { CronRegistry } from "~/api/cron-registry";

@Discord()
@Bot("shenron")
@injectable()
export class JailExpiryEvent {
	constructor(
		@inject(DatabaseService) private dbs: DatabaseService,
		@inject(ModerationService) private mod: ModerationService,
		@inject(CronRegistry) private cron: CronRegistry,
		@inject(MessageTemplateService) private msg: MessageTemplateService
	) {}

	@Once({ event: "clientReady" })
	async start([client]: [Client]) {
		this.cron.register({
			name: "jail-expiry",
			description: "Auto-unjail des membres dont la peine expire",
			intervalMs: 60_000,
			fn: () => this.tick(client),
		});
	}

	async tick(client: Client) {
		const now = new Date();
		const expired = await this.dbs.db
			.select()
			.from(jails)
			.where(and(isNull(jails.releasedAt), lte(jails.expiresAt, now)));
		const guild = client.guilds.cache.get(env.GUILD_ID);
		if (!guild) return;
		for (const j of expired) {
			await this.mod
				.unjail(guild, j.userId, client.user?.id ?? "bot", "auto-expiry")
				.catch(() => {});
			const member = await guild.members.fetch(j.userId).catch(() => null);
			const durationMs = j.expiresAt ? j.expiresAt.getTime() - j.createdAt.getTime() : 0;
			await this.msg.publish(
				"jail_expired",
				{
					user: `<@${j.userId}>`,
					userName: member?.user.username ?? j.userId,
					duration: formatDuration(durationMs),
				},
				client
			);
		}
	}
}

function formatDuration(ms: number): string {
	if (ms <= 0) return "—";
	const s = Math.floor(ms / 1000);
	const d = Math.floor(s / 86400);
	const h = Math.floor((s % 86400) / 3600);
	const m = Math.floor((s % 3600) / 60);
	if (d > 0) return `${d}j ${h}h`;
	if (h > 0) return `${h}h ${m}m`;
	return `${m}m`;
}
