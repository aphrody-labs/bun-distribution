import type { ButtonInteraction, ModalSubmitInteraction } from "discord.js";
import { ChannelType } from "discord.js";
import type { Client } from "@aphrody/discordx";

import { ButtonComponent, Discord, Guard, Injectable, ModalComponent } from "@/decorators";
import { Clan, Guild } from "@/entities";
import { ClanEnabled, GuildAdminOnly } from "@/guards";
import { Database } from "@/services";
import {
	followUpWithErrorEmbed,
	followUpWithSuccessEmbed,
	guildSettingsEmbed,
} from "@/utils/functions";

import {
	buildGuildBroadcastManagementButtons,
	buildGuildSettingsButtons,
	buildGuildSettingsModal,
	safeGetSelectValue,
	safeGetTextInput,
} from "../../utils/functions/components";

@Discord()
@Injectable()
export class GuildButtons {
	constructor(private db: Database) {}

	@ButtonComponent({ id: /^broadcast_channel_button:.+/ })
	@Guard(GuildAdminOnly)
	async displayBroadcastModal(
		interaction: ButtonInteraction,
		client: Client,
		{ localize }: InteractionData
	) {
		try {
			const [, guildIdStr] = interaction.customId.split(":");

			const guild = await this.db.em.findOne(Guild, { id: guildIdStr });
			if (!guild) throw new Error("Cette commande doit être effectuée sur un serveur !");

			const modal = await buildGuildSettingsModal(guild, client);

			await interaction.showModal(modal);
		} catch (err: any) {
			return followUpWithErrorEmbed(interaction, `${err.message}`, true);
		}
	}

	@ButtonComponent({ id: /^bind_clan_guild:.+/ })
	@Guard(GuildAdminOnly, ClanEnabled)
	async bindClan(
		interaction: ButtonInteraction,
		client: Client,
		{ localize, clan }: InteractionData
	) {
		await interaction.deferUpdate();
		try {
			const [, guildIdStr] = interaction.customId.split(":");

			const guild = await this.db.em.findOne(Guild, { id: guildIdStr });
			if (!guild) throw new Error("Le bot n'est pas présent dans cette Guilde !");

			const guildClan = await this.db.em.findOne(Clan, { guild: interaction.guildId });
			if (guildClan) throw new Error("Un Clan est déjà lié à ce serveur");

			if (!guild.broadcastChannel)
				throw new Error("Votre Guilde n'a pas paramétré de salon d'alerte pour votre Clan !");

			clan.guild = guild;
			await this.db.em.persist(guild).flush();

			await interaction.editReply({
				embeds: [guildSettingsEmbed(guild, clan)],
				components: [buildGuildSettingsButtons(guild, true)],
			});

			followUpWithSuccessEmbed(
				interaction,
				`Votre guilde est désormais liée au Clan ${clan.name} !`,
				true
			);
		} catch (err: any) {
			return followUpWithErrorEmbed(interaction, `${err.message}`, true);
		}
	}

	@ButtonComponent({ id: /^unbind_clan_guild:.+/ })
	@Guard(GuildAdminOnly, ClanEnabled)
	async unbindClan(
		interaction: ButtonInteraction,
		client: Client,
		{ localize, clan }: InteractionData
	) {
		await interaction.deferUpdate();
		try {
			const [, guildIdStr] = interaction.customId.split(":");

			const guild = await this.db.em.findOne(Guild, { id: guildIdStr });
			if (!guild) throw new Error("Le bot n'est pas présent dans cette Guilde !");

			if (!clan.guild) throw new Error("Votre Clan n'est pas lié à cette Guilde");

			clan.guild = null;
			await this.db.em.flush();

			await interaction.editReply({
				embeds: [guildSettingsEmbed(guild, null)],
				components: [buildGuildSettingsButtons(guild, false)],
			});

			followUpWithSuccessEmbed(
				interaction,
				`Votre guilde n'est désormais plus liée au Clan ${clan.name} !`,
				true
			);
		} catch (err: any) {
			return followUpWithErrorEmbed(interaction, `${err.message}`, true);
		}
	}

	@ModalComponent({ id: /^modal_guild_broadcast_channel:\d+$/ })
	async handleGuildSettingsModal(interaction: ModalSubmitInteraction) {
		await interaction.deferUpdate();

		try {
			const [, guildId] = interaction.customId.split(":");
			const guild = await interaction.client.guilds.fetch(guildId);

			// Try both inputs
			const textInputValue = safeGetTextInput(interaction, "input_guild_broadcast_channel");
			const selectMenuValue = safeGetSelectValue(interaction, "select_guild_broadcast_channel");
			const chosenChannelId = textInputValue || selectMenuValue;

			const guildEntity = await this.db.em.findOneOrFail(Guild, { id: guildId });
			const clan = await this.db.em.findOne(Clan, { guild: guildEntity });

			if (!guildEntity) throw new Error("Le bot n'est pas présent dans cette Guilde !");

			if (!chosenChannelId) {
				guildEntity.broadcastChannel = null;
				if (clan) clan.guild = null;
				await this.db.em.flush();

				await interaction.editReply({
					embeds: [guildSettingsEmbed(guildEntity, null)],
					components: [buildGuildSettingsButtons(guildEntity, false)],
				});

				return followUpWithSuccessEmbed(
					interaction,
					`Salon d'annonce supprimé !${clan ? ` Le lien entre ${clan.name} et votre Guilde a également été coupé !` : ""}`,
					true
				);
			}

			// Validate that this channel exists and is a valid type
			const channel = await guild.channels.fetch(chosenChannelId).catch(() => null);
			if (!channel) throw new Error(`Le salon <#${chosenChannelId}> est introuvable.`);

			if (![ChannelType.GuildText, ChannelType.GuildAnnouncement].includes(channel.type))
				throw new Error(`Le salon choisi n'est pas un salon texte ou d'annonce.`);

			// Update database
			guildEntity.broadcastChannel = chosenChannelId;
			await this.db.em.flush();

			await interaction.editReply({
				embeds: [guildSettingsEmbed(guildEntity, clan)],
				components: [buildGuildSettingsButtons(guildEntity, clan !== null)],
			});

			followUpWithSuccessEmbed(
				interaction,
				`Le salon des annonces du clan a été mis à jour vers ${channel}.`,
				true
			);
		} catch (err: any) {
			return followUpWithErrorEmbed(interaction, `${err.message}`, true);
		}
	}

