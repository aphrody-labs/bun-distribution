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

export class XPostBuilder {
	public static buildFromOmniResult(omni: OmniUrlResult): string {
		const action = omni.action;
		const emoji =
			action.urgency === "CRITICAL"
				? "🚨"
				: action.verdict.includes("BUY") || action.verdict.includes("CRAFT")
					? "🔥"
					: "📊";

		const headline = action.headline.replace(/^[^\wÀ-ÿ]+/g, "").trim();
		const step = action.concreteSteps[0] || action.summaryFr;

		const text = `${emoji} FLASH FUT ALERTE : ${headline}

${action.summaryFr}

🎯 Action : ${step}
${action.financialImpactCoins ? `💰 Gain potentiel : +${action.financialImpactCoins.toLocaleString()} 🪙` : ""}

#FC27 #FUT #EASportsFC #FUTTrading`;

		return text.trim();
	}
}
