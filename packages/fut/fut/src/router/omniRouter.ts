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

import { detectFutUrlType } from "./urlDetector.ts";
import type { OmniUrlResult } from "./types.ts";
import type { PlayerCommunitySentiment } from "../social/types.ts";
import { FutImporterRegistry } from "../importers/index.ts";

export interface OmniRouterOptions {
	livePriceConsole?: number;
	livePricePc?: number;
	budgetCoins?: number;
	communitySentiment?: PlayerCommunitySentiment;
	referenceDate?: Date;
	clubInventoryPath?: string;
}

/**
 * Universal Omni-URL Parser & Analyzer for all FUTBin, FUT.GG and EA pages.
 * Seamlessly delegates to dedicated page importers for tailored data extraction,
 * deep econometric & meta analysis, and actionable trading/gameplay decisions.
 */
export async function handleAnyFutUrl(
	url: string,
	options: OmniRouterOptions = {},
): Promise<OmniUrlResult> {
	const detected = detectFutUrlType(url);
	return FutImporterRegistry.dispatch(url, detected, options);
}
