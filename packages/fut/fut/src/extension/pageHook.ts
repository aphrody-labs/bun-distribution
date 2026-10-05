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

import type {
	UtasEventType,
	WebappAgentCommand,
} from "./types.ts";

/**
 * Classifies an intercepted UTAS / EA endpoint URL into a typed category.
 */
export function classifyUtasEndpoint(url: string, method: string): UtasEventType {
	const lower = url.toLowerCase();
	if (lower.includes("/user/accountinfo") || lower.includes("/usermassinfo") || lower.includes("/auth")) {
		return "USER_INFO";
	}
	if (lower.includes("/transfermarket")) {
		return "MARKET_SEARCH";
	}
	if (lower.includes("/trade/") && lower.includes("/bid") && method === "PUT") {
		return "ITEM_BID";
	}
	if (lower.includes("/auctionhouse") && method === "POST") {
		return "ITEM_LIST";
	}
	if (lower.includes("/club/stats") || lower.includes("/club/player") || lower.includes("/club")) {
		return "CLUB_ITEMS";
	}
	if (lower.includes("/sbc/sets") || lower.includes("/sbc/categories")) {
		return "SBC_SETS";
	}
	if (lower.includes("/sbc/challenge") && method === "POST") {
		return "SBC_SUBMIT";
	}
	if (lower.includes("/store/purchase") || lower.includes("/store/openpack")) {
		return "PACK_OPEN";
	}
	if (lower.includes("/store")) {
		return "STORE_PACKS";
	}
	if (lower.includes("/purchased/items")) {
		return "UNASSIGNED_ITEMS";
	}
	if (lower.includes("/objectives")) {
		return "OBJECTIVES";
	}
	return "GENERIC_UTAS";
}

/**
 * Generates the JavaScript source code for the "world: MAIN" injection.
 * Monkey-patches fetch and XHR, hooks EA window.services, and listens for remote agent commands.
 */
