import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import { Entity, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { ClanMember } from "./ClanMember";
import { InterclanLineup } from "./InterclanLineup";
import { User } from "./User";

@Entity({ repository: () => InterclanLineupMemberRepository })
export class InterclanLineupMember {
	[EntityRepositoryType]?: InterclanLineupMemberRepository;

	@PrimaryKey()
	id!: number;

	@ManyToOne(() => InterclanLineup, { deleteRule: "cascade" })
	lineup!: Rel<InterclanLineup>;

	@ManyToOne(() => User)
	user!: Rel<User>;

	@Property()
	position!: number; // 1..5 order in lineup
}

export class InterclanLineupMemberRepository extends EntityRepository<InterclanLineupMember> {}
