import type { AxiosInstance } from "axios";
import axios from "axios";

import type { ChallongeUpdatedMatchPayload, MatchModel } from "@/api/models/dtos";
import { Service } from "@/decorators";
import type { Tournament, TournamentParticipant } from "@/entities";
import { env } from "@/env";
import { Provider } from "@/utils/enums";
import type { ChallongeTournamentPayload } from "@/utils/interfaces";
import { TournamentType } from "@/utils/interfaces";

import type { ParticipantModel } from "../api/models/dtos/participantDTO";

enum ChallongeTournamentState {
	AbortCheckin = "abort_checkin",
	Finalize = "finalize",
	FinalizeGroupStage = "finalize_group_stage",
	OpenPredictions = "open_predictions",
	ProcessCheckin = "process_checkin",
	Reset = "reset",
	ResetGroupStage = "reset_group_stage",
	Start = "start",
	StartGroupStage = "start_group_stage",
}

@Service() // À adapter selon ton framework (NestJS: @Injectable())
export class ChallongeService {
	private http: AxiosInstance;

	constructor() {
		this.http = axios.create({
			baseURL: env.CHALLONGE_BASE_URL,
			headers: {
				Authorization: `${env.isProd ? env.CHALLONGE_API_KEY : env.CHALLONGE_API_KEY_TEST}`, // Ou "Bearer ..." selon le type de token
				"Content-Type": "application/vnd.api+json",
				Accept: "application/json",
			},
		});
	}

	/**
	 * Crée un tournoi sur Challonge et retourne l'ID Challonge
	 */
	async createTournament(tournament: Tournament): Promise<[string, string]> {
		try {
			const payload: ChallongeTournamentPayload = {
				data: {
					type: "tournaments",
					attributes: {
						name: tournament.name, // Vient de Event.ts
						tournament_type: tournament.tournamentType as unknown as TournamentType,
						starts_at: tournament.startsAt?.toISOString(),
						description: tournament.description, // Vient de Event.ts
						game_name: "Inazuma Eleven Victory Road",
						group_stage_enabled: false,
						private: true,
					},
				},
			};

			const response = await this.http.post("/application/tournaments", payload);

			// JSON:API retourne l'objet créé dans data.id
			return [response.data.data.id, response.data.data.attributes.url];
		} catch (error: any) {
			console.error("Erreur Challonge:", error.response?.data?.errors || error.message);
			throw new Error(
				`Impossible de créer le tournoi sur Challonge: ${this.formatChallongeError(error)}`,
				{ cause: error }
			);
		}
	}

	async bulkRegisterParticipants(
		localParticipants: TournamentParticipant[],
		tournamentChallongeId: string
	): Promise<ParticipantModel[]> {
		// 2. Préparer le payload pour Challonge (format JSON:API Bulk)
		const payload = {
			data: {
				type: "Participants",
				attributes: {
					participants: localParticipants.map((p) => ({
						name: p.user.username, // Ou p.user.displayName
						username:
							p.user.connections.getItems().find((c) => c.provider === Provider.CHALLONGE)
								?.externalUsername ?? p.user.username, // Ou p.user.displayName
					})),
				},
			},
		};

		// 3. Appel API (V2 Bulk Create)
		const response = await this.http.post(
			`/tournaments/${tournamentChallongeId}/participants/bulk_add.json`,
			payload
		);

		return response.data.data;
	}

	async startTournament(tournamentChallongeId: string) {
		// 2. Préparer le payload pour Challonge (format JSON:API Bulk)
		const payload = {
			data: {
				type: "TournamentState",
				attributes: {
					state: ChallongeTournamentState.Start,
				},
			},
		};

		// 3. Appel API (V2 Bulk Create)
		const response = await this.http.put(
			`/tournaments/${tournamentChallongeId}/change_state.json`,
			payload
		);

		return true;
	}

	async getMatches(tournamentChallongeId: string): Promise<MatchModel[]> {
		let allMatches: MatchModel[] = [];

		try {
			const response = await this.http.get(`/tournaments/${tournamentChallongeId}/matches.json`);

			// Sécurité : Vérifier si response.data existe
			if (!response.data || !response.data.data) {
				console.warn("[CHALLONGE] Réponse vide ou mal formatée");
			}

			const data = response.data.data;
			allMatches = [...allMatches, ...data];

			return allMatches;
		} catch (error: any) {
			// Affichez le détail de l'erreur axios (status, message)
			console.error(
				"Erreur API Challonge:",
				error.response?.status,
				error.response?.data || error.message
			);
			throw error;
		}
	}

	async updateMatch(
		tournamentChallongeId: string,
		matchId: string,
		payload: ChallongeUpdatedMatchPayload
	) {
		// 3. Appel API (V2 Bulk Create)
		const response = await this.http.get(
			`/tournaments/${tournamentChallongeId}/matches/${matchId}.json`,
			payload
		);

		return response.data.data;
	}

	/**
	 * Mappe ton Enum interne vers les strings attendues par Challonge v2
	 */
	private mapTournamentType(type: TournamentType): string {
		switch (type) {
			case TournamentType.SingleElimination:
				return "single elimination";

			case TournamentType.DoubleElimination:
				return "double elimination";

			case TournamentType.RoundRobin:
				return "round robin";

			case TournamentType.Swiss:
				return "swiss";

			case TournamentType.FreeForAll:
				return "free for all"; // Vérifier si supporté par v2, sinon fallback

			default:
				return "single elimination";
		}
	}

	/**
	 * Helper pour extraire les messages d'erreur de Challonge
	 */
	private formatChallongeError(error: any): string {
		const responseData = error.response?.data;

		// Cas 1: Challonge renvoie un tableau d'erreurs (JSON:API standard)
		if (responseData?.errors && Array.isArray(responseData.errors)) {
			return responseData.errors
				.map((e: any) => e.detail || e.title || JSON.stringify(e))
				.join(", ");
		}

		// Cas 2: Challonge renvoie une erreur unique ou un format différent
		if (responseData?.errors) {
			return JSON.stringify(responseData.errors);
		}

		// Cas 3: Erreur générique axios
		return error.message || "Erreur inconnue Challonge";
	}
}
