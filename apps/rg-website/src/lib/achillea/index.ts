/**
 * Surface Achilléa exposée à `apps/website`.
 *
 * Preuve de portabilité autant que commodité : la même logique métier qui
 * alimente le front Angular alimente ici un front Next.js + Tailwind + shadcn,
 * sans duplication ni couche d'adaptation.
 */

export { achilleaApiUrl, createAchilleaClient } from "./client";
export { safeReturnUrl } from "@rosegriffon/auth/redirect";
export { badgeVariant, toneClassName } from "./tone";
export type { BadgeVariant, Tone } from "./tone";
export { AchilleaAuthProvider, useAchilleaAuth } from "./auth-context";
export type {
  AchilleaAuthContextType,
  AchilleaAuthStatus,
} from "./auth-context";
export {
  clampParallax,
  canSpawnFx,
  createBurstParticles,
  stepParticles,
  capParticles,
  lerp,
  isHeroUiTarget,
  HERO_UI_HIT_SELECTOR,
  HERO_PARTICLE_COLORS_DARK,
  HERO_PARTICLE_COLORS_LIGHT,
} from "./hero-bg-fx";
export type { HeroParticle, Rgb } from "./hero-bg-fx";

// Règles métier réutilisables telles quelles côté React.
export {
  castReadiness,
  eloToRankKey,
  formatAchCurrency,
  isClanRecruiting,
  isTournamentOrganizer,
  licenseStatusLabel,
  licenseStatusTone,
  matchFormatLabel,
  participantStatusLabel,
  participantStatusTone,
  placementPrizeAp,
  rankImagePath,
  resolveDiscordAvatarUrl,
  sanctionTypeLabel,
  sanctionTypeTone,
  stageTypeLabel,
  tournamentStateLabel,
  tournamentStateTone,
  winRatePercent,
  canReportTournamentScore,
  isBracketStageType,
  singleEliminationRounds,
  doubleEliminationRounds,
  roundRobinRounds,
  stageRounds,
  stageMatchCount,
  nextPowerOfTwo,
  byeCount,
  ALL_STAGE_TYPES,
  BRACKET_STAGE_TYPES,
} from "@rosegriffon/achillea-core";

// Enums du contrat d'API Achilléa
export {
  EventTypeEnum,
  LobbyState,
  LobbyUserState,
  MatchFormat,
  ParticipantStatus,
  ScoreReportPolicy,
  StageType,
  TeamSide,
  TournamentEventType,
  TournamentState,
  ClanMemberRole,
  ClanMemberDistinction,
  ClanState,
  SanctionType,
  LicenseStatus,
  OrganizationState,
} from "@rosegriffon/achillea-types";

// Types de domaine
export type {
  CircuitLeaderboardEntry,
  CircuitRanking,
  CircuitClanEntry,
  CircuitTournamentSummary,
  ClanDTO,
  ClanMemberDTO,
  ClanApplicationDTO,
  ClanInviteDTO,
  LeaderboardEntry,
  RankedProfile,
  RankedTrend,
  RankedChallengeLink,
  RankedAdminDispute,
  Tournament,
  WireTournament,
  WireParticipant,
  TournamentDetail,
  TournamentSummary,
  TournamentTop10Entry,
  TournamentEventDTO,
  TournamentMatchStats,
  LobbyDTO,
  LobbyUserDTO,
  GameScoreDTO,
  GameValidatorDTO,
  UserDTO,
  AdminOpsOverview,
  AdminUserRow,
  Sanction,
  License,
  LeagueSeasonPayload,
  LeagueStandingRow,
  LeagueMatchRow,
  LeagueSummary,
  SeedOrdering,
  BracketMatchStatus,
} from "@rosegriffon/achillea-types";
