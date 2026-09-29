import type { CommandInteraction } from "discord.js";
import { ApplicationCommandOptionType, escapeMarkdown, GuildMember } from "discord.js";
import type { Client } from "@aphrody/discordx";
import { Guild } from "@aphrody/discordx";

import { adminManagerConfig } from "@/configs";
import {
	Discord,
	Guard,
	Injectable,
	Slash,
	SlashChoice,
	SlashGroup,
	SlashOption,
} from "@/decorators";
import { User as UserEntity } from "@/entities";
import { Disabled } from "@/guards";
import { Database } from "@/services";
import { followUpWithSuccessEmbed, syncUser } from "@/utils/functions";

@Discord()
@Injectable()
@Guild(adminManagerConfig.adminGuildId)
@SlashGroup({ description: "Owner scope", name: "owner" })
@SlashGroup("owner")
export default class BotRoleCommand {
	constructor(private db: Database) {}

	@Slash({
		name: "bot-role",
	})
	@Guard(Disabled)
	async botRole(
		@SlashChoice({ name: "Add", value: "add" })
		@SlashChoice({ name: "Remove", value: "remove" })
		@SlashOption({
			name: "action",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		action: string,
		@SlashOption({
			name: "user",
			type: ApplicationCommandOptionType.User,
			required: true,
		})
		user: GuildMember,
		@SlashChoice({ name: "Admin", value: "admin" })
		@SlashChoice({ name: "Mod", value: "mod" })
		@SlashChoice({ name: "Super Admin", value: "superadmin" })
		@SlashOption({
			name: "role",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		role: string,
		interaction: CommandInteraction,
		client: Client,
		{ localize }: InteractionData
	) {
		await interaction.deferReply();
		const cmdUser = user instanceof GuildMember ? user.user : user;
		await syncUser(cmdUser);
		const usersRepo = this.db.get(UserEntity);
		const fetchedUser = await usersRepo.findOne({ id: user.id });
		if (role === "admin") {
			await usersRepo.setBotAdmin(fetchedUser!.id, action === "add");
			if (action === "add") {
				await user.roles.add(adminManagerConfig.adminRoleId);
			} else {
				await user.roles.remove(adminManagerConfig.adminRoleId);
			}
			followUpWithSuccessEmbed(
				interaction,
				`${escapeMarkdown(cmdUser.displayName)} is ${action === "add" ? "now" : "no longer"} a bot admin !`
			);
		} else if (role === "mod") {
			await usersRepo.setBotModerator(fetchedUser!.id, action === "add");
			followUpWithSuccessEmbed(
				interaction,
				`${escapeMarkdown(cmdUser.displayName)} is ${action === "add" ? "now" : "no longer"} a bot moderator !`
			);
		} else if (role === "superadmin") {
			await usersRepo.setBotSuperAdmin(fetchedUser!.id, action === "add");
			followUpWithSuccessEmbed(
				interaction,
				`${escapeMarkdown(cmdUser.displayName)} is ${action === "add" ? "now" : "no longer"} a bot super admin !`
			);
		}
	}
}
