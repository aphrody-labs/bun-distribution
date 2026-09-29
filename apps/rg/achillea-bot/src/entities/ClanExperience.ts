import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import { Entity, OneToOne, Property } from "@mikro-orm/decorators/legacy";

import { CustomBaseEntity } from "./BaseEntity";
import { Clan } from "./Clan";

@Entity({ repository: () => ClanExperienceRepository })
export class ClanExperience extends CustomBaseEntity {
	[EntityRepositoryType]?: ClanExperienceRepository;

	@OneToOne(() => Clan, (clan: Clan) => clan.xp, { primary: true, owner: true })
	clan: Rel<Clan>;

	@Property({ default: 1 })
	currentLevel: number = 1;

	@Property({ default: 0 })
	totalXp: number = 0;
}

export class ClanExperienceRepository extends EntityRepository<ClanExperience> {}
