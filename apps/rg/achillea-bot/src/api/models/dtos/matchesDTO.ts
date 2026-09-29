/**
 * MatchModel
 */
export type MatchModel = {
	attributes?: MatchOutput;
	id?: string;
	type?: string;
	[property: string]: any;
};

/**
 * MatchOutput
 */
export type MatchOutput = {
	identifier?: string;
	points_by_participant?: { [key: string]: any };
	relationships?: Relationships;
	round?: number;
	score_in_sets?: { [key: string]: any };
	scores?: string;
	state?: ChallongeMatchState;
	suggested_play_order?: number;
	timestamps?: Timestamps;

	/**
	 * The participant ID of the winner
	 */
	winner_id?: number;
	[property: string]: any;
};

export type Relationships = {
	player1?: Player1;
	player2?: Player2;
	[property: string]: any;
};

export type Player1 = {
	data?: Player1Data;
	[property: string]: any;
};

export type Player1Data = {
	id?: string;
	type?: string;
	[property: string]: any;
};

export type Player2 = {
	data?: Player2Data;
	[property: string]: any;
};

export type Player2Data = {
	id?: string;
	type?: string;
	[property: string]: any;
};

export enum ChallongeMatchState {
	Complete = "complete",
	Open = "open",
	Pending = "pending",
}

export type Timestamps = {
	created_at?: string;
	updated_at?: any;
	[property: string]: any;
};

// ####  UPDATE ####
/**
 * MatchInput
 */
export type ChallongeUpdatedMatchPayload = {
	data?: ChallongUpdatedMatchData;
	[property: string]: any;
};

export type ChallongUpdatedMatchData = {
	attributes?: UpdatedMatchesAttributes;
	type?: string;
	[property: string]: any;
};

export type UpdatedMatchesAttributes = {
	/**
	 * Location for the match (text only, see Stations endpoints if want more structure and
	 * automation)
	 */
	location?: string;
	match?: UpdatedMatch[];

	/**
	 * Date time string for scheduled start time
	 */
	scheduled_time?: string;

	/**
	 * To mark the match complete as a tie, set this to true and ensure 'advancing' is false for
	 * reported scores.
	 */
	tie?: boolean;
	[property: string]: any;
};

/**
 * Match
 */
export type UpdatedMatch = {
	advancing?: boolean;
	participant_id: string;
	rank?: number;

	/**
	 * Comma-separated scores for this participant_id. E.g. if participant ID 76 won 4-1, 2-4,
	 * 4-0, the value should be '4,2,4' (the other player's value should be '1,4,0'). This
	 * format may seem odd, but it scales to support 3+ participants per match in Free For All.
	 */
	score_set: string;
	[property: string]: any;
};
