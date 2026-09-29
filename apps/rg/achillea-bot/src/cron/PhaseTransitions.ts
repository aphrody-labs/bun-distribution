import { Injectable, Schedule } from "@/decorators";
import { resolveDependency } from "@/utils/functions";

import { PhaseTransitionService } from "../services/PhaseTransitionService";
import { TournamentScheduleService } from "../services/TournamentScheduleService";
import { TournamentsService } from "../services/TournamentsService";

@Injectable()
export class PhaseTransitions {
	@Schedule("*/5 * * * *", "phase-transitions")
	async scanActiveTournaments() {
		const tournamentService = await resolveDependency(TournamentsService);
		const phaseService = await resolveDependency(PhaseTransitionService);
		const scheduleService = await resolveDependency(TournamentScheduleService);

		// 1. Transitions pilotées par les dates du planning (ouverture des
		//    inscriptions, fermeture + bracket, démarrage). Avant l'avancement des
		//    phases : un tournoi démarré à ce tick doit pouvoir progresser au suivant.
		try {
			const applied = await scheduleService.runDueTransitions();
			for (const transition of applied) {
				console.info(
					`[PhaseTransitions] tournoi ${transition.tournamentId} : ${transition.from} → ${transition.to}`
				);
			}
		} catch (error) {
			// Une erreur de planning ne doit pas empêcher l'avancement des tournois en cours.
			console.warn("[PhaseTransitions] transitions de planning :", (error as Error)?.message);
		}

		// 2. Avancement des phases des tournois déjà en cours (rondes suisses).
		const [tournaments] = await tournamentService.getTournaments(1, 100, undefined, [
			"Ongoing" as never,
		]);

		for (const tournament of tournaments) {
			try {
				await phaseService.progressTournament(tournament);
			} catch {
				// Subscriber errors must never break the cron loop
			}
		}
	}
}
