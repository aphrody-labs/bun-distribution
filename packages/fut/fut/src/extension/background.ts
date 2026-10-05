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

import type { StoredEaCookie } from "./types.ts";

export const DEFAULT_BXC_STREAM_WS_URL = "ws://localhost:3000/fut/stream";

/**
 * Filter sensitive cookies relevant to EA UT authentication and session.
 */
export function filterEaSessionCookies(cookies: StoredEaCookie[]): StoredEaCookie[] {
	const relevantNames = new Set([
		"PLAY_SESSION",
		"ea_auth_sid",
		"EASW_KEY",
		"futweb_nucleus_id",
		"futweb_session",
		"remid",
		"sid",
		"customer_id",
	]);
	return cookies.filter((c) => relevantNames.has(c.name) || c.name.startsWith("EASW") || c.name.startsWith("UT_"));
}

/**
 * Generates the source code for the Manifest V3 Service Worker (background.js).
 */
export function generateBackgroundScriptSource(): string {
	return `
(function() {
	var BXC_WS_URL = "${DEFAULT_BXC_STREAM_WS_URL}";
	var ws = null;
	var isConnecting = false;
	var reconnectTimer = null;
	// Latest UTAS session captured by the page hook (X-UT-SID …), replayed on (re)connect.
	var lastUtasSession = null;

	console.log("[BXC FUT Background] Service Worker initialized.");

	function getWsUrl(callback) {
		if (chrome && chrome.storage && chrome.storage.local) {
			chrome.storage.local.get(["bxc_ws_url"], function(res) {
				callback(res.bxc_ws_url || BXC_WS_URL);
			});
		} else {
			callback(BXC_WS_URL);
		}
	}

	function connectWebSocket() {
		if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
			return;
		}

		getWsUrl(function(targetUrl) {
			isConnecting = true;
			try {
				ws = new WebSocket(targetUrl);

				ws.onopen = function() {
					console.log("[BXC FUT Background] WebSocket connected to BXC VPS:", targetUrl);
					isConnecting = false;
					syncCookies();
					if (lastUtasSession) {
						sendPacket({
							version: "1.0.0",
							type: "UTAS_SESSION",
							sender: "CHROME_EXTENSION",
							timestamp: Date.now(),
							data: { session: lastUtasSession }
						});
					}
				};

				ws.onmessage = function(event) {
					try {
						var packet = JSON.parse(event.data);
						handleIncomingServerPacket(packet);
					} catch (e) {
						console.error("[BXC FUT Background] Invalid JSON from server", e);
					}
				};

				ws.onclose = function() {
					console.warn("[BXC FUT Background] WebSocket disconnected. Retrying in 5s...");
					isConnecting = false;
					scheduleReconnect();
				};

				ws.onerror = function(err) {
					console.error("[BXC FUT Background] WebSocket error:", err);
				};
			} catch (e) {
				console.error("[BXC FUT Background] Failed to initiate WebSocket", e);
				scheduleReconnect();
			}
		});
	}

	function scheduleReconnect() {
		if (reconnectTimer) clearTimeout(reconnectTimer);
		reconnectTimer = setTimeout(connectWebSocket, 5000);
	}

	function sendPacket(packet) {
		if (ws && ws.readyState === WebSocket.OPEN) {
			ws.send(JSON.stringify(packet));
		}
	}

	// Read and extract EA secure cookies
	function syncCookies() {
		if (!chrome || !chrome.cookies) return;

		chrome.cookies.getAll({ domain: "ea.com" }, function(cookies) {
			if (!cookies || !cookies.length) return;

			var simplified = cookies.map(function(c) {
				return {
					name: c.name,
					value: c.value,
					domain: c.domain,
					path: c.path,
					secure: c.secure,
					httpOnly: c.httpOnly,
					expirationDate: c.expirationDate
				};
			});

			sendPacket({
				version: "1.0.0",
				type: "SESSION_SYNC",
				sender: "CHROME_EXTENSION",
				timestamp: Date.now(),
				data: {
					cookies: simplified
				}
			});
			console.log("[BXC FUT Background] Synced " + simplified.length + " EA cookies to VPS.");
		});
	}

	// Handle messages from Content Script
	chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
		if (!message || !message.type) return;

		if (message.type === "UTAS_EVENT") {
			sendPacket({
				version: "1.0.0",
				type: "UTAS_EVENT",
				sender: "CHROME_EXTENSION",
				timestamp: Date.now(),
				data: {
					utasEvent: message.payload
				}
			});
			sendResponse({ received: true });
		} else if (message.type === "UTAS_SESSION") {
			// Keep the latest session so a (re)connecting BXC server gets it immediately.
			lastUtasSession = message.payload;
			sendPacket({
				version: "1.0.0",
				type: "UTAS_SESSION",
				sender: "CHROME_EXTENSION",
				timestamp: Date.now(),
				data: {
					session: message.payload
				}
			});
			sendResponse({ received: true });
		} else if (message.type === "DOM_SNAPSHOT") {
			sendPacket({
				version: "1.0.0",
				type: "DOM_SNAPSHOT",
				sender: "CHROME_EXTENSION",
				timestamp: Date.now(),
				data: {
					domSnapshot: message.payload
				}
			});
			sendResponse({ received: true });
		} else if (message.type === "AGENT_RESPONSE") {
			sendPacket({
				version: "1.0.0",
				type: "AGENT_RESPONSE",
				sender: "CHROME_EXTENSION",
				timestamp: Date.now(),
				data: {
					response: message.payload
				}
			});
			sendResponse({ received: true });
		}
	});

	// Handle incoming packets from BXC VPS / Remote Agent MCP
	function handleIncomingServerPacket(packet) {
		if (!packet || !packet.type) return;

		if (packet.type === "AGENT_COMMAND") {
			var cmd = packet.data && packet.data.command;
			if (!cmd) return;

			// Forward command to the active EA Web App tab
			chrome.tabs.query({ url: "*://www.ea.com/*ea-sports-fc/ultimate-team/web-app/*" }, function(tabs) {
				if (!tabs || !tabs.length) {
					console.warn("[BXC FUT Background] No active EA Web App tab found to execute command.");
					sendPacket({
						version: "1.0.0",
						type: "AGENT_RESPONSE",
						sender: "CHROME_EXTENSION",
						timestamp: Date.now(),
						data: {
							response: {
								commandId: cmd.commandId,
								success: false,
								error: "NO_ACTIVE_WEBAPP_TAB",
								timestamp: Date.now()
							}
						}
					});
					return;
				}

				chrome.tabs.sendMessage(tabs[0].id, {
					type: "EXECUTE_AGENT_COMMAND",
					command: cmd
				});
			});
		} else if (packet.type === "HEARTBEAT") {
			sendPacket({
				version: "1.0.0",
				type: "HEARTBEAT",
				sender: "CHROME_EXTENSION",
				timestamp: Date.now(),
				data: { meta: { status: "ALIVE" } }
			});
		}
	}

	// Start connection
	connectWebSocket();
})();
	`.trim();
}
