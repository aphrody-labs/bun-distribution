import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import { Entity, Enum, ManyToOne, PrimaryKey, Unique } from "@mikro-orm/decorators/legacy";

import { TeamMemberRole } from "../utils/enums/teamMemberRole";
import { CustomBaseEntity } from "./BaseEntity";
import { ClanMember } from "./ClanMember";
import { ClanTeam } from "./ClanTeam";
import { User } from "./User";

@Entity({ repository: () => ClanTeamMemberRepository })
@Unique({ properties: ["member"] })
export class ClanTeamMember extends CustomBaseEntity {
	[EntityRepositoryType]?: ClanTeamMemberRepository;

	@PrimaryKey({ autoincrement: true })
	id!: number;

	@ManyToOne(() => ClanTeam, { deleteRule: "cascade" })
	team!: Rel<ClanTeam>;

	@ManyToOne(() => ClanMember, { deleteRule: "cascade" })
	member!: Rel<ClanMember>;

	@Enum(() => TeamMemberRole)
	role: TeamMemberRole = TeamMemberRole.PLAYER;

	@ManyToOne(() => User)
	addedBy: Rel<User>;
}

export class ClanTeamMemberRepository extends EntityRepository<ClanTeamMember> {}
