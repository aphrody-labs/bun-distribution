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

import { describe, expect, it } from "bun:test";
import {
	Fc27ControllerActions,
	Fc27GamepadAutopilot,
	GamePerceptionBridge,
	VirtualXboxController,
	XboxButton,
	type GameVisionState,
} from "../src/index.ts";

describe("Virtual Xbox 360 Controller & FC 27 Gamepad Autopilot", () => {
	const pad = VirtualXboxController.getInstance();

	describe("Hardware-Level Virtual Controller Driver", () => {
		it("initializes singleton controller instance with clean zero state", () => {
			expect(pad).toBeDefined();
			const state = pad.getCurrentState();
			expect(state.buttons).toBe(0);
			expect(state.leftTrigger).toBe(0);
			expect(state.rightTrigger).toBe(0);
			expect(state.thumbLX).toBe(0);
			expect(state.thumbLY).toBe(0);
		});

		it("connects and assigns virtual gamepad slot index on Windows", () => {
			if (process.platform === "win32") {
				const attached = pad.connect();
				expect(attached.success).toBe(true);
				expect(pad.isAttached()).toBe(true);
				expect(pad.getSlot()).toBeGreaterThanOrEqual(1);
			}
		});

		it("encodes thumbstick coordinates into signed 16-bit integers", () => {
			pad.setLeftStick(1.0, -1.0);
			let state = pad.getCurrentState();
			expect(state.thumbLX).toBe(32767);
			expect(state.thumbLY).toBe(-32768);

			pad.setLeftStick(0, 0);
			state = pad.getCurrentState();
			expect(state.thumbLX).toBe(0);
			expect(state.thumbLY).toBe(0);

			pad.setRightStick(-0.5, 0.5);
			state = pad.getCurrentState();
			expect(state.thumbRX).toBeCloseTo(-16384, -2);
			expect(state.thumbRY).toBeCloseTo(16384, -2);
		});

		it("encodes analog triggers into 8-bit unsigned integers", () => {
			pad.setTriggers(1.0, 0.5);
			const state = pad.getCurrentState();
			expect(state.leftTrigger).toBe(255);
			expect(state.rightTrigger).toBe(128);

			pad.reset();
			const resetState = pad.getCurrentState();
			expect(resetState.leftTrigger).toBe(0);
			expect(resetState.rightTrigger).toBe(0);
		});

		it("manages button bitmask operations accurately", () => {
			pad.pressButton(XboxButton.A);
			expect(pad.getCurrentState().buttons & XboxButton.A).toBe(XboxButton.A);

			pad.pressButton(XboxButton.RightShoulder);
			expect(pad.getCurrentState().buttons & XboxButton.RightShoulder).toBe(XboxButton.RightShoulder);
			expect(pad.getCurrentState().buttons & XboxButton.A).toBe(XboxButton.A);

			pad.releaseButton(XboxButton.A);
			expect(pad.getCurrentState().buttons & XboxButton.A).toBe(0);
			expect(pad.getCurrentState().buttons & XboxButton.RightShoulder).toBe(XboxButton.RightShoulder);

			pad.reset();
			expect(pad.getCurrentState().buttons).toBe(0);
		});
	});

	describe("FC 27 High-Level Controller Actions", () => {
		const actions = new Fc27ControllerActions(pad);

		it("steers left analog stick to correct directional coordinates", () => {
			// East (0 degrees)
			actions.steer(0, 1.0);
			let state = pad.getCurrentState();
			expect(state.thumbLX).toBe(32767);
			expect(state.thumbLY).toBe(0);

			// North (90 degrees)
			actions.steer(90, 1.0);
			state = pad.getCurrentState();
			expect(state.thumbLX).toBeCloseTo(0, -1);
			expect(state.thumbLY).toBe(32767);

			// West (180 degrees)
			actions.steer(180, 1.0);
			state = pad.getCurrentState();
			expect(state.thumbLX).toBe(-32768);
			expect(state.thumbLY).toBeCloseTo(0, -1);

			actions.reset();
		});

		it("executes ground, through, and driven passing sequences", async () => {
			await actions.pass("ground", 0.5);
			expect(pad.getCurrentState().buttons).toBe(0);

			await actions.pass("through", 0.6);
			expect(pad.getCurrentState().buttons).toBe(0);

			await actions.pass("driven", 0.7);
			expect(pad.getCurrentState().buttons).toBe(0);
		});

		it("executes shooting actions (normal and finesse)", async () => {
			await actions.shoot("normal", 0.8);
			expect(pad.getCurrentState().buttons).toBe(0);

			await actions.shoot("finesse", 0.75);
			expect(pad.getCurrentState().buttons).toBe(0);
		});

		it("toggles sprint and jockey states via analog triggers", () => {
			actions.sprint(true);
			expect(pad.getCurrentState().rightTrigger).toBe(255);
			actions.sprint(false);
			expect(pad.getCurrentState().rightTrigger).toBe(0);

			actions.jockey(true);
			expect(pad.getCurrentState().leftTrigger).toBe(255);
			actions.jockey(false);
			expect(pad.getCurrentState().leftTrigger).toBe(0);
		});

		it("executes tactical skill moves (ball roll, heel-to-heel, roulette)", async () => {
			await actions.skillMove("ball_roll_right");
			expect(pad.getCurrentState().thumbRX).toBe(0);
			expect(pad.getCurrentState().thumbRY).toBe(0);

			await actions.skillMove("heel_to_heel");
			expect(pad.getCurrentState().thumbRX).toBe(0);

			await actions.skillMove("roulette");
			expect(pad.getCurrentState().thumbRX).toBe(0);
		});
	});

	describe("Perception Bridge & Game Window Detection", () => {
		it("detects running game process or returns clean diagnostic", async () => {
			const status = await GamePerceptionBridge.detectGameWindow();
			expect(status).toBeDefined();
			expect(typeof status.found).toBe("boolean");
			if (status.found) {
				expect(typeof status.pid).toBe("number");
			}
		});

		it("extracts and overrides game vision states reliably", () => {
			const defaultState = GamePerceptionBridge.extractGameState();
			expect(defaultState.inPossession).toBe(true);
			expect(defaultState.ballX).toBe(0.2);

			const overridden = GamePerceptionBridge.extractGameState({
				inPossession: false,
				ballX: -0.5,
				nearestOpponentDistance: 1.2,
			});
			expect(overridden.inPossession).toBe(false);
			expect(overridden.ballX).toBe(-0.5);
			expect(overridden.nearestOpponentDistance).toBe(1.2);
		});
	});

	describe("FC 27 Autonomous AI Gamepad Autopilot", () => {
		const autopilot = new Fc27GamepadAutopilot();

		it("determines correct tactical phases from game states", () => {
			// When out of possession
			const defState: GameVisionState = {
				inPossession: false,
				ballX: -0.4,
				ballY: 0.1,
				nearestOpponentDistance: 2.0,
				distanceToGoal: 35.0,
				isShootingAngleOpen: false,
				teammatesAhead: 0,
			};
			expect(autopilot.determinePhase(defState)).toBe("DEFENDING");

			// In shooting window
			const shootState: GameVisionState = {
				inPossession: true,
				ballX: 0.8,
				ballY: 0.0,
				nearestOpponentDistance: 4.0,
				distanceToGoal: 16.0,
				isShootingAngleOpen: true,
				teammatesAhead: 1,
			};
			expect(autopilot.determinePhase(shootState)).toBe("SHOOTING_WINDOW");

			// Final third
			const finalThirdState: GameVisionState = {
				inPossession: true,
				ballX: 0.65,
				ballY: 0.2,
				nearestOpponentDistance: 3.0,
				distanceToGoal: 28.0,
				isShootingAngleOpen: false,
				teammatesAhead: 2,
			};
			expect(autopilot.determinePhase(finalThirdState)).toBe("FINAL_THIRD");

			// Buildup
			const buildupState: GameVisionState = {
				inPossession: true,
				ballX: 0.1,
				ballY: -0.2,
				nearestOpponentDistance: 5.0,
				distanceToGoal: 45.0,
				isShootingAngleOpen: false,
				teammatesAhead: 3,
			};
			expect(autopilot.determinePhase(buildupState)).toBe("ATTACK_BUILDUP");
		});

		it("evaluates and executes tactical ticks in defensive phase", async () => {
			const defState: GameVisionState = {
				inPossession: false,
				ballX: -0.2,
				ballY: 0.0,
				nearestOpponentDistance: 1.0, // Close opponent (<= 1.2m) -> Standing tackle
				distanceToGoal: 30.0,
				isShootingAngleOpen: false,
				teammatesAhead: 0,
			};
			const decision = await autopilot.evaluateTick(defState);
			expect(decision.phase).toBe("DEFENDING");
			expect(decision.actionExecuted).toBe("STANDING_TACKLE");
		});

		it("evaluates and executes tactical ticks in shooting window", async () => {
			const shootState: GameVisionState = {
				inPossession: true,
				ballX: 0.85,
				ballY: 0.1,
				nearestOpponentDistance: 3.5,
				distanceToGoal: 15.0,
				isShootingAngleOpen: true,
				teammatesAhead: 1,
			};
			const decision = await autopilot.evaluateTick(shootState);
			expect(decision.phase).toBe("SHOOTING_WINDOW");
			expect(decision.actionExecuted).toContain("FINESSE_SHOT");
		});

		it("evaluates and executes tactical ticks with skill moves when pressed in final third", async () => {
			const pressedState: GameVisionState = {
				inPossession: true,
				ballX: 0.7,
				ballY: 0.2,
				nearestOpponentDistance: 1.5, // Pressed by defender (< 2.0m) -> Skill move evasion
				distanceToGoal: 24.0,
				isShootingAngleOpen: false,
				teammatesAhead: 2,
			};
			const decision = await autopilot.evaluateTick(pressedState);
			expect(decision.phase).toBe("FINAL_THIRD");
			expect(decision.actionExecuted).toBe("SKILL_MOVE(heel_to_heel)");
		});
	});
});
