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

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { ImpersonatedClient } from "@aphrody/bxc/ffi/curl-impersonate";
import type {
	UtAuctionItem,
	UtBidResult,
	UtChemistryProfile,
	UtChemistryProfiles,
	UtChemistryTeamLinks,
	UtClubInventoryStats,
	UtClubPlayerItem,
	UtClubStat,
	UtConsumableItem,
	UtItemMoveResult,
	UtItemPileTarget,
	UtListAuctionParams,
	UtListAuctionResult,
	UtMarketSearchParams,
	UtPriceBand,
	UtPriceLimits,
	UtQuickSellResult,
	UtSessionData,
	UtTeamLink,
	UtTradeItemsResult,
	UtUserMassInfo,
	UtasSessionConfig,
} from "./types.ts";

// EADP OAuth client used by the official FC Ultimate Team web app. Verified
// against the live web app (www.ea.com/…/ultimate-team/web-app): the browser
// requests an implicit `access_token` at accounts.ea.com, then exchanges it for
// a UTAS session id that is sent as the `X-UT-SID` header (a 36-char UUID — NOT
// the PLAY_SESSION JWT cookie) on every /ut/game/fc<year>/* call.
const EADP_CLIENT_ID = "FC27_JS_WEB_APP";
const EADP_CONNECT_HOST = "https://accounts.ea.com";
const EADP_GATEWAY_HOST = "https://gateway.ea.com";
// Live gameplay shard is v1 (config.json: utasAuthHost=utas.mob.v1.prd…). The
// previous v2 host does not exist and always failed auth.
const UTAS_HOST = "https://utas.mob.v1.prd.futc-ext.gcp.ea.com";

export class EaUtasClient {
	private client: ImpersonatedClient;
	private config: UtasSessionConfig;
	private baseUtasUrl: string;
	private cookieHeader = "";

	constructor(config: UtasSessionConfig = {}, client?: ImpersonatedClient) {
		this.config = config;
		const gameYear = config.gameYear ?? "27";
		this.baseUtasUrl = `${UTAS_HOST}/ut/game/fc${gameYear}`;
		this.client = client ?? new ImpersonatedClient({ profile: "chrome131" });
		this.loadStoredSession();
	}

	/** Default on-disk location of the persisted UTAS session. */
	public sessionFilePath(): string {
		return (
			this.config.sessionPath ??
			process.env.EA_UT_SESSION_PATH ??
			join(import.meta.dir, "../cookies/ea-session.json")
		);
	}

	public getSessionFilePath(): string {
		return this.sessionFilePath();
	}

	public saveSession(): UtSessionData | null {
		return this.persistSession();
	}

	public getSessionStatus(): {
		authenticated: boolean;
		hasSid: boolean;
		hasCookies: boolean;
		sidPreview?: string;
		phishingToken?: string;
		nucleusId?: string;
		personaId?: string;
		sessionFile: string;
	} {
		const s = this.getSession();
		return {
			authenticated: Boolean(s?.sid),
			hasSid: Boolean(s?.sid),
			hasCookies: Boolean(this.cookieHeader),
			sidPreview: s?.sid
				? `${s.sid.slice(0, 8)}...${s.sid.slice(-4)}`
				: undefined,
			phishingToken: s?.phishingToken,
			nucleusId: s?.nucleusId,
			personaId: s?.personaId,
			sessionFile: this.sessionFilePath(),
		};
	}

	/** Loads a previously persisted session (`ea-session.json`) if present. */
	public loadPersistedSession(): void {
		const path = this.sessionFilePath();
		if (!existsSync(path)) return;
		try {
			const data = JSON.parse(readFileSync(path, "utf-8")) as UtSessionData;
			if (data.sid) {
				this.config.sid = data.sid;
				this.config.phishingToken = data.phishingToken || this.config.phishingToken;
				this.config.nucleusId = data.nucleusId ?? this.config.nucleusId;
				this.config.personaId = data.personaId ?? this.config.personaId;
				this.config.gameSku = data.gameSku ?? this.config.gameSku;
			}
		} catch {
			// Corrupt session file: ignore and re-authenticate.
		}
	}

