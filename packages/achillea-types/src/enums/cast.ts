/** Nature d'un évènement à caster. */
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

/** Poste occupé sur une diffusion. */
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
