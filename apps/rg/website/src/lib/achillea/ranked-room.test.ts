import { describe, expect, test } from "bun:test";
import {
	matchStatusLabel,
	rankedMatchPath,
	rankedMatchViewState,
	roomIdFromReservation,
} from "./ranked-room";

describe("réservation de salle ranked", () => {
	test("extrait l'identifiant de la réservation Colyseus", () => {
		expect(roomIdFromReservation({ room: { roomId: "room-123" } })).toBe("room-123");
	});

	test("refuse les réservations absentes ou incomplètes", () => {
		expect(roomIdFromReservation(null)).toBeNull();
		expect(roomIdFromReservation({})).toBeNull();
		expect(roomIdFromReservation({ room: { roomId: " " } })).toBeNull();
	});

	test("construit un retour match avec un identifiant échappé", () => {
		expect(rankedMatchPath("room id/1")).toBe("/achillea/ranked/match?salle=room%20id%2F1");
	});

	test("traduit les phases de match connues et les valeurs inconnues", () => {
		expect(matchStatusLabel("waiting")).toBe("En attente des joueurs");
		expect(matchStatusLabel("playing")).toBe("Match en cours");
		expect(matchStatusLabel("scoring")).toBe("Saisie des scores");
		expect(matchStatusLabel("finished")).toBe("Match terminé");
		expect(matchStatusLabel("other")).toBe("État du match inconnu");
	});

	test("n'annonce un match que lorsque la session, la salle et son code sont prêts", () => {
		const common = {
			authLoading: false,
			isAuthenticated: true,
			connection: "inactive" as const,
			roomCode: null,
		};
		expect(rankedMatchViewState(common)).toBe("empty");
		expect(rankedMatchViewState({ ...common, isAuthenticated: false })).toBe("login");
		expect(rankedMatchViewState({ ...common, connection: "connexion" })).toBe("loading");
		expect(rankedMatchViewState({ ...common, connection: "connecte" })).toBe("syncing");
		expect(rankedMatchViewState({ ...common, connection: "connecte", roomCode: "ACH-1" })).toBe(
			"match"
		);
		expect(rankedMatchViewState({ ...common, connection: "erreur" })).toBe("error");
	});
});
