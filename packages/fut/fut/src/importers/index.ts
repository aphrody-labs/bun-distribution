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

export * from "./types.ts";
export * from "./playerImporter.ts";
export * from "./sbcImporter.ts";
export * from "./squadImporter.ts";
export * from "./evolutionImporter.ts";
export * from "./fodderImporter.ts";
export * from "./marketListingImporter.ts";

import type { DetectedUrlInfo, OmniUrlResult } from "../router/types.ts";
import type { ImporterOptions } from "./types.ts";
import { PlayerImporter } from "./playerImporter.ts";
import { SbcImporter } from "./sbcImporter.ts";
import { SquadImporter } from "./squadImporter.ts";
import { EvolutionImporter } from "./evolutionImporter.ts";
import { FodderImporter } from "./fodderImporter.ts";
import { MarketListingImporter } from "./marketListingImporter.ts";

export class FutImporterRegistry {
	private static playerImporter = new PlayerImporter();
	private static sbcImporter = new SbcImporter();
	private static squadImporter = new SquadImporter();
	private static evolutionImporter = new EvolutionImporter();
	private static fodderImporter = new FodderImporter();
	private static marketListingImporter = new MarketListingImporter();

	public static async dispatch(
		url: string,
		detected: DetectedUrlInfo,
		options: ImporterOptions = {},
	): Promise<OmniUrlResult> {
		switch (detected.pageType) {
			case "PLAYER": {
				const { result, action } = await this.playerImporter.importAndAnalyze(url, detected, options);
				return {
					url,
					detectedInfo: detected,
					pageType: "PLAYER",
					provider: detected.provider,
					extractedData: result,
					action,
				};
			}

			case "SBC": {
				const { result, action } = await this.sbcImporter.importAndAnalyze(url, detected, options);
				return {
					url,
					detectedInfo: detected,
					pageType: "SBC",
					provider: detected.provider,
					extractedData: result,
					action,
				};
			}

			case "SQUAD": {
				const { result, action } = await this.squadImporter.importAndAnalyze(url, detected, options);
				return {
					url,
					detectedInfo: detected,
					pageType: "SQUAD",
					provider: detected.provider,
					extractedData: result,
					action,
				};
			}

			case "EVOLUTION": {
				const { result, action } = await this.evolutionImporter.importAndAnalyze(url, detected, options);
				return {
					url,
					detectedInfo: detected,
					pageType: "EVOLUTION",
					provider: detected.provider,
					extractedData: result,
					action,
				};
			}

			case "FODDER": {
				const { result, action } = await this.fodderImporter.importAndAnalyze(url, detected, options);
				return {
					url,
					detectedInfo: detected,
					pageType: "FODDER",
					provider: detected.provider,
					extractedData: result,
					action,
				};
			}

			case "MARKET_LISTING": {
				const { result, action } = await this.marketListingImporter.importAndAnalyze(url, detected, options);
				return {
					url,
					detectedInfo: detected,
					pageType: "MARKET_LISTING",
					provider: detected.provider,
					extractedData: result,
					action,
				};
			}

			default: {
				const { result, action } = await this.marketListingImporter.importAndAnalyze(url, detected, options);
				return {
					url,
					detectedInfo: detected,
					pageType: "UNKNOWN",
					provider: detected.provider,
					extractedData: result,
					action,
				};
			}
		}
	}
}
