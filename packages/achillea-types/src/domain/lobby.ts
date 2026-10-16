import type { LobbyState, LobbyUserState, MatchFormat, MatchMode, TeamSide } from "../enums/eventEnums";

export interface LobbyUserDataDTO {
  displayName: string;
  id: string;
  avatar: string;
}

export interface LobbyUserDTO {
  id: number;
  user: LobbyUserDataDTO;
  team: TeamSide;
  forfeit: boolean;
  state: LobbyUserState;
}

export interface LobbyMatchDTO {
  id: number;
  gameNumber: number;
  scoreTeam1: number;
  scoreTeam2: number;
  team1Validated: boolean;
  team2Validated: boolean;
  adminValidated: boolean;
}

export interface LobbyDTO {
  id: number;
  mode: MatchMode;
  state: LobbyState;
  bracketMatchId?: number | null;
  lobbyUsers: LobbyUserDTO[];
  lobbyMatches: LobbyMatchDTO[];
  hostUser: LobbyUserDTO | null;
  matchFormat?: MatchFormat | null;
}

export interface GameScoreDTO {
  lobbyId: number;
  gameNumber: number;
  score1: number;
  score2: number;
}

export interface GameValidatorDTO {
  lobbyId: number;
  lobbyMatchId: number;
}
