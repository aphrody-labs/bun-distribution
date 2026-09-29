import {
	Cascade,
	Collection,
	EntityRepository,
	EntityRepositoryType,
	type Rel,
} from "@mikro-orm/core";
import {
	Entity,
	Enum,
	ManyToOne,
	OneToMany,
	PrimaryKey,
	Property,
} from "@mikro-orm/decorators/legacy";

import { ClanTeamType, TeamMemberRole } from "@/utils/enums";

import { CustomBaseEntity } from "./BaseEntity";
import { Clan } from "./Clan";
import { ClanTeamMember } from "./ClanTeamMember";

@Entity({ repository: () => ClanTeamRepository })
export class ClanTeam extends CustomBaseEntity {
	[EntityRepositoryType]?: ClanTeamRepository;

	@PrimaryKey({ autoincrement: true })
	id!: number;

	@ManyToOne(() => Clan, { deleteRule: "cascade" })
	clan!: Rel<Clan>;

	@Property()
	name!: string;

	@Enum(() => ClanTeamType)
	type: ClanTeamType; // e.g. MAIN / SUB

	@OneToMany(() => ClanTeamMember, (e) => e.team, { cascade: [Cascade.REMOVE] })
	links = new Collection<ClanTeamMember>(this);

	@ManyToOne(() => ClanTeamMember, { nullable: true, deleteRule: "set null" })
	captain?: Rel<ClanTeamMember> | null;

	// helper for clarity
	setCaptain(link: ClanTeamMember | null) {
		this.captain = link;
		// this.touch() // update updatedAt
	}

	touch() {
		this.updatedAt = new Date();
	}

	isValidTeam(): boolean {
		// Count by role
		const players = this.links.filter((l) => l.role === TeamMemberRole.PLAYER);
		const subs = this.links.filter((l) => l.role === TeamMemberRole.SUB);
		const coaches = this.links.filter((l) => l.role === TeamMemberRole.COACH);

		// Validate numbers
		const validPlayers = players.length >= 3;
		const validSubs = subs.length >= 0 && subs.length <= 2;
		const validCoach = coaches.length >= 0 && coaches.length <= 1;

		return validPlayers && validSubs && validCoach;
	}

	getValidityErrors(): string[] {
		const errors: string[] = [];

		const players = this.links.filter((l) => l.role === TeamMemberRole.PLAYER).length;
		const subs = this.links.filter((l) => l.role === TeamMemberRole.SUB).length;
		const coaches = this.links.filter((l) => l.role === TeamMemberRole.COACH).length;

		if (players < 3) errors.push("Il faut au moins 3 joueurs.");
		if (subs > 2) errors.push("Pas plus de 2 remplaçants.");
		if (coaches > 1) errors.push("Pas plus d’un coach.");

		return errors;
	}
}

export class ClanTeamRepository extends EntityRepository<ClanTeam> {}
