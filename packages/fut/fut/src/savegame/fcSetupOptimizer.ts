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

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface FcSetupConfig {
	AUDIO_MIX_MODE?: number;
	CONTROLLER_DEFAULT?: number;
	FULLSCREEN?: number;
	WINDOWED_BORDERLESS?: number;
	RESOLUTIONWIDTH?: number;
	RESOLUTIONHEIGHT?: number;
	REFRESH_RATE?: number;
	WAITFORVSYNC?: number;
	MAX_FRAME_RATE?: number;
	RENDERINGQUALITY?: number;
	STRAND_BASED_HAIR?: number;
	DYNAMIC_RESOLUTION?: number;
	RAYTRACING?: number;
	DIRECT_STORAGE_ENABLED?: number;
	[key: string]: string | number | undefined;
}

export class FcSetupOptimizer {
	public static getDefaultPath(): string {
		const localAppData = process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local");
		return join(localAppData, "EA SPORTS FC 27", "fcsetup.ini");
	}

	/**
	 * Parses an INI configuration string.
	 */
	public static parse(content: string): FcSetupConfig {
		const config: FcSetupConfig = {};
		const lines = content.split(/\r?\n/);

		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith(";")) continue;

			const eqIdx = trimmed.indexOf("=");
			if (eqIdx === -1) continue;

			const key = trimmed.slice(0, eqIdx).trim();
			const valStr = trimmed.slice(eqIdx + 1).trim();

			if (/^-?\d+$/.test(valStr)) {
				config[key] = parseInt(valStr, 10);
			} else {
				config[key] = valStr;
			}
		}

		return config;
	}

	/**
	 * Serializes a configuration object to INI format.
	 */
	public static stringify(config: FcSetupConfig): string {
		const lines: string[] = [];
		for (const [k, v] of Object.entries(config)) {
			if (v !== undefined) {
				lines.push(`${k} = ${v}`);
			}
		}
		return lines.join("\r\n") + "\r\n";
	}

	/**
	 * Generates optimal configuration for hardware profile (e.g. RTX 4070 12GB).
	 */
	public static getOptimalConfig(gpuModel = "RTX 4070"): FcSetupConfig {
		const isHighEnd = gpuModel.includes("4070") || gpuModel.includes("4080") || gpuModel.includes("4090");

		return {
			AUDIO_MIX_MODE: 0,
			CONTROLLER_DEFAULT: 0,
			FULLSCREEN: 1,
			WINDOWED_BORDERLESS: 0,
			RESOLUTIONWIDTH: isHighEnd ? 2560 : 1920,
			RESOLUTIONHEIGHT: isHighEnd ? 1440 : 1080,
			REFRESH_RATE: 144,
			WAITFORVSYNC: 1,
			MAX_FRAME_RATE: 144,
			RENDERINGQUALITY: isHighEnd ? 3 : 2, // 3 = Ultra
			STRAND_BASED_HAIR: isHighEnd ? 1 : 0,
			DYNAMIC_RESOLUTION: 0,
			RAYTRACING: isHighEnd ? 1 : 0,
			DIRECT_STORAGE_ENABLED: 1,
		};
	}

	/**
	 * Reads and parses fcsetup.ini from disk.
	 */
	public static readFromDisk(path = FcSetupOptimizer.getDefaultPath()): FcSetupConfig | null {
		if (!existsSync(path)) return null;
		const content = readFileSync(path, "utf-8");
		return FcSetupOptimizer.parse(content);
	}

	/**
	 * Writes configuration to disk.
	 */
	public static writeToDisk(config: FcSetupConfig, path = FcSetupOptimizer.getDefaultPath()): void {
		const content = FcSetupOptimizer.stringify(config);
		writeFileSync(path, content, "utf-8");
	}
}
