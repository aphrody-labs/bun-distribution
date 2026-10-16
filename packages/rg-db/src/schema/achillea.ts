import type { ColumnType, Generated } from "kysely";

export interface AchilleaTables {
	// Clans
	clan: ClanTable;
	clan_member: ClanMemberTable;
	clan_member_history: ClanMemberHistoryTable;
	clan_invite: ClanInviteTable;
	clan_application: ClanApplicationTable;
	clan_experience: ClanExperienceTable;
	clan_experience_log: ClanExperienceLogTable;

	// Événements & Tournois
	event: EventTable;
	tournament_participant: TournamentParticipantTable;
	event_managers: EventManagerTable;
	event_announcement: EventAnnouncementTable;
	tournament_event: TournamentEventTable;
	lobby: LobbyTable;
	lobby_user: LobbyUserTable;
	lobby_match: LobbyMatchTable;
	tournament_phase: TournamentPhaseTable;
	ruleset: RulesetTable;
	license: LicenseTable;
	interclan_lineup: InterclanLineupTable;

	// Économie & Portefeuille
	wallet: WalletTable;
	transaction: TransactionTable;

	// Compétitif & ELO
	user_elo: UserEloTable;
	season: SeasonTable;
	rank: RankTable;
	stat: StatTable;

	// Auth & CSRF
	user: UserTable;
	user_connection: UserConnectionTable;
	oauth_csrf: OAuthCsrfTable;
	notification: NotificationTable;
	user_notification: UserNotificationTable;
	blacklist: BlacklistTable;
	sanction: SanctionTable;
	player_note: PlayerNoteTable;
	organization: OrganizationTable;
	organization_manager: OrganizationManagerTable;
	guild: GuildTable;
}

export interface ClanTable {
	id: Generated<number>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	founders: string[];
	name: string;
	role_id: string;
	shortened_name: string;
	clan_avatar_url: string;
	clan_biography: string;
	x_url: string | null;
	instagram_url: string | null;
	tiktok_url: string | null;
	clan_fame: Generated<number>;
	guild_id: string | null;
	is_recruiting: Generated<boolean>;
	is_inactive: Generated<boolean>;
	is_hidden: Generated<boolean>;
	is_disbanded: Generated<boolean>;
	auto_accept_members: Generated<boolean>;
	state: number;
	channel_id: string;
	normalized_name: Generated<string>;
	normalized_short_name: Generated<string>;
	clan_emoji_id: Generated<string>;
	languages: Generated<string[]>;
	origin: Generated<string>;
	under_member_limit: Generated<boolean>;
}

export interface ClanExperienceTable {
	clan_id: number;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	current_level: Generated<number>;
	total_xp: Generated<number>;
}

export interface ClanMemberTable {
	clan_id: number;
	user_id: string;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	clan_fame_contributed: Generated<number>;
	role: Generated<number>;
	distinctions: Generated<string[]>;
}

export interface ClanMemberHistoryTable {
	id: Generated<number>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	user_id: string;
	clan_id: number;
	join_date: Date;
	leave_reason: number;
	kick_reason: string | null;
	clan_fame_contributed: Generated<number>;
	role: number;
}

export interface ClanInviteTable {
	id: Generated<number>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	user_id: string;
	clan_id: number;
	inviter_id: string;
	thread_id: string | null;
	distinctions: Generated<string[]>;
	last_notified_at: Generated<Date>;
}

export interface ClanApplicationTable {
	id: Generated<number>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	user_id: string;
	clan_id: number;
	distinctions: Generated<string[]>;
	message_id: string | null;
}

export interface ClanExperienceLogTable {
	id: Generated<number>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	clan_id: number;
	reason: Generated<string>;
	xp_change: Generated<number>;
}

