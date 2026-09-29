import { injectable, inject } from "tsyringe";
import { Bot, Discord, Guard, Slash, SlashChoice, SlashOption } from "discordx";
import { userTransformer } from "~/lib/slash-user";
import {
	ApplicationCommandOptionType,
	MessageFlags,
	type CommandInteraction,
	type User,
	type VoiceChannel,
} from "discord.js";
import { GuildOnly } from "~/guards/GuildOnly";
import { VocalTempoService } from "~/services/VocalTempoService";

@Discord()
@Bot("shenron")
@Guard(GuildOnly)
@injectable()
export class VocalCommands {
	constructor(@inject(VocalTempoService) private vts: VocalTempoService) {}

	@Slash({ name: "voc", description: "Gérer votre vocal temporaire" })
	async voc(
		@SlashChoice({ name: "kick", value: "kick" })
		@SlashChoice({ name: "ban", value: "ban" })
		@SlashChoice({ name: "unban", value: "unban" })
		@SlashOption({
			name: "action",
			description: "kick/ban/unban",
			type: ApplicationCommandOptionType.String,
			required: true,
		})
		action: "kick" | "ban" | "unban",
		@SlashOption(
			{
				name: "membre",
				description: "Membre",
				type: ApplicationCommandOptionType.User,
				required: true,
			},
			userTransformer
		)
		target: User,
		interaction: CommandInteraction
	) {
		if (!interaction.inCachedGuild()) return;
		const member = interaction.member;
		const voice = member.voice;
		const channel = voice?.channel as VoiceChannel | null;
		if (!channel) {
			await interaction.reply({
				content: "Tu dois être dans un vocal temporaire.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const ownerId = await this.vts.ownerOf(channel.id);
		if (!ownerId) {
			await interaction.reply({
				content: "Ce salon n'est pas un vocal temporaire.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		if (ownerId !== interaction.user.id) {
			await interaction.reply({
				content: "Seul le propriétaire peut gérer ce vocal.",
				flags: MessageFlags.Ephemeral,
			});
			return;
		}
		const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);

		if (action === "kick") {
			if (targetMember?.voice.channelId === channel.id)
				await targetMember.voice.disconnect("kick voc tempo").catch(() => {});
			await interaction.reply({ content: `👢 ${target} expulsé du vocal.` });
			return;
		}
		if (action === "ban") {
			await this.vts.banUser(interaction.user.id, target.id);
			await channel.permissionOverwrites.edit(target.id, { Connect: false }).catch(() => {});
			if (targetMember?.voice.channelId === channel.id)
				await targetMember.voice.disconnect("voc tempo ban").catch(() => {});
			await interaction.reply({ content: `🚫 ${target} banni du vocal.` });
			return;
		}
		await this.vts.unbanUser(interaction.user.id, target.id);
		await channel.permissionOverwrites.delete(target.id).catch(() => {});
		await interaction.reply({ content: `✅ ${target} débanni.` });
	}
}
