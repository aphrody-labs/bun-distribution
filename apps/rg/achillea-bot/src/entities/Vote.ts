import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import { Entity, Enum, ManyToOne, PrimaryKey } from "@mikro-orm/decorators/legacy";

import { VoteChoice } from "../utils/enums";
import { CustomBaseEntity } from "./BaseEntity";
import { User } from "./User";
import { VoteProposal } from "./VoteProposal";

@Entity({ repository: () => VoteRepository })
export class Vote extends CustomBaseEntity {
	[EntityRepositoryType]?: VoteRepository;

	@PrimaryKey()
	id: number;

	@ManyToOne(() => VoteProposal)
	proposal!: Rel<VoteProposal>;

	@ManyToOne(() => User)
	voter!: Rel<User>;

	@Enum(() => VoteChoice)
	vote: VoteChoice;
}

export class VoteRepository extends EntityRepository<Vote> {}
