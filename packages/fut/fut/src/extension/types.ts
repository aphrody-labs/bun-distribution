/**
 * Copyright 2026 aphrody-code
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

export type UtasEventType =
	| "AUTH_SESSION"
	| "USER_INFO"
	| "CLUB_ITEMS"
	| "MARKET_SEARCH"
	| "ITEM_BID"
	| "ITEM_BUY_NOW"
	| "ITEM_LIST"
	| "SBC_SETS"
	| "SBC_SUBMIT"
	| "STORE_PACKS"
	| "PACK_OPEN"
	| "UNASSIGNED_ITEMS"
	| "OBJECTIVES"
	| "GENERIC_UTAS";

export interface UtasInterceptedEvent {
	id: string;
	type: UtasEventType;
	url: string;
	method: string;
	requestHeaders: Record<string, string>;
	requestBody?: unknown;
	responseStatus: number;
	responseBody?: unknown;
	timestamp: number;
}

/**
 * Live UTAS session captured from the web app's own traffic: the
 * `X-UT-SID` / `X-UT-PHISHING-TOKEN` request headers, the `/ut/auth`
 * response, or `window.services.Authentication.getUtasSession()`.
 */
export interface UtasCapturedSession {
	sid: string;
	phishingToken?: string;
	personaId?: string;
	personaName?: string;
	nucleusId?: string;
	gameSku?: string;
	utasHost?: string;
	capturedAt: number;
	source: "HEADER" | "AUTH_RESPONSE" | "SERVICES";
}

export interface StoredEaCookie {
	name: string;
	value: string;
	domain: string;
	path: string;
	secure: boolean;
	httpOnly: boolean;
	sameSite?: string;
	expirationDate?: number;
}

export interface DomStreamMessage {
	url: string;
	title: string;
	html: string;
	cssRulesCount: number;
	domNodeCount: number;
	timestamp: number;
	activeScreen?: string;
}

export type WebappCommandAction =
	| "GET_SESSION"
	| "SEARCH_MARKET"
	| "BID_ITEM"
	| "BUY_NOW"
	| "LIST_MARKET"
	| "SEND_TO_CLUB"
	| "QUICK_SELL"
	| "SOLVE_SBC"
	| "SUBMIT_SBC_CHALLENGE"
	| "GET_ACTIVE_VIEW"
	| "NAVIGATE"
	| "EXECUTE_SCRIPT";

export interface WebappAgentCommand {
	commandId: string;
	action: WebappCommandAction;
	payload: Record<string, unknown>;
	timeoutMs?: number;
}

export interface WebappAgentResponse {
	commandId: string;
	success: boolean;
	data?: unknown;
	error?: string;
	timestamp: number;
}

export type ExtensionPacketType =
	| "SESSION_SYNC"
	| "UTAS_SESSION"
	| "UTAS_EVENT"
	| "DOM_SNAPSHOT"
	| "AGENT_COMMAND"
	| "AGENT_RESPONSE"
	| "HEARTBEAT"
	| "EXTENSION_STATUS";

export interface ExtensionStreamPacket {
	version: "1.0.0";
	type: ExtensionPacketType;
	sender: "CHROME_EXTENSION" | "BXC_VPS_SERVER" | "AGENT_MCP";
	timestamp: number;
	data: {
		cookies?: StoredEaCookie[];
		session?: UtasCapturedSession;
		utasEvent?: UtasInterceptedEvent;
		domSnapshot?: DomStreamMessage;
		command?: WebappAgentCommand;
		response?: WebappAgentResponse;
		meta?: Record<string, unknown>;
	};
}

export interface WebAppLiveState {
	connected: boolean;
	lastSeen: number;
	personaName?: string;
	coins: number;
	points: number;
	clubPlayerCount: number;
	transferListCount: number;
	unassignedCount: number;
	activeScreen: string;
	recentEvents: UtasInterceptedEvent[];
	latestDom?: DomStreamMessage;
	cookiesCount: number;
	lastSession?: UtasCapturedSession;
	/** Auctions seen in intercepted transfer-market responses. */
	marketObservations: number;
	/** Timestamp of the most recent market response observed. */
	lastMarketObservation?: number;
}
