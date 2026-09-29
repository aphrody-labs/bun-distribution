import type { Tournament } from "@/entities";
import type { UserDTO } from "@/services";
import type { ParticipantStatus } from "@/utils/enums";

/**
 * ParticipantModel
 */
export type ParticipantModel = {
	attributes?: ParticipantOutput;
	id?: string;
	type?: string;
	[property: string]: any;
};

/**
 * ParticipantOutput
 */
export type ParticipantOutput = {
	final_rank?: number;
	group_id?: number;

	/**
	 * API-only field for your own foreign key or other use
	 */
	misc?: string;
	name?: string;
	seed?: number;
	states?: States;
	timestamps?: Timestamps;
	tournament_id?: number;
	username?: string;
	[property: string]: any;
};

export type States = {
	active?: boolean;
	[property: string]: any;
};

export type Timestamps = {
	created_at?: string;
	updated_at?: any;
	[property: string]: any;
};

export type ParticipantDTO = {
	id: number;
	tournament: Tournament;
	user: UserDTO;
	bracketParticipantId?: number | null;
	seed?: number;
	hasCheckedIn: boolean;
	/** `Active` | `Waitlisted` | `Disqualified` — voir `ParticipantStatus`. */
	status?: ParticipantStatus;
	registeredAt?: Date;
	/** Rang dans la liste d'attente (1 = prochain promu), null si inscrit ou disqualifié. */
	waitlistPosition?: number | null;
	/** Motif de DQ / retrait — renvoyé aux seuls organisateurs. */
	statusReason?: string | null;
};
