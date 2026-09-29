import { EntityRepository, EntityRepositoryType } from "@mikro-orm/core";
import { Entity, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { CustomBaseEntity } from "./BaseEntity";

@Entity({ repository: () => ExperienceRepository })
export class Experience extends CustomBaseEntity {
	[EntityRepositoryType]?: ExperienceRepository;

	@PrimaryKey({ autoincrement: true })
	id: number;

	@Property({ unique: true })
	level: number;

	@Property()
	xpRequired: number;
}

export class ExperienceRepository extends EntityRepository<Experience> {}
