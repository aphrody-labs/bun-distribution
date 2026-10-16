/** Choix possible d'un votant sur une proposition. */
export enum VoteChoice {
  APPROVE = "APPROVE",
  REJECT = "REJECT",
}

/** Catégorie fonctionnelle d'une proposition soumise au vote. */
export enum ProposalType {
  CLAN_CREATION = "CLAN_CREATION",
  CLAN_APPROVAL = "CLAN_APPROVAL",
  RANKED_RECLAMATION = "RANKED_RECLAMATION",
  TOURNAMENT_APPEAL = "TOURNAMENT_APPEAL",
  INTERCLAN_VALIDATION = "INTERCLAN_VALIDATION",
}

/** État du cycle de vie d'une proposition. */
export enum ProposalStatus {
  PENDING = "PENDING",
  APPROVED = "APPROVED",
  REJECTED = "REJECTED",
  EXPIRED = "EXPIRED",
}

/** Règle de décision appliquée pour clore une proposition. */
export enum VotingStrategy {
  UNANIMOUS = "UNANIMOUS",
  MAJORITY = "MAJORITY",
  SUPERMAJORITY_2_3 = "SUPERMAJORITY_2_3",
}
