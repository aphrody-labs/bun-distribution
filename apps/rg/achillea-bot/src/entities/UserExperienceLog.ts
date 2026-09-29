import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import { Entity, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { CustomBaseEntity } from "./BaseEntity";
import { User } from "./User";

@Entity({ repository: () => UserExperienceLogRepository })
export class UserExperienceLog extends CustomBaseEntity {
	[EntityRepositoryType]?: UserExperienceLogRepository;

	@PrimaryKey()
	id: number;

	@ManyToOne(() => User, { deleteRule: "cascade" })
	user: Rel<User>;

	@Property({ default: "" })
	reason: string;

	@Property({ default: 0 })
	xpChange: number = 0;
}

export class UserExperienceLogRepository extends EntityRepository<UserExperienceLog> {}
