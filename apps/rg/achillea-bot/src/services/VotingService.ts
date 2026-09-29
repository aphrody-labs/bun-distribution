import type { EntityManager } from "@mikro-orm/core";
import type { ButtonInteraction } from "discord.js";
import { Client } from "@aphrody/discordx";

import { evaluateProposalOutcome } from "@rosegriffon/achillea-core";
import { delay, inject } from "tsyringe";

import { generalConfig } from "@/configs";
import { Service } from "@/decorators";
import { User, Vote, VoteProposal } from "@/entities";
import { followUpWithSuccessEmbed } from "@/utils/functions";

import { ProposalStatus, VoteChoice } from "../utils/enums";
import { VOTE_EVENT_HANDLERS } from "../utils/interfaces/voteWorkflowHandler";
import { Database } from "./Database";
import { Logger } from "./Logger";

@Service()
export class VotingService {
	constructor(
		@inject(delay(() => Database)) private db: any,
		@inject(delay(() => Logger)) private logger: any
	) {}

	async handleVote(
		proposal: VoteProposal,
		voter: User,
		voteChoice: VoteChoice,
		client: Client,
		interaction: ButtonInteraction
	): Promise<void> {
		const canOverrideVote = generalConfig.devs.includes(voter.id);

		if (canOverrideVote) {
			const forcedVote = new Vote();
			forcedVote.proposal = proposal;
			forcedVote.voter = voter;
			forcedVote.vote = voteChoice;

			proposal.votes.add(forcedVote);
			proposal.status =
				voteChoice === VoteChoice.APPROVE ? ProposalStatus.APPROVED : ProposalStatus.REJECTED;

			proposal.closedAt = new Date();

			this.db.em.persist([proposal, forcedVote]);

			// Log & trigger handler
			await this.invokeOnProposalComplete(proposal, interaction, client);

			await this.db.em.flush();

			return followUpWithSuccessEmbed(
				interaction,
				`🧩 Vote forcé par le propriétaire du bot : **${proposal.status === ProposalStatus.APPROVED ? "Approuvé ✅" : "Rejeté ❌"}**.`,
				true
			);
		}

		const existingVote = proposal.votes.getItems().find((v) => v.voter.id === voter.id);

		if (existingVote) {
			return await this.db.em.transactional(async (tem: EntityManager) => {
				if (existingVote.vote === voteChoice) {
					// Remove vote (toggle off)
					proposal.votes.remove(existingVote);

					await this.invokeVoteOnCast(proposal, existingVote, interaction, client, true, tem);
				} else {
					// Update vote choice
					existingVote.vote = voteChoice;

					await this.invokeVoteOnCast(proposal, existingVote, interaction, client, false, tem);
				}

				await this.evaluateProposal(proposal, client, interaction, tem);
				await this.db.em.flush();
			});
		}

		const vote = new Vote();
		vote.proposal = proposal;
		vote.voter = voter;
		vote.vote = voteChoice;

		proposal.votes.add(vote);

		await this.db.em.persist(vote).flush();

		await this.db.em.transactional(async (tem: EntityManager) => {
			await this.invokeVoteOnCast(proposal, vote, interaction, client, false, tem);
			await tem.flush();
		});

		await this.db.em.transactional(async (tem: EntityManager) => {
			await this.evaluateProposal(proposal, client, interaction, tem);
			await tem.flush();
		});
	}

	private async invokeVoteOnCast(
		proposal: VoteProposal,
		vote: Vote,
		interaction: ButtonInteraction,
		client: Client,
		isVoteRemoved: boolean = false,
		em: EntityManager
	): Promise<void> {
		const handler = VOTE_EVENT_HANDLERS[proposal.type];
		if (handler?.onVoteCast) {
			await handler.onVoteCast(proposal, vote, interaction, client, this.logger, isVoteRemoved, em);

			return;
		}

		followUpWithSuccessEmbed(
			interaction,
			`Votre vote a été enregistré: ${vote.vote === VoteChoice.APPROVE ? "✅ Pour" : "❌ Contre"}.`,
			true
		);
	}

	async evaluateProposal(
		proposal: VoteProposal,
		client: Client,
		interaction: ButtonInteraction,
		em: EntityManager
	): Promise<void> {
		if (proposal.status !== ProposalStatus.PENDING) return;

		const votes = proposal.votes.getItems();
		const totalEligible = proposal.eligibleVoters.length;

		const approvals = votes.filter((v) => v.vote === VoteChoice.APPROVE).length;
		const rejections = votes.filter((v) => v.vote === VoteChoice.REJECT).length;

		// Décision pure déléguée à @rosegriffon/achillea-core (MAJORITY / SUPERMAJORITY_2_3 /
		// UNANIMOUS + expiration). Renvoie null si la proposition reste en attente.
		const outcome = evaluateProposalOutcome({
			approvals,
			rejections,
			totalEligible,
			minParticipationRatio: proposal.minParticipationRatio,
			strategy: proposal.strategy,
			expired: Boolean(proposal.expiresAt && proposal.expiresAt <= new Date()),
		});

		if (!outcome) return;

		proposal.status = outcome;
		proposal.closedAt = new Date();
		await this.invokeOnProposalComplete(proposal, interaction, client, em);
	}

	private async invokeOnProposalComplete(
		proposal: VoteProposal,
		interaction: ButtonInteraction,
		client: Client,
		em?: EntityManager
	): Promise<void> {
		const usedEm = em || this.db.em;
		const handler = VOTE_EVENT_HANDLERS[proposal.type];
		if (handler?.onProposalComplete) {
			await handler.onProposalComplete(proposal, interaction, client, this.logger, usedEm);
			await usedEm.flush();
		}
	}
}
