import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import { Entity, OneToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { CustomBaseEntity } from "./BaseEntity";
import { VoteProposal } from "./VoteProposal";

@Entity({ repository: () => BlacklistRepository })
export class Blacklist extends CustomBaseEntity {
	[EntityRepositoryType]?: BlacklistRepository;

	@PrimaryKey()
	id!: number;

	@Property({ default: "" })
	reason: string;

	@OneToOne(() => VoteProposal, { nullable: true, deleteRule: "cascade" })
	voteProposal?: Rel<VoteProposal> | null;
}

// ===========================================
// =========== Custom Repository =============
// ===========================================

export class BlacklistRepository extends EntityRepository<Blacklist> {}
