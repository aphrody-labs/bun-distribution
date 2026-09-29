import type { VoteProposal } from "@/entities";

import type { VotingEventHandler } from "../interfaces/voteWorkflowHandler";

export class TournamentAppealVoteHandler implements VotingEventHandler {
	async onVoteCast(proposal: VoteProposal): Promise<void> {
		// Handle vote cast logic if needed
	}

	async onProposalComplete(proposal: VoteProposal): Promise<void> {
		//
	}
}
