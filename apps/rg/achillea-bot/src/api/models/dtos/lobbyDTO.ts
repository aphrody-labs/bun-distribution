import { CollectionOf, Enum, Groups, Name, Nullable, Optional, Property } from "@tsed/schema";

import { LobbyState, LobbyUserState, MatchFormat, MatchMode, TeamSide } from "@/utils/enums";

export class LobbyUserDataDTO {
	@Property() displayName: string;
	@Property() id: string;
	@Property() avatar: string;
}

export class LobbyUserDTO {
	@Property()
	id: number;

	@Name("user")
	@Property(LobbyUserDataDTO)
	user: LobbyUserDataDTO;

	@Enum(TeamSide)
	team: TeamSide;

	@Property()
	forfeit: boolean;

	@Enum(LobbyUserState)
	state: LobbyUserState; // PENDING, READY, etc.
}

export class LobbyMatchDTO {
	@Property()
	id: number;

	@Property()
	gameNumber: number;

	@Property()
	scoreTeam1: number;

	@Property()
	scoreTeam2: number;

	@Property()
	team1Validated: boolean;

	@Property()
	team2Validated: boolean;

	@Property()
	adminValidated: boolean;
}

export class LobbyDTO {
	@Property()
	id: number;

	@Enum(MatchMode)
	mode: MatchMode;

	@Enum(LobbyState)
	state: LobbyState;

	@Property()
	@Nullable(Number)
	@Optional()
	bracketMatchId?: number | null;

	@CollectionOf(LobbyUserDTO)
	lobbyUsers: LobbyUserDTO[];

	@CollectionOf(LobbyMatchDTO)
	@Groups("details")
	lobbyMatches: LobbyMatchDTO[];

	@Property(LobbyUserDTO)
	@Nullable(LobbyUserDTO)
	hostUser: LobbyUserDTO | null;

	@Enum(MatchFormat)
	matchFormat: MatchFormat;
}
