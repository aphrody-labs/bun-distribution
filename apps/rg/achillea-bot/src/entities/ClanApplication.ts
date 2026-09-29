import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import { Entity, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import type { ClanMemberDistinction } from "../utils/enums";
import { CustomBaseEntity } from "./BaseEntity";
import { Clan } from "./Clan";
import { User } from "./User";

@Entity({ repository: () => ClanApplicationRepository })
export class ClanApplication extends CustomBaseEntity {
	[EntityRepositoryType]?: ClanApplicationRepository;

	@PrimaryKey({ autoincrement: true })
	id: number;

	@ManyToOne(() => User)
	user!: Rel<User>;

	@ManyToOne(() => Clan)
	clan!: Rel<Clan>;

	@Property({ type: "string[]", default: [] })
	distinctions: ClanMemberDistinction[] = [];

	@Property({ nullable: true })
	messageId?: string;
}

// ===========================================
// =========== Custom Repository =============
// ===========================================

export class ClanApplicationRepository extends EntityRepository<ClanApplication> {
	async getAllApplications(clanId: number, page?: number, pagination?: number) {
		const options: any = {
			orderBy: { createdAt: "asc" },
			populate: ["user"],
		};

		if (pagination && page) {
			options.limit = pagination;
			options.offset = pagination * (page - 1);
		}

		return this.findAndCount(
			{
				clan: clanId,
			},
			options
		);
	}
}
