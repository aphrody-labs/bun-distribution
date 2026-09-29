import { EntityRepository, EntityRepositoryType } from "@mikro-orm/core";
import { Entity, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { CustomBaseEntity } from "./BaseEntity";
import { Event } from "./Event";

@Entity({ repository: () => EventAnnouncementRepository })
export class EventAnnouncement extends CustomBaseEntity {
	[EntityRepositoryType]?: EventAnnouncementRepository;

	@PrimaryKey()
	id!: number;

	@ManyToOne(() => Event)
	event!: Event; // FK to any subclass: Ranked, Tournament, Interclan

	@Property()
	guildId!: string;

	@Property()
	channelId!: string;

	@Property()
	messageId!: string;
}

export class EventAnnouncementRepository extends EntityRepository<EventAnnouncement> {}
