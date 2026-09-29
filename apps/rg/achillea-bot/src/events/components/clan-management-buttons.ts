import type { ButtonInteraction } from "discord.js";
import { escapeMarkdown } from "discord.js";
import type { Client } from "@aphrody/discordx";

import { ButtonComponent, Discord, Guard, Injectable, SelectMenuComponent } from "@/decorators";
import { ClanMember } from "@/entities";
import { ClanEnabled, ClanRole } from "@/guards";
import { Database } from "@/services";
import {
	buildClanMemberEmbed,
	followUpWithErrorEmbed,
	followUpWithSuccessEmbed,
} from "@/utils/functions";

import { ClanMemberDistinction, ClanMemberRole } from "../../utils/enums";
import {
	buildClanMemberManagementButtons,
	buildDistinctionsEditorSelector,
	buildReturnButtonSelector,
} from "../../utils/functions/components";

@Discord()
@Injectable()
export class ClanManagementButtons {
	constructor(private db: Database) {}

	@ButtonComponent({ id: /^editDistinctions:.+/ })
	@Guard(ClanEnabled, ClanRole(ClanMemberRole.SubCaptain))
	async editMemberDistinctions(
		interaction: ButtonInteraction,
		client: Client,
		{ localize, clan }: InteractionData
	) {
		await interaction.deferUpdate();

		try {
			const [, targetUserId, targetClanIdStr] = interaction.customId.split(":");
			const targetClanId = Number(targetClanIdStr);

			const clanMember = await this.db.em.findOne(ClanMember, {
				user: targetUserId,
				clan: targetClanId,
			});
			if (!clanMember) throw new Error("Membre sélectionné introuvable");

			await interaction.editReply({
				components: [
					buildDistinctionsEditorSelector(clanMember),
					buildReturnButtonSelector(clanMember),
				],
			});
		} catch (err: any) {
			followUpWithErrorEmbed(interaction, `${err.message}`, true);
		}
	}

	@ButtonComponent({ id: /^return_to_member_menu:.+/ })
	@Guard(ClanEnabled, ClanRole(ClanMemberRole.SubCaptain))
	async returnToMemberMenu(
		interaction: ButtonInteraction,
		client: Client,
		{ localize, clan, clanMember }: InteractionData
	) {
		await interaction.deferUpdate();

		try {
			const [, targetUserId, targetClanIdStr] = interaction.customId.split(":");
			const targetClanId = Number(targetClanIdStr);

			const member = await this.db.em.findOne(
				ClanMember,
				{ user: targetUserId, clan: targetClanId },
				{ populate: ["user"] }
			);
			if (!member) throw new Error(`Membre cible introuvable.`);

			await interaction.editReply({
				embeds: [await buildClanMemberEmbed(member, client, "Gestion du membre")],
				components: [buildClanMemberManagementButtons(member, clanMember, false)],
			});
		} catch (err: any) {
			followUpWithErrorEmbed(interaction, `${err.message}`, true);
		}
	}

	@SelectMenuComponent({ id: /^edit_distinctions:.+/ })
	@Guard(ClanEnabled, ClanRole(ClanMemberRole.SubCaptain))
	async handleDistinctionsEditSelector(
		interaction: any,
		client: Client,
		{ localize, clan, clanMember }: InteractionData
	) {
		await interaction.deferUpdate();

		try {
			const [, targetUserId, targetClanIdStr] = interaction.customId.split(":");
			const selectedValues: string[] = interaction.values; // e.g. ['Player', 'Staff']
			const targetClanId = Number(targetClanIdStr);

			const member = await this.db.em.findOne(
				ClanMember,
				{ user: targetUserId, clan: targetClanId },
				{ populate: ["user"] }
			);
			if (!member) throw new Error(`Membre cible introuvable.`);

			const distinctions = selectedValues
				.map((v) => ClanMemberDistinction[v as keyof typeof ClanMemberDistinction])
				.filter((v): v is ClanMemberDistinction => !!v);

			// Ask for confirmation — same as before, but show chosen distinctions
			member.distinctions = distinctions;
			await this.db.em.flush();

			followUpWithSuccessEmbed(
				interaction,
				`Distinctions éditées pour le membre ${escapeMarkdown(member.user.displayName)}`,
				true
			);

			await interaction.editReply({
				embeds: [await buildClanMemberEmbed(member, client, "Gestion du membre")],
				components: [buildClanMemberManagementButtons(member, clanMember, false)],
			});
		} catch (err: any) {
			followUpWithErrorEmbed(interaction, `${err.message}`, true);

			return await interaction.message.delete().catch(() => null);
		}
	}
}