	@ButtonComponent({ id: /^broadcast_management_button:.+/ })
	@Guard(GuildAdminOnly)
	async displayBroadcastManagementMenu(
		interaction: ButtonInteraction,
		client: Client,
		{ localize, clan }: InteractionData
	) {
		await interaction.deferUpdate();
		try {
			const [, guildIdStr] = interaction.customId.split(":");

			const guild = await this.db.em.findOne(Guild, { id: guildIdStr });
			if (!guild) throw new Error("Le bot n'est pas présent dans cette Guilde !");

			const guildClan = await this.db.em.findOne(Clan, { guild: interaction.guildId });

			await interaction.editReply({
				embeds: [guildSettingsEmbed(guild, guildClan)],
				components: [buildGuildBroadcastManagementButtons(guild)],
			});
		} catch (err: any) {
			return followUpWithErrorEmbed(interaction, `${err.message}`, true);
		}
	}

	@ButtonComponent({ id: /^guild_settings_menu:.+/ })
	@Guard(GuildAdminOnly)
	async displayGuildSettingsMenu(
		interaction: ButtonInteraction,
		client: Client,
		{ localize, clan }: InteractionData
	) {
		await interaction.deferUpdate();
		try {
			const [, guildIdStr] = interaction.customId.split(":");

			const guild = await this.db.em.findOne(Guild, { id: guildIdStr });
			if (!guild) throw new Error("Le bot n'est pas présent dans cette Guilde !");

			const guildClan = await this.db.em.findOne(Clan, { guild: interaction.guildId });

			await interaction.editReply({
				embeds: [guildSettingsEmbed(guild, guildClan)],
				components: [buildGuildSettingsButtons(guild, false)],
			});
		} catch (err: any) {
			return followUpWithErrorEmbed(interaction, `${err.message}`, true);
		}
	}

	@ButtonComponent({ id: /^ranked_broadcast_toggle:.+/ })
	@Guard(GuildAdminOnly)
	async toggleGuildRankedBroadcast(
		interaction: ButtonInteraction,
		client: Client,
		{ localize, clan }: InteractionData
	) {
		await interaction.deferUpdate();
		try {
			const [, guildIdStr] = interaction.customId.split(":");

			const guild = await this.db.em.findOne(Guild, { id: guildIdStr });
			if (!guild) throw new Error("Le bot n'est pas présent dans cette Guilde !");

			guild.rankedEnabled = !guild.rankedEnabled;
			await this.db.em.flush();

			const guildClan = await this.db.em.findOne(Clan, { guild: interaction.guildId });

			await interaction.editReply({
				embeds: [guildSettingsEmbed(guild, guildClan)],
				components: [buildGuildBroadcastManagementButtons(guild)],
			});

			followUpWithSuccessEmbed(
				interaction,
				`Le système d'annonce de la file classée a été ${guild.rankedEnabled ? "activé" : "désactivé"}.)`,
				true
			);
		} catch (err: any) {
			return followUpWithErrorEmbed(interaction, `${err.message}`, true);
		}
	}

	@ButtonComponent({ id: /^delete_broadcast_channel_button:.+/ })
	@Guard(GuildAdminOnly)
	async deleteBroadcastChannel(
		interaction: ButtonInteraction,
		client: Client,
		{ localize }: InteractionData
	) {
		await interaction.deferUpdate();
		try {
			const [, guildIdStr] = interaction.customId.split(":");

			const guild = await this.db.em.findOne(Guild, { id: guildIdStr });
			if (!guild) throw new Error("Le bot n'est pas présent dans cette Guilde !");

			const clan = await this.db.em.findOne(Clan, { guild });

			guild.broadcastChannel = null;
			if (clan) clan.guild = null;
			await this.db.em.flush();

			await interaction.editReply({
				embeds: [guildSettingsEmbed(guild, null)],
				components: [buildGuildSettingsButtons(guild, false)],
			});

			return followUpWithSuccessEmbed(
				interaction,
				`Salon d'annonce supprimé !${clan ? ` Le lien entre ${clan.name} et votre Guilde a également été coupé !` : ""}`,
				true
			);
		} catch (err: any) {
			return followUpWithErrorEmbed(interaction, `${err.message}`, true);
		}
	}
}
