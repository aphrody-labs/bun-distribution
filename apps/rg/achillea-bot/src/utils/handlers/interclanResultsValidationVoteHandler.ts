import type { BaseMessageOptions, ButtonInteraction } from "discord.js";
import { roleMention } from "discord.js";
import type { Client } from "@aphrody/discordx";

import { coreManagerConfig } from "@/configs";
import type { Vote, VoteProposal } from "@/entities";
import { Interclan } from "@/entities";
import type { Logger } from "@/services";
import { Database } from "@/services";
import {
	buildErrorEmbed,
	buildInterclanScoresEmbed,
	createInterclanResultVoteEmbed,
	resolveDependency,
} from "@/utils/functions";

import { InterclanState, ProposalStatus } from "../enums";
import { buildVoteButtons } from "../functions/components";
import { cancelInterclan } from "../functions/interclans";
import {
	logOnAchilleaGenericClanChannel,
	logOnAchilleaSpecificClanChannel,
} from "../functions/messager";
import type { VotingEventHandler } from "../interfaces/voteWorkflowHandler";

export class InterclanResultsValidationVoteHandler implements VotingEventHandler {
	async onVoteCast(
		proposal: VoteProposal,
		vote: Vote,
		interaction: ButtonInteraction
	): Promise<void> {
		if (proposal.expiresAt && proposal.expiresAt <= new Date()) return;

		const db = await resolveDependency(Database);
		const interclan = await db.em.findOneOrFail(
			Interclan,
			{ id: proposal.targetEntityId },
			{ populate: ["lineups.members.user", "lineups.clan", "lobbies.*"] }
		);

		await interaction.message.edit({
			content: `${roleMention(interclan.clanA.roleId)} ${roleMention(interclan.clanB.roleId)}`,
			embeds: [createInterclanResultVoteEmbed(interclan, proposal)],
			components: [buildVoteButtons(proposal.id.toString()) as any],
		});
	}

	async onProposalComplete(
		proposal: VoteProposal,
		interaction: ButtonInteraction,
		client: Client,
		logger: Logger
	): Promise<void> {
		if (proposal.status === ProposalStatus.PENDING) return;

		const db = await resolveDependency(Database);
		const interclan = await db.em.findOneOrFail(
			Interclan,
			{ id: proposal.targetEntityId },
			{ populate: ["lineups.members.user", "lineups.clan", "lobbies.*"] }
		);

		if (proposal.status === ProposalStatus.EXPIRED) {
			await this.handleExpiredProposal(interclan, db, client, logger);

			return;
		}

		if (proposal.status === ProposalStatus.APPROVED)
			await this.handleApproval(interclan, proposal, interaction, db, logger, client);
		else if (proposal.status === ProposalStatus.REJECTED)
			await this.handleRejection(interclan, interaction, db, client, logger);
	}

	private async handleApproval(
		interclan: Interclan,
		proposal: VoteProposal,
		interaction: ButtonInteraction,
		db: Database,
		logger: Logger,
		client: Client
	) {
		interclan.state = InterclanState.RESULT_OK;

		const result = db.get(Interclan).computeInterclanResult(interclan);

		if (!result.winner) throw new Error("Unknown winner");

		await db.em.persist(interclan).flush();

		await interaction.message.edit({
			embeds: [createInterclanResultVoteEmbed(interclan, proposal)],
			components: [],
		});

		if (interclan.discordChannelId) {
			try {
				const guild = await client.guilds.fetch(coreManagerConfig.coreGuildId);
				const channel = await guild.channels.fetch(interclan.discordChannelId);
				if (channel) await channel.delete(`Interclan #${interclan.id} annulé`);
			} catch (err) {
				console.warn(
					`[InterclanCancel] Impossible de supprimer le salon pour interclan ${interclan.id}:`,
					err
				);
			}
		}

		const msg = {
			content: `L'interclan ${interclan.name} s'est terminé avec succès sur une victoire de ${result.winner.name}`,
			embeds: [buildInterclanScoresEmbed(interclan)],
		};

		await logOnAchilleaGenericClanChannel(logger, msg);
	}

	private async handleRejection(
		interclan: Interclan,
		interaction: ButtonInteraction,
		db: Database,
		client: Client,
		logger: Logger
	) {
		// Appeler modo + gestion modo
	}

	private async handleExpiredProposal(
		interclan: Interclan,
		db: Database,
		client: Client,
		logger: Logger
	): Promise<void> {
		const msgA: BaseMessageOptions = {
			content: `${roleMention(interclan.clanA.roleId)}`,
			embeds: [
				buildErrorEmbed(
					`La procédure de vote a expiré, l'interclan ${interclan.name} ne sera donc pas pris en compte.`
				),
			],
		};

		const msgB: BaseMessageOptions = {
			content: `${roleMention(interclan.clanB.roleId)}`,
			embeds: [
				buildErrorEmbed(
					`La procédure de vote a expiré, l'interclan ${interclan.name} ne sera donc pas pris en compte.`
				),
			],
		};

		await logOnAchilleaSpecificClanChannel(logger, msgA, interclan.clanA.channelId);
		await logOnAchilleaSpecificClanChannel(logger, msgB, interclan.clanB.channelId);
		await cancelInterclan(interclan, client, db);
	}
}
