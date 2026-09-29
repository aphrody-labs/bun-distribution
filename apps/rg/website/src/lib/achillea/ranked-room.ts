/** Extrait l'identifiant d'une réservation Colyseus sans imposer son type opaque. */
export function roomIdFromReservation(reservation: unknown): string | null {
	if (!reservation || typeof reservation !== "object") return null;
	const room = (reservation as { room?: unknown }).room;
	if (!room || typeof room !== "object") return null;
	const roomId = (room as { roomId?: unknown }).roomId;
	return typeof roomId === "string" && roomId.trim() ? roomId : null;
}

export function rankedMatchPath(roomId: string): string {
	return `/achillea/ranked/match?salle=${encodeURIComponent(roomId)}`;
}

/** Rend l'état de salle lisible, y compris avant la première synchro Colyseus. */
export function matchStatusLabel(status: string): string {
	switch (status) {
		case "waiting":
			return "En attente des joueurs";
		case "playing":
			return "Match en cours";
		case "scoring":
			return "Saisie des scores";
		case "finished":
			return "Match terminé";
		case "disputed":
			return "Match contesté";
		default:
			return "État du match inconnu";
	}
}

export type RankedMatchConnection = "inactive" | "connexion" | "connecte" | "erreur";
export type RankedMatchViewState =
	| "loading"
	| "login"
	| "error"
	| "empty"
	| "disconnected"
	| "syncing"
	| "match";

export function rankedMatchViewState(input: {
	authLoading: boolean;
	isAuthenticated: boolean;
	connection: RankedMatchConnection;
	roomCode: string | null;
}): RankedMatchViewState {
	if (input.authLoading || (input.isAuthenticated && input.connection === "connexion"))
		return "loading";
	if (!input.isAuthenticated) return "login";
	if (input.connection === "erreur") return "error";
	if (input.connection === "inactive" && !input.roomCode) return "empty";
	if (input.connection === "inactive") return "disconnected";
	if (!input.roomCode) return "syncing";
	return "match";
}
