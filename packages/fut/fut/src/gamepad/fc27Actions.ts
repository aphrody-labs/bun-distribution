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

import { type PassType, type ShootType, type SkillMoveType, type TackleType, XboxButton } from "./types.ts";
import { VirtualXboxController } from "./virtualPad.ts";

export class Fc27ControllerActions {
	private pad: VirtualXboxController;

	constructor(pad = VirtualXboxController.getInstance()) {
		this.pad = pad;
	}

	/**
	 * Steers player movement using normalized angle in degrees (0 = East/Right, 90 = North/Up)
	 * and intensity (0.0 to 1.0).
	 */
	public steer(angleDegrees: number, intensity = 1.0): void {
		const rad = (angleDegrees * Math.PI) / 180;
		const x = Math.cos(rad) * intensity;
		const y = Math.sin(rad) * intensity;
		this.pad.setLeftStick(x, y);
	}

	/**
	 * Executes a timed pass based on pass type and power (0.1 to 1.0).
	 */
	public async pass(type: PassType = "ground", power = 0.5): Promise<void> {
		const holdMs = Math.round(50 + power * 150);

		switch (type) {
			case "ground":
				await this.pad.tapButton(XboxButton.A, holdMs);
				break;
			case "through":
				await this.pad.tapButton(XboxButton.Y, holdMs);
				break;
			case "lob":
				await this.pad.tapButton(XboxButton.X, holdMs);
				break;
			case "driven":
				this.pad.pressButton(XboxButton.RightShoulder);
				await this.pad.tapButton(XboxButton.A, holdMs);
				this.pad.releaseButton(XboxButton.RightShoulder);
				break;
		}
	}

	/**
	 * Executes a shot based on type (normal, finesse, chip, power) and power bar.
	 */
	public async shoot(type: ShootType = "normal", power = 0.6): Promise<void> {
		const holdMs = Math.round(60 + power * 180);

		switch (type) {
			case "normal":
				await this.pad.tapButton(XboxButton.B, holdMs);
				break;
			case "finesse":
				this.pad.pressButton(XboxButton.RightShoulder); // RB
				await this.pad.tapButton(XboxButton.B, holdMs);
				this.pad.releaseButton(XboxButton.RightShoulder);
				break;
			case "chip":
				this.pad.pressButton(XboxButton.LeftShoulder); // LB
				await this.pad.tapButton(XboxButton.B, holdMs);
				this.pad.releaseButton(XboxButton.LeftShoulder);
				break;
			case "power":
				// Power Shot in FC 24/25/26/27: LB + RB + B
				this.pad.pressButton(XboxButton.LeftShoulder);
				this.pad.pressButton(XboxButton.RightShoulder);
				await this.pad.tapButton(XboxButton.B, holdMs);
				this.pad.releaseButton(XboxButton.LeftShoulder);
				this.pad.releaseButton(XboxButton.RightShoulder);
				break;
		}
	}

	/**
	 * Toggle sprint trigger (RT).
	 */
	public setSprint(active: boolean): void {
		const state = this.pad.getCurrentState();
		this.pad.setTriggers(state.leftTrigger / 255, active ? 1.0 : 0.0);
	}

	/**
	 * Toggle defensive jockey trigger (LT).
	 */
	public setJockey(active: boolean): void {
		const state = this.pad.getCurrentState();
		this.pad.setTriggers(active ? 1.0 : 0.0, state.rightTrigger / 255);
	}

	/**
	 * Executes a defensive tackle.
	 */
	public async tackle(type: TackleType = "standing"): Promise<void> {
		if (type === "standing") {
			await this.pad.tapButton(XboxButton.B, 100);
		} else {
			await this.pad.tapButton(XboxButton.X, 120);
		}
	}

	/**
	 * Switches controlled defender using LB or right stick directional flick.
	 */
	public async switchPlayer(method: "lb" | "right_stick" = "lb", directionAngle = 0): Promise<void> {
		if (method === "lb") {
			await this.pad.tapButton(XboxButton.LeftShoulder, 50);
		} else {
			const rad = (directionAngle * Math.PI) / 180;
			this.pad.setRightStick(Math.cos(rad), Math.sin(rad));
			await new Promise((r) => setTimeout(r, 60));
			this.pad.setRightStick(0, 0);
		}
	}

	/**
	 * Executes a timed multi-step Skill Move on the Right Thumbstick.
	 */
	public async executeSkillMove(move: SkillMoveType): Promise<void> {
		switch (move) {
			case "ball_roll_right":
				this.pad.setRightStick(1.0, 0.0);
				await new Promise((r) => setTimeout(r, 220));
				this.pad.setRightStick(0.0, 0.0);
				break;
			case "ball_roll_left":
				this.pad.setRightStick(-1.0, 0.0);
				await new Promise((r) => setTimeout(r, 220));
				this.pad.setRightStick(0.0, 0.0);
				break;
			case "heel_to_heel":
				// Flick forward (0, 1), then backward (0, -1)
				this.pad.setRightStick(0.0, 1.0);
				await new Promise((r) => setTimeout(r, 80));
				this.pad.setRightStick(0.0, -1.0);
				await new Promise((r) => setTimeout(r, 80));
				this.pad.setRightStick(0.0, 0.0);
				break;
			case "roulette":
				// 3-point circular rotation on right stick
				this.pad.setRightStick(0.0, -1.0);
				await new Promise((r) => setTimeout(r, 60));
				this.pad.setRightStick(1.0, -0.5);
				await new Promise((r) => setTimeout(r, 60));
				this.pad.setRightStick(0.0, 1.0);
				await new Promise((r) => setTimeout(r, 60));
				this.pad.setRightStick(0.0, 0.0);
				break;
			case "stepover_right":
				this.pad.setRightStick(0.0, 1.0);
				await new Promise((r) => setTimeout(r, 70));
				this.pad.setRightStick(1.0, 0.5);
				await new Promise((r) => setTimeout(r, 70));
				this.pad.setRightStick(0.0, 0.0);
				break;
			case "stepover_left":
				this.pad.setRightStick(0.0, 1.0);
				await new Promise((r) => setTimeout(r, 70));
				this.pad.setRightStick(-1.0, 0.5);
				await new Promise((r) => setTimeout(r, 70));
				this.pad.setRightStick(0.0, 0.0);
				break;
			case "rainbow":
				this.pad.setRightStick(0.0, -1.0);
				await new Promise((r) => setTimeout(r, 100));
				this.pad.setRightStick(0.0, 1.0);
				await new Promise((r) => setTimeout(r, 100));
				this.pad.setRightStick(0.0, 1.0);
				await new Promise((r) => setTimeout(r, 100));
				this.pad.setRightStick(0.0, 0.0);
				break;
		}
	}

	public sprint(active: boolean): void {
		this.setSprint(active);
	}

	public jockey(active: boolean): void {
		this.setJockey(active);
	}

	public async skillMove(move: SkillMoveType): Promise<void> {
		return this.executeSkillMove(move);
	}

	public reset(): void {
		this.pad.reset();
	}
}
