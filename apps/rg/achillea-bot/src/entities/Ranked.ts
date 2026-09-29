import { EntityRepository, EntityRepositoryType } from "@mikro-orm/core";
import { Entity, Enum, Property } from "@mikro-orm/decorators/legacy";

import { EventTypeEnum, MatchMode, RankedState } from "../utils/enums";
import { Event } from "./Event";

@Entity({ repository: () => RankedRepository, discriminatorValue: EventTypeEnum.RANKED })
export class Ranked extends Event {
	[EntityRepositoryType]?: RankedRepository;

	@Enum(() => RankedState)
	status: RankedState = RankedState.OPEN;

	@Property()
	queueEndsAt: Date;

	@Enum(() => MatchMode)
	mode: MatchMode = MatchMode.ONE_VS_ONE;
}

export class RankedRepository extends EntityRepository<Ranked> {}
