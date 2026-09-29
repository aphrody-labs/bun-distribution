import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import { Entity, ManyToOne, PrimaryKey, Property } from "@mikro-orm/decorators/legacy";

import { CustomBaseEntity } from "./BaseEntity";
import { Lobby } from "./Lobby";

@Entity({ repository: () => LobbyMatchRepository })
export class LobbyMatch extends CustomBaseEntity {
	[EntityRepositoryType]?: LobbyMatchRepository;

	@PrimaryKey()
	id!: number;

	@ManyToOne(() => Lobby)
	lobby!: Rel<Lobby>;

	@Property()
	gameNumber!: number; // Match 1, Match 2, Match 3...

	@Property()
	scoreTeam1: number = 0;

	@Property()
	scoreTeam2: number = 0;

	@Property()
	team1Validated: boolean = false;

	@Property()
	team2Validated: boolean = false;

	@Property()
	adminValidated: boolean = false;

	get isValidated(): boolean {
		return this.adminValidated || (this.team1Validated && this.team2Validated);
	}
}

export class LobbyMatchRepository extends EntityRepository<LobbyMatch> {}
