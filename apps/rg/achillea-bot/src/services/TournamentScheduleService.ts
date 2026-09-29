import { Service } from "@/decorators";
import { env } from "@/env";
import { urlsConfig } from "@/configs";
import { TournamentState } from "@/utils/enums";
import { resolveDependency } from "@/utils/functions";
import { TournamentsService } from "./TournamentsService";

export interface ScheduleTransition {
	tournamentId: number;
	from: TournamentState;
	to: TournamentState;
}

/**
 * Transitions d'état pilotées par le planning (item « Automatiser les transitions de
 * phases du tournoi par rapport au Planning »).
 *
 * Les bascules d'ouverture et de préparation sont exécutées par l'API unifiée,
 * chacune conditionnée à une date **explicitement renseignée** par l'organisateur.
 * Sans date, rien ne bouge — un tournoi créé avant cette fonctionnalité continue
 * de se conduire à la main.
 *
 *   Pending        → Preregistering  à `registrationOpensAt`
 *   Preregistering → Preparing       à `registrationClosesAt` (+ génération du bracket)
 * Le démarrage et la progression des brackets restent, pour l'instant, dans le
 * worker de phases Discord afin de préserver l'adaptateur de lobbies existant.
 *
 * Chaque tick est indépendant et idempotent : un tournoi dont la date est passée
 * depuis trois jours bascule au prochain tick sans traitement de rattrapage, et un
 * tournoi déjà basculé n'est plus candidat (le filtre porte sur l'état courant).
 */
@Service()
export class TournamentScheduleService {
	async runDueTransitions(now: Date = new Date()): Promise<ScheduleTransition[]> {
		const response = await fetch(
			`${urlsConfig.unifiedApi.replace(/\/+$/u, "")}/v1/achillea/tournaments/internal/schedule-transitions`,
			{
				method: "POST",
				headers: {
					accept: "application/json",
					"content-type": "application/json",
					...(env.API_ADMIN_TOKEN ? { authorization: `Bearer ${env.API_ADMIN_TOKEN}` } : {}),
				},
				body: JSON.stringify({ now: now.toISOString() }),
			}
		);
		const payload = (await response.json().catch(() => null)) as
			| { transitions?: ScheduleTransition[]; startCandidates?: number[]; message?: string }
			| null;
		if (!response.ok) {
			throw new Error(payload?.message ?? `Unified schedule API returned ${response.status}`);
		}
		// The API owns candidate selection. Starting a bracket still uses the
		// Discord-side lobby adapter until that adapter is moved to the API.
		for (const tournamentId of payload?.startCandidates ?? []) {
			try {
				await (await resolveDependency(TournamentsService)).startTournament(tournamentId);
				(payload?.transitions ?? []).push({
					tournamentId,
					from: TournamentState.PREPARING,
					to: TournamentState.ONGOING,
				});
			} catch (error) {
				console.warn(
					`[TournamentSchedule] démarrage automatique impossible (tournoi ${tournamentId}) :`,
					(error as Error)?.message
				);
			}
		}
		return payload?.transitions ?? [];
	}
}
