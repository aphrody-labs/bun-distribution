// =============================================================================
// Enums — Cellule Cast (T-2.1)
// =============================================================================

export enum CastEventKind {
	Match = "match",
	Tournament = "tournament",
	Stream = "stream",
	Other = "other",
}

export enum CastEventStatus {
	Planned = "planned",
	OpenSignup = "open_signup",
	Attributed = "attributed",
	Live = "live",
	Done = "done",
	Cancelled = "cancelled",
}

export enum CastSlotRole {
	CasterMain = "caster_main",
	CasterSecondary = "caster_secondary",
	Observer = "observer",
	Producer = "producer",
	Host = "host",
	Technical = "technical",
}

export enum CastAvailabilityStatus {
	Available = "available",
	Maybe = "maybe",
	Unavailable = "unavailable",
}
