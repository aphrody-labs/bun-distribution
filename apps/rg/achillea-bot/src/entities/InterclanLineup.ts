import {
	Cascade,
	Collection,
	EntityRepository,
	EntityRepositoryType,
	type Rel,
} from "@mikro-orm/core";
import { Entity, ManyToOne, OneToMany, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { Clan } from "./Clan";
import { Interclan } from "./Interclan";
import { InterclanLineupMember } from "./InterclanLineupMember";

@Entity({ repository: () => InterclanLineupRepository })
export class InterclanLineup {
	[EntityRepositoryType]?: InterclanLineupRepository;

	@PrimaryKey()
	id!: number;

	@ManyToOne(() => Interclan)
	event!: Rel<Interclan>;

	@ManyToOne(() => Clan)
	clan!: Rel<Clan>;

	@OneToMany(() => InterclanLineupMember, (lm) => lm.lineup, {
		cascade: [Cascade.ALL],
		orphanRemoval: true,
	})
	members = new Collection<InterclanLineupMember>(this);

	@Property()
	lockedIn: boolean = false;

	/**
	 * Returns true if lineup count is between 3 and 10.
	 */
	isValidLineup(): boolean {
		return this.members.length === 5;
	}
}

export class InterclanLineupRepository extends EntityRepository<InterclanLineup> {}
