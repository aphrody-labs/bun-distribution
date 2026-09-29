import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import { Entity, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import type { ClanMemberDistinction } from "../utils/enums";
import { CustomBaseEntity } from "./BaseEntity";
import { Clan } from "./Clan";
import { User } from "./User";

@Entity({ repository: () => ClanInviteRepository })
export class ClanInvite extends CustomBaseEntity {
	[EntityRepositoryType]?: ClanInviteRepository;

	@PrimaryKey({ autoincrement: true })
	id: number;

	@ManyToOne(() => User)
	user!: Rel<User>;

	@ManyToOne(() => Clan)
	clan!: Rel<Clan>;

	@ManyToOne(() => User)
	inviter!: Rel<User>;

	@Property({ nullable: true, type: "string" })
	threadId: string;

	@Property({ type: "string[]", default: [] })
	distinctions: ClanMemberDistinction[] = [];

	@Property({ defaultRaw: "NOW()" })
	lastNotifiedAt: Date = new Date();
}

// ===========================================
// =========== Custom Repository =============
// ===========================================

export class ClanInviteRepository extends EntityRepository<ClanInvite> {
	async getAllInvites(clanId: number, page?: number, pagination?: number) {
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
