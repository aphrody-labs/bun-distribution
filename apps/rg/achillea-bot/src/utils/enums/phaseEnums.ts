export enum PhaseKind {
	Swiss = "Swiss",
	SingleElim = "SingleElim",
	DoubleElim = "DoubleElim",
	RoundRobin = "RoundRobin",
	Top8Bracket = "Top8Bracket",
	/** Championnat (calendrier + points), ex. Asytral League. */
	League = "League",
}

export enum PhaseStatus {
	Pending = "Pending",
	Active = "Active",
	Completed = "Completed",
}
