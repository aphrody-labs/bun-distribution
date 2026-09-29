import { Category } from "@aphrody/utilities";
import type { CommandInteraction, GuildMember } from "discord.js";
import { ApplicationCommandOptionType, escapeMarkdown, MessageFlags, User } from "discord.js";
import type { Client } from "@aphrody/discordx";
import { Guard } from "@aphrody/discordx";

import { coreManagerConfig } from "@/configs";
import { Discord, Injectable, Slash, SlashGroup, SlashOption } from "@/decorators";
import { ClanEnabled, ClanRole } from "@/guards";
import { Database } from "@/services";
import { followUpWithErrorEmbed, syncUser } from "@/utils/functions";

import { ClanMemberRole } from "../../utils/enums";
import { buildApplicationDistinctionSelector } from "../../utils/functions/components";

@Discord()
@Guard(ClanEnabled, ClanRole(ClanMemberRole.SubCaptain))
@Injectable()
@Category("General")
@SlashGroup("clan")
export default class LeaveClanCommand {
	constructor(private db: Database) {}

	@Slash({
		description: "Invitez un joueur dans votre Clan",
		name: "invite-member",
	})
	async invite(
		@SlashOption({
			description: "User to invite to your Clan",
			name: "user",
			required: true,
			type: ApplicationCommandOptionType.User,
		})
		targetMember: GuildMember,
		interaction: CommandInteraction,
		client: Client,
		{ localize, clan, clanMember }: InteractionData
	) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });

		if (targetMember instanceof User) {
			followUpWithErrorEmbed(
				interaction,
				`${escapeMarkdown(targetMember.displayName)} is not present on ${coreManagerConfig.coreGuildName} !`
			);

			return;
		}
		await syncUser(targetMember.user);

		await interaction.followUp({
			content: `Sélectionnez les distinctions à proposer à l'utilisateur à inviter:`,
			flags: MessageFlags.Ephemeral,
			components: [buildApplicationDistinctionSelector(clan.id, "invite", targetMember.id)],
		});
	}
}
