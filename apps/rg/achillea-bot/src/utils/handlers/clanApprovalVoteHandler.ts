import type { EntityManager } from "@mikro-orm/core";
import type { BaseMessageOptions, ButtonInteraction } from "discord.js";
import { roleMention, userMention } from "discord.js";
import type { Client } from "@aphrody/discordx";

import { coreManagerConfig } from "@/configs";
import type { Vote, VoteProposal } from "@/entities";
import { Clan, ClanMember } from "@/entities";
import { CustomImagesUpload, Database, Logger } from "@/services";
import {
	buildErrorEmbed,
	buildNewClanEmbed,
	buildSuccessEmbed,
	createClanCreationVoteEmbed,
	deleteClan,
	followUpWithErrorEmbed,
	followUpWithSuccessEmbed,
	resolveDependency,
} from "@/utils/functions";

import { ClanMemberRole, ClanState, ProposalStatus, VoteChoice } from "../enums";
import {
	logOnAchilleaDefaultBotChannel,
	logOnAchilleaGenericClanChannel,
	logOnAchilleaSpecificClanChannel,
	logOnClanGuildChannel,
} from "../functions/messager";
import type { VotingEventHandler } from "../interfaces/voteWorkflowHandler";

export class ClanApprovalVoteHandler implements VotingEventHandler {
	async onVoteCast(
		proposal: VoteProposal,
		vote: Vote,
		interaction: ButtonInteraction,
		client: Client,
		logger: Logger,
		isVoteRemoved: boolean,
		em: EntityManager
	): Promise<void> {
		if (proposal.expiresAt && proposal.expiresAt <= new Date()) {
			followUpWithErrorEmbed(
				interaction,
				"Le vote n'a pas été pris en compte car la période de vote a expiré",
				true
			);

			return;
		}

		const clan = await em.findOneOrFail(Clan, { id: proposal.targetEntityId });

		await interaction.message.edit({
			embeds: [await createClanCreationVoteEmbed(clan, proposal)],
		});

		if (isVoteRemoved) followUpWithSuccessEmbed(interaction, "Votre vote a été retiré.", true);
		else
			followUpWithSuccessEmbed(
				interaction,
				`Vous avez voté ${vote.vote === VoteChoice.APPROVE ? "✅ Pour" : "❌ Contre"}.`,
				true
			);
	}

	async onProposalComplete(
		proposal: VoteProposal,
		interaction: ButtonInteraction,
		client: Client,
		logger: Logger,
		em: EntityManager
	): Promise<void> {
		if (proposal.status === ProposalStatus.PENDING) return;

		const clan = await em.findOneOrFail(Clan, { id: proposal.targetEntityId });

		await interaction.message.edit({
			components: [],
			embeds: [await createClanCreationVoteEmbed(clan, proposal)],
		});

		if (proposal.status === ProposalStatus.EXPIRED) {
			await this.handleExpiredProposal(clan, interaction, client, logger);

			return;
		}

		if (proposal.status === ProposalStatus.APPROVED)
			await this.handleApproval(clan, interaction, em, logger, client);
		else if (proposal.status === ProposalStatus.REJECTED)
			await this.handleRejection(clan, interaction, client, logger);
	}

	private async handleApproval(
		clan: Clan,
		interaction: ButtonInteraction,
		em: EntityManager,
		logger: Logger,
		client: Client
	) {
		clan.state = ClanState.Approved;

		await em.persist(clan).flush();
		const captain = await em.getRepository(ClanMember).getClanCaptain(clan.id);

		const achillea = await client.guilds.fetch(coreManagerConfig.coreGuildId);
		const captainAsGuildMember = await achillea.members.fetch(captain!.user.id);
		await captainAsGuildMember.roles.add(coreManagerConfig.captainRoleId);

		followUpWithSuccessEmbed(
			interaction,
			`La création du Clan ${clan.name} a été approuvée !`,
			false
		);

		const msg: BaseMessageOptions = {
			content: `${roleMention(clan.roleId)}`,
			embeds: [
				buildSuccessEmbed(`Félicitations, votre Clan a été approuvé par les Administrateurs !`),
			],
		};

		await logOnAchilleaSpecificClanChannel(logger, msg, clan.channelId);

		if (captain) {
			msg.content = `${userMention(captain!.user.id)}`;

			await logOnClanGuildChannel(logger, msg, clan.guild);
		}

		await logOnAchilleaGenericClanChannel(logger, {
			embeds: [await buildNewClanEmbed(clan, captain!.user.id)],
		});

		await em.persist(clan).flush();
	}

	private async handleRejection(
		clan: Clan,
		interaction: ButtonInteraction,
		client: Client,
		logger: Logger
	) {
		const imgService = await resolveDependency(CustomImagesUpload);
		const db = await resolveDependency(Database);
		const captain = await db.get(ClanMember).getClanCaptain(clan.id);
		const clanChannel = await client.channels.fetch(clan.channelId);
		await clanChannel?.delete();
		await deleteClan(clan, db, imgService, client);

		followUpWithSuccessEmbed(
			interaction,
			`La création du Clan ${clan.name} a été refusée !`,
			false
		);
		await logOnAchilleaDefaultBotChannel(await resolveDependency(Logger), {
			content: `${userMention(captain!.user.id)}`,
			embeds: [
				buildErrorEmbed(
					`Votre demande de création du Clan ${clan.name} a été rejetée par les Administrateurs.`
				),
			],
		});
	}

	private async handleExpiredProposal(
		clan: Clan,
		interaction: ButtonInteraction,
		client: Client,
		logger: Logger
	): Promise<void> {
		const db = await resolveDependency(Database);
		const captain = await db.em.findOneOrFail(ClanMember, {
			clan: clan.id,
			role: ClanMemberRole.Captain,
		});

		const msg: BaseMessageOptions = {
			content: userMention(captain.user.id),
			embeds: [
				buildErrorEmbed(
					`Votre demande de création du Clan ${clan.name} a été rejetée par les Administrateurs.`
				),
			],
		};
		await logOnAchilleaDefaultBotChannel(logger, msg);
		const imgService = await resolveDependency(CustomImagesUpload);
		await deleteClan(clan, db, imgService, client);
	}
}