export interface EventTable {
	id: Generated<number>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	name: string;
	description: string;
	type: "TOURNAMENT" | "INTERCLAN" | "RANKED";
	status: string | null;
	queue_ends_at: Date | null;
	mode: number | null;
	clan_a_id: number | null;
	clan_b_id: number | null;
	winner_clan_id: string | null;
	state: Generated<number>;
	fixed_date: Date | null;
	discord_channel_id: string | null;
	organization_id: number | null;
	internal_state:
		| "Pending"
		| "Preregistering"
		| "Preparing"
		| "Ongoing"
		| "Finished"
		| "Canceled"
		| null;
	participants_number: number | null;
	tournament_type: string | null;
	starts_at: Date | null;
	grand_final_at: Date | null;
	group_stage_enabled: boolean;
	group_stage_type: string | null;
	logo: string | null;
	affiche: string | null;
	planning: string | null;
	ruleset: string | null;
	seed_ordering: string | null;
	match_format: string | null;
	custom_format_child_count: number | null;
	score_report_policy: string | null;
	registration_opens_at: Date | null;
	registration_closes_at: Date | null;
	auto_start: boolean;
	discord_role_enabled: boolean;
	discord_role_id: string | null;
	discord_guild_id: string | null;
	cancel_reason: string | null;
	canceled_at: Date | null;
	closed_at: Date | null;
}

export interface TournamentParticipantTable {
	id: Generated<number>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	tournament_id: number;
	user_id: string;
	bracket_participant_id: number | null;
	seed: number | null;
	has_checked_in: boolean;
	status: "Active" | "Waitlisted" | "Disqualified";
	registered_at: Date;
	status_changed_at: Date | null;
	status_reason: string | null;
	status_actor_id: string | null;
}

export interface EventManagerTable {
	event_id: number;
	user_id: string;
}

export interface EventAnnouncementTable {
	id: Generated<number>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	event_id: number;
	guild_id: string;
	channel_id: string;
	message_id: string;
}

export interface TournamentEventTable {
	id: Generated<string>;
	tournament_id: number;
	type: string;
	actor_id: string | null;
	target_id: string | null;
	payload: Record<string, unknown> | null;
	reason: string | null;
	created_at: Generated<Date>;
}

/** Persistent tournament/ranked lobby state shared by API, website and bot adapters. */
export interface LobbyTable {
	id: Generated<number>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	event_type: string;
	event_id: number;
	mode: number;
	state: string;
	bracket_match_id: number | null;
	channel_id: string | null;
	host_user_id: number | null;
	is_repool: boolean;
	phase_id: string | null;
	swiss_round: number | null;
	match_format: string;
	custom_format_child_count: number | null;
	ranked_elo_applied: boolean;
}

export interface LobbyUserTable {
	id: Generated<number>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	user_id: string;
	lobby_id: number;
	team: number;
	score: number;
	forfeit: boolean;
	elo_variation: number;
	validated_result: boolean;
	claimed_opponent_score: number | null;
	screenshot_url: string | null;
	state: string;
}

export interface LobbyMatchTable {
	id: Generated<number>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	lobby_id: number;
	game_number: number;
	score_team1: number;
	score_team2: number;
	team1validated: boolean;
	team2validated: boolean;
	admin_validated: boolean;
}

export interface TournamentPhaseTable {
	id: Generated<string>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	tournament_id: number;
	index: number;
	kind: string;
	config: Record<string, unknown> | null;
	status: string;
	started_at: Date | null;
	ended_at: Date | null;
	qualifiers_count: number;
}

export interface RulesetTable {
	id: Generated<string>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	version: string;
	name: string;
	category: string;
	is_official: boolean;
	forbidden_tactics_dropable: string[] | null;
	forbidden_tactics_movement: string[] | null;
	forbidden_tactics_immobilization: string[] | null;
	forbidden_tactics_rng: string[] | null;
	stadiums_allowed: string[] | null;
	default_bo: number;
	golden_goal: boolean;
	half_time_minutes: number | null;
	judgment_of_advantage_protocol: Record<string, unknown> | null;
	tiebreaker_rules: Record<string, unknown> | null;
	parent_ruleset_id: string | null;
}

export interface LicenseTable {
	id: Generated<string>;
	user_id: string;
	license_number: string;
	issued_at: Generated<Date>;
	valid_until: Date;
	status: string;
	pdf_url: string | null;
	qr_secret: string;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
}

