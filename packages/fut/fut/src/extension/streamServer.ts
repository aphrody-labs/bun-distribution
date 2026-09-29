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

import type { Server, ServerWebSocket } from "bun";
import { EaUtasClient } from "../ea/client.ts";
import type { UtAuctionItem } from "../ea/types.ts";
import type {
	DomStreamMessage,
	ExtensionStreamPacket,
	StoredEaCookie,
	UtasCapturedSession,
	UtasInterceptedEvent,
	WebAppLiveState,
	WebappAgentCommand,
	WebappAgentResponse,
	WebappCommandAction,
} from "./types.ts";

export interface StreamServerConfig {
	port?: number;
	hostname?: string;
	onUtasEvent?: (event: UtasInterceptedEvent) => void;
	onCookiesUpdated?: (cookies: StoredEaCookie[]) => void;
	onSessionCaptured?: (session: UtasCapturedSession) => void;
	/**
	 * Called with auctions seen in transfer-market responses the browser made,
	 * so a caller can persist them as price observations.
	 */
	onAuctionsObserved?: (auctions: UtAuctionItem[], observedAt: number) => void;
}

/**
 * Pulls auctions out of an intercepted UTAS transfer-market response.
 * The body shape matches the client mapping: { auctionInfo: [{ tradeId,
 * itemData: { assetId, rating }, buyNowPrice, ... }] }. Anything that does
 * not look like that yields nothing rather than a partly-filled record.
 */
export function extractAuctions(responseBody: unknown): UtAuctionItem[] {
	if (typeof responseBody !== "object" || responseBody === null) return [];
	const info = (responseBody as { auctionInfo?: unknown }).auctionInfo;
	if (!Array.isArray(info)) return [];

	const out: UtAuctionItem[] = [];
	for (const raw of info) {
		if (typeof raw !== "object" || raw === null) continue;
		const a = raw as Record<string, any>;
		const assetId = a.itemData?.assetId;
		if (typeof assetId !== "number" || assetId <= 0) continue;
		out.push({
			tradeId: typeof a.tradeId === "number" ? a.tradeId : 0,
			assetId,
			rating: a.itemData?.rating ?? 0,
			itemType: a.itemData?.itemType ?? "player",
			rareflag: a.itemData?.rareflag ?? 0,
			preferredPosition: a.itemData?.preferredPosition ?? "",
			startingBid: a.startingBid ?? 0,
			currentBid: a.currentBid ?? 0,
			buyNowPrice: a.buyNowPrice ?? 0,
			expires: a.expires ?? 0,
			tradeState: a.tradeState ?? "active",
		});
	}
	return out;
}

export class FutWebappStreamServer {
	private server: Server<unknown> | null = null;
	private activeSockets: Set<ServerWebSocket<unknown>> = new Set();
	private pendingCommands: Map<
		string,
		{
			resolve: (res: WebappAgentResponse) => void;
			reject: (err: Error) => void;
			timer: ReturnType<typeof setTimeout>;
		}
	> = new Map();

	private liveState: WebAppLiveState = {
		connected: false,
		lastSeen: 0,
		coins: 0,
		points: 0,
		clubPlayerCount: 0,
		transferListCount: 0,
		unassignedCount: 0,
		activeScreen: "INITIALIZING",
		recentEvents: [],
		cookiesCount: 0,
		marketObservations: 0,
	};

	private liveCookies: StoredEaCookie[] = [];
	private config: StreamServerConfig;

	constructor(config: StreamServerConfig = {}) {
		this.config = {
			port: config.port ?? 3000, // matches DEFAULT_BXC_STREAM_WS_URL in background.ts
			hostname: config.hostname ?? "0.0.0.0",
			...config,
		};
	}

	/**
	 * Starts the WebSocket & HTTP streaming ingest server.
	 */
	public start(): Server<unknown> {
		if (this.server) return this.server;

		const self = this;

		this.server = Bun.serve({
			port: this.config.port,
			hostname: this.config.hostname,
			fetch(req, server) {
				const url = new URL(req.url);

				// WebSocket upgrade for Extension live streaming
				if (url.pathname === "/fut/stream" || url.pathname === "/api/fut/stream") {
					const upgraded = server.upgrade(req, { data: undefined });
					if (upgraded) return undefined;
					return new Response("WebSocket upgrade failed", { status: 400 });
				}

				// Status endpoint for AI agent or monitoring
				if (url.pathname === "/fut/status" || url.pathname === "/api/fut/status") {
					return Response.json(self.getLiveState(), {
						headers: { "Access-Control-Allow-Origin": "*" },
					});
				}

				// DOM Snapshot endpoint
				if (url.pathname === "/fut/dom" || url.pathname === "/api/fut/dom") {
					return Response.json(self.getLatestDomSnapshot() || { status: "NO_SNAPSHOT" }, {
						headers: { "Access-Control-Allow-Origin": "*" },
					});
				}

				// Cookies inspect endpoint
				if (url.pathname === "/fut/cookies" || url.pathname === "/api/fut/cookies") {
					return Response.json(self.getLiveCookies(), {
						headers: { "Access-Control-Allow-Origin": "*" },
					});
				}

				return new Response("BXC FUT Extension Stream Server Active", { status: 200 });
			},
			websocket: {
				open(ws) {
					self.activeSockets.add(ws);
					self.liveState.connected = true;
					self.liveState.lastSeen = Date.now();
				},
				message(ws, message) {
					self.handleIncomingPacket(String(message));
				},
				close(ws) {
					self.activeSockets.delete(ws);
					if (self.activeSockets.size === 0) {
						self.liveState.connected = false;
					}
				},
			},
		});

		return this.server;
	}

