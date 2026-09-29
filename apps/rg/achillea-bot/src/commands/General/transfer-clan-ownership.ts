import { Category } from "@aphrody/utilities";
import type { BaseMessageOptions, CommandInteraction, User } from "discord.js";
import {
	ApplicationCommandOptionType,
	escapeMarkdown,
	GuildMember,
	MessageFlags,
} from "discord.js";
import type { Client } from "@aphrody/discordx";
import { Guard } from "@aphrody/discordx";

import { coreManagerConfig } from "@/configs";
import { Discord, Injectable, Slash, SlashGroup, SlashOption } from "@/decorators";
import { ClanMember } from "@/entities";
import { ClanEnabled, ClanRole } from "@/guards";
import { Database, Logger } from "@/services";
import {
	buildSimpleUserEmbed,
	followUpWithErrorEmbed,
	followUpWithSuccessEmbed,
	resolveDependency,
} from "@/utils/functions";

import { ClanMemberRole } from "../../utils/enums";
import { buildValidationModal } from "../../utils/functions/components";
import { logOnAchilleaGenericClanChannel, logOnClanChannels } from "../../utils/functions/messager";

@Discord()
@Guard(ClanEnabled, ClanRole(ClanMemberRole.Captain))
@Injectable()
@Category("General")
@SlashGroup("clan")
export default class TransferClanOwnershipCommand {
	constructor(private db: Database) {}

	@Slash({
		description: "Permet de transférer la présidence du Clan à un autre membre",
		name: "transfer-ownership",
	})
	async transferClanOwnership(
		@SlashOption({
			description: "Membre à qui céder la présidence du Clan",
			name: "member",
			required: true,
			type: ApplicationCommandOptionType.User,
		})
		member: GuildMember,
		interaction: CommandInteraction,
		client: Client,
		{ localize, clan, clanMember }: InteractionData
	) {
		if (interaction.user.id === member.id) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			followUpWithErrorEmbed(
				interaction,
				`Vous ne pouvez pas vous choisir comme cible de l'action !`
			);

			return;
		}

		const clanMembersRepo = this.db.get(ClanMember);

		const guildMemberUser = member instanceof GuildMember ? member.user : (member as User);
		const targetIsMember = await clanMembersRepo.findOne({ clan, user: guildMemberUser.id });
		if (!targetIsMember) {
			await interaction.deferReply({ flags: MessageFlags.Ephemeral });
			followUpWithErrorEmbed(
				interaction,
				`L'utilisateur ${escapeMarkdown(guildMemberUser.displayName)} de fait pas partie de votre Clan !`
			);

			return;
		}

		const validationString = "Je confirme";
		await interaction.showModal(buildValidationModal(validationString));
		const submittedModal = await interaction
			.awaitModalSubmit({
				time: 60_000,
				filter: (i) => i.user.id === interaction.user.id,
			})
			.catch((error) => {
				console.info(error);

				return null;
			});

		if (submittedModal) {
			const wasDeferred = await submittedModal
				.deferReply({ flags: MessageFlags.Ephemeral })
				.catch(() => {
					return false;
				});

			if (!wasDeferred) {
				return;
			}

			const validationResponse = submittedModal.fields.getTextInputValue("userInput");
			if (validationResponse !== validationString) {
				followUpWithErrorEmbed(submittedModal, `La validation a échoué !`);

				return;
			}
			if (!(await clanMembersRepo.transferOwnership(clan.id, guildMemberUser.id))) {
				followUpWithErrorEmbed(submittedModal, `La transfert de la présidence a échoué !`);

				return;
			}
			await this.db.em.flush();

			await this.changeCaptain(interaction.user, guildMemberUser, client);

			followUpWithSuccessEmbed(
				submittedModal,
				`${escapeMarkdown(guildMemberUser.displayName)} est est maintenant le nouveau Président de votre Clan`
			);

			const logger = await resolveDependency(Logger);

			const msg: BaseMessageOptions = {
				embeds: [
					await buildSimpleUserEmbed(
						guildMemberUser,
						"Nouveau Président",
						`${escapeMarkdown(guildMemberUser.displayName)} est maintenant le nouveau Président du Clan !`,
						0x206694
					),
				],
			};

			await logOnClanChannels(logger, msg, clan);

			await logOnAchilleaGenericClanChannel(logger, {
				embeds: [
					await buildSimpleUserEmbed(
						guildMemberUser,
						"Nouveau Président",
						`${escapeMarkdown(guildMemberUser.displayName)} est maintenant le nouveau Président du Clan ${clan.name} !`,
						0x206694
					),
				],
			});
		}
	}

	async changeCaptain(oldCaptain: User, newCaptain: User, client: Client) {
		// Sync best-effort des rôles : exécuté APRÈS le flush DB → ne doit jamais faire
		// planter la commande ni laisser l'interaction sans réponse (membre parti du serveur,
		// permissions manquantes, etc.). On logue et on continue.
		try {
			const achillea = await client.guilds.fetch(coreManagerConfig.coreGuildId);
			const [oldMember, newMember] = await Promise.all([
				achillea.members.fetch(oldCaptain.id).catch(() => null),
				achillea.members.fetch(newCaptain.id).catch(() => null),
			]);

			if (oldMember)
				await oldMember.roles
					.remove(coreManagerConfig.captainRoleId)
					.catch((err) => console.error("[changeCaptain] retrait rôle ancien capitaine:", err));
			if (newMember)
				await newMember.roles
					.add(coreManagerConfig.captainRoleId)
					.catch((err) => console.error("[changeCaptain] ajout rôle nouveau capitaine:", err));
		} catch (err) {
			console.error("[changeCaptain] sync des rôles Discord échouée:", err);
		}
	}
}
