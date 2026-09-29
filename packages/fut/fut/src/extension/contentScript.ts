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

import type { DomStreamMessage } from "./types.ts";

/**
 * Generates a clean DOM snapshot object for streaming to the BXC backend.
 */
export function captureDomSnapshot(
	documentRef: {
		location?: { href?: string };
		title?: string;
		documentElement?: { outerHTML?: string };
		styleSheets?: ArrayLike<unknown>;
		querySelectorAll?: (selector: string) => ArrayLike<unknown>;
	} = typeof document !== "undefined" ? document : {},
): DomStreamMessage {
	const url = (documentRef.location && documentRef.location.href) || "";
	const title = documentRef.title || "";
	const html = (documentRef.documentElement && documentRef.documentElement.outerHTML) || "";
	const cssRulesCount = (documentRef.styleSheets && documentRef.styleSheets.length) || 0;
	const domNodeCount = (documentRef.querySelectorAll && documentRef.querySelectorAll("*").length) || 0;

	let activeScreen = "UNKNOWN";
	if (url.includes("/club")) activeScreen = "CLUB";
	else if (url.includes("/transfermarket") || url.includes("/transfers")) activeScreen = "TRANSFERS";
	else if (url.includes("/sbc")) activeScreen = "SBC";
	else if (url.includes("/store")) activeScreen = "STORE";
	else if (url.includes("/stadium")) activeScreen = "STADIUM";
	else if (url.includes("/objectives")) activeScreen = "OBJECTIVES";

	return {
		url,
		title,
		html,
		cssRulesCount,
		domNodeCount,
		timestamp: Date.now(),
		activeScreen,
	};
}

/**
 * Generates the source code for the isolated world Content Script.
 */
export function generateContentScriptSource(): string {
	return `
(function() {
	console.log("%c[BXC FUT]%c Content Script (Isolated World) Initialized", "color: #10b981; font-weight: bold;", "color: inherit;");

	// Relay intercepted UTAS events from Main World to Background Service Worker
	window.addEventListener("__BXC_UTAS_EVENT__", function(e) {
		if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
			chrome.runtime.sendMessage({
				type: "UTAS_EVENT",
				payload: e.detail
			});
		}
	});

	// Relay the captured UTAS session (X-UT-SID …) to the Background Service Worker
	window.addEventListener("__BXC_UTAS_SESSION__", function(e) {
		if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
			chrome.runtime.sendMessage({
				type: "UTAS_SESSION",
				payload: e.detail
			});
		}
	});

	// Relay agent responses from Main World to Background Service Worker
	window.addEventListener("__BXC_WEBAPP_RESPONSE__", function(e) {
		if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
			chrome.runtime.sendMessage({
				type: "AGENT_RESPONSE",
				payload: e.detail
			});
		}
	});

	// Listen for commands forwarded from Background Service Worker
	if (chrome && chrome.runtime && chrome.runtime.onMessage) {
		chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
			if (message && message.type === "EXECUTE_AGENT_COMMAND") {
				window.dispatchEvent(new CustomEvent("__BXC_WEBAPP_COMMAND__", {
					detail: message.command
				}));
				sendResponse({ status: "DISPATCHED_TO_MAIN_WORLD" });
			} else if (message && message.type === "REQUEST_DOM_SNAPSHOT") {
				sendDomSnapshot();
				sendResponse({ status: "SNAPSHOT_SENT" });
			}
		});
	}

	function sendDomSnapshot() {
		try {
			var url = window.location.href;
			var title = document.title;
			var html = document.documentElement ? document.documentElement.outerHTML : "";
			var cssCount = document.styleSheets ? document.styleSheets.length : 0;
			var nodeCount = document.querySelectorAll ? document.querySelectorAll("*").length : 0;

			var activeScreen = "UNKNOWN";
			if (url.includes("/club")) activeScreen = "CLUB";
			else if (url.includes("/transfers")) activeScreen = "TRANSFERS";
			else if (url.includes("/sbc")) activeScreen = "SBC";
			else if (url.includes("/store")) activeScreen = "STORE";

			if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
				chrome.runtime.sendMessage({
					type: "DOM_SNAPSHOT",
					payload: {
						url: url,
						title: title,
						html: html,
						cssRulesCount: cssCount,
						domNodeCount: nodeCount,
						timestamp: Date.now(),
						activeScreen: activeScreen
					}
				});
			}
		} catch (err) {
			console.error("[BXC FUT] Failed to capture DOM snapshot", err);
		}
	}

	// Throttle DOM snapshot streaming on significant mutations or navigation
	var lastSnapshotTime = 0;
	function throttledSnapshot() {
		var now = Date.now();
		if (now - lastSnapshotTime > 5000) { // max once every 5 seconds
			lastSnapshotTime = now;
			sendDomSnapshot();
		}
	}

	window.addEventListener("popstate", throttledSnapshot);
	window.addEventListener("hashchange", throttledSnapshot);

	// Periodic heartbeat & initial snapshot once DOM is loaded
	setTimeout(sendDomSnapshot, 3000);
	setInterval(throttledSnapshot, 15000);
})();
	`.trim();
}