	/**
	 * Stops the streaming server and closes all active client connections.
	 */
	public stop(): void {
		if (this.server) {
			this.server.stop(true);
			this.server = null;
		}
		this.activeSockets.clear();
		for (const [, p] of this.pendingCommands) {
			clearTimeout(p.timer);
			p.reject(new Error("Stream server stopped."));
		}
		this.pendingCommands.clear();
		this.liveState.connected = false;
	}

	/**
	 * Returns the current live state of the connected EA Web App.
	 */
	public getLiveState(): WebAppLiveState {
		return {
			...this.liveState,
			connected: this.activeSockets.size > 0,
		};
	}

	/**
	 * Returns the latest DOM snapshot captured from the Web App.
	 */
	public getLatestDomSnapshot(): DomStreamMessage | undefined {
		return this.liveState.latestDom;
	}

	/**
	 * Returns the current active EA session cookies.
	 */
	public getLiveCookies(): StoredEaCookie[] {
		return [...this.liveCookies];
	}

	/**
	 * Dispatches a remote command to the connected EA Web App and awaits its execution response.
	 */
	public async executeCommand(
		action: WebappCommandAction,
		payload: Record<string, unknown> = {},
		timeoutMs = 15000,
	): Promise<WebappAgentResponse> {
		if (this.activeSockets.size === 0) {
			throw new Error("Cannot execute command: No EA Web App Chrome Extension connected to BXC.");
		}

		const commandId = `cmd_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
		const command: WebappAgentCommand = {
			commandId,
			action,
			payload,
			timeoutMs,
		};

		const packet: ExtensionStreamPacket = {
			version: "1.0.0",
			type: "AGENT_COMMAND",
			sender: "BXC_VPS_SERVER",
			timestamp: Date.now(),
			data: { command },
		};

		const serialized = JSON.stringify(packet);
		for (const socket of this.activeSockets) {
			socket.send(serialized);
		}

		return new Promise<WebappAgentResponse>((resolve, reject) => {
			const timer = setTimeout(() => {
				self.pendingCommands.delete(commandId);
				reject(new Error(`Execution timed out after ${timeoutMs}ms for command ${action} (${commandId})`));
			}, timeoutMs);

			const self = this;
			this.pendingCommands.set(commandId, { resolve, reject, timer });
		});
	}

	/**
	 * Ingests a raw JSON packet sent from the Chrome Extension.
	 */
	public handleIncomingPacket(rawMessage: string): void {
		try {
			const packet = JSON.parse(rawMessage) as ExtensionStreamPacket;
			if (!packet || !packet.type) return;

			this.liveState.lastSeen = Date.now();
			this.liveState.connected = true;

			switch (packet.type) {
				case "SESSION_SYNC":
					if (packet.data.cookies) {
						this.liveCookies = packet.data.cookies;
						this.liveState.cookiesCount = packet.data.cookies.length;
						if (this.config.onCookiesUpdated) {
							this.config.onCookiesUpdated(this.liveCookies);
						}
					}
					break;

				case "UTAS_SESSION":
					if (packet.data.session) {
						this.liveState.lastSession = packet.data.session;
						if (this.config.onSessionCaptured) {
							this.config.onSessionCaptured(packet.data.session);
						}
						try {
							const client = new EaUtasClient();
							client.setSession(packet.data.session);
						} catch {
							// Silent fallback on persistence failure
						}
					}
					break;

				case "UTAS_EVENT":
					if (packet.data.utasEvent) {
						this.processUtasEvent(packet.data.utasEvent);
					}
					break;

				case "DOM_SNAPSHOT":
					if (packet.data.domSnapshot) {
						this.liveState.latestDom = packet.data.domSnapshot;
						if (packet.data.domSnapshot.activeScreen) {
							this.liveState.activeScreen = packet.data.domSnapshot.activeScreen;
						}
					}
					break;

				case "AGENT_RESPONSE":
					if (packet.data.response) {
						const res = packet.data.response;
						const pending = this.pendingCommands.get(res.commandId);
						if (pending) {
							clearTimeout(pending.timer);
							this.pendingCommands.delete(res.commandId);
							pending.resolve(res);
						}
					}
					break;

				case "HEARTBEAT":
					break;
			}
		} catch (err) {
			console.error("[FutWebappStreamServer] Failed parsing packet:", err);
		}
	}

	private processUtasEvent(event: UtasInterceptedEvent): void {
		this.liveState.recentEvents.unshift(event);
		if (this.liveState.recentEvents.length > 50) {
			this.liveState.recentEvents.pop();
		}

		// Update live currencies if user info is observed
		if (event.type === "USER_INFO" && typeof event.responseBody === "object" && event.responseBody !== null) {
			const body = event.responseBody as Record<string, unknown>;
			if (typeof body.personaName === "string") {
				this.liveState.personaName = body.personaName;
			}
			const userCoins = body.coins;
			if (typeof userCoins === "number") {
				this.liveState.coins = userCoins;
			}
		}

		// Market results seen in the browser are ordinary price observations, and
		// the richest source available: they are already authenticated, cost no
		// extra request, and cover whatever the player is actually browsing.
		if (event.type === "MARKET_SEARCH") {
			const auctions = extractAuctions(event.responseBody);
			if (auctions.length > 0) {
				this.liveState.lastMarketObservation = event.timestamp;
				this.liveState.marketObservations += auctions.length;
				if (this.config.onAuctionsObserved) {
					try {
						this.config.onAuctionsObserved(auctions, event.timestamp);
					} catch {
						// Recording is best-effort; never break the stream.
					}
				}
			}
		}

		if (this.config.onUtasEvent) {
			this.config.onUtasEvent(event);
		}
	}
}