export function generatePageHookScript(): string {
	return `
(function() {
	if (window.__BXC_HOOK_INITIALIZED__) return;
	window.__BXC_HOOK_INITIALIZED__ = true;

	console.log("%c[BXC FUT]%c Main World Hook Injected & Active", "color: #38bdf8; font-weight: bold;", "color: inherit;");

	function classifyEndpoint(url, method) {
		var u = url.toLowerCase();
		if (u.includes("/user/accountinfo") || u.includes("/usermassinfo") || u.includes("/auth")) return "USER_INFO";
		if (u.includes("/transfermarket")) return "MARKET_SEARCH";
		if (u.includes("/trade/") && u.includes("/bid") && method === "PUT") return "ITEM_BID";
		if (u.includes("/auctionhouse") && method === "POST") return "ITEM_LIST";
		if (u.includes("/club/stats") || u.includes("/club/player") || u.includes("/club")) return "CLUB_ITEMS";
		if (u.includes("/sbc/sets") || u.includes("/sbc/categories")) return "SBC_SETS";
		if (u.includes("/sbc/challenge") && method === "POST") return "SBC_SUBMIT";
		if (u.includes("/store/purchase") || u.includes("/store/openpack")) return "PACK_OPEN";
		if (u.includes("/store")) return "STORE_PACKS";
		if (u.includes("/purchased/items")) return "UNASSIGNED_ITEMS";
		if (u.includes("/objectives")) return "OBJECTIVES";
		return "GENERIC_UTAS";
	}

	function emitUtasEvent(detail) {
		try {
			window.dispatchEvent(new CustomEvent("__BXC_UTAS_EVENT__", { detail: detail }));
		} catch (err) {
			console.error("[BXC FUT] Error dispatching UTAS event:", err);
		}
	}

	// Live session capture. The web app sends the UTAS session id as the
	// X-UT-SID header (a 36-char UUID) on every gameplay call; we surface it to
	// BXC so the CLI / API / MCP can act with the same session.
	var __bxcSession = { sid: null, phishingToken: null, personaId: null, personaName: null, nucleusId: null, gameSku: null, utasHost: null };
	var __bxcLastEmittedSid = null;

	function readServicesSession() {
		try {
			var services = window.services;
			var auth = services && services.Authentication;
			var ut = auth && typeof auth.getUtasSession === "function" ? auth.getUtasSession() : null;
			if (ut && ut.id) {
				__bxcSession.sid = String(ut.id);
				if (ut.protocol && ut.hostname) __bxcSession.utasHost = ut.protocol + "://" + ut.hostname;
				var user = ut.user || {};
				if (user.personaId) __bxcSession.personaId = String(user.personaId);
				if (user.personaName) __bxcSession.personaName = String(user.personaName);
				if (user.nucleusId || user.userId) __bxcSession.nucleusId = String(user.nucleusId || user.userId);
				if (user.gameSku || user.sku) __bxcSession.gameSku = String(user.gameSku || user.sku);
			}
			if (auth && typeof auth.getPhishingToken === "function") {
				var pt = auth.getPhishingToken();
				if (pt) __bxcSession.phishingToken = String(pt);
			}
			var u = services && services.User && typeof services.User.getUser === "function" ? services.User.getUser() : null;
			if (u && u.personaName && !__bxcSession.personaName) __bxcSession.personaName = String(u.personaName);
			if (u && u.personaId && !__bxcSession.personaId) __bxcSession.personaId = String(u.personaId);
		} catch (_) {}
		return __bxcSession;
	}

	function emitSession(source) {
		if (!__bxcSession.sid) return;
		if (__bxcSession.sid === __bxcLastEmittedSid && source !== "SERVICES") return;
		__bxcLastEmittedSid = __bxcSession.sid;
		try {
			window.dispatchEvent(new CustomEvent("__BXC_UTAS_SESSION__", {
				detail: {
					sid: __bxcSession.sid,
					phishingToken: __bxcSession.phishingToken || undefined,
					personaId: __bxcSession.personaId || undefined,
					personaName: __bxcSession.personaName || undefined,
					nucleusId: __bxcSession.nucleusId || undefined,
					gameSku: __bxcSession.gameSku || undefined,
					utasHost: __bxcSession.utasHost || undefined,
					capturedAt: Date.now(),
					source: source
				}
			}));
		} catch (err) {
			console.error("[BXC FUT] Error dispatching UTAS session:", err);
		}
	}

	function observeAuthResponse(url, body) {
		if (!body || typeof body !== "object") return;
		if (url.indexOf("/ut/auth") === -1) return;
		if (body.sid) __bxcSession.sid = String(body.sid);
		if (body.phishingToken) __bxcSession.phishingToken = String(body.phishingToken);
		if (body.persona && body.persona.id) __bxcSession.personaId = String(body.persona.id);
		if (body.persona && body.persona.name) __bxcSession.personaName = String(body.persona.name);
		if (body.nucleusId) __bxcSession.nucleusId = String(body.nucleusId);
		try { __bxcSession.utasHost = new URL(url).origin; } catch (_) {}
		readServicesSession();
		emitSession("AUTH_RESPONSE");
	}

	// Capture the session headers the app sets on its own XHRs.
	var originalXhrSetHeader = XMLHttpRequest.prototype.setRequestHeader;
	XMLHttpRequest.prototype.setRequestHeader = function(name, value) {
		try {
			if (!this.__bxc_headers) this.__bxc_headers = {};
			this.__bxc_headers[name] = String(value);
			var lower = String(name).toLowerCase();
			if (lower === "x-ut-sid" && value && String(value).length >= 32) {
				var changed = __bxcSession.sid !== String(value);
				__bxcSession.sid = String(value);
				if (this.__bxc_url) { try { __bxcSession.utasHost = new URL(this.__bxc_url).origin; } catch (_) {} }
				if (changed) { readServicesSession(); emitSession("HEADER"); }
			} else if (lower === "x-ut-phishing-token" && value) {
				__bxcSession.phishingToken = String(value);
			}
		} catch (_) {}
		return originalXhrSetHeader.apply(this, arguments);
	};

	// 1. Monkey-patch window.fetch
	var originalFetch = window.fetch;
	window.fetch = async function(...args) {
		var input = args[0];
		var init = args[1] || {};
		var url = typeof input === "string" ? input : (input && input.url ? input.url : "");
		var method = (init.method || (input && input.method) || "GET").toUpperCase();

		var isUtas = url.includes("utas.") || url.includes("/ut/game/") || url.includes("services.ea.com");

		var response = await originalFetch.apply(this, args);

		if (isUtas) {
			var clone = response.clone();
			clone.text().then(function(text) {
				var jsonBody = null;
				try {
					jsonBody = JSON.parse(text);
				} catch (_) {
					jsonBody = text;
				}
				observeAuthResponse(url, jsonBody);

				emitUtasEvent({
					id: "evt_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
					type: classifyEndpoint(url, method),
					url: url,
					method: method,
					requestHeaders: init.headers || {},
					requestBody: init.body,
					responseStatus: response.status,
					responseBody: jsonBody,
					timestamp: Date.now()
				});
			}).catch(function(e) {
				console.warn("[BXC FUT] Failed reading UTAS response body", e);
			});
		}

		return response;
	};

	// 2. Monkey-patch window.XMLHttpRequest
	var originalXhrOpen = XMLHttpRequest.prototype.open;
	var originalXhrSend = XMLHttpRequest.prototype.send;

	XMLHttpRequest.prototype.open = function(method, url, async, user, pass) {
		this.__bxc_url = typeof url === "string" ? url : String(url);
		this.__bxc_method = (method || "GET").toUpperCase();
		this.__bxc_isUtas = this.__bxc_url.includes("utas.") || this.__bxc_url.includes("/ut/game/") || this.__bxc_url.includes("services.ea.com");
		return originalXhrOpen.apply(this, arguments);
	};

	XMLHttpRequest.prototype.send = function(body) {
		var self = this;
		if (this.__bxc_isUtas) {
			this.__bxc_reqBody = body;
			this.addEventListener("load", function() {
				var jsonBody = null;
				try {
					jsonBody = JSON.parse(self.responseText);
				} catch (_) {
					jsonBody = self.responseText;
				}
				observeAuthResponse(self.__bxc_url, jsonBody);

				emitUtasEvent({
					id: "evt_" + Date.now() + "_" + Math.random().toString(36).substring(2, 7),
					type: classifyEndpoint(self.__bxc_url, self.__bxc_method),
					url: self.__bxc_url,
					method: self.__bxc_method,
					requestHeaders: self.__bxc_headers || {},
					requestBody: self.__bxc_reqBody,
					responseStatus: self.status,
					responseBody: jsonBody,
					timestamp: Date.now()
				});
			});
		}
		return originalXhrSend.apply(this, arguments);
	};

	// 3. Remote Agent Command Dispatcher (window.services.* hooks)
	window.addEventListener("__BXC_WEBAPP_COMMAND__", async function(event) {
		var command = event.detail;
		if (!command || !command.commandId) return;

		var cmdId = command.commandId;
		var action = command.action;
		var payload = command.payload || {};

		function sendReply(success, data, error) {
			window.dispatchEvent(new CustomEvent("__BXC_WEBAPP_RESPONSE__", {
				detail: {
					commandId: cmdId,
					success: success,
					data: data,
					error: error,
					timestamp: Date.now()
				}
			}));
		}

		try {
			var services = window.services;
			if (action === "GET_SESSION") {
				var s = readServicesSession();
				if (!s.sid) throw new Error("No UTAS session yet: log into the web app first.");
				emitSession("SERVICES");
				sendReply(true, {
					sid: s.sid,
					phishingToken: s.phishingToken || undefined,
					personaId: s.personaId || undefined,
					personaName: s.personaName || undefined,
					nucleusId: s.nucleusId || undefined,
					gameSku: s.gameSku || undefined,
					utasHost: s.utasHost || undefined,
					capturedAt: Date.now(),
					source: "SERVICES"
				});
				return;
			}

			if (action === "GET_ACTIVE_VIEW") {
				var user = (services && services.User && services.User.getUser()) || {};
				var currencies = (user && user.coins) ? { coins: user.coins.amount, points: user.points.amount } : {};
				sendReply(true, {
					url: window.location.href,
					personaName: user.personaName || "Anonymous",
					currencies: currencies,
					title: document.title,
					hasServices: !!services
				});
				return;
			}

			if (action === "BUY_NOW") {
				var tradeId = payload.tradeId;
				var buyNowPrice = payload.buyNowPrice;
				if (!services || !services.Item) {
					throw new Error("window.services.Item is not initialized on this view.");
				}
				// Call EA internal item service
				var promise = services.Item.bid(tradeId, buyNowPrice);
				if (promise && typeof promise.observe === "function") {
					promise.observe(this, function(sender, response) {
						if (response.success) {
							sendReply(true, { tradeId: tradeId, price: buyNowPrice, purchased: true });
						} else {
							sendReply(false, null, response.status || "BID_FAILED");
						}
					});
				} else {
					sendReply(true, { tradeId: tradeId, price: buyNowPrice, executed: true });
				}
				return;
			}

			if (action === "BID_ITEM") {
				var tradeId = payload.tradeId;
				var bidAmount = payload.bidAmount;
				if (!services || !services.Item) throw new Error("window.services.Item not available");
				services.Item.bid(tradeId, bidAmount);
				sendReply(true, { tradeId: tradeId, bidAmount: bidAmount });
				return;
			}

			if (action === "SEARCH_MARKET") {
				if (!services || !services.TransferMarket) throw new Error("window.services.TransferMarket not available");
				var criteria = payload.criteria || {};
				// Trigger market search via EA service
				var searchReq = services.TransferMarket.search(criteria);
				sendReply(true, { initiated: true, criteria: criteria });
				return;
			}

			if (action === "EXECUTE_SCRIPT") {
				var code = payload.code;
				var result = eval(code);
				sendReply(true, { result: result });
				return;
			}

			sendReply(false, null, "Unknown or unsupported command action: " + action);
		} catch (err) {
			sendReply(false, null, err.message || String(err));
		}
	});

	console.log("[BXC FUT] Hook and Command Bridge successfully bound to window");
})();
	`.trim();
}
