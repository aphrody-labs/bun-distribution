// State Colyseus pour MatchRoom — sérialisé automatiquement vers les 2 clients.
// Status flow : waiting → playing → scoring → (finished | disputed)
//   waiting  : on attend la connexion + le « Début de match » des 2 joueurs.
//   playing  : match en cours ; chaque joueur peut cliquer « Fin de match ».
//   scoring  : au moins un joueur a confirmé la fin → saisie des scores (ASYNCHRONE :
//              chaque joueur saisit + peut uploader une preuve indépendamment de l'autre).
//
// Le 1er joueur joue à DOMICILE (team 1), le 2e à l'EXTÉRIEUR (team 2).
//
// Modèle de score « double validation » : chaque joueur saisit le score COMPLET de son
// point de vue (mes buts + buts adverse). Accord si les 2 scorelines concordent
// (domicile 3-1 ⇄ extérieur 1-3) → match validé + ELO. Désaccord → preuve → Contesté.

import { ArraySchema, MapSchema, Schema, type } from "@colyseus/schema";

export class ChatMessage extends Schema {
	@type("string") userId: string = "";
	@type("string") text: string = "";
	@type("number") at: number = 0;
}

export class PlayerState extends Schema {
	@type("string") userId: string = "";
	@type("string") displayName: string = "";
	@type("string") avatar: string = "";
	@type("number") elo: number = 0;
	// Côté terrain : 1 = domicile (1er joueur), 2 = extérieur (2e joueur). 0 = non assigné.
	@type("number") team: number = 0;
	// Saisie du score, du point de vue de CE joueur (−1 = non saisi).
	@type("number") myScore: number = -1; // mes buts
	@type("number") oppScore: number = -1; // buts que j'attribue à l'adversaire
	@type("boolean") startedMatch: boolean = false; // a cliqué « Début de match »
	@type("boolean") submitted: boolean = false; // a validé sa saisie de score
	@type("boolean") proofUploaded: boolean = false; // a uploadé sa capture (preuve / litige)
	@type("boolean") confirmedFinish: boolean = false; // a cliqué « Fin de match »
}

export class MatchState extends Schema {
	@type("string") roomCode: string = "";
	@type("string") status: string = "waiting"; // waiting|playing|scoring|disputed|finished
	@type("number") mode: number = 2; // MatchMode (count of players)
	@type("boolean") ranked: boolean = true; // true = classé (ELO) ; false = non classé (amical)
	@type({ map: PlayerState }) players = new MapSchema<PlayerState>();
	@type([ChatMessage]) chat = new ArraySchema<ChatMessage>();
	@type("string") disputeReason: string = "";
	@type("number") lobbyId: number = 0;
	@type("number") startedAt: number = 0;
}
