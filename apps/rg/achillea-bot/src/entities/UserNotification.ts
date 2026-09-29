import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import { Entity, Index, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { CustomBaseEntity } from "./BaseEntity";
import { Notification } from "./Notification";
import { User } from "./User";

@Entity({ repository: () => UserNotificationRepository })
export class UserNotification extends CustomBaseEntity {
	[EntityRepositoryType]?: UserNotificationRepository;

	@PrimaryKey({ autoincrement: true })
	id!: number;

	@ManyToOne(() => Notification)
	@Index()
	notification!: Rel<Notification>;

	@ManyToOne(() => User)
	@Index()
	user!: Rel<User>;

	@Property({ default: false })
	isRead: boolean = false;

	@Property({ nullable: true })
	readAt?: Date | null;
}

export class UserNotificationRepository extends EntityRepository<UserNotification> {}
