import type { EntityManager } from "@mikro-orm/core";
import type { ButtonInteraction } from "discord.js";
import type { Client } from "@aphrody/discordx";

import type { Vote, VoteProposal } from "@/entities";
import type { Logger } from "@/services";

import { ProposalType } from "../enums";
import {
	ClanApprovalVoteHandler,
	ClanFoundationVoteHandler,
	InterclanResultsValidationVoteHandler,
	RankedReclamationVoteHandler,
	TournamentAppealVoteHandler,
} from "../handlers";

export type VotingEventHandler = {
	onVoteCast?: (
		proposal: VoteProposal,
		vote: Vote,
		interaction: ButtonInteraction,
		client: Client,
		logger: Logger,
		isVoteRemoved: boolean,
		em: EntityManager
	) => Promise<void>;
	onProposalComplete?: (
		proposal: VoteProposal,
		interaction: ButtonInteraction,
		client: Client,
		logger: Logger,
		em: EntityManager
	) => Promise<void>;
};

export const VOTE_EVENT_HANDLERS: Record<ProposalType, VotingEventHandler> = {
	[ProposalType.CLAN_CREATION]: new ClanFoundationVoteHandler(),
	[ProposalType.CLAN_APPROVAL]: new ClanApprovalVoteHandler(),
	[ProposalType.RANKED_RECLAMATION]: new RankedReclamationVoteHandler(),
	[ProposalType.TOURNAMENT_APPEAL]: new TournamentAppealVoteHandler(),
	[ProposalType.INTERCLAN_VALIDATION]: new InterclanResultsValidationVoteHandler(),
};
