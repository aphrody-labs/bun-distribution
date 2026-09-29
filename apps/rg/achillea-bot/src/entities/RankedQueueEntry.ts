import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import { Entity, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { CustomBaseEntity } from "./BaseEntity";
import { Ranked } from "./Ranked";
import { User } from "./User";

@Entity({ repository: () => RankedQueueEntryRepository })
export class RankedQueueEntry extends CustomBaseEntity {
	[EntityRepositoryType]?: RankedQueueEntryRepository;

	@PrimaryKey()
	id: number;

	@ManyToOne(() => User)
	user!: Rel<User>;

	@ManyToOne(() => Ranked)
	ranked!: Rel<Ranked>;

	@Property({ default: false })
	validatedPresence: boolean = false;
}

export class RankedQueueEntryRepository extends EntityRepository<RankedQueueEntry> {}
