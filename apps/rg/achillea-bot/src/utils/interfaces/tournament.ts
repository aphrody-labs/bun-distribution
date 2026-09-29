import type { StageType } from "brackets-model";

/**
 * TournamentModel
 */
export type ChallongeTournamentPayload = {
	data: {
		attributes?: Tournament;
		id?: string;
		type?: string;
		[property: string]: any;
	};
};

/**
 * Tournament
 */
export type Tournament = {
	description?: string;
	double_elimination_options?: DoubleEliminationOptions;
	free_for_all_options?: FreeForAllOptions;
	game_name?: string;

	/**
	 * When true, Challonge's two-stage format is used (group stage + final stage). Additional
	 * tournament state transitions must be performed (start_group_stage, finalize_group_stage).
	 */
	group_stage_enabled?: boolean;
	group_stage_options?: GroupStageOptions;
	match_options?: MatchOptions;
	name: string;
	notifications?: Notifications;

	/**
	 * When true, this tournament will be opted out for search engine bots and will be hidden
	 * from indexes on Challonge
	 */
	private?: boolean;
	registration_options?: RegistrationOptions;
	round_robin_options?: RoundRobinOptions;
	seeding_options?: SeedingOptions;

	/**
	 * The scheduled start time. Note that Challonge will not automatically start the tournament.
	 */
	starts_at?: string;
	station_options?: StationOptions;
	swiss_options?: SwissOptions;
	tournament_type: TournamentType;
	url?: string;
	[property: string]: any;
};

export type DoubleEliminationOptions = {
	/**
	 * When blank, the losers bracket winner has to beat the winners bracket winner twice.
	 */
	grand_finals_modifier?: GrandFinalsModifier;

	/**
	 * Double elimination only - starts the bottom half of seeds in the losers bracket
	 */
	split_participants?: boolean;
	[property: string]: any;
};

/**
 * When blank, the losers bracket winner has to beat the winners bracket winner twice.
 */
export enum GrandFinalsModifier {
	Empty = "",
	SingleMatch = "single match",
	Skip = "skip",
}

export type FreeForAllOptions = {
	max_participants?: number;
	[property: string]: any;
};

export type GroupStageOptions = {
	group_size?: number;
	participant_count_to_advance_per_group?: number;

	/**
	 * Round robin format only, determines the primary ranking stat.
	 */
	ranked_by?: Rank;

	/**
	 * Round robin format only, where 1 = single round robin, 2 = double round robin, 3 = triple
	 * round robin
	 */
	rr_iterations?: number;

	/**
	 * For 'custom' ranked by round robin group stage
	 */
	rr_pts_for_game_tie?: number;

	/**
	 * For 'custom' ranked by round robin group stage
	 */
	rr_pts_for_game_win?: number;

	/**
	 * For 'custom' ranked by round robin group stage
	 */
	rr_pts_for_match_tie?: number;

	/**
	 * For 'custom' ranked by round robin group stage
	 */
	rr_pts_for_match_win?: number;

	/**
	 * Double elimination only - starts the bottom half of seeds in the losers bracket
	 */
	split_participants?: boolean;
	stage_type?: StageType;
	[property: string]: any;
};

/**
 * Round robin format only, determines the primary ranking stat.
 */
export enum Rank {
	Custom = "custom",
	Empty = "",
	GameWinPercentage = "game win percentage",
	Gamewins = "game wins",
	Matchwins = "match wins",
	PointsDifference = "points difference",
	PointsScored = "points scored",
}

export type MatchOptions = {
	/**
	 * Whether or not to allow match attachment uploads
	 */
	accept_attachments?: boolean;

	/**
	 * For single or double elimination only, consolation matches will be run to break ties up
	 * to this final placement.
	 */
	consolation_matches_target_rank?: number;
	[property: string]: any;
};

export type Notifications = {
	upon_matches_open?: boolean;
	upon_tournament_ends?: boolean;
	[property: string]: any;
};

export type RegistrationOptions = {
	/**
	 * Number of minutes for check-in prior to tournament start time. Must be a multiple of 5.
	 */
	check_in_duration?: number;

	/**
	 * Allow registered Challonge users to self-register for this tournament
	 */
	open_signup?: boolean;

	/**
	 * Maximum number of participants allowed in the tournament before the waitlist kicks in
	 */
	signup_cap?: number;
	[property: string]: any;
};

export type RoundRobinOptions = {
	iterations?: number;
	pts_for_game_tie?: number;
	pts_for_game_win?: number;
	pts_for_match_tie?: number;
	pts_for_match_win?: number;
	ranking?: Rank;
	[property: string]: any;
};

export type SeedingOptions = {
	hide_seeds?: boolean;

	/**
	 * When true, seeding rules are ignored and participants are placed in the bracket from top
	 * to bottom.
	 */
	sequential_pairings?: boolean;
	[property: string]: any;
};

export type StationOptions = {
	/**
	 * Automatically assign stations to playable matches (requires one or more stations)
	 */
	auto_assign?: boolean;

	/**
	 * When true, playable matches won't start until they have a station assigned to them
	 */
	only_start_matches_with_assigned_stations?: boolean;
	[property: string]: any;
};

export type SwissOptions = {
	pts_for_game_tie?: number;
	pts_for_game_win?: number;
	pts_for_match_tie?: number;
	pts_for_match_win?: number;
	rounds?: number;
	[property: string]: any;
};

export enum TournamentType {
	DoubleElimination = "double elimination",
	FreeForAll = "free for all",
	RoundRobin = "round robin",
	SingleElimination = "single elimination",
	Swiss = "swiss",
}
