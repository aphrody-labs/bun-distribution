/**
 * Évaluation pure de l'issue d'une proposition soumise au vote.
 *
 * Réplique exacte de la logique de `VotingService.evaluateProposal` du bot
 * (stratégies MAJORITY / SUPERMAJORITY_2_3 / UNANIMOUS + expiration), mais sans
 * entités MikroORM ni interaction Discord : on raisonne uniquement sur des
 * nombres + un drapeau d'expiration.
 */

import { ProposalStatus, VotingStrategy } from "../enums/vote";

/** Décompte de votes nécessaire pour évaluer une proposition. */
export interface VoteTally {
	/** Votes « pour ». */
	approvals: number;
	/** Votes « contre ». */
	rejections: number;
	/** Nombre total de votants éligibles. */
	totalEligible: number;
	/** Ratio minimal de participation requis (0..1). */
	minParticipationRatio: number;
	/** Stratégie de décision appliquée. */
	strategy: VotingStrategy;
	/** La proposition a-t-elle dépassé sa date d'expiration ? */
	expired?: boolean;
}

/**
 * Calcule le statut résultant d'une proposition encore `PENDING`.
 *
 * @returns Le nouveau {@link ProposalStatus} (APPROVED / REJECTED / EXPIRED),
 *   ou `null` si la proposition doit rester en attente.
 */
export function evaluateProposalOutcome(tally: VoteTally): ProposalStatus | null {
	const { approvals, rejections, totalEligible, minParticipationRatio, strategy } = tally;

	const votesCount = approvals + rejections;
	const requiredParticipation = Math.ceil(totalEligible * minParticipationRatio);
	const remainingPossibleVotes = totalEligible - votesCount;
	const expiredUnderQuorum = Boolean(tally.expired) && votesCount < requiredParticipation;

	// UNANIMOUS : un seul refus rejette ; approbation seulement si tous ont voté pour.
	if (strategy === VotingStrategy.UNANIMOUS) {
		if (rejections > 0) return ProposalStatus.REJECTED;
		if (votesCount === totalEligible && approvals === totalEligible) return ProposalStatus.APPROVED;
		if (expiredUnderQuorum) return ProposalStatus.EXPIRED;
		return null;
	}

	if (expiredUnderQuorum) return ProposalStatus.EXPIRED;

	let approved = false;
	let rejected = false;

	switch (strategy) {
		case VotingStrategy.SUPERMAJORITY_2_3: {
			const supermajorityThreshold = Math.ceil((2 / 3) * votesCount);
			const supermajorityTotal = Math.ceil((2 / 3) * totalEligible);

			if (approvals + remainingPossibleVotes < supermajorityTotal) {
				rejected = true;
			} else if (approvals >= supermajorityThreshold && votesCount >= requiredParticipation) {
				approved = true;
			}
			break;
		}

		// MAJORITY (et fallback pour toute stratégie inconnue, comme le bot).
		default: {
			if (approvals > rejections + remainingPossibleVotes) {
				approved = true;
			} else if (rejections >= approvals + remainingPossibleVotes) {
				rejected = true;
			} else if (votesCount >= requiredParticipation) {
				approved = approvals > rejections;
				rejected = !approved;
			}
			break;
		}
	}

	if (approved) return ProposalStatus.APPROVED;
	if (rejected) return ProposalStatus.REJECTED;
	return null;
}
