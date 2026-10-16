// State Colyseus pour LobbyRoom — liste des joueurs présents en ligne,
// sérialisée automatiquement vers tous les clients connectés à la lobby.
// Permet aux clients de voir qui est dispo pour un défi direct (invitation).

import { MapSchema, Schema, type } from "@colyseus/schema";

export class LobbyPlayer extends Schema {
	@type("string") userId: string = "";
	@type("string") displayName: string = "";
	@type("string") avatar: string = "";
	@type("number") elo: number = 0;
	@type("number") mode: number = 2; // mode de prédilection affiché (1v1 par défaut)
}

export class LobbyState extends Schema {
	// Indexé par sessionId (un joueur peut être sur plusieurs onglets → 1 entrée/session).
	@type({ map: LobbyPlayer }) players = new MapSchema<LobbyPlayer>();
}
