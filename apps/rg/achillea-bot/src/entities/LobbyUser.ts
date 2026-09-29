import { EntityRepository, EntityRepositoryType, type Rel } from "@mikro-orm/core";
import {
	Entity,
	Enum,
	ManyToOne,
	PrimaryKey,
	Property,
	Unique,
} from "@mikro-orm/decorators/legacy";

import type { LobbyUserDataDTO } from "../api/models/dtos/lobbyDTO";

import { LobbyUserState, TeamSide } from "../utils/enums";
import { CustomBaseEntity } from "./BaseEntity";
import { Lobby } from "./Lobby";
import { User } from "./User";

@Entity({ repository: () => LobbyUserRepository })
@Unique({ properties: ["user", "lobby"] })
export class LobbyUser extends CustomBaseEntity {
	[EntityRepositoryType]?: LobbyUserRepository;

	@PrimaryKey()
	id!: number;

	@ManyToOne(() => User)
	user!: Rel<User>;

	@ManyToOne(() => Lobby)
	lobby!: Rel<Lobby>;

	@Enum(() => TeamSide)
	team: TeamSide = TeamSide.TEAM_1;

	@Property({ default: 0 })
	score: number = 0;

	@Property({ default: false })
	forfeit: boolean = false;

	@Property({ default: 0 })
	eloVariation: number = 0;

	@Property({ default: false })
	validatedResult: boolean = false;

	// Score que CE joueur attribue à l'adversaire (litige : on stocke les 2 scorelines complètes).
	@Property({ nullable: true })
	claimedOpponentScore?: number;

	// Capture d'écran de preuve uploadée en cas de litige.
	@Property({ type: "text", nullable: true })
	screenshotUrl?: string;

	@Enum(() => LobbyUserState)
	state: LobbyUserState = LobbyUserState.PENDING;

	get won(): boolean {
		if (this.forfeit) return false;
		const opponent = this.getOpponents();

		return opponent.at(0)?.forfeit || this.score > (opponent.at(0)?.score ?? 0);
	}

	get userData(): LobbyUserDataDTO {
		return { displayName: this.user.displayName, id: this.user.id, avatar: this.user.avatar };
	}

	getOpponents(): LobbyUser[] {
		return this.lobby.lobbyUsers.getItems().filter((u) => u.team !== this.team);
	}
}

export class LobbyUserRepository extends EntityRepository<LobbyUser> {}
