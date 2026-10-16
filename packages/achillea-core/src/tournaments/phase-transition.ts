export type PhaseStatusValue = "Pending" | "Active" | "Completed";

/** A phase can advance only after every lobby has a terminal result. */
export function phaseLobbiesAreFinished(
	lobbyStates: readonly string[],
	finishedStates: ReadonlySet<string> = new Set(["Finished", "Forfeited"]),
): boolean {
	return lobbyStates.length > 0 && lobbyStates.every((state) => finishedStates.has(state));
}

/** True when the active phase is the last phase still needing completion. */
export function shouldFinishTournament(
	phases: readonly { id: number | string; status: PhaseStatusValue }[],
	activePhaseId: number | string,
): boolean {
	return (
		phases.length > 0 &&
		phases.every((phase) => phase.status === "Completed" || phase.id === activePhaseId) &&
		!phases.some((phase) => phase.status === "Active" && phase.id !== activePhaseId)
	);
}
