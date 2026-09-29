import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import {
	Entity,
	Enum,
	ManyToOne,
	OneToMany,
	PrimaryKey,
	Property,
} from "@mikro-orm/decorators/legacy";

import { ClanMemberRole, LeaveReason } from "../utils/enums";
import { CustomBaseEntity } from "./BaseEntity";
import { Clan } from "./Clan";
import { User } from "./User";

@Entity({ repository: () => ClanMemberHistoryRepository })
export class ClanMemberHistory extends CustomBaseEntity {
	[EntityRepositoryType]?: ClanMemberHistoryRepository;

	@PrimaryKey()
	id!: number;

	@ManyToOne(() => User)
	user: Rel<User>;

	@ManyToOne(() => Clan)
	clan: Rel<Clan>;

	@Property()
	joinDate: Date;

	@Enum(() => LeaveReason)
	leaveReason: LeaveReason;

	@Property({ nullable: true, type: "string" })
	kickReason?: string;

	@Property()
	clanFameContributed: number = 0;

	@Enum(() => ClanMemberRole)
	role: ClanMemberRole;
}

// ===========================================
// =========== Custom Repository =============
// ===========================================

export class ClanMemberHistoryRepository extends EntityRepository<ClanMemberHistory> {}
