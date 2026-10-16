/**
 * Types partagés pour les API responses
 */

// Calendar Events API
export interface CalendarEvent {
	id?: string | null;
	summary?: string | null;
	location?: string | null;
	description?: string | null;
	start?: {
		date?: string | null;
		dateTime?: string | null;
		timeZone?: string | null;
	} | null;
	end?: {
		date?: string | null;
		dateTime?: string | null;
		timeZone?: string | null;
	} | null;
	extendedProperties?: {
		private?: Record<string, string>;
		shared?: Record<string, string>;
	} | null;
}

export interface CalendarEventsResponse {
	events: CalendarEvent[];
}

// Discord Widget API
export interface DiscordMember {
	id: string;
	username: string;
	avatar_url: string | null;
	status: "online" | "idle" | "dnd" | "offline";
	game: { name: string } | null;
}

export interface DiscordWidgetResponse {
	name: string;
	icon: string | null;
	banner: string | null;
	presence_count: number;
	member_count: number;
	instant_invite: string;
	members: DiscordMember[];
}

// Generic API Response
export interface ApiSuccessResponse<T = unknown> {
	success: true;
	data: T;
}

export interface ApiErrorResponse {
	success: false;
	error: {
		message: string;
		code?: string;
		details?: unknown;
	};
}

export type ApiResponse<T = unknown> = ApiSuccessResponse<T> | ApiErrorResponse;
