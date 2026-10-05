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

import type { OmniUrlResult } from "../router/types.ts";

export interface DiscordEmbedPayload {
	username: string;
	avatar_url?: string;
	embeds: Array<{
		title: string;
		description: string;
		color: number;
		fields: Array<{ name: string; value: string; inline?: boolean }>;
		footer?: { text: string; icon_url?: string };
		timestamp?: string;
	}>;
}

export class DiscordEmbedBuilder {
	public static buildFromOmniResult(omni: OmniUrlResult): DiscordEmbedPayload {
		const action = omni.action;
		const isCritical = action.urgency === "CRITICAL";
		const isProfitable = action.verdict.includes("BUY") || action.verdict.includes("CRAFT") || action.verdict.includes("TOP");

		const color = isCritical
			? 0xef4444 // Red
			: isProfitable
				? 0x10b981 // Green
				: 0xf59e0b; // Amber

		const fields: Array<{ name: string; value: string; inline?: boolean }> = [
			{
				name: "📌 Verdict",
				value: `\`${action.verdict}\``,
				inline: true,
			},
			{
				name: "⚡ Urgence",
				value: `\`${action.urgency}\``,
				inline: true,
			},
		];

		if (action.financialImpactCoins) {
			fields.push({
				name: "💰 Impact Financier Estimé",
				value: `**${action.financialImpactCoins > 0 ? "+" : ""}${action.financialImpactCoins.toLocaleString()} 🪙**`,
				inline: true,
			});
		}

		if (action.concreteSteps && action.concreteSteps.length > 0) {
			fields.push({
				name: "📋 Actions Concrètes",
				value: action.concreteSteps.map((s) => `• ${s}`).join("\n"),
				inline: false,
			});
		}

		return {
			username: "BXC FUT Alert Bot",
			avatar_url: "https://bxc.aphrody.com/assets/fut-bot-avatar.png",
			embeds: [
				{
					title: action.headline,
					description: `${action.summaryFr}\n\n${action.explanation}`,
					color,
					fields,
					footer: {
						text: `BXC FUT Engine • Source: ${omni.provider} (${omni.pageType})`,
					},
					timestamp: new Date().toISOString(),
				},
			],
		};
	}
}
