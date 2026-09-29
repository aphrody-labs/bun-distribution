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

import { Fc27ControllerActions } from "./fc27Actions.ts";
import { GamePerceptionBridge } from "./perception.ts";
import type { GamePhase, GameVisionState } from "./types.ts";
import { VirtualXboxController } from "./virtualPad.ts";

export interface AutopilotDecision {
	phase: GamePhase;
	actionExecuted: string;
	aimAngle: number;
	power?: number;
}

export class Fc27GamepadAutopilot {
	private pad: VirtualXboxController;
	private actions: Fc27ControllerActions;
	private isRunning = false;

	constructor() {
		this.pad = VirtualXboxController.getInstance();
		this.actions = new Fc27ControllerActions(this.pad);
	}

	/**
	 * Determines the game tactical phase from raw perceptual inputs.
	 */
	public determinePhase(state: GameVisionState): GamePhase {
		if (!state.inPossession) {
			return "DEFENDING";
		}
		if (state.distanceToGoal <= 20.0 && state.isShootingAngleOpen) {
			return "SHOOTING_WINDOW";
		}
		if (state.ballX > 0.5) {
			return "FINAL_THIRD";
		}
		return "ATTACK_BUILDUP";
	}

	/**
	 * Evaluates and executes a single AI decision tick on the virtual Xbox gamepad.
	 */
	public async evaluateTick(state: GameVisionState): Promise<AutopilotDecision> {
		const phase = this.determinePhase(state);
		let actionExecuted = "DRIBBLE_FORWARD";
		let aimAngle = 0; // East (towards opponent goal)
		let power: number | undefined;

		switch (phase) {
			case "SHOOTING_WINDOW": {
				aimAngle = state.ballY > 0 ? -15 : 15; // Aim far post
				this.actions.steer(aimAngle, 1.0);
				power = 0.65;
				await this.actions.shoot("finesse", power);
				actionExecuted = `FINESSE_SHOT(power=${power}, angle=${aimAngle}°)`;
				break;
			}
			case "FINAL_THIRD": {
				aimAngle = 0;
				if (state.nearestOpponentDistance < 2.0) {
					await this.actions.executeSkillMove("heel_to_heel");
					actionExecuted = "SKILL_MOVE(heel_to_heel)";
				} else if (state.teammatesAhead > 0) {
					power = 0.7;
					await this.actions.pass("through", power);
					actionExecuted = `THROUGH_BALL(power=${power})`;
				} else {
					this.actions.setSprint(true);
					this.actions.steer(0, 1.0);
					actionExecuted = "SPRINT_TOWARDS_BOX";
				}
				break;
			}
			case "ATTACK_BUILDUP": {
				aimAngle = 0;
				// If opponent presses close (< 2.0m), perform skill move evasion
				if (state.nearestOpponentDistance < 2.0) {
					await this.actions.executeSkillMove("ball_roll_right");
					actionExecuted = "SKILL_MOVE(ball_roll_right)";
				} else {
					this.actions.steer(aimAngle, 0.85);
					actionExecuted = "CONTROLLED_DRIBBLE";
				}
				break;
			}
			case "DEFENDING": {
				this.actions.setJockey(true);
				if (state.nearestOpponentDistance <= 1.2) {
					await this.actions.tackle("standing");
					actionExecuted = "STANDING_TACKLE";
				} else {
					aimAngle = state.ballX < 0 ? 180 : 0;
					this.actions.steer(aimAngle, 0.9);
					actionExecuted = "JOCKEY_AND_INTERCEPT";
				}
				break;
			}
			default: {
				this.actions.steer(0, 0.5);
				actionExecuted = "HOLD_POSITION";
				break;
			}
		}

		return {
			phase,
			actionExecuted,
			aimAngle,
			power,
		};
	}

	/**
	 * Runs the autonomous AI game loop for N ticks or until stopped.
	 */
	public async runLoop(options: {
		maxTicks?: number;
		tickDelayMs?: number;
		simulatedStates?: GameVisionState[];
		onDecision?: (d: AutopilotDecision, tick: number) => void;
	} = {}): Promise<AutopilotDecision[]> {
		const maxTicks = options.maxTicks ?? 10;
		const delay = options.tickDelayMs ?? 50;
		const decisions: AutopilotDecision[] = [];

		this.pad.connect();
		this.isRunning = true;

		try {
			for (let tick = 0; tick < maxTicks && this.isRunning; tick++) {
				const state = options.simulatedStates?.[tick] ?? GamePerceptionBridge.extractGameState();
				const decision = await this.evaluateTick(state);
				decisions.push(decision);

				if (options.onDecision) {
					options.onDecision(decision, tick);
				}

				if (delay > 0) {
					await new Promise((r) => setTimeout(r, delay));
				}
			}
		} finally {
			this.stop();
		}

		return decisions;
	}

	public stop(): void {
		this.isRunning = false;
		this.actions.setSprint(false);
		this.actions.setJockey(false);
		this.pad.reset();
		this.pad.disconnect();
	}
}
