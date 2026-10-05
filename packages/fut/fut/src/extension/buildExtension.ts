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

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { generateBackgroundScriptSource } from "./background.ts";
import { generateContentScriptSource } from "./contentScript.ts";
import { generatePageHookScript } from "./pageHook.ts";

export interface BuildExtensionOptions {
	outputDir?: string;
	vpsWsUrl?: string;
}

/**
 * Builds the standalone unpacked Chrome Extension directory ready to load into Google Chrome.
 */
export function buildChromeExtension(options: BuildExtensionOptions = {}): string {
	const currentDir = import.meta.dir;
	const targetDir = options.outputDir || join(currentDir, "../../../../dist/extension");

	if (!existsSync(targetDir)) {
		mkdirSync(targetDir, { recursive: true });
	}

	// 1. Manifest
	const manifestPath = join(currentDir, "manifest.json");
	const manifestContent = JSON.parse(readFileSync(manifestPath, "utf-8"));
	writeFileSync(join(targetDir, "manifest.json"), JSON.stringify(manifestContent, null, 2));

	// 2. CSS Overlay
	const cssPath = join(currentDir, "overlay.css");
	if (existsSync(cssPath)) {
		writeFileSync(join(targetDir, "overlay.css"), readFileSync(cssPath, "utf-8"));
	}

	// 3. Popup HTML
	const popupHtmlPath = join(currentDir, "popup.html");
	if (existsSync(popupHtmlPath)) {
		writeFileSync(join(targetDir, "popup.html"), readFileSync(popupHtmlPath, "utf-8"));
	}

	// 4. Standalone JS scripts
	writeFileSync(join(targetDir, "pageHook.js"), generatePageHookScript());
	writeFileSync(join(targetDir, "contentScript.js"), generateContentScriptSource());
	writeFileSync(join(targetDir, "background.js"), generateBackgroundScriptSource());

	// 5. Popup JS controller
	const popupJs = `
document.addEventListener("DOMContentLoaded", function() {
	var forceSyncBtn = document.getElementById("forceSyncBtn");
	var snapshotBtn = document.getElementById("snapshotBtn");

	if (forceSyncBtn) {
		forceSyncBtn.addEventListener("click", function() {
			if (chrome && chrome.runtime && chrome.runtime.sendMessage) {
				chrome.runtime.sendMessage({ type: "SYNC_COOKIES_NOW" }, function() {
					forceSyncBtn.textContent = "Synced!";
					setTimeout(function() { forceSyncBtn.textContent = "Force Resync Session"; }, 1500);
				});
			}
		});
	}

	if (snapshotBtn) {
		snapshotBtn.addEventListener("click", function() {
			if (chrome && chrome.tabs) {
				chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
					if (tabs && tabs[0]) {
						chrome.tabs.sendMessage(tabs[0].id, { type: "REQUEST_DOM_SNAPSHOT" }, function() {
							snapshotBtn.textContent = "Snapshot Sent!";
							setTimeout(function() { snapshotBtn.textContent = "Capture DOM Snapshot"; }, 1500);
						});
					}
				});
			}
		});
	}
});
`.trim();
	writeFileSync(join(targetDir, "popup.js"), popupJs);

	return targetDir;
}
