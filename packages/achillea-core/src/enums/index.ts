/**
 * Enums métier portables d'Achilléa.
 *
 * Source unique runtime — consommable navigateur / edge / Node / Bun.
 * Les enums qui traversent le réseau vivent dans
 * `@rosegriffon/achillea-types` et ne sont PAS dupliqués ici : ils y sont
 * ré-exportés pour que `@rosegriffon/achillea-core` reste le seul import
 * nécessaire côté métier.
 *
 * Ré-export nominatif et non `export * from ".../enums"` : le bot compile en
 * `moduleResolution: Node`, qui ne lit pas les sous-chemins `exports`, et le
 * barrel de `@core` exporte déjà un `RankTier` distinct de celui du contrat —
 * un `export *` créerait une ambiguïté.
 */

export {
  CastAvailabilityStatus,
  CastEventKind,
  CastEventStatus,
  CastSlotRole,
  ClanMemberDistinction,
  ClanMemberRole,
  ClanState,
  EventTypeEnum,
  InterclanState,
  LicenseStatus,
  LobbyState,
  LobbyUserState,
  MatchFormat,
  MatchMode,
  NotificationCategory,
  NotificationType,
  OrganizationState,
  ParticipantStatus,
  PlayerNoteCategory,
  PlayerNoteSeverity,
  RankedState,
  SanctionIssuerType,
  SanctionType,
  ScoreReportPolicy,
  SocialMedia,
  StageType,
  TeamSide,
  TournamentEventType,
  TournamentState,
  UserRole,
  WalletTransactionDirection,
  WalletTransactionType,
} from "@rosegriffon/achillea-types";

export * from "./access";
export * from "./vote";