	private loadStoredSession(): void {
		// 1. Try to load saved session from ea-session.json
		this.loadPersistedSession();

		// 2. Allow an already-established session to be injected via env,
		// e.g. harvested from a logged-in browser. The SID is a runtime secret.
		if (!this.config.sid && process.env.EA_UT_SID) {
			this.config.sid = process.env.EA_UT_SID;
		}
		if (!this.config.phishingToken && process.env.EA_UT_PHISHING_TOKEN) {
			this.config.phishingToken = process.env.EA_UT_PHISHING_TOKEN;
		}

		const cookiePath =
			this.config.cookiesPath ??
			join(import.meta.dir, "../cookies/ea.json");

		// The exported ea.com cookies authenticate the OAuth authorize step; we
		// build a Cookie header from them (they are NOT the UTAS session id).
		if (existsSync(cookiePath)) {
			try {
				const raw = readFileSync(cookiePath, "utf-8");
				const cookies = JSON.parse(raw) as Array<{
					name?: string;
					value?: string;
					domain?: string;
				}>;
				this.cookieHeader = cookies
					.filter(
						(c) =>
							c.name &&
							c.value &&
							(c.domain ?? "").includes("ea.com"),
					)
					.map((c) => `${c.name}=${c.value}`)
					.join("; ");
			} catch {
				// Cookie loading fallback
			}
		}

		// Fallback to Rust FFI Chromium cookie harvest if no cookies loaded yet.
		if (!this.cookieHeader) {
			try {
				const { harvestEaChromiumCookies } = require("../recon/network.ts");
				const harvested = harvestEaChromiumCookies() as Record<
					string,
					string
				>;
				this.cookieHeader = Object.entries(harvested)
					.map(([k, v]) => `${k}=${v}`)
					.join("; ");
			} catch {
				// Silent fallback
			}
		}
	}

