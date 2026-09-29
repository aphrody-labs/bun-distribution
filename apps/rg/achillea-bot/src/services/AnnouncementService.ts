import type { BaseMessageOptions, Client, TextChannel } from "discord.js";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import type { Generated, Kysely } from "kysely";

import { createAchilleaSql } from "@rosegriffon/db/achillea-sql";
import { coreManagerConfig } from "@/configs";
import { Service } from "@/decorators";
import type { Event, Ranked } from "@/entities";
import { batchSend, createRankedQueueEmbed, resolveDependency } from "@/utils/functions";

import { logOnAchilleaRankedChannel } from "../utils/functions/messager";
import { Logger } from "./Logger";

interface AnnouncementDatabase {
	guild: {
		id: string;
		broadcast_channel: string | null;
		ranked_enabled: boolean;
	};
	event_announcement: {
		id: Generated<number>;
		event_id: number;
		guild_id: string;
		channel_id: string;
		message_id: string;
		created_at: Generated<Date>;
		updated_at: Generated<Date>;
	};
}

const sql = createAchilleaSql<AnnouncementDatabase>() as Kysely<AnnouncementDatabase>;

@Service()
export class AnnouncementService {
	/**
	 * Send the “ranked queue open” message to every configured guild,
	 * batching N in parallel, and record each send in EventAnnouncement.
	 */
	async announceRankedQueue(client: Client, ranked: Ranked): Promise<void> {
		// 1) load all your Guild configs from the database
		const guilds = await sql
			.selectFrom("guild")
			.select(["id", "broadcast_channel"])
			.where("broadcast_channel", "is not", null)
			.where("ranked_enabled", "=", true)
			.execute();

		if (!guilds.length) {
			console.warn("No guilds configured for ranked announcements.");

			return;
		}

		const btnJoin = new ButtonBuilder()
			.setLabel("Join")
			.setStyle(ButtonStyle.Success)
			.setCustomId(`join_queue:${ranked.id}`);
		const btnLeave = new ButtonBuilder()
			.setLabel("Leave")
			.setStyle(ButtonStyle.Danger)
			.setCustomId(`leave_queue:${ranked.id}`);

		const row = new ActionRowBuilder<ButtonBuilder>().addComponents(btnJoin, btnLeave) as any;

		const logger = await resolveDependency(Logger);

		const msg: BaseMessageOptions = {
			embeds: [createRankedQueueEmbed(ranked, 0)],
			components: [row],
		};

		const achilleaAnnouncement = await logOnAchilleaRankedChannel(logger, msg);
		await sql
			.insertInto("event_announcement")
			.values({
				event_id: ranked.id,
				guild_id: coreManagerConfig.coreGuildId,
				channel_id: coreManagerConfig.rankedAnnouncementsChannelId,
				message_id: achilleaAnnouncement!.id,
			})
			.execute();

		// 2) batch‐size (tune as needed under Discord rate limits)
		const batchSize = 10;

		await batchSend(guilds, batchSize, async (guildEntity) => {
			// fetch the broadcast channel by its snowflake
			const channel = await client.channels
				.fetch(guildEntity.broadcast_channel!)
				.then((ch) => ch as TextChannel)
				.catch(() => null);
			if (!channel) return;

			// send the queue message with buttons
			const msg = await channel.send({
				embeds: [createRankedQueueEmbed(ranked, 0)],
				components: [row],
			});

			// 3) record this announcement for later edits/cleanup
			await sql
				.insertInto("event_announcement")
				.values({
					event_id: ranked.id,
					guild_id: guildEntity.id,
					channel_id: channel.id,
					message_id: msg.id,
				})
				.execute();
		});

		console.info(`Announced Ranked#${ranked.id} to ${guilds.length} guilds.`);
	}

	async editEventAnnouncements(
		client: Client,
		event: Event,
		msgToSend: BaseMessageOptions
	): Promise<void> {
		// 1) fetch all announcements for this event
		const anns = await sql
			.selectFrom("event_announcement")
			.select(["channel_id", "message_id"])
			.where("event_id", "=", event.id)
			.execute();

		// 2) batch‐size under rate limits
		const batchSize = 10;

		await batchSend(anns, batchSize, async (ann) => {
			// fetch the channel
			const ch = await client.channels
				.fetch(ann.channel_id)
				.then((c) => c as TextChannel)
				.catch(() => null);
			if (!ch) return;

			// fetch the message
			const msg = await ch.messages.fetch(ann.message_id).catch(() => null);
			if (!msg) return;

			// option A: remove all components entirely
			await msg.edit(msgToSend);
		});

		console.info(`Cleared buttons for event ${event.id} across all announcements.`);
	}
}
