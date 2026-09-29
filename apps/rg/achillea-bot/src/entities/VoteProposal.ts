import { Collection, EntityRepository, EntityRepositoryType } from "@mikro-orm/core";
import {
	Entity,
	Enum,
	ManyToMany,
	OneToMany,
	PrimaryKey,
	Property,
} from "@mikro-orm/decorators/legacy";

import { ProposalStatus, ProposalType, VotingStrategy } from "../utils/enums";
import { CustomBaseEntity } from "./BaseEntity";
import { User } from "./User";
import { Vote } from "./Vote";

@Entity({ repository: () => VoteProposalRepository })
export class VoteProposal extends CustomBaseEntity {
	[EntityRepositoryType]?: VoteProposalRepository;

	@PrimaryKey()
	id: number;

	@Enum(() => ProposalType)
	type: ProposalType;

	@Property()
	targetEntityType: string; // "Clan", "RankedReclamation", etc.

	@Property()
	targetEntityId: number;

	@Property()
	reason: string;

	@Property({ nullable: true, type: "date" })
	closedAt?: Date;

	@Enum(() => ProposalStatus)
	status: ProposalStatus = ProposalStatus.PENDING;

	@OneToMany(() => Vote, (vote) => vote.proposal, { orphanRemoval: true })
	votes: Collection<Vote> = new Collection<Vote>(this);

	// Optional: who can vote (not enforced at DB level)
	@ManyToMany(() => User)
	eligibleVoters: Collection<User> = new Collection<User>(this);

	@Enum(() => VotingStrategy)
	strategy: VotingStrategy = VotingStrategy.MAJORITY;

	@Property()
	minParticipationRatio: number = 1.0;

	@Property()
	expiresAt: Date;
}

export class VoteProposalRepository extends EntityRepository<VoteProposal> {}