	/**
	 * Establishes a UTAS session (`X-UT-SID`) from the loaded ea.com cookies,
	 * mirroring the official web app: OAuth implicit `access_token` →
	 * identity `pids/me` → UTAS `/ut/auth`. Populates `this.config.sid` and
	 * returns it. Skips network work if a SID is already set.
	 */
	public async authenticate(): Promise<string> {
		if (this.config.sid) return this.config.sid;
		if (!this.cookieHeader) {
			throw new Error(
				"EA authentication requires ea.com cookies (cookies/ea.json) or EA_UT_SID.",
			);
		}

		// 1. Implicit OAuth access token (authenticated by ea.com cookies).
		const authUrl =
			`${EADP_CONNECT_HOST}/connect/auth?client_id=${EADP_CLIENT_ID}` +
			"&response_type=token&display=web2/login&locale=en_US" +
			"&redirect_uri=nucleus:rest&release_type=prod";
		const tokenRes = await this.client.fetch(authUrl, {
			headers: { Accept: "application/json" },
			cookies: this.cookieHeader,
			followRedirects: false,
		});
		// Without a valid accounts.ea.com login (`remid`/`sid` cookies) EA answers
		// 302 → signin.ea.com instead of the JSON token payload.
		if (tokenRes.status === 302 || tokenRes.status === 301) {
			const location = tokenRes.headers.get("location") ?? "";
			const hasLoginCookies = /(^|;\s*)(remid|sid)=/.test(this.cookieHeader);
			throw new Error(
				`EA OAuth authorize redirected to ${location.split("?")[0] || "the sign-in page"}: ` +
					(hasLoginCookies
						? "the accounts.ea.com login cookies have expired."
						: "cookies/ea.json has no accounts.ea.com login cookies (remid/sid); export them from https://accounts.ea.com while signed in,") +
					" or inject a live session with `bxc fut session --sid <X-UT-SID>` (Chrome extension / EA_UT_SID).",
			);
		}
		if (tokenRes.status !== 200) {
			throw new Error(
				`EA OAuth authorize failed: HTTP ${tokenRes.status} (cookies expired?).`,
			);
		}
		const tokenText = await tokenRes.text();
		let token: { access_token?: string } = {};
		try {
			token = JSON.parse(tokenText);
		} catch {
			throw new Error(
				"EA OAuth authorize returned a non-JSON page (login required). Refresh cookies/ea.json or inject a live session.",
			);
		}
		if (!token.access_token) {
			throw new Error("EA OAuth authorize returned no access_token.");
		}

		// 2. Resolve the nucleus/persona identity for the UTAS handshake.
		const meRes = await this.client.fetch(
			`${EADP_GATEWAY_HOST}/proxy/identity/pids/me`,
			{
				headers: {
					Authorization: `Bearer ${token.access_token}`,
					Accept: "application/json",
				},
			},
		);
		const me = (await meRes.json().catch(() => ({}))) as {
			pid?: { pidId?: number };
		};
		if (me.pid?.pidId) {
			this.config.nucleusId = String(me.pid.pidId);
		}

		// 3. Exchange for a UTAS session id (the X-UT-SID UUID).
		const authBody: Record<string, unknown> = {
			isReadOnly: false,
			sku: "FUT27WEB",
			clientVersion: 1,
			locale: "en-US",
			method: "authcode",
			priorityLevel: 4,
			identification: { authCode: "" },
			nucleusPersonaId: this.config.personaId ?? undefined,
			gameSku: this.config.gameSku ?? "FFA27PS5",
			accessToken: token.access_token,
		};
		const utAuthRes = await this.client.fetch(`${UTAS_HOST}/ut/auth`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Accept: "application/json",
				Origin: "https://www.ea.com",
				Referer:
					"https://www.ea.com/ea-sports-fc/ultimate-team/web-app/",
			},
			body: JSON.stringify(authBody),
		});
		if (utAuthRes.status !== 200) {
			throw new Error(
				`UTAS /ut/auth failed: HTTP ${utAuthRes.status}. Provide EA_UT_SID from a logged-in session instead.`,
			);
		}
		const utAuth = (await utAuthRes.json()) as {
			sid?: string;
			phishingToken?: string;
		};
		if (!utAuth.sid) {
			throw new Error("UTAS /ut/auth returned no sid.");
		}
		this.config.sid = utAuth.sid;
		if (utAuth.phishingToken) {
			this.config.phishingToken = utAuth.phishingToken;
		}
		return this.config.sid;
	}

	/** Ensures a session exists before an authenticated UTAS call. */
	private async ensureSession(): Promise<void> {
		if (!this.config.sid) {
			this.loadPersistedSession();
		}
		if (!this.config.sid) {
			await this.authenticate();
			this.persistSession();
		}
	}

	/** Persists the current session so later CLI/MCP invocations reuse it. */
	public persistSession(): UtSessionData | null {
		if (!this.config.sid) return null;
		const data: UtSessionData = {
			sid: this.config.sid,
			phishingToken: this.config.phishingToken ?? "0",
			nucleusId: this.config.nucleusId,
			personaId: this.config.personaId,
			gameSku: this.config.gameSku,
			savedAt: new Date().toISOString(),
		};
		try {
			const path = this.sessionFilePath();
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
		} catch {
			// Read-only filesystem: session stays in memory only.
		}
		return data;
	}

	/**
	 * Injects a session captured from a logged-in browser (e.g. by the Chrome
	 * extension's page hook) and persists it.
	 */
	public setSession(session: Partial<UtSessionData> & { sid: string }): void {
		this.config.sid = session.sid;
		if (session.phishingToken) this.config.phishingToken = session.phishingToken;
		if (session.nucleusId) this.config.nucleusId = session.nucleusId;
		if (session.personaId) this.config.personaId = session.personaId;
		if (session.gameSku) this.config.gameSku = session.gameSku;
		this.persistSession();
	}

	/** Current session snapshot (without forcing authentication). */
	public getSession(allowReload = true): UtSessionData | null {
		if (!this.config.sid && allowReload) this.loadPersistedSession();
		if (!this.config.sid) return null;
		return {
			sid: this.config.sid,
			phishingToken: this.config.phishingToken ?? "0",
			nucleusId: this.config.nucleusId,
			personaId: this.config.personaId,
			gameSku: this.config.gameSku,
			savedAt: new Date().toISOString(),
		};
	}

	/** Drops the in-memory session (and optionally deletes the persisted session file). */
	public clearSession(removeDiskFile = false): void {
		this.config.sid = undefined;
		if (removeDiskFile) {
			const file = this.sessionFilePath();
			if (existsSync(file)) {
				try {
					unlinkSync(file);
				} catch {
					// Fallback
				}
			}
		}
	}

	private getHeaders(): Record<string, string> {
		const headers: Record<string, string> = {
			"User-Agent":
				"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
			Origin: "https://www.ea.com",
			Referer: "https://www.ea.com/ea-sports-fc/ultimate-team/web-app/",
			Accept: "application/json",
			"Accept-Language": "en-US,en;q=0.9",
		};

		if (this.config.sid) {
			headers["X-UT-SID"] = this.config.sid;
		}
		// The live web app always sends the phishing token; default "0".
		headers["X-UT-PHISHING-TOKEN"] = this.config.phishingToken ?? "0";

		return headers;
	}

	/**
	 * Authenticated GET against a UTAS gameplay path (relative to the fc<year>
	 * base), establishing a session first and mapping UTAS auth failures to a
	 * clear error. `path` may include a query string.
	 */
	private async authedGet<T = any>(path: string): Promise<T> {
		return this.authedRequest<T>("GET", path);
	}

	/**
	 * Authenticated request with any HTTP method. A JSON body is serialized
	 * automatically. On 401 the persisted session is discarded and the call is
	 * retried once with a fresh authentication.
	 */
	private async authedRequest<T = any>(
		method: "GET" | "POST" | "PUT" | "DELETE",
		path: string,
		body?: unknown,
		retry = true,
	): Promise<T> {
		await this.ensureSession();
		const url = `${this.baseUtasUrl}${path}`;
		const headers = this.getHeaders();
		if (body !== undefined) headers["Content-Type"] = "application/json";
		const res = await this.client.fetch(url, {
			method,
			headers,
			body: body === undefined ? undefined : JSON.stringify(body),
		});

		if (res.status === 401 && retry) {
			this.clearSession();
			await this.authenticate();
			this.persistSession();
			return this.authedRequest<T>(method, path, body, false);
		}
		if (res.status === 401 || res.status === 403) {
			throw new Error(
				`UTAS authentication required (HTTP ${res.status}) for ${method} ${path}. Session token expired or not established.`,
			);
		}
		if (res.status === 458) {
			throw new Error(
				`UTAS captcha required (HTTP 458) for ${method} ${path}. Solve it in the web app, then retry.`,
			);
		}
		if (res.status === 461) {
			throw new Error(`UTAS permission denied (HTTP 461) for ${method} ${path}.`);
		}
		if (res.status === 470) {
			throw new Error(`UTAS insufficient credits (HTTP 470) for ${method} ${path}.`);
		}
		if (res.status === 478) {
			throw new Error(`UTAS auction no longer available (HTTP 478) for ${method} ${path}.`);
		}
		if (res.status < 200 || res.status >= 300) {
			throw new Error(`UTAS request failed: HTTP ${res.status} for ${method} ${path}`);
		}
		const text = await res.text();
		if (!text) return {} as T;
		return JSON.parse(text) as T;
	}

	/** Normalizes a raw UTAS inventory entry into a `UtClubPlayerItem`. */
	private static mapClubItem(it: any): UtClubPlayerItem {
		return {
			id: it.id,
			assetId: it.assetId,
			resourceId: it.resourceId,
			rating: it.rating,
			itemType: it.itemType ?? "player",
			rareflag: it.rareflag ?? 0,
			preferredPosition: it.preferredPosition ?? "",
			possiblePositions: it.possiblePositions ?? [],
			nation: it.nation ?? 0,
			leagueId: it.leagueId ?? 0,
			teamid: it.teamid ?? 0,
			untradeable: it.untradeable ?? false,
			discardValue: it.discardValue ?? 0,
			owners: it.owners ?? 1,
			playStyle: it.playStyle,
			// Item history: left undefined when UTAS omits the field, so a missing
			// purchase price never reads as "bought for 0".
			lastSalePrice: it.lastSalePrice,
			loyaltyBonus: it.loyaltyBonus,
			contract: it.contract,
			injuryType: it.injuryType,
			injuryGames: it.injuryGames,
			suspension: it.suspension,
			lifetimeStats: it.lifetimeStats,
			statsList: it.statsList,
			cardsubtypeid: it.cardsubtypeid,
		};
	}

	/** Normalizes a raw UTAS auction entry into a `UtAuctionItem`. */
	private static mapAuction(a: any): UtAuctionItem {
		return {
			tradeId: a.tradeId,
			assetId: a.itemData?.assetId ?? 0,
			rating: a.itemData?.rating ?? 0,
			itemType: a.itemData?.itemType ?? "player",
			rareflag: a.itemData?.rareflag ?? 0,
			preferredPosition: a.itemData?.preferredPosition ?? "",
			startingBid: a.startingBid ?? 0,
			currentBid: a.currentBid ?? 0,
			buyNowPrice: a.buyNowPrice ?? 0,
			expires: a.expires ?? 0,
			tradeState: a.tradeState ?? "active",
		};
	}

	/**
	 * Direct Transfer Market Search against UTAS shard
	 */
	public async searchMarket(
		params: UtMarketSearchParams = {},
	): Promise<UtAuctionItem[]> {
		const query = new URLSearchParams();
		query.set("type", params.type ?? "player");
		if (params.defId) query.set("defId", String(params.defId));
		if (params.maskedDefId) query.set("maskedDefId", String(params.maskedDefId));
		if (params.lev) query.set("lev", params.lev);
		if (params.pos) query.set("pos", params.pos);
		if (params.nat) query.set("nat", String(params.nat));
		if (params.leag) query.set("leag", String(params.leag));
		if (params.team) query.set("team", String(params.team));
		if (params.micr) query.set("micr", String(params.micr));
		if (params.macr) query.set("macr", String(params.macr));
		if (params.minb) query.set("minb", String(params.minb));
		if (params.maxb) query.set("maxb", String(params.maxb));
		query.set("num", String(params.num ?? 21));
		query.set("start", String(params.start ?? 0));

		const data = await this.authedGet(`/transfermarket?${query.toString()}`);
		const auctions: UtAuctionItem[] = (data.auctionInfo ?? []).map(
			EaUtasClient.mapAuction,
		);
		if (this.config.onAuctions && auctions.length > 0) {
			// Observing prices must never break the search itself.
			try {
				this.config.onAuctions(auctions, params);
			} catch {
				// Recording is best-effort.
			}
		}
		return auctions;
	}

	/**
	 * Queries current user credit balance from UTAS
	 */
	public async getUserCredits(): Promise<number> {
		const data = await this.authedGet("/user/credits");
		return data.credits ?? 0;
	}

	/**
	 * Returns the user's active transfer list (`/tradepile`): items on sale,
	 * sold and unsold, plus the live credit balance.
	 */
	public async getTradePile(): Promise<UtTradeItemsResult> {
		const data = await this.authedGet("/tradepile");
		return {
			items: (data.auctionInfo ?? []).map(EaUtasClient.mapAuction),
			credits: data.credits ?? 0,
			total: data.auctionInfo?.length ?? 0,
		};
	}

	/**
	 * Returns the user's watch list (`/watchlist`): auctions currently being
	 * followed, with the total count and live credit balance.
	 */
	public async getWatchList(): Promise<UtTradeItemsResult> {
		const data = await this.authedGet("/watchlist");
		return {
			items: (data.auctionInfo ?? []).map(EaUtasClient.mapAuction),
			credits: data.credits ?? 0,
			total: data.total ?? data.auctionInfo?.length ?? 0,
		};
	}

	/**
	 * Returns purchased-but-unassigned items (`/purchased/items`): won auctions
	 * and pack pulls waiting to be moved to the club.
	 */
	public async getUnassignedItems(): Promise<UtClubPlayerItem[]> {
		const data = await this.authedGet("/purchased/items");
		return (data.itemData ?? []).map(EaUtasClient.mapClubItem);
	}

	/**
	 * Returns stackable development consumables (`/club/consumables/development`)
	 * such as position modifiers, chemistry styles and contracts.
	 */
	public async getDevelopmentConsumables(): Promise<UtConsumableItem[]> {
		const data = await this.authedGet("/club/consumables/development");
		return (data.itemData ?? []).map((it: any) => ({
			resourceId: it.resourceId,
			count: it.count ?? 0,
			untradeableCount: it.untradeableCount ?? 0,
			discardValue: it.discardValue ?? 0,
			preferredPosition: it.item?.preferredPosition,
			rating: it.item?.rating,
			cardsubtypeid: it.item?.cardsubtypeid,
		}));
	}

	/**
	 * Returns aggregated club statistics (`/club/stats/club`): item counts by
	 * category (players, kits, balls, stadia, …).
	 */
	public async getClubStats(): Promise<UtClubStat[]> {
		const data = await this.authedGet("/club/stats/club");
		return (data.stat ?? []) as UtClubStat[];
	}

	/**
	 * Ingests and inspects club status. Now backed by the real `/tradepile` and
	 * `/watchlist` counts and the aggregated club player total.
	 */
	public async getClubInventoryStats(): Promise<UtClubInventoryStats> {
		const [credits, tradepile, watchlist, clubStats] = await Promise.all([
			this.getUserCredits().catch(() => 0),
			this.getTradePile().catch(() => null),
			this.getWatchList().catch(() => null),
			this.getClubStats().catch(() => [] as UtClubStat[]),
		]);

		const playersStat = clubStats.find((s) => s.type === "players");
		return {
			totalItems: playersStat?.typeValue ?? 0,
			credits: credits || tradepile?.credits || watchlist?.credits || 0,
			tradepileCount: tradepile?.total ?? 0,
			watchlistCount: watchlist?.total ?? 0,
		};
	}

	/**
	 * Fetches one of EA's static item dictionaries (players, teams, nations,
	 * leagues) from the public content CDN. No authentication required.
	 *
	 * These dictionaries are the missing link between EA's numeric ids
	 * (`assetId`, `teamid`, `nation`, `leagueId`, returned by every UTAS call)
	 * and human-readable names, which is why club and market items currently
	 * cannot be joined against the scraped database.
	 *
	 * **The default `baseUrl` is known-stale**: the historical
	 * `fifa21.content.easports.com/…/2027/…` path answers 404, and the web app
	 * now loads these assets from a build-specific content root it resolves at
	 * runtime. Until that root is captured from a live session, pass an explicit
	 * `baseUrl`; calling this without one will throw rather than return
	 * anything.
	 */
	public async fetchPublicCdnDictionary(
		dictionaryType: "players" | "teams" | "nations" | "leagues",
		buildGuid: string = "FFA27PCC",
		baseUrl?: string,
	): Promise<any> {
		const url = baseUrl
			? `${baseUrl.replace(/\/$/, "")}/${dictionaryType}.json`
			: `https://fifa21.content.easports.com/fifa/fltOnlineAssets/${buildGuid}/2027/fut/items/web/${dictionaryType}.json`;
		const res = await this.client.fetch(url);
		if (res.status !== 200) {
			throw new Error(
				`Failed to fetch EA CDN ${dictionaryType}.json: HTTP ${res.status} (${url}). ` +
					"The default CDN path is stale; pass an explicit baseUrl taken from a live web app session.",
			);
		}
		return await res.json();
	}

	/**
	 * Paginates through club players from UTAS
	 */
	public async getClubPlayers(
		offset: number = 0,
		count: number = 50,
	): Promise<UtClubPlayerItem[]> {
		const data = await this.authedGet(
			`/club?count=${count}&offset=${offset}&type=player`,
		);
		return (data.itemData ?? []).map(EaUtasClient.mapClubItem);
	}

	// -------------------------------------------------------------------------
	// Account / profile
	// -------------------------------------------------------------------------

	/**
	 * Returns the user profile and pile limits (`/usermassinfo`): persona, club
	 * name, credits, FC points, division, trade/watch/unassigned pile limits.
	 */
	public async getUserMassInfo(): Promise<UtUserMassInfo> {
		const data = await this.authedGet("/usermassinfo");
		const u = data.userInfo ?? {};
		const limits = (u.pileSizeClientData?.entries ?? []) as Array<{
			key: number;
			value: number;
		}>;
		const limit = (key: number, fallback: number) =>
			limits.find((e) => e.key === key)?.value ?? fallback;
		return {
			userInfo: {
				personaId: u.personaId ?? 0,
				personaName: u.personaName ?? "",
				clubName: u.clubName ?? "",
				clubAbbr: u.clubAbbr ?? "",
				credits: u.credits ?? 0,
				points: u.currencies?.find((c: any) => c.name === "POINTS")?.funds ?? 0,
				established: u.established ?? 0,
				division: u.divisionOffline ?? u.division ?? 0,
			},
			deckLimits: {
				// pileSizeClientData keys observed in the web app: 2=trade, 4=unassigned, 6=watch
				tradePileLimit: limit(2, u.trade?.size ?? 30),
				watchListLimit: limit(6, u.watchlist?.size ?? 50),
				unassignedPileLimit: limit(4, u.unassigned?.size ?? 100),
			},
			unassignedPileSize: u.unassignedPileSize ?? data.pileSizeClientData?.unassigned ?? 0,
			currencies: (u.currencies ?? []).map((c: any) => ({
				name: c.name,
				funds: c.funds ?? 0,
				finalFunds: c.finalFunds ?? c.funds ?? 0,
			})),
		};
	}

	/** Returns the stadium configuration (`/stadium`). */
	public async getStadium(): Promise<any> {
		return this.authedGet("/stadium");
	}

	/** Returns the active squad (`/squad/active`). */
	public async getActiveSquad(): Promise<any> {
		return this.authedGet("/squad/active");
	}

	/** Returns the list of squads (`/squad/list`). */
	public async getSquadList(): Promise<any> {
		return this.authedGet("/squad/list");
	}

	/**
	 * Returns EA's own price-range data for a definition id
	 * (`/marketdata/item/pricelimits?itemIdList=…`).
	 */
	public async getPriceLimits(itemIds: number[]): Promise<UtPriceLimits> {
		const data = await this.authedGet(
			`/marketdata/item/pricelimits?itemIdList=${itemIds.join(",")}`,
		);
		const bands: UtPriceBand[] = (data.marketData ?? data ?? [])
			.filter((e: any) => e && typeof e.defId === "number")
			.map((e: any) => ({
				defId: e.defId,
				itemId: e.itemId,
				minPrice: e.minPrice ?? e.priceLimits?.minPrice ?? 0,
				maxPrice: e.maxPrice ?? e.priceLimits?.maxPrice ?? 0,
			}));
		const byDefId: Record<number, UtPriceBand> = {};
		for (const band of bands) byDefId[band.defId] = band;
		return { bands, byDefId, raw: data };
	}

	/**
	 * Returns EA's official team-link table (`/chemistry/teamlinks`): the extra
	 * club/league/nation links that Icons, Heroes and linked clubs contribute.
	 *
	 * This is static reference data the web app loads at boot. Without it a
	 * chemistry calculation has to assume every player links only through its
	 * own club/league/nation, which understates Icon and Hero squads.
	 */
	public async getChemistryTeamLinks(): Promise<UtChemistryTeamLinks> {
		const data = await this.authedGet("/chemistry/teamlinks");
		return {
			links: (data.teamLinks ?? data.links ?? []) as UtTeamLink[],
			raw: data,
		};
	}

	/**
	 * Returns EA's chemistry profiles (`/chemistry/profiles`): the per-slot
	 * threshold rules that decide how many club/league/nation team-mates are
	 * needed for 1, 2 and 3 chemistry points.
	 *
	 * Prefer these live values over hard-coded thresholds: EA retunes them
	 * between titles and events.
	 */
	public async getChemistryProfiles(): Promise<UtChemistryProfiles> {
		const data = await this.authedGet("/chemistry/profiles");
		return {
			profiles: (data.profiles ?? data.chemistryProfiles ?? []) as UtChemistryProfile[],
			raw: data,
		};
	}

	// -------------------------------------------------------------------------
	// Trading actions (write)
	// -------------------------------------------------------------------------

	/**
	 * Places a bid on (or buys now) an auction:
	 * `PUT /trade/<tradeId>/bid {bid}`. Use the auction's `buyNowPrice` as the
	 * bid to buy now.
	 */
	public async bid(tradeId: number, bidAmount: number): Promise<UtBidResult> {
		const data = await this.authedRequest<any>("PUT", `/trade/${tradeId}/bid`, {
			bid: bidAmount,
		});
		const auction = data.auctionInfo?.[0] ?? {};
		return {
			tradeId,
			bidAmount,
			success: auction.bidState === "highest" || auction.tradeState === "closed",
			currentBid: auction.currentBid ?? bidAmount,
			tradeState: auction.tradeState ?? "unknown",
			creditsRemaining: data.credits ?? 0,
		};
	}

	/**
	 * Buy Now helper: places a bid matching the item's Buy Now price.
	 */
	public async buyNow(tradeId: number, buyNowPrice: number): Promise<UtBidResult> {
		return this.bid(tradeId, buyNowPrice);
	}

	/**
	 * Lists an item on the transfer market:
	 * `POST /auctionhouse {itemData:{id}, startingBid, buyNowPrice, duration}`.
	 * Duration is one of 3600, 10800, 21600, 43200, 86400, 259200 seconds.
	 */
	public async listAuction(params: UtListAuctionParams): Promise<UtListAuctionResult> {
		const data = await this.authedRequest<any>("POST", "/auctionhouse", {
			itemData: { id: params.itemId },
			startingBid: params.startingBid,
			buyNowPrice: params.buyNowPrice,
			duration: params.durationSeconds ?? 3600,
		});
		return { id: data.id ?? 0, success: Boolean(data.id) };
	}

	/**
	 * Alias for listAuction.
	 */
	public async listOnMarket(params: UtListAuctionParams): Promise<UtListAuctionResult> {
		return this.listAuction(params);
	}

	/**
	 * Moves items between piles: `PUT /item {itemData:[{id, pile}]}`.
	 * `pile` is `club` or `trade` (from the unassigned/trade piles).
	 */
	public async moveItems(
		itemIds: number[],
		pile: UtItemPileTarget,
	): Promise<UtItemMoveResult[]> {
		const data = await this.authedRequest<any>("PUT", "/item", {
			itemData: itemIds.map((id) => ({ id, pile })),
		});
		const results = (data.itemData ?? []) as Array<{ id: number; success: boolean }>;
		return itemIds.map((id) => ({
			itemId: id,
			pile,
			success: results.find((r) => r.id === id)?.success ?? false,
		}));
	}

	/**
	 * Moves a single item to the club.
	 */
	public async sendToClub(itemId: number): Promise<UtItemMoveResult> {
		const res = await this.moveItems([itemId], "club");
		return res[0] ?? { itemId, pile: "club", success: false };
	}

	/**
	 * Moves a single item to the transfer pile.
	 */
	public async sendToTradepile(itemId: number): Promise<UtItemMoveResult> {
		const res = await this.moveItems([itemId], "trade");
		return res[0] ?? { itemId, pile: "trade", success: false };
	}

	/** Quick-sells items for their discard value: `DELETE /item?itemIds=…`. */
	public async quickSell(itemIds: number[]): Promise<UtQuickSellResult> {
		const data = await this.authedRequest<any>(
			"DELETE",
			`/item?itemIds=${itemIds.join(",")}`,
		);
		return {
			totalCredits: data.totalCredits ?? 0,
			itemIds: (data.items ?? []).map((i: any) => i.id ?? i),
		};
	}

	/** Quick-sells a single item. */
	public async quickSellItem(itemId: number): Promise<UtQuickSellResult> {
		return this.quickSell([itemId]);
	}

	/** Removes a sold / expired trade from the trade pile: `DELETE /trade/<id>`. */
	public async removeFromTradePile(tradeId: number): Promise<void> {
		await this.authedRequest("DELETE", `/trade/${tradeId}`);
	}

	/** Re-lists all expired trade-pile items at their previous prices: `PUT /auctionhouse/relist`. */
	public async relistAll(): Promise<{ tradeIdList: number[] }> {
		const data = await this.authedRequest<any>("PUT", "/auctionhouse/relist");
		return { tradeIdList: (data.tradeIdList ?? []).map((t: any) => t.id ?? t) };
	}

	/** Adds auctions to the watch list: `PUT /watchlist {auctionInfo:[{id}]}`. */
	public async watch(tradeIds: number[]): Promise<void> {
		await this.authedRequest("PUT", "/watchlist", {
			auctionInfo: tradeIds.map((id) => ({ id })),
		});
	}

	/** Removes auctions from the watch list: `DELETE /watchlist?tradeId=…`. */
	public async unwatch(tradeIds: number[]): Promise<void> {
		await this.authedRequest("DELETE", `/watchlist?tradeId=${tradeIds.join(",")}`);
	}

	/**
	 * Fetches full club by paginating until empty
	 */
	public async getClubAllPlayers(maxCount: number = 2000): Promise<UtClubPlayerItem[]> {
		const allPlayers: UtClubPlayerItem[] = [];
		let offset = 0;
		const pageSize = 90;

		while (offset < maxCount) {
			const batch = await this.getClubPlayers(offset, pageSize);
			if (batch.length === 0) break;
			allPlayers.push(...batch);
			if (batch.length < pageSize) break;
			offset += pageSize;
		}

		return allPlayers;
	}
}