export interface InterclanLineupTable {
	id: Generated<number>;
	event_id: number;
	clan_id: number;
	locked_in: Generated<boolean>;
}

export interface WalletTable {
	id: Generated<string>;
	user_id: string;
	balance: ColumnType<string, string | number, string | number>;
	currency: Generated<string>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
}

export interface TransactionTable {
	id: Generated<string>;
	type: number | string;
	amount: ColumnType<string, string | number, string | number>;
	reason: string | null;
	from_user_id: string | null;
	to_user_id: string | null;
	metadata: Record<string, unknown> | null;
	created_at: Generated<Date>;
}

export interface UserEloTable {
	user_id: string;
	season_id: string | null;
	mode: number;
	elo: Generated<number>;
	peak_rating: Generated<number>;
	games_played: Generated<number>;
	wins: Generated<number>;
	losses: Generated<number>;
	updated_at: Generated<Date>;
}

export interface SeasonTable {
	id: Generated<string>;
	name: string;
	starts_at: Date;
	ends_at: Date;
	state: string;
	config: Record<string, unknown> | null;
}

export interface RankTable {
	id: Generated<number>;
	key: string;
	min_elo: number;
	max_elo: number;
	emoji_id: string;
	emoji_key: Generated<string>;
	gradient: Generated<string[]>;
}

export interface StatTable {
	id: Generated<number>;
	type: string;
	value: Generated<string>;
	additional_data: Record<string, unknown> | null;
	created_at: Generated<Date>;
}

export interface OAuthCsrfTable {
	token: string;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	discord_id: string;
}

export interface NotificationTable {
	id: Generated<number>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	title: string;
	message: string;
	type: number;
	category: number;
	payload: Record<string, unknown> | null;
}

export interface UserNotificationTable {
	id: Generated<number>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	notification_id: number;
	user_id: string;
	is_read: Generated<boolean>;
	read_at: Date | null;
}

export interface UserTable {
	id: string;
	created_at: Date;
	updated_at: Date;
	last_interact: Date;
	role: number;
	username: string | null;
	avatar: string | null;
	display_name: string;
	normalized_display_name: string;
	blacklist_id: number | null;
	bio: string | null;
	twitch_url: string | null;
}

export interface UserConnectionTable {
	id: Generated<number>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	user_id: string;
	provider: string;
	external_id: string | null;
	external_username: string | null;
	access_token: string | null;
	refresh_token: string | null;
}

export interface PlayerNoteTable {
	id: Generated<string>;
	target_id: string;
	author_id: string | null;
	tournament_id: number | null;
	category: string;
	severity: string;
	content: string;
	resolved: Generated<boolean>;
	resolved_at: Date | null;
	resolved_by_id: string | null;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
}

export interface OrganizationTable {
	id: Generated<number>;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	name: string;
	normalized_name: string;
	logo: string;
	description: string;
	owner_id: string;
	state: number;
	preapproved: Generated<boolean>;
	preapproved_at: Date | null;
	preapproved_by: string | null;
	twitter_url: string | null;
	instagram_url: string | null;
	tiktok_url: string | null;
	twitch_url: string | null;
	youtube_url: string | null;
	origin: string;
}

export interface OrganizationManagerTable {
	organization_id: number;
	user_id: string;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
}

export interface BlacklistTable {
	id: string;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
}

export interface SanctionTable {
	id: Generated<string>;
	user_id: string;
	guild_id: string;
	type: string;
	reason: string | null;
	duration_sec: number | null;
	issued_by: string;
	issued_by_type: string;
	expires_at: Date | null;
	revoked_at: Date | null;
	revoked_by: string | null;
	revoke_reason: string | null;
	evidence: Record<string, unknown>[] | null;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
}

export interface GuildTable {
	id: string;
	created_at: Generated<Date>;
	updated_at: Generated<Date>;
	prefix: string | null;
	deleted: Generated<boolean>;
	last_interact: Date;
	broadcast_channel: string | null;
	ranked_enabled: Generated<boolean>;
}
