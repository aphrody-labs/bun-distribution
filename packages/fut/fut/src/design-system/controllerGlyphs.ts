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

export interface ControllerPrompt {
	button: "A" | "B" | "X" | "Y" | "LB" | "RB" | "LT" | "RT" | "RS" | "LS";
	label: string;
}

export class ControllerGlyphsFormatter {
	public static renderPrompt(button: ControllerPrompt["button"], label: string): string {
		const isShoulder = button === "LB" || button === "RB" || button === "LT" || button === "RT";
		const shapeStyle = isShoulder
			? "padding: 1px 5px; border-radius: 4px; font-size: 10px;"
			: "width: 18px; height: 18px; border-radius: 50%; font-size: 11px; display: inline-flex; align-items: center; justify-content: center;";

		return `
		<div class="fc-controller-prompt" style="
			display: inline-flex;
			align-items: center;
			gap: 6px;
			color: #FFFFFF;
			font-family: system-ui, sans-serif;
			font-size: 12px;
			font-weight: 600;
		">
			<span style="
				background: #FFFFFF;
				color: #0F172A;
				font-weight: 800;
				${shapeStyle}
			">${button}</span>
			<span>${label}</span>
		</div>`;
	}

	public static renderActionBar(prompts: ControllerPrompt[]): string {
		const rendered = prompts
			.map((p) => ControllerGlyphsFormatter.renderPrompt(p.button, p.label))
			.join("\n");

		return `
		<div class="fc-action-bar" style="
			display: flex;
			align-items: center;
			gap: 20px;
			padding: 10px 24px;
			background: rgba(8, 13, 19, 0.9);
			border-top: 1px solid rgba(255, 255, 255, 0.08);
			backdrop-filter: blur(12px);
		">
			${rendered}
		</div>`;
	}
}
