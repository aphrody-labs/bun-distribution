import type { ButtonInteraction } from "discord.js";
import { MessageFlags } from "discord.js";
import type { Client } from "@aphrody/discordx";

import { ButtonComponent, Discord, Injectable } from "@/decorators";
import { Matchmaker, RankedQueueService } from "@/services";
import { followUpWithErrorEmbed, followUpWithSuccessEmbed } from "@/utils/functions";

import { RankedState } from "../../utils/enums";

@Discord()
@Injectable()
export class MatchmakerButtons {
	constructor(
		private matchmaker: Matchmaker,
		private queueService: RankedQueueService
	) {}

	@ButtonComponent({ id: /^join_queue:.+/ })
	async join(interaction: ButtonInteraction, client: Client) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const ranked = await this.matchmaker.getEventFromCustomId(interaction.customId);
		if (!ranked) followUpWithErrorEmbed(interaction, "No active queue.");

		const result = await this.queueService.joinQueue(ranked, interaction.user);

		if (this.queueService.isQueueLocked(ranked) || ranked.status === RankedState.LOCKED) {
			followUpWithErrorEmbed(interaction, "This queue is locked.", true);

			return;
		}

		if (result === "success") {
			followUpWithSuccessEmbed(interaction, "Joined queue !", true);
			this.queueService.scheduleQueueCountUpdate(client, ranked);
		} else {
			followUpWithErrorEmbed(interaction, "You are already in the queue.", true);
		}
	}

	@ButtonComponent({ id: /^leave_queue:.+/ })
	async leave(interaction: ButtonInteraction, client: Client) {
		await interaction.deferReply({ flags: MessageFlags.Ephemeral });
		const ranked = await this.matchmaker.getEventFromCustomId(interaction.customId);
		if (!ranked) followUpWithErrorEmbed(interaction, "No active queue.");

		const result = await this.queueService.leaveQueue(ranked, interaction.user.id);

		if (this.queueService.isQueueLocked(ranked) || ranked.status === RankedState.LOCKED) {
			followUpWithErrorEmbed(interaction, "This queue is locked.", true);

			return;
		}

		if (result === "success") {
			followUpWithSuccessEmbed(interaction, "Left queue !", true);
			this.queueService.scheduleQueueCountUpdate(client, ranked);
		} else {
			followUpWithErrorEmbed(interaction, "Vous n'êtes pas dans la file.", true);
		}
	}

	@ButtonComponent({ id: /^confirm_presence:.+/ })
	async confirmPresence(interaction: ButtonInteraction) {
		await interaction.deferReply();
		const lobby = await this.matchmaker.getLobbyFromCustomId(interaction.customId);
		if (!lobby) followUpWithErrorEmbed(interaction, "Lobby introuvable...");

		const result = await this.queueService.validatePresence(interaction.user.id);

		if (result) followUpWithSuccessEmbed(interaction, "Présence confirmée et enregistrée");
		else
			followUpWithErrorEmbed(
				interaction,
				"Une erreur est survenue et votre présence n'a pas pu être confirmée"
			);
	}
}
