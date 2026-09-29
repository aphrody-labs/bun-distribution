import { Entity, Enum, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { EventTypeEnum } from "../utils/enums";
import { CustomBaseEntity } from "./BaseEntity";

@Entity({ discriminatorColumn: "type", abstract: true })
export abstract class Event extends CustomBaseEntity {
	@PrimaryKey()
	id: number;

	@Property()
	name!: string;

	@Property({ length: 1500 })
	description!: string;

	@Enum(() => EventTypeEnum)
	type!: EventTypeEnum;
}
