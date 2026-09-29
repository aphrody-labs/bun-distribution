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

import { EaUtasClient } from "../ea/client.ts";
import type { UtItemPileTarget, UtMarketSearchParams } from "../ea/types.ts";
import { FutCoreService } from "../services/FutCoreService.ts";

export class FutUnifiedApi {
	private core: FutCoreService;
	private utas: EaUtasClient | null = null;

	constructor() {
		this.core = new FutCoreService();
	}

	public close(): void {
		this.core.close();
	}

	/** Lazily created native UTAS client (shares one session across requests). */
	private utasClient(): EaUtasClient {
		if (!this.utas) this.utas = new EaUtasClient();
		return this.utas;
	}

	private static intParam(url: URL, key: string): number | undefined {
		const raw = url.searchParams.get(key);
		if (raw === null || raw === "") return undefined;
		const n = Number(raw);
		return Number.isFinite(n) ? n : undefined;
	}

	private static idList(raw: string | null | undefined): number[] {
		if (!raw) return [];
		return String(raw)
			.split(",")
			.map((s) => Number(s.trim()))
			.filter((n) => Number.isFinite(n));
	}

	/**
	 * Routes `/api/fut/ut/<action>` to the native EA web-app client. Returns
	 * `undefined` for unknown actions so the caller can answer 404.
	 *
	 * Read (GET): session, me, credits, stats, club, club/all, consumables,
	 * unassigned, tradepile, watchlist, market, pricelimits, squad, squads, stadium.
	 * Write (POST JSON): auth, session, logout, bid, list, move, quicksell,
	 * remove, relist, watch, unwatch.
	 */
	private async handleUtas(action: string, req: Request, url: URL): Promise<unknown> {
		const client = this.utasClient();
		const body =
			req.method === "POST" || req.method === "PUT" || req.method === "DELETE"
				? ((await req.json().catch(() => ({}))) as Record<string, any>)
				: {};

		switch (action) {
			// --- session -----------------------------------------------------
			case "auth": {
				const sid = await client.authenticate();
				return { authenticated: Boolean(sid), session: client.persistSession() };
			}
			case "session": {
				if (typeof body.sid === "string" && body.sid) {
					client.setSession({
						sid: body.sid,
						phishingToken: body.phishingToken,
						personaId: body.personaId,
						nucleusId: body.nucleusId,
						gameSku: body.gameSku,
					});
				}
				return client.getSessionStatus();
			}
			case "logout": {
				client.clearSession();
				return { loggedOut: true };
			}

			// --- read --------------------------------------------------------
			case "me":
				return client.getUserMassInfo();
			case "credits":
				return { credits: await client.getUserCredits() };
			case "stats":
				return client.getClubInventoryStats();
			case "club":
				return client.getClubPlayers(
					FutUnifiedApi.intParam(url, "offset") ?? 0,
					FutUnifiedApi.intParam(url, "count") ?? 50,
				);
			case "club/all":
				return client.getClubAllPlayers(FutUnifiedApi.intParam(url, "max") ?? 2000);
			case "consumables":
				return client.getDevelopmentConsumables();
			case "unassigned":
				return client.getUnassignedItems();
			case "tradepile":
				return client.getTradePile();
			case "watchlist":
				return client.getWatchList();
			case "market": {
				const q = url.searchParams;
				const params: UtMarketSearchParams = {
					type: (q.get("type") as UtMarketSearchParams["type"]) ?? undefined,
					lev: (q.get("lev") as UtMarketSearchParams["lev"]) ?? undefined,
					pos: q.get("pos") ?? undefined,
					defId: FutUnifiedApi.intParam(url, "defId"),
					maskedDefId: FutUnifiedApi.intParam(url, "maskedDefId"),
					nat: FutUnifiedApi.intParam(url, "nat"),
					leag: FutUnifiedApi.intParam(url, "leag"),
					team: FutUnifiedApi.intParam(url, "team"),
					micr: FutUnifiedApi.intParam(url, "micr"),
					macr: FutUnifiedApi.intParam(url, "macr"),
					minb: FutUnifiedApi.intParam(url, "minb"),
					maxb: FutUnifiedApi.intParam(url, "maxb"),
					num: FutUnifiedApi.intParam(url, "num"),
					start: FutUnifiedApi.intParam(url, "start"),
				};
				return client.searchMarket(params);
			}
			case "pricelimits":
				return client.getPriceLimits(FutUnifiedApi.idList(url.searchParams.get("ids")));
			case "squad":
				return client.getActiveSquad();
			case "squads":
				return client.getSquadList();
			case "stadium":
				return client.getStadium();

			// --- write -------------------------------------------------------
			case "bid":
			case "buy":
				return client.bid(Number(body.tradeId), Number(body.amount ?? body.bid));
			case "list":
				return client.listAuction({
					itemId: Number(body.itemId),
					startingBid: Number(body.startingBid),
					buyNowPrice: Number(body.buyNowPrice),
					durationSeconds: body.durationSeconds ? Number(body.durationSeconds) : undefined,
				});
			case "move":
				return client.moveItems(
					FutUnifiedApi.idList(body.itemIds),
					(body.pile as UtItemPileTarget) ?? "club",
				);
			case "quicksell":
				return client.quickSell(FutUnifiedApi.idList(body.itemIds));
			case "remove": {
				const tradeId = Number(body.tradeId);
				await client.removeFromTradePile(tradeId);
				return { removed: tradeId };
			}
			case "relist":
				return client.relistAll();
			case "watch": {
				const ids = FutUnifiedApi.idList(body.tradeIds);
				await client.watch(ids);
				return { watching: ids };
			}
			case "unwatch": {
				const ids = FutUnifiedApi.idList(body.tradeIds);
				await client.unwatch(ids);
				return { unwatched: ids };
			}
			default:
				return undefined;
		}
	}

