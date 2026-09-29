import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import { Entity, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { CustomBaseEntity } from "./BaseEntity";
import { Clan } from "./Clan";

@Entity({ repository: () => ClanExperienceLogRepository })
export class ClanExperienceLog extends CustomBaseEntity {
	[EntityRepositoryType]?: ClanExperienceLogRepository;

	@PrimaryKey()
	id: number;

	@ManyToOne(() => Clan, { deleteRule: "cascade" })
	clan: Rel<Clan>;

	@Property({ default: "" })
	reason: string;

	@Property({ default: 0 })
	xpChange: number = 0;
}

export class ClanExperienceLogRepository extends EntityRepository<ClanExperienceLog> {}
