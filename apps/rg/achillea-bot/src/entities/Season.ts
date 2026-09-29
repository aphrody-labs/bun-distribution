import { EntityRepository, EntityRepositoryType } from "@mikro-orm/core";
import { Entity, Enum, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { SeasonState } from "../utils/enums/seasonEnums";
import { CustomBaseEntity } from "./BaseEntity";

export interface SeasonConfig {
	kFactor: number;
	baseRating: number;
	decayRate: number;
}

@Entity({ repository: () => SeasonRepository })
export class Season extends CustomBaseEntity {
	[EntityRepositoryType]?: SeasonRepository;

	@PrimaryKey({ type: "uuid", defaultRaw: "gen_random_uuid()" })
	id!: string;

	@Property()
	name!: string;

	@Property()
	startsAt!: Date;

	@Property()
	endsAt!: Date;

	@Enum({ items: () => SeasonState })
	state: SeasonState = SeasonState.Upcoming;

	@Property({ type: "json", nullable: true })
	config: SeasonConfig | null = null;
}

export class SeasonRepository extends EntityRepository<Season> {}
