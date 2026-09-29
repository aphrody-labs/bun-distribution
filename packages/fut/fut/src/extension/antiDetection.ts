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

/**
 * Generates Gaussian-distributed delay using the Box-Muller transform
 * to mimic natural human reaction timing.
 */
export function generateGaussianJitter(
	meanMs = 1500,
	stdDevMs = 350,
	minMs = 800,
	maxMs = 3500,
): number {
	const u1 = Math.max(1e-15, Math.random());
	const u2 = Math.random();
	const z0 = Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
	const sample = meanMs + z0 * stdDevMs;
	return Math.round(Math.min(Math.max(sample, minMs), maxMs));
}

/**
 * Alternates market search min bid parameter to bust EA edge cache
 * without invalidating target search criteria.
 */
export function getAlternatingMinBid(currentMinBid = 150): number {
	return currentMinBid === 150 ? 200 : 150;
}

export interface SoftBanCheckResult {
	isSoftBan: boolean;
	isCaptcha: boolean;
	cooldownSeconds: number;
	reason: string;
}

/**
 * Analyzes UTAS HTTP status codes and payloads to detect rate limits, soft bans, or Arkose FunCaptchas.
 */
export function detectUtasSoftBan(
	statusCode: number,
	responseBody?: unknown,
): SoftBanCheckResult {
	if (statusCode === 429) {
		return {
			isSoftBan: true,
			isCaptcha: false,
			cooldownSeconds: 900, // 15 minutes
			reason: "HTTP 429 Too Many Requests (Temporary Rate Limit)",
		};
	}

	if (typeof responseBody === "object" && responseBody !== null) {
		const b = responseBody as Record<string, unknown>;
		const code = b.code || b.status;

		if (code === 458 || code === 512 || code === "CAPTCHA_REQUIRED") {
			return {
				isSoftBan: true,
				isCaptcha: true,
				cooldownSeconds: 3600, // 1 hour or manual solve
				reason: "Arkose Labs FunCaptcha Verification Triggered (Code 458/512)",
			};
		}

		if (code === "SERVICE_UNAVAILABLE" || code === 503) {
			return {
				isSoftBan: true,
				isCaptcha: false,
				cooldownSeconds: 300, // 5 minutes
				reason: "EA UTAS Service Temporarily Unavailable (503)",
			};
		}
	}

	return {
		isSoftBan: false,
		isCaptcha: false,
		cooldownSeconds: 0,
		reason: "OK",
	};
}

/**
 * Dispatches a complete synthetic human pointer event sequence with randomized offsets.
 */
export async function simulateHumanClick(
	target: {
		getBoundingClientRect?: () => { left: number; top: number; width: number; height: number };
		dispatchEvent?: (event: unknown) => boolean;
	} | null,
): Promise<boolean> {
	if (!target || typeof target.dispatchEvent !== "function") return false;

	const rect = target.getBoundingClientRect
		? target.getBoundingClientRect()
		: { left: 100, top: 100, width: 50, height: 30 };

	const offsetX = Math.floor(rect.width * (0.2 + Math.random() * 0.6));
	const offsetY = Math.floor(rect.height * (0.2 + Math.random() * 0.6));
	const clientX = rect.left + offsetX;
	const clientY = rect.top + offsetY;

	const eventInit = {
		bubbles: true,
		cancelable: true,
		view: typeof window !== "undefined" ? window : undefined,
		clientX,
		clientY,
	};

	if (typeof MouseEvent !== "undefined") {
		target.dispatchEvent(new MouseEvent("mousedown", eventInit));
		target.dispatchEvent(new MouseEvent("mouseup", eventInit));
		target.dispatchEvent(new MouseEvent("click", eventInit));
	} else {
		target.dispatchEvent({ type: "mousedown", ...eventInit });
		target.dispatchEvent({ type: "mouseup", ...eventInit });
		target.dispatchEvent({ type: "click", ...eventInit });
	}

	return true;
}
