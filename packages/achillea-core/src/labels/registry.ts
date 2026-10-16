/**
 * Registre des enums du contrat et de leurs libellés.
 *
 * Sans ce registre, « ajouter un membre d'enum et oublier son libellé » est
 * invisible : `Record<Enum, string>` protège les tables existantes, mais rien
 * ne signale qu'un enum entier n'a jamais eu de table. Le test
 * `tests/labels-exhaustivity.test.ts` s'appuie sur ce registre pour exiger que
 * chaque enum du contrat soit **soit** libellé, **soit** explicitement déclaré
 * comme n'ayant pas à l'être, avec sa raison.
 */

import {
	BRACKET_MATCH_STATUS_LABELS,
	CAST_AVAILABILITY_STATUS_LABELS,
	CAST_EVENT_KIND_LABELS,
	CAST_EVENT_STATUS_LABELS,
	CAST_SLOT_ROLE_LABELS,
	CLAN_MEMBER_DISTINCTION_LABELS,
	CLAN_MEMBER_ROLE_LABELS,
	CLAN_STATE_LABELS,
	EVENT_TYPE_LABELS,
	INTERCLAN_STATE_LABELS,
	LICENSE_STATUS_LABELS,
	LOBBY_STATE_LABELS,
	LOBBY_USER_STATE_LABELS,
	MATCH_FORMAT_LABELS,
	MATCH_MODE_LABELS,
	NOTIFICATION_CATEGORY_LABELS,
	NOTIFICATION_TYPE_LABELS,
	ORGANIZATION_STATE_LABELS,
	PARTICIPANT_STATUS_LABELS,
	PLAYER_NOTE_CATEGORY_LABELS,
	PLAYER_NOTE_SEVERITY_LABELS,
	RANKED_STATE_LABELS,
	SANCTION_ISSUER_LABELS,
	SANCTION_TYPE_LABELS,
	SCORE_REPORT_POLICY_LABELS,
	SOCIAL_MEDIA_LABELS,
	STAGE_TYPE_LABELS,
	TEAM_SIDE_LABELS,
	TOURNAMENT_EVENT_LABELS,
	TOURNAMENT_STATE_LABELS,
	USER_ROLE_LABELS,
	WALLET_DIRECTION_LABELS,
	WALLET_TRANSACTION_TYPE_LABELS,
} from "./tables";

/** Forme minimale d'un enum TypeScript, vue depuis le runtime. */
export type EnumLike = Record<string, string | number>;

/** Table de libellés, indexée par valeur de membre d'enum. */
export type LabelTable = Record<string | number, string>;

/**
 * Valeurs d'un enum, reverse mapping numérique exclu.
 *
 * `Object.values` d'un enum numérique rend aussi les noms de membres
 * (`{ 0: "A", A: 0 }`) : les compter ferait passer un test de couverture qui
 * devrait échouer.
 */
export function enumValues(enumeration: EnumLike): Array<string | number> {
	const values = Object.values(enumeration);
	const numeric = values.filter((value): value is number => typeof value === "number");
	return numeric.length > 0 ? numeric : values;
}

/**
 * Enums portant un libellé destiné à un humain, indexés par le nom sous lequel
 * `@rosegriffon/achillea-types` les exporte — c'est ce nom que le test croise
 * avec les exports réels du contrat.
 */
export const LABELLED_ENUMS: Readonly<Record<string, LabelTable>> = {
	BracketMatchStatus: BRACKET_MATCH_STATUS_LABELS,
	CastAvailabilityStatus: CAST_AVAILABILITY_STATUS_LABELS,
	CastEventKind: CAST_EVENT_KIND_LABELS,
	CastEventStatus: CAST_EVENT_STATUS_LABELS,
	CastSlotRole: CAST_SLOT_ROLE_LABELS,
	ClanMemberDistinction: CLAN_MEMBER_DISTINCTION_LABELS,
	ClanMemberRole: CLAN_MEMBER_ROLE_LABELS,
	ClanState: CLAN_STATE_LABELS,
	EventTypeEnum: EVENT_TYPE_LABELS,
	InterclanState: INTERCLAN_STATE_LABELS,
	LicenseStatus: LICENSE_STATUS_LABELS,
	LobbyState: LOBBY_STATE_LABELS,
	LobbyUserState: LOBBY_USER_STATE_LABELS,
	MatchFormat: MATCH_FORMAT_LABELS,
	MatchMode: MATCH_MODE_LABELS,
	NotificationCategory: NOTIFICATION_CATEGORY_LABELS,
	NotificationType: NOTIFICATION_TYPE_LABELS,
	OrganizationState: ORGANIZATION_STATE_LABELS,
	ParticipantStatus: PARTICIPANT_STATUS_LABELS,
	PlayerNoteCategory: PLAYER_NOTE_CATEGORY_LABELS,
	PlayerNoteSeverity: PLAYER_NOTE_SEVERITY_LABELS,
	RankedState: RANKED_STATE_LABELS,
	SanctionIssuerType: SANCTION_ISSUER_LABELS,
	SanctionType: SANCTION_TYPE_LABELS,
	ScoreReportPolicy: SCORE_REPORT_POLICY_LABELS,
	SocialMedia: SOCIAL_MEDIA_LABELS,
	StageType: STAGE_TYPE_LABELS,
	TeamSide: TEAM_SIDE_LABELS,
	TournamentEventType: TOURNAMENT_EVENT_LABELS,
	TournamentState: TOURNAMENT_STATE_LABELS,
	UserRole: USER_ROLE_LABELS,
	WalletTransactionDirection: WALLET_DIRECTION_LABELS,
	WalletTransactionType: WALLET_TRANSACTION_TYPE_LABELS,
};

/**
 * Enums sans libellé, et pourquoi. Y ajouter une entrée est un choix explicite,
 * pas un oubli : le test exige une justification non vide.
 */
export const UNLABELLED_ENUMS: Readonly<Record<string, string>> = {
	FormMode:
		"Mode interne d'un formulaire (création / revue / édition). Jamais rendu tel quel : chaque écran formule son propre intitulé.",
};
