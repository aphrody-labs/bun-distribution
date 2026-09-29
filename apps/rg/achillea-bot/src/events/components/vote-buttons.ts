import { RequestContext } from "@mikro-orm/core";
import type { ButtonInteraction } from "discord.js";
import type { Client } from "@aphrody/discordx";

import { generalConfig } from "@/configs";
import { ButtonComponent, Discord, Injectable } from "@/decorators";
import { User, VoteProposal } from "@/entities";
import { Database, VotingService } from "@/services";
import { followUpWithErrorEmbed, resolveDependency } from "@/utils/functions";

import { ProposalType, VoteChoice } from "../../utils/enums";

@Discord()
@Injectable()
export class VoteButtons {
	constructor(private db: Database) {}

	@ButtonComponent({ id: /vote:(approve|reject):(\d+)/ })
	async handleVote(interaction: ButtonInteraction, client: Client) {
		await interaction.deferUpdate();

		const [, voteType, proposalId] =
			interaction.customId.match(/vote:(approve|reject):(\d+)/) ?? [];
		const testEm = RequestContext.getEntityManager() ?? this.db.em;
		const proposal = await testEm.findOneOrFail(
			VoteProposal,
			{ id: +proposalId },
			{ populate: ["eligibleVoters", "votes"] }
		);

		if (!proposal) {
			followUpWithErrorEmbed(interaction, `Proposal with ID ${proposalId} not found.`, true);

			return;
		}

		const voterAsUser = await testEm.findOneOrFail(User, { id: interaction.user.id });
		const canOverrideVote = generalConfig.devs.includes(interaction.user.id);
		if (!proposal.eligibleVoters.contains(voterAsUser) && !canOverrideVote) {
			followUpWithErrorEmbed(interaction, "You are not eligible to vote on this proposal.", true);

			return;
		}

		if (
			proposal.type === ProposalType.CLAN_CREATION &&
			proposal.votes.getItems().some((v) => v.voter.id === interaction.user.id)
		) {
			followUpWithErrorEmbed(interaction, "You have already voted on this proposal.", true);

			return;
		}

		const voteChoice = voteType === "approve" ? VoteChoice.APPROVE : VoteChoice.REJECT;

		const votingService = await resolveDependency(VotingService);
		await votingService.handleVote(proposal, voterAsUser, voteChoice, client, interaction);
	}
}
