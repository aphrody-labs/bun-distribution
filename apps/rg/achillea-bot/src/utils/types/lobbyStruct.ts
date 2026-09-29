import type { Lobby } from "@/entities";

export type LobbyStruct = {
	lobby: Lobby;
	p1: LobbyUserStruct;
	p2: LobbyUserStruct;
};

export type LobbyUserStruct = {
	userId: string;
	elo: number;
	twitchId: string | undefined;
	twitchLogin: string | undefined;
};

export type MatchStruct = {
	lobby?: Lobby;
	players: string[];
};
