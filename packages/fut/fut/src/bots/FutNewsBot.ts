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

import { FutCoreService } from "../services/FutCoreService.ts";
import { DiscordEmbedBuilder, type DiscordEmbedPayload } from "./DiscordEmbedBuilder.ts";
import { XPostBuilder } from "./XPostBuilder.ts";
import type { OmniUrlResult } from "../router/types.ts";

export interface FutNewsBotConfig {
	discordWebhookUrl?: string;
	xPostHandler?: (postText: string) => Promise<void>;
}

export class FutNewsBot {
	private core: FutCoreService;
	private config: FutNewsBotConfig;

	constructor(config: FutNewsBotConfig = {}) {
		this.core = new FutCoreService();
		this.config = config;
	}

	public close(): void {
		this.core.close();
	}

	/**
	 * Formats an OmniUrlResult into both Discord Webhook and X post payloads.
	 */
	public formatAlert(omni: OmniUrlResult): {
		discordPayload: DiscordEmbedPayload;
		xPostText: string;
	} {
		return {
			discordPayload: DiscordEmbedBuilder.buildFromOmniResult(omni),
			xPostText: XPostBuilder.buildFromOmniResult(omni),
		};
	}

	/**
	 * Broadcasts an alert to configured Discord Webhook and X account.
	 */
	public async broadcastAlert(omni: OmniUrlResult): Promise<{ sentToDiscord: boolean; sentToX: boolean }> {
		const { discordPayload, xPostText } = this.formatAlert(omni);
		let sentToDiscord = false;
		let sentToX = false;

		if (this.config.discordWebhookUrl) {
			try {
				const res = await fetch(this.config.discordWebhookUrl, {
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(discordPayload),
				});
				sentToDiscord = res.status >= 200 && res.status < 300;
			} catch {
				sentToDiscord = false;
			}
		}

		if (this.config.xPostHandler) {
			try {
				await this.config.xPostHandler(xPostText);
				sentToX = true;
			} catch {
				sentToX = false;
			}
		}

		return { sentToDiscord, sentToX };
	}
}
