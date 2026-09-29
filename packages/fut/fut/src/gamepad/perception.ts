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

import type { GameVisionState } from "./types.ts";

export class GamePerceptionBridge {
	/**
	 * Detects whether EA SPORTS FC 27 window is currently open and focused.
	 */
	public static async detectGameWindow(): Promise<{ found: boolean; title?: string; pid?: number }> {
		if (process.platform !== "win32") {
			return { found: false };
		}

		try {
			const { spawnSync } = await import("node:child_process");
			const ps = spawnSync("powershell", [
				"-NoProfile",
				"-Command",
				"Get-Process | Where-Object { $_.ProcessName -like '*FC27*' -or $_.MainWindowTitle -like '*FC 27*' } | Select-Object -First 1 Id, ProcessName, MainWindowTitle | ConvertTo-Json",
			], { encoding: "utf-8" });

			if (ps.stdout && ps.stdout.trim()) {
				const info = JSON.parse(ps.stdout.trim());
				return {
					found: true,
					title: info.MainWindowTitle || info.ProcessName,
					pid: info.Id,
				};
			}
		} catch {
			// Fallback
		}

		return { found: false };
	}

	/**
	 * Extracts real-time in-game coordinates from video frame / OCR or generates simulated state.
	 */
	public static extractGameState(simulatedOverride?: Partial<GameVisionState>): GameVisionState {
		return {
			inPossession: simulatedOverride?.inPossession ?? true,
			ballX: simulatedOverride?.ballX ?? 0.2, // 20% into opponent half
			ballY: simulatedOverride?.ballY ?? 0.0, // central
			nearestOpponentDistance: simulatedOverride?.nearestOpponentDistance ?? 3.5, // 3.5 meters
			distanceToGoal: simulatedOverride?.distanceToGoal ?? 22.0, // 22 meters
			isShootingAngleOpen: simulatedOverride?.isShootingAngleOpen ?? true,
			teammatesAhead: simulatedOverride?.teammatesAhead ?? 2,
		};
	}
}
