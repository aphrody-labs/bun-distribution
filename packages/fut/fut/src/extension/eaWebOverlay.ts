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

export interface CardOverlayData {
	playerId: string;
	playerName: string;
	rating: number;
	livePriceConsole: number;
	livePricePc: number;
	metaRating: number;
	verdict: "HOLD" | "SELL" | "SNIPE" | "FAIR";
}

/**
 * Generates DOM injection markup for player cards on the EA Sports FC Web App.
 */
export function renderCardOverlayBadge(card: CardOverlayData): string {
	const badgeColor =
		card.verdict === "HOLD"
			? "#eab308" // yellow/gold
			: card.verdict === "SNIPE"
				? "#22c55e" // green
				: card.verdict === "SELL"
					? "#ef4444" // red
					: "#6b7280"; // neutral

	return `
		<div class="bxc-fut-card-badge" style="
			position: absolute;
			bottom: 4px;
			left: 4px;
			right: 4px;
			background: rgba(15, 23, 42, 0.92);
			border: 1px solid ${badgeColor};
			border-radius: 6px;
			padding: 4px 6px;
			font-family: system-ui, sans-serif;
			font-size: 11px;
			color: #f8fafc;
			display: flex;
			justify-content: space-between;
			align-items: center;
			box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.5);
			z-index: 100;
		">
			<div style="display: flex; flex-direction: column;">
				<span style="font-weight: 700; color: #38bdf8;">PS: ${card.livePriceConsole.toLocaleString("en-US")} 🪙</span>
				<span style="color: #cbd5e1; font-size: 9px;">PC: ${card.livePricePc.toLocaleString("en-US")} 🪙</span>
			</div>
			<div style="text-align: right;">
				<span style="
					background: ${badgeColor};
					color: #000;
					font-weight: 800;
					font-size: 9px;
					padding: 1px 4px;
					border-radius: 3px;
				">${card.verdict}</span>
				<div style="font-size: 9px; color: #94a3b8;">Méta: ${card.metaRating.toFixed(1)}</div>
			</div>
		</div>
	`;
}

/**
 * Content script bootstrap generator: listens to DOM mutations on the EA Web App transfer market
 * and injects real-time overlay badges asynchronously.
 */
export function buildContentScriptBundle(): string {
	return `
		(function() {
			console.log("[BXC FUT] EA Web App Intelligence Overlay Active");

			const observer = new MutationObserver((mutations) => {
				for (const mutation of mutations) {
					for (const node of mutation.addedNodes) {
						if (node.nodeType === 1 && node.classList && (node.classList.contains("ut-item-view") || node.querySelector(".ut-item-view"))) {
							decorateItemView(node);
						}
					}
				}
			});

			observer.observe(document.body, { childList: true, subtree: true });

			function decorateItemView(itemNode) {
				if (itemNode.dataset.bxcInjected) return;
				itemNode.dataset.bxcInjected = "true";

				const nameNode = itemNode.querySelector(".name");
				const ratingNode = itemNode.querySelector(".rating");
				if (!nameNode || !ratingNode) return;

				const name = nameNode.textContent.trim();
				const rating = parseInt(ratingNode.textContent.trim(), 10);

				// Connect to local BXC daemon
				fetch("http://localhost:3000/api/fut/player/" + encodeURIComponent(name))
					.then(r => r.json())
					.then(data => {
						if (!data || !data.playerData) return;
						const overlay = document.createElement("div");
						overlay.innerHTML = data.metaReport ? data.metaReport.metaScore : "";
						itemNode.style.position = "relative";
						itemNode.appendChild(overlay);
					})
					.catch(() => {});
			}
		})();
	`;
}
