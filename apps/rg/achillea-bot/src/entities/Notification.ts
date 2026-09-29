import { EntityRepository, EntityRepositoryType } from "@mikro-orm/core";
import { Entity, Enum, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { NotificationCategory, NotificationType } from "../utils/enums/notifications";
import { CustomBaseEntity } from "./BaseEntity";

@Entity({ repository: () => NotificationRepository })
export class Notification extends CustomBaseEntity {
	[EntityRepositoryType]?: NotificationRepository;

	@PrimaryKey({ autoincrement: true })
	id!: number;

	@Property()
	title!: string;

	@Property()
	message!: string;

	@Enum(() => NotificationType)
	type!: NotificationType;

	@Enum(() => NotificationCategory)
	category!: NotificationCategory;

	@Property({ type: "jsonb", nullable: true })
	payload?: any;
}

export class NotificationRepository extends EntityRepository<Notification> {}
