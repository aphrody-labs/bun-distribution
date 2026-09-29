import type { CommandInteraction, User as DiscordUser } from "discord.js";
import { MessageFlags } from "discord.js";
import type { Client } from "@aphrody/discordx";
import { Guild } from "@aphrody/discordx";

import { adminManagerConfig } from "@/configs";
import { Discord, Guard, Injectable, Slash, SlashGroup } from "@/decorators";
import { User } from "@/entities";
import { Disabled } from "@/guards";
import { Database, UserService } from "@/services";
import { followUpWithSuccessEmbed, freshDiscordAvatarUrl, normalizeNames } from "@/utils/functions";

@Discord()
@Injectable()
@Guild(adminManagerConfig.adminGuildId)
@SlashGroup("owner")
export default class ResyncUsersCommand {
	constructor(
		private db: Database,
		private userService: UserService
	) {}

	@Slash({
		name: "resync-users",
	})
	@Guard(Disabled)
	async resyncUsers(
		interaction: CommandInteraction,
		client: Client,
		{ localize }: InteractionData
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		await this.resyncAllUsers(interaction);
		followUpWithSuccessEmbed(interaction, "Successfully resynced all users !");
	}

	async resyncUser(discordUser: DiscordUser) {
		const user = await this.db.em.findOne(User, { id: discordUser.id });

		if (user) {
			user.avatar = freshDiscordAvatarUrl(discordUser);
			user.username = discordUser.username;
			user.displayName = discordUser.displayName;
			user.normalizedDisplayName = normalizeNames(discordUser.displayName);
		}
	}

	async resyncAllUsers(interaction: CommandInteraction) {
		const allUsers = await this.db.em.find(User, {});
		const userIds = allUsers.map((u) => u.id);

		const batches = this.chunk(userIds, 10); // 10 per batch

		await interaction.editReply({
			content: `${userIds.length} users fetched from Database for a total of ${batches.length} batches.`,
		});

		let batchCounter = 0;
		for (const batch of batches) {
			batchCounter += 1;
			await interaction.editReply({
				content: `Processing batch ${batchCounter}/${batches.length}`,
			});
			const discordUsers = await Promise.all(
				batch.map(
					(id) => this.userService.getDiscordUser(id) // returns null if unknown user
				)
			);

			for (const discordUser of discordUsers) {
				if (!discordUser) continue;

				await this.resyncUser(discordUser);
			}

			// Flush DB once per batch
			await this.db.em.flush();

			// Delay to avoid rate limits
			await this.wait(1500); // 1.5 seconds between batches
		}
	}

	private wait(ms: number) {
		return new Promise((res) => setTimeout(res, ms));
	}

	private chunk<T>(arr: T[], size: number): T[][] {
		const out = [];
		for (let i = 0; i < arr.length; i += size) {
			out.push(arr.slice(i, i + size));
		}

		return out;
	}
}
