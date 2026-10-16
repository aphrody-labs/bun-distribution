export enum EventTypeEnum {
  TOURNAMENT = "TOURNAMENT",
  INTERCLAN = "INTERCLAN",
  RANKED = "RANKED",
}

export enum TournamentState {
  PENDING = "Pending", // Pending approval
  PREREGISTERING = "Preregistering",
  PREPARING = "Preparing",
  ONGOING = "Ongoing",
  FINISHED = "Finished",
  CANCELED = "Canceled",
}

/**
 * Statut d'un inscrit à un tournoi.
 *
 * Un seul axe pour deux besoins qui portaient sur la même ligne : la liste d'attente
 * quand le tournoi est plein, et la disqualification. Seuls les `Active` comptent dans
 * la capacité, le seeding et le bracket.
 */
export enum ParticipantStatus {
  ACTIVE = "Active",
  WAITLISTED = "Waitlisted",
  DISQUALIFIED = "Disqualified",
}

/**
 * Évènements journalisés d'un tournoi (table `tournament_event`).
 *
 * Journal métier destiné à l'affichage — distinct d'`audit_log`, qui est un journal ops
 * signé en chaîne contenant IP et charges utiles arbitraires.
 */
export enum TournamentEventType {
  CREATED = "created",
  UPDATED = "updated",
  REGISTRATIONS_OPENED = "registrations_opened",
  REGISTRATIONS_CLOSED = "registrations_closed",
  PARTICIPANT_REGISTERED = "participant_registered",
  PARTICIPANT_WAITLISTED = "participant_waitlisted",
  PARTICIPANT_PROMOTED = "participant_promoted",
  PARTICIPANT_UNREGISTERED = "participant_unregistered",
  PARTICIPANT_REMOVED = "participant_removed",
  PARTICIPANT_DISQUALIFIED = "participant_disqualified",
  PARTICIPANT_REINSTATED = "participant_reinstated",
  SEEDING_CHANGED = "seeding_changed",
  BRACKET_GENERATED = "bracket_generated",
  TOURNAMENT_STARTED = "tournament_started",
  SCORE_REPORTED = "score_reported",
  SCORE_VALIDATED = "score_validated",
  PHASE_ADVANCED = "phase_advanced",
  ORGANIZER_ADDED = "organizer_added",
  ORGANIZER_REMOVED = "organizer_removed",
  TOURNAMENT_CLOSED = "tournament_closed",
  TOURNAMENT_CANCELED = "tournament_canceled",
  TOURNAMENT_RESTORED = "tournament_restored",
}

/**
 * Qui saisit les scores des matchs d'un tournoi.
 *
 * `PLAYERS` est le comportement historique : les deux joueurs d'un lobby remplissent
 * eux-mêmes leur score, puis le valident chacun de leur côté (ou un organisateur
 * tranche). `STAFF_ONLY` réserve saisie et validation aux organisateurs — les joueurs
 * gardent la lecture du match, sans aucun bouton.
 */
export enum ScoreReportPolicy {
  PLAYERS = "players",
  STAFF_ONLY = "staff_only",
}

/**
 * Notes du staff sur un joueur (« espace dédié » où les organisateurs consignent ce
 * qu'ils ont à dire d'un joueur pendant un tournoi, lisible des autres admins).
 *
 * Distinct des sanctions : une note est une observation, pas une décision. Elle
 * n'entraîne aucune conséquence automatique et n'est jamais montrée au joueur.
 */
export enum PlayerNoteCategory {
  BEHAVIOR = "behavior",
  CHEATING = "cheating",
  NO_SHOW = "no_show",
  SCORE_DISPUTE = "score_dispute",
  POSITIVE = "positive",
  OTHER = "other",
}

export enum PlayerNoteSeverity {
  INFO = "info",
  WARNING = "warning",
  SERIOUS = "serious",
}

export enum RankedState {
  OPEN = "Open",
  LOCKED = "Locked",
  VALIDATING_PRESENCE = "Validating presence",
  PAIRING = "Pairing",
  VALIDATING_MATCH_START = "Validating start",
  REPOOLING = "Repooling",
  MATCHING = "Matching",
  FINISHED = "Finished",
  CANCELED = "Canceled",
}

export enum InterclanState {
  PENDING_APPROVAL,
  APPROVED,
  DENIED,
  READY,
  ONGOING,
  FINISHED,
  CANCELED,
  RESULT_OK,
  RESULT_NOK,
}

export enum LobbyState {
  FRESH = "Fresh",
  ONGOING = "Ongoing",
  PENDING_VALIDATION = "Pending validation",
  CONTESTED = "Contested",
  FINISHED = "Finished",
  CANCELED = "Canceled",
  FORFEITED = "Forfeited",
}

export enum MatchMode {
  ONE_VS_ONE = 2,
  TWO_VS_TWO = 4,
}

export enum TeamSide {
  TEAM_1 = 1,
  TEAM_2 = 2,
}

export enum LobbyUserState {
  PENDING = "Pending",
  READY = "Ready",
  AFK = "Afk",
  ONGOING = "Ongoing",
  FINISHED = "Finished",
  REPOOLED = "Repooled",
}

export enum StageType {
  round_robin = "round_robin",
  single_elimination = "single_elimination",
  double_elimination = "double_elimination",
  /**
   * Championnat type Premier League (calendrier + classement par points),
   * distinct d'une coupe à élimination. Voir `@rosegriffon/achillea-core/league`
   * et `docs/asytral-league.md` (référence Asytral League).
   */
  league = "league",
}

export enum MatchFormat {
  BO1 = "bo1",
  BO3 = "bo3",
  BO5 = "bo5",
  DOUBLE_LEG = "double_leg",
  CUSTOM = "custom",
}
