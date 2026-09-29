import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import { Entity, OneToOne, Property } from "@mikro-orm/decorators/legacy";

import { CustomBaseEntity } from "./BaseEntity";
import { User } from "./User";

@Entity({ repository: () => UserExperienceRepository })
export class UserExperience extends CustomBaseEntity {
	[EntityRepositoryType]?: UserExperienceRepository;

	@OneToOne(() => User, (user: User) => user.xp, { primary: true, owner: true })
	user: Rel<User>;

	@Property({ default: 1 })
	currentLevel: number = 1;

	@Property({ default: 0 })
	totalXp: number = 0;
}

export class UserExperienceRepository extends EntityRepository<UserExperience> {}
