import { EntityRepository, EntityRepositoryType, PrimaryKeyProp, type Rel } from "@mikro-orm/core";
import { Entity, Enum, ManyToOne, Property } from "@mikro-orm/decorators/legacy";

import { MatchMode } from "../utils/enums";
import { CustomBaseEntity } from "./BaseEntity";
import { Season } from "./Season";
import { User } from "./User";

@Entity({ repository: () => UserEloRepository })
export class UserElo extends CustomBaseEntity {
	[EntityRepositoryType]?: UserEloRepository;
	[PrimaryKeyProp]?: ["user", "mode"];

	@ManyToOne(() => User, { primary: true, deleteRule: "cascade" })
	user!: Rel<User>;

	@Enum({ items: () => MatchMode, primary: true })
	mode!: MatchMode; // e.g., '1v1', '2v2'

	@ManyToOne(() => Season, { nullable: true, deleteRule: "set null" })
	season: Rel<Season> | null = null;

	@Property()
	elo: number = 0;

	@Property()
	peakRating: number = 0;

	@Property()
	gamesPlayed: number = 0;

	@Property()
	wins: number = 0;

	@Property()
	losses: number = 0;
}

export class UserEloRepository extends EntityRepository<UserElo> {}
