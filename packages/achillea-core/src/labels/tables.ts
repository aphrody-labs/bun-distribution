/**
 * Libellés d'affichage (fr-FR) — données pures, aucun framework.
 *
 * Ces tables vivent ici et non dans `@rosegriffon/achillea-types` : le contrat
 * doit rester traduisible mécaniquement (serde / Codable), un libellé ne l'est
 * pas. Tout front (Angular, Next.js, React Native, jeu Rust via FFI) consomme
 * les mêmes chaînes, ce qui supprime la dérive de vocabulaire entre cibles.
 *
 * Point d'extension i18n : chaque table est un `Record` exporté ; une locale
 * supplémentaire se branche en fournissant un `Record` de même forme.
 */

import {
  BracketMatchStatus,
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

/** Renvoie le libellé de `key`, ou la clé brute si elle n'est pas connue. */
function labelOf<K extends PropertyKey>(table: Record<K, string>, key: K): string {
  return table[key] ?? String(key);
}

// ── Tournois ────────────────────────────────────────────────────────────────

export const STAGE_TYPE_LABELS: Record<StageType, string> = {
  [StageType.round_robin]: "Tournoi à la ronde",
  [StageType.single_elimination]: "Élimination simple",
  [StageType.double_elimination]: "Double élimination",
  [StageType.league]: "Championnat (ligue)",
};

export function stageTypeLabel(type: StageType): string {
  return labelOf(STAGE_TYPE_LABELS, type);
}

export const TOURNAMENT_STATE_LABELS: Record<TournamentState, string> = {
  [TournamentState.PENDING]: "En attente de validation",
  [TournamentState.PREREGISTERING]: "Préinscriptions",
  [TournamentState.PREPARING]: "En préparation",
  [TournamentState.ONGOING]: "En cours",
  [TournamentState.FINISHED]: "Terminé",
  [TournamentState.CANCELED]: "Annulé",
};

export function tournamentStateLabel(state: TournamentState): string {
  return labelOf(TOURNAMENT_STATE_LABELS, state);
}

export const PARTICIPANT_STATUS_LABELS: Record<ParticipantStatus, string> = {
  [ParticipantStatus.ACTIVE]: "Inscrit",
  [ParticipantStatus.WAITLISTED]: "Liste d'attente",
  [ParticipantStatus.DISQUALIFIED]: "Disqualifié",
};

export function participantStatusLabel(status: ParticipantStatus): string {
  return labelOf(PARTICIPANT_STATUS_LABELS, status);
}

export const MATCH_FORMAT_LABELS: Record<MatchFormat, string> = {
  [MatchFormat.BO1]: "BO1",
  [MatchFormat.BO3]: "BO3",
  [MatchFormat.BO5]: "BO5",
  [MatchFormat.DOUBLE_LEG]: "Aller-retour",
  [MatchFormat.CUSTOM]: "Personnalisé",
};

export function matchFormatLabel(format: MatchFormat): string {
  return labelOf(MATCH_FORMAT_LABELS, format);
}

export const MATCH_MODE_LABELS: Record<MatchMode, string> = {
  [MatchMode.ONE_VS_ONE]: "1 c. 1",
  [MatchMode.TWO_VS_TWO]: "2 c. 2",
};

export function matchModeLabel(mode: MatchMode): string {
  return labelOf(MATCH_MODE_LABELS, mode);
}

export const SCORE_REPORT_POLICY_LABELS: Record<ScoreReportPolicy, string> = {
  [ScoreReportPolicy.PLAYERS]: "Les joueurs saisissent leur score",
  [ScoreReportPolicy.STAFF_ONLY]: "Staff uniquement",
};

export const SCORE_REPORT_POLICY_HINTS: Record<ScoreReportPolicy, string> = {
  [ScoreReportPolicy.PLAYERS]:
    "Chaque joueur remplit le score de son match, puis les deux camps le valident. Un organisateur peut toujours corriger et trancher.",
  [ScoreReportPolicy.STAFF_ONLY]:
    "Les joueurs consultent leur match sans pouvoir y toucher : seuls les organisateurs saisissent et valident les scores.",
};

/** Options prêtes à alimenter un `<select>` — quel que soit le framework. */
export interface SelectOption<T> {
  value: T;
  label: string;
  hint?: string;
}

/** Chaque politique porte toujours son explication : `hint` n'est pas optionnel ici. */
export const SCORE_REPORT_POLICY_OPTIONS: ReadonlyArray<Required<SelectOption<ScoreReportPolicy>>> = [
  {
    value: ScoreReportPolicy.PLAYERS,
    label: SCORE_REPORT_POLICY_LABELS[ScoreReportPolicy.PLAYERS],
    hint: SCORE_REPORT_POLICY_HINTS[ScoreReportPolicy.PLAYERS],
  },
  {
    value: ScoreReportPolicy.STAFF_ONLY,
    label: SCORE_REPORT_POLICY_LABELS[ScoreReportPolicy.STAFF_ONLY],
    hint: SCORE_REPORT_POLICY_HINTS[ScoreReportPolicy.STAFF_ONLY],
  },
];

export const STAGE_TYPE_OPTIONS: ReadonlyArray<SelectOption<StageType>> = (
  Object.keys(STAGE_TYPE_LABELS) as StageType[]
).map(value => ({ value, label: STAGE_TYPE_LABELS[value] }));

// ── Clans ───────────────────────────────────────────────────────────────────

export const CLAN_MEMBER_ROLE_LABELS: Record<ClanMemberRole, string> = {
  [ClanMemberRole.Trial]: "Membre à l'essai",
  [ClanMemberRole.Member]: "Membre",
  [ClanMemberRole.SubCaptain]: "Vice-Président",
  [ClanMemberRole.Captain]: "Président",
};

export function clanMemberRoleLabel(role: ClanMemberRole): string {
  return labelOf(CLAN_MEMBER_ROLE_LABELS, role);
}

export const CLAN_MEMBER_DISTINCTION_LABELS: Record<ClanMemberDistinction, string> = {
  [ClanMemberDistinction.Player]: "Joueur",
  [ClanMemberDistinction.Staff]: "Staff",
  [ClanMemberDistinction.Artist]: "Artiste",
  [ClanMemberDistinction.ContentCreator]: "Créateur de contenu",
};

export function clanMemberDistinctionLabel(distinction: ClanMemberDistinction): string {
  return labelOf(CLAN_MEMBER_DISTINCTION_LABELS, distinction);
}

export const CLAN_STATE_LABELS: Record<ClanState, string> = {
  [ClanState.Creating]: "En création",
  [ClanState.PendingReview]: "En attente de validation",
  [ClanState.Approved]: "Validé",
};

export function clanStateLabel(state: ClanState): string {
  return labelOf(CLAN_STATE_LABELS, state);
}

// ── Modération ──────────────────────────────────────────────────────────────

export const SANCTION_TYPE_LABELS: Record<SanctionType, string> = {
  [SanctionType.Warn]: "Avertissement",
  [SanctionType.Mute]: "Mute",
  [SanctionType.Kick]: "Expulsion",
  [SanctionType.Ban]: "Bannissement",
  [SanctionType.Unmute]: "Unmute",
  [SanctionType.Unban]: "Unban",
  [SanctionType.Note]: "Note",
};

export function sanctionTypeLabel(type: SanctionType): string {
  return labelOf(SANCTION_TYPE_LABELS, type);
}

export const PLAYER_NOTE_CATEGORY_LABELS: Record<PlayerNoteCategory, string> = {
  [PlayerNoteCategory.BEHAVIOR]: "Comportement",
  [PlayerNoteCategory.CHEATING]: "Triche suspectée",
  [PlayerNoteCategory.NO_SHOW]: "Absence / no-show",
  [PlayerNoteCategory.SCORE_DISPUTE]: "Litige de score",
  [PlayerNoteCategory.POSITIVE]: "Positif",
  [PlayerNoteCategory.OTHER]: "Autre",
};

export function playerNoteCategoryLabel(category: PlayerNoteCategory): string {
  return labelOf(PLAYER_NOTE_CATEGORY_LABELS, category);
}

export const PLAYER_NOTE_SEVERITY_LABELS: Record<PlayerNoteSeverity, string> = {
  [PlayerNoteSeverity.INFO]: "Info",
  [PlayerNoteSeverity.WARNING]: "Attention",
  [PlayerNoteSeverity.SERIOUS]: "Grave",
};

export function playerNoteSeverityLabel(severity: PlayerNoteSeverity): string {
  return labelOf(PLAYER_NOTE_SEVERITY_LABELS, severity);
}

export const USER_ROLE_LABELS: Record<UserRole, string> = {
  [UserRole.User]: "Membre",
  [UserRole.Moderator]: "Modérateur",
  [UserRole.Administrator]: "Administrateur",
  [UserRole.SuperAdministrator]: "Super-administrateur",
};

export function userRoleLabel(role: UserRole): string {
  return labelOf(USER_ROLE_LABELS, role);
}

// ── Licences & portefeuille ─────────────────────────────────────────────────

export const LICENSE_STATUS_LABELS: Record<LicenseStatus, string> = {
  [LicenseStatus.Active]: "Active",
  [LicenseStatus.Revoked]: "Révoquée",
  [LicenseStatus.Expired]: "Expirée",
};

export function licenseStatusLabel(status: LicenseStatus): string {
  return labelOf(LICENSE_STATUS_LABELS, status);
}

export const WALLET_TRANSACTION_TYPE_LABELS: Record<WalletTransactionType, string> = {
  [WalletTransactionType.Credit]: "Crédit",
  [WalletTransactionType.Debit]: "Débit",
  [WalletTransactionType.Transfer]: "Transfert",
  [WalletTransactionType.Payout]: "Versement",
  [WalletTransactionType.Fine]: "Amende",
};

export function walletTransactionTypeLabel(type: WalletTransactionType): string {
  return labelOf(WALLET_TRANSACTION_TYPE_LABELS, type);
}

// ── Casts ───────────────────────────────────────────────────────────────────

export const CAST_EVENT_KIND_LABELS: Record<CastEventKind, string> = {
  [CastEventKind.Match]: "Match",
  [CastEventKind.Tournament]: "Tournoi",
  [CastEventKind.Stream]: "Stream",
  [CastEventKind.Other]: "Autre",
};

export function castEventKindLabel(kind: CastEventKind): string {
  return labelOf(CAST_EVENT_KIND_LABELS, kind);
}

export const CAST_EVENT_STATUS_LABELS: Record<CastEventStatus, string> = {
  [CastEventStatus.Planned]: "Planifié",
  [CastEventStatus.OpenSignup]: "Sondage ouvert",
  [CastEventStatus.Attributed]: "Attribué",
  [CastEventStatus.Live]: "En direct",
  [CastEventStatus.Done]: "Terminé",
  [CastEventStatus.Cancelled]: "Annulé",
};

export function castEventStatusLabel(status: CastEventStatus): string {
  return labelOf(CAST_EVENT_STATUS_LABELS, status);
}

export const CAST_SLOT_ROLE_LABELS: Record<CastSlotRole, string> = {
  [CastSlotRole.CasterMain]: "Caster principal",
  [CastSlotRole.CasterSecondary]: "Caster secondaire",
  [CastSlotRole.Observer]: "Observateur",
  [CastSlotRole.Producer]: "Producteur",
  [CastSlotRole.Host]: "Présentateur",
  [CastSlotRole.Technical]: "Technique",
};

export function castSlotRoleLabel(role: CastSlotRole): string {
  return labelOf(CAST_SLOT_ROLE_LABELS, role);
}

export const CAST_AVAILABILITY_STATUS_LABELS: Record<CastAvailabilityStatus, string> = {
  [CastAvailabilityStatus.Available]: "Disponible",
  [CastAvailabilityStatus.Maybe]: "Peut-être",
  [CastAvailabilityStatus.Unavailable]: "Indisponible",
};

export function castAvailabilityStatusLabel(status: CastAvailabilityStatus): string {
  return labelOf(CAST_AVAILABILITY_STATUS_LABELS, status);
}

// ── Organisations & notifications ───────────────────────────────────────────

export const ORGANIZATION_STATE_LABELS: Record<OrganizationState, string> = {
  [OrganizationState.Pending]: "En attente",
  [OrganizationState.Approved]: "Validée",
  [OrganizationState.Rejected]: "Refusée",
};

export function organizationStateLabel(state: OrganizationState): string {
  return labelOf(ORGANIZATION_STATE_LABELS, state);
}

export const NOTIFICATION_CATEGORY_LABELS: Record<NotificationCategory, string> = {
  [NotificationCategory.USER]: "Perso.",
  [NotificationCategory.CLAN]: "Clan",
  [NotificationCategory.GLOBAL]: "Globale",
  [NotificationCategory.ORGANIZATION]: "Organisation",
};

export function notificationCategoryLabel(category: NotificationCategory): string {
  return labelOf(NOTIFICATION_CATEGORY_LABELS, category);
}

// ── Évènements et matchs ────────────────────────────────────────────────────

export const EVENT_TYPE_LABELS: Record<EventTypeEnum, string> = {
  [EventTypeEnum.TOURNAMENT]: "Tournoi",
  [EventTypeEnum.INTERCLAN]: "Interclan",
  [EventTypeEnum.RANKED]: "Classé",
};

export function eventTypeLabel(type: EventTypeEnum): string {
  return labelOf(EVENT_TYPE_LABELS, type);
}

export const TEAM_SIDE_LABELS: Record<TeamSide, string> = {
  [TeamSide.TEAM_1]: "Domicile",
  [TeamSide.TEAM_2]: "Extérieur",
};

export function teamSideLabel(side: TeamSide): string {
  return labelOf(TEAM_SIDE_LABELS, side);
}

export const LOBBY_STATE_LABELS: Record<LobbyState, string> = {
  [LobbyState.FRESH]: "Ouvert",
  [LobbyState.ONGOING]: "En cours",
  [LobbyState.PENDING_VALIDATION]: "En attente de validation",
  [LobbyState.CONTESTED]: "Contesté",
  [LobbyState.FINISHED]: "Terminé",
  [LobbyState.CANCELED]: "Annulé",
  [LobbyState.FORFEITED]: "Forfait",
};

export function lobbyStateLabel(state: LobbyState): string {
  return labelOf(LOBBY_STATE_LABELS, state);
}

export const LOBBY_USER_STATE_LABELS: Record<LobbyUserState, string> = {
  [LobbyUserState.PENDING]: "En attente",
  [LobbyUserState.READY]: "Prêt",
  [LobbyUserState.AFK]: "Absent",
  [LobbyUserState.ONGOING]: "En match",
  [LobbyUserState.FINISHED]: "Terminé",
  [LobbyUserState.REPOOLED]: "Remis en file",
};

export function lobbyUserStateLabel(state: LobbyUserState): string {
  return labelOf(LOBBY_USER_STATE_LABELS, state);
}

export const RANKED_STATE_LABELS: Record<RankedState, string> = {
  [RankedState.OPEN]: "File ouverte",
  [RankedState.LOCKED]: "File fermée",
  [RankedState.VALIDATING_PRESENCE]: "Vérification des présences",
  [RankedState.PAIRING]: "Appariement",
  [RankedState.VALIDATING_MATCH_START]: "Validation du lancement",
  [RankedState.REPOOLING]: "Remise en file",
  [RankedState.MATCHING]: "Matchs en cours",
  [RankedState.FINISHED]: "Terminé",
  [RankedState.CANCELED]: "Annulé",
};

export function rankedStateLabel(state: RankedState): string {
  return labelOf(RANKED_STATE_LABELS, state);
}

export const INTERCLAN_STATE_LABELS: Record<InterclanState, string> = {
  [InterclanState.PENDING_APPROVAL]: "En attente de validation",
  [InterclanState.APPROVED]: "Validé",
  [InterclanState.DENIED]: "Refusé",
  [InterclanState.READY]: "Prêt",
  [InterclanState.ONGOING]: "En cours",
  [InterclanState.FINISHED]: "Terminé",
  [InterclanState.CANCELED]: "Annulé",
  [InterclanState.RESULT_OK]: "Résultat validé",
  [InterclanState.RESULT_NOK]: "Résultat contesté",
};

export function interclanStateLabel(state: InterclanState): string {
  return labelOf(INTERCLAN_STATE_LABELS, state);
}

export const BRACKET_MATCH_STATUS_LABELS: Record<BracketMatchStatus, string> = {
  [BracketMatchStatus.Locked]: "Verrouillé",
  [BracketMatchStatus.Waiting]: "En attente d'adversaire",
  [BracketMatchStatus.Ready]: "Prêt à jouer",
  [BracketMatchStatus.Running]: "En cours",
  [BracketMatchStatus.Completed]: "Terminé",
  [BracketMatchStatus.Archived]: "Archivé",
};

export function bracketMatchStatusLabel(status: BracketMatchStatus): string {
  return labelOf(BRACKET_MATCH_STATUS_LABELS, status);
}

/** Journal métier d'un tournoi — libellés affichés dans la timeline. */
export const TOURNAMENT_EVENT_LABELS: Record<TournamentEventType, string> = {
  [TournamentEventType.CREATED]: "Tournoi créé",
  [TournamentEventType.UPDATED]: "Tournoi modifié",
  [TournamentEventType.REGISTRATIONS_OPENED]: "Inscriptions ouvertes",
  [TournamentEventType.REGISTRATIONS_CLOSED]: "Inscriptions fermées",
  [TournamentEventType.PARTICIPANT_REGISTERED]: "Inscription",
  [TournamentEventType.PARTICIPANT_WAITLISTED]: "Placé en liste d'attente",
  [TournamentEventType.PARTICIPANT_PROMOTED]: "Promu depuis la liste d'attente",
  [TournamentEventType.PARTICIPANT_UNREGISTERED]: "Désinscription",
  [TournamentEventType.PARTICIPANT_REMOVED]: "Retiré par un organisateur",
  [TournamentEventType.PARTICIPANT_DISQUALIFIED]: "Disqualification",
  [TournamentEventType.PARTICIPANT_REINSTATED]: "Réintégration",
  [TournamentEventType.SEEDING_CHANGED]: "Seeding modifié",
  [TournamentEventType.BRACKET_GENERATED]: "Arbre généré",
  [TournamentEventType.TOURNAMENT_STARTED]: "Tournoi démarré",
  [TournamentEventType.SCORE_REPORTED]: "Score saisi",
  [TournamentEventType.SCORE_VALIDATED]: "Score validé",
  [TournamentEventType.PHASE_ADVANCED]: "Phase suivante",
  [TournamentEventType.ORGANIZER_ADDED]: "Organisateur ajouté",
  [TournamentEventType.ORGANIZER_REMOVED]: "Organisateur retiré",
  [TournamentEventType.TOURNAMENT_CLOSED]: "Tournoi clôturé",
  [TournamentEventType.TOURNAMENT_CANCELED]: "Tournoi annulé",
  [TournamentEventType.TOURNAMENT_RESTORED]: "Tournoi restauré",
};

export function tournamentEventLabel(type: TournamentEventType): string {
  return labelOf(TOURNAMENT_EVENT_LABELS, type);
}

// ── Modération, portefeuille, réseaux ───────────────────────────────────────

export const SANCTION_ISSUER_LABELS: Record<SanctionIssuerType, string> = {
  [SanctionIssuerType.User]: "Utilisateur",
  [SanctionIssuerType.Bot]: "Bot",
  [SanctionIssuerType.Staff]: "Staff",
  [SanctionIssuerType.System]: "Système",
};

export function sanctionIssuerLabel(issuer: SanctionIssuerType): string {
  return labelOf(SANCTION_ISSUER_LABELS, issuer);
}

export const WALLET_DIRECTION_LABELS: Record<WalletTransactionDirection, string> = {
  [WalletTransactionDirection.In]: "Entrée",
  [WalletTransactionDirection.Out]: "Sortie",
};

export function walletDirectionLabel(direction: WalletTransactionDirection): string {
  return labelOf(WALLET_DIRECTION_LABELS, direction);
}

export const SOCIAL_MEDIA_LABELS: Record<SocialMedia, string> = {
  [SocialMedia.X]: "X",
  [SocialMedia.Instagram]: "Instagram",
  [SocialMedia.TikTok]: "TikTok",
  [SocialMedia.Youtube]: "YouTube",
  [SocialMedia.Twitch]: "Twitch",
};

export function socialMediaLabel(platform: SocialMedia): string {
  return labelOf(SOCIAL_MEDIA_LABELS, platform);
}

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  [NotificationType.NEW_ORGANIZATION_CREATION_REQUEST]: "Demande de création d'organisation",
  [NotificationType.NEW_ORGANIZATION_EDITION_REQUEST]: "Demande de modification d'organisation",
  [NotificationType.NEW_ORGANIZATION_EDIT_REPLY]: "Réponse à une modification d'organisation",
  [NotificationType.NEW_ORGANIZATION_ACCEPT_REPLY]: "Organisation validée",
  [NotificationType.NEW_ORGANIZATION_REJECT_REPLY]: "Organisation refusée",
  [NotificationType.CLAN_MEMBER_KICK]: "Exclusion d'un membre de clan",
};

export function notificationTypeLabel(type: NotificationType): string {
  return labelOf(NOTIFICATION_TYPE_LABELS, type);
}
