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

export enum XboxButton {
	None = 0,
	DpadUp = 0x0001,
	DpadDown = 0x0002,
	DpadLeft = 0x0004,
	DpadRight = 0x0008,
	Start = 0x0010,
	Back = 0x0020,
	LeftThumb = 0x0040,
	RightThumb = 0x0080,
	LeftShoulder = 0x0100,  // LB
	RightShoulder = 0x0200, // RB
	Guide = 0x0400,
	A = 0x1000,
	B = 0x2000,
	X = 0x4000,
	Y = 0x8000,
}

export interface RawGamepadReport {
	buttons: number;      // 16-bit mask
	leftTrigger: number;  // 0 to 255
	rightTrigger: number; // 0 to 255
	thumbLX: number;      // -32768 to 32767
	thumbLY: number;      // -32768 to 32767
	thumbRX: number;      // -32768 to 32767
	thumbRY: number;      // -32768 to 32767
}

export type PassType = "ground" | "lob" | "through" | "driven";
export type ShootType = "normal" | "finesse" | "chip" | "power";
export type TackleType = "standing" | "sliding";

export type SkillMoveType =
	| "ball_roll_right"
	| "ball_roll_left"
	| "heel_to_heel"
	| "roulette"
	| "stepover_right"
	| "stepover_left"
	| "rainbow";

export type GamePhase =
	| "KICKOFF"
	| "ATTACK_BUILDUP"
	| "FINAL_THIRD"
	| "SHOOTING_WINDOW"
	| "DEFENDING"
	| "LOOSE_BALL";

export interface GameVisionState {
	inPossession: boolean;
	ballX: number; // -1.0 (own goal) to 1.0 (opponent goal)
	ballY: number; // -1.0 (bottom touchline) to 1.0 (top touchline)
	nearestOpponentDistance: number; // in virtual meters
	distanceToGoal: number; // in virtual meters
	isShootingAngleOpen: boolean;
	teammatesAhead: number;
}
