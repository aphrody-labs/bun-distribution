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
	DetectedUrlInfo,
	FodderUrlResult,
	OmniUrlResult,
	RecommendedAction,
	SquadUrlResult,
} from "../router/types.ts";
import type { PlayerCommunitySentiment } from "../social/types.ts";

export interface ImporterOptions {
	livePriceConsole?: number;
	livePricePc?: number;
	budgetCoins?: number;
	communitySentiment?: PlayerCommunitySentiment;
	referenceDate?: Date;
	clubInventoryPath?: string;
}

export interface FutPageImporter<TResult> {
	canHandle(detected: DetectedUrlInfo): boolean;
	importAndAnalyze(
		url: string,
		detected: DetectedUrlInfo,
		options?: ImporterOptions,
	): Promise<{
		result: TResult;
		action: RecommendedAction;
	}>;
}