	/**
	 * Unified HTTP Request Handler for Bun HTTP server, Elysia, Express, or Next.js API routes.
	 */
	public async handleRequest(req: Request): Promise<Response> {
		const url = new URL(req.url);
		const pathname = url.pathname;

		// Set standard CORS headers
		const headers = {
			"Content-Type": "application/json",
			"Access-Control-Allow-Origin": "*",
			"Access-Control-Allow-Methods": "GET, POST, OPTIONS",
			"Access-Control-Allow-Headers": "Content-Type, Authorization",
		};

		if (req.method === "OPTIONS") {
			return new Response(null, { status: 204, headers });
		}

		try {
			// Health check
			if (pathname === "/api/fut/health") {
				return new Response(
					JSON.stringify({ status: "OK", timestamp: Date.now(), service: "@aphrody/fut" }),
					{ status: 200, headers },
				);
			}

			// 1. Universal URL Parser Endpoint
			if (pathname === "/api/fut/parse-url" && req.method === "POST") {
				const body = (await req.json()) as { url: string; livePriceConsole?: number; livePricePc?: number };
				if (!body.url) {
					return new Response(JSON.stringify({ error: "Missing 'url' parameter" }), { status: 400, headers });
				}
				const result = await this.core.parseAnyUrl(body.url, body);
				return new Response(JSON.stringify(result), { status: 200, headers });
			}

			// 2. Player Analysis Endpoint
			if (pathname.startsWith("/api/fut/player/")) {
				const identifier = decodeURIComponent(pathname.replace("/api/fut/player/", ""));
				const player = await this.core.getPlayerAnalysis(identifier);
				return new Response(JSON.stringify(player), { status: 200, headers });
			}

			// 3. SBC Solver Endpoint
			if (pathname === "/api/fut/sbc/solve" && req.method === "POST") {
				const body = (await req.json()) as { targetRating: number };
				const solution = await this.core.getSbcSolution(body.targetRating || 85);
				return new Response(JSON.stringify(solution), { status: 200, headers });
			}

			// 4. Fodder Index Endpoint
			if (pathname === "/api/fut/fodder") {
				const fodder = this.core.getFodderMarket();
				return new Response(JSON.stringify(fodder), { status: 200, headers });
			}

			// 5. Market Bargains Endpoint
			if (pathname === "/api/fut/bargains") {
				const position = url.searchParams.get("position") || "CM";
				const bargains = await this.core.scanBargains({ position });
				return new Response(JSON.stringify(bargains), { status: 200, headers });
			}

			// 6. Native EA web-app surface (UTAS), mirrored 1:1 from the official client.
			if (pathname.startsWith("/api/fut/ut/")) {
				const result = await this.handleUtas(pathname.slice("/api/fut/ut/".length), req, url);
				if (result !== undefined) {
					return new Response(JSON.stringify(result), { status: 200, headers });
				}
			}

			return new Response(JSON.stringify({ error: "Not Found", path: pathname }), { status: 404, headers });
		} catch (error: unknown) {
			const msg = error instanceof Error ? error.message : String(error);
			return new Response(JSON.stringify({ error: msg }), { status: 500, headers });
		}
	}
}
