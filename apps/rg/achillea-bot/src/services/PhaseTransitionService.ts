import { singleton } from "tsyringe";
import { phaseLobbiesAreFinished, shouldFinishTournament } from "@rosegriffon/achillea-core";

import { Lobby, Tournament, TournamentPhase } from "@/entities";
import { PhaseStatus, TournamentState } from "@/utils/enums";

import { Database } from "./Database";
import { SwissStageService } from "./SwissStageService";

@singleton()
export class PhaseTransitionService {
	constructor(
		private db: Database,
		private swissStageService: SwissStageService
	) {}

	async progressTournament(tournament: Tournament): Promise<void> {
		const em = this.db.em.fork();

		const phases = await em.find(
			TournamentPhase,
			{ tournament: tournament.id },
			{ orderBy: { index: "ASC" } }
		);

		if (phases.length === 0) return;

		const activePhase = phases.find((p) => p.status === PhaseStatus.Active);
		if (!activePhase) return;

		const lobbies = await em.find(Lobby, { phase: activePhase.id });

		const allDone = phaseLobbiesAreFinished(lobbies.map((l) => l.state));

		if (!allDone) return;

		const alreadyCompleted = activePhase.status === PhaseStatus.Completed;
		if (alreadyCompleted) return;

		await this.swissStageService.advanceToNextPhase(activePhase);

		if (shouldFinishTournament(phases, activePhase.id)) {
			const t = await em.findOne(Tournament, { id: tournament.id });
			if (t && t.internalState === TournamentState.ONGOING) {
				t.internalState = TournamentState.FINISHED;
				await em.flush();
			}
		}
	}
}
