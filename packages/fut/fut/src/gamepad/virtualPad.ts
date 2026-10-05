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

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { dlopen, FFIType, ptr } from "bun:ffi";
import { type RawGamepadReport, XboxButton } from "./types.ts";

export class VirtualXboxController {
	private static instance: VirtualXboxController | null = null;
	private lib: any = null;
	private clientPtr: any = null;
	private targetPtr: any = null;
	private isConnected = false;
	private slotIndex = -1;

	// In-memory controller report buffer (12 bytes)
	private reportBuffer = new Uint8Array(12);
	private reportView = new DataView(this.reportBuffer.buffer);

	// Current logical state
	private currentButtons = 0;
	private currentLt = 0;
	private currentRt = 0;
	private currentLx = 0;
	private currentLy = 0;
	private currentRx = 0;
	private currentRy = 0;

	/** `VIGEM_CLIENT_DLL` wins, then the per-user ViGEm install, then the DLL search path. */
	private static readonly CANDIDATE_DLL_PATHS = [
		process.env.VIGEM_CLIENT_DLL,
		join(process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"), "ViGEm", "ViGEmClient.dll"),
		"ViGEmClient.dll",
	].filter((path): path is string => Boolean(path));

	constructor() {
		this.initNativeBindings();
	}

	public static getInstance(): VirtualXboxController {
		if (!VirtualXboxController.instance) {
			VirtualXboxController.instance = new VirtualXboxController();
		}
		return VirtualXboxController.instance;
	}

	private initNativeBindings(): void {
		if (process.platform !== "win32") return;

		for (const path of VirtualXboxController.CANDIDATE_DLL_PATHS) {
			if (existsSync(path)) {
				try {
					this.lib = dlopen(path, {
						vigem_alloc: { args: [], returns: FFIType.ptr },
						vigem_free: { args: [FFIType.ptr], returns: FFIType.void },
						vigem_connect: { args: [FFIType.ptr], returns: FFIType.u32 },
						vigem_disconnect: { args: [FFIType.ptr], returns: FFIType.void },
						vigem_target_x360_alloc: { args: [], returns: FFIType.ptr },
						vigem_target_free: { args: [FFIType.ptr], returns: FFIType.void },
						vigem_target_add: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
						vigem_target_remove: { args: [FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
						vigem_target_x360_update: { args: [FFIType.ptr, FFIType.ptr, FFIType.ptr], returns: FFIType.u32 },
						vigem_target_get_index: { args: [FFIType.ptr], returns: FFIType.u32 },
					});
					break;
				} catch {
					// Fallback to next path
				}
			}
		}
	}

	/**
	 * Plugs in the virtual Xbox 360 controller into the Windows kernel via ViGEmBus.
	 */
	public connect(): { success: boolean; slot: number; mode: "hardware" | "mock" } {
		if (this.isConnected) {
			return { success: true, slot: this.slotIndex, mode: this.lib ? "hardware" : "mock" };
		}

		if (this.lib) {
			try {
				this.clientPtr = this.lib.symbols.vigem_alloc();
				const connRes = this.lib.symbols.vigem_connect(this.clientPtr);
				if (connRes !== 0x20000000) {
					throw new Error(`vigem_connect failed with error code: 0x${connRes.toString(16)}`);
				}

				this.targetPtr = this.lib.symbols.vigem_target_x360_alloc();
				const addRes = this.lib.symbols.vigem_target_add(this.clientPtr, this.targetPtr);
				if (addRes !== 0x20000000) {
					throw new Error(`vigem_target_add failed with error code: 0x${addRes.toString(16)}`);
				}

				this.slotIndex = this.lib.symbols.vigem_target_get_index(this.targetPtr);
				this.isConnected = true;
				this.reset();

				return { success: true, slot: this.slotIndex, mode: "hardware" };
			} catch  {
				// Fallback to mock mode if driver cannot be opened
				this.isConnected = true;
				this.slotIndex = 1;
				return { success: true, slot: 1, mode: "mock" };
			}
		}

		// Non-Windows or testing mode
		this.isConnected = true;
		this.slotIndex = 1;
		return { success: true, slot: 1, mode: "mock" };
	}

	/**
	 * Unplugs and cleans up the virtual gamepad.
	 */
	public disconnect(): void {
		if (!this.isConnected) return;

		this.reset();
		if (this.lib && this.clientPtr && this.targetPtr) {
			try {
				this.lib.symbols.vigem_target_remove(this.clientPtr, this.targetPtr);
				this.lib.symbols.vigem_target_free(this.targetPtr);
				this.lib.symbols.vigem_disconnect(this.clientPtr);
				this.lib.symbols.vigem_free(this.clientPtr);
			} catch {
				// Clean exit
			}
		}

		this.clientPtr = null;
		this.targetPtr = null;
		this.isConnected = false;
		this.slotIndex = -1;
	}

	public isAttached(): boolean {
		return this.isConnected;
	}

	public getSlot(): number {
		return this.slotIndex;
	}

	/**
	 * Flushes the current controller report to ViGEmBus.
	 */
	public flush(): void {
		this.reportView.setUint16(0, this.currentButtons, true);
		this.reportView.setUint8(2, this.currentLt);
		this.reportView.setUint8(3, this.currentRt);
		this.reportView.setInt16(4, this.currentLx, true);
		this.reportView.setInt16(6, this.currentLy, true);
		this.reportView.setInt16(8, this.currentRx, true);
		this.reportView.setInt16(10, this.currentRy, true);

		if (this.lib && this.clientPtr && this.targetPtr && this.isConnected) {
			this.lib.symbols.vigem_target_x360_update(
				this.clientPtr,
				this.targetPtr,
				ptr(this.reportBuffer),
			);
		}
	}

	/**
	 * Resets all buttons, triggers, and sticks to neutral.
	 */
	public reset(): void {
		this.currentButtons = 0;
		this.currentLt = 0;
		this.currentRt = 0;
		this.currentLx = 0;
		this.currentLy = 0;
		this.currentRx = 0;
		this.currentRy = 0;
		this.flush();
	}

	public pressButton(btn: XboxButton): void {
		this.currentButtons |= btn;
		this.flush();
	}

	public releaseButton(btn: XboxButton): void {
		this.currentButtons &= ~btn;
		this.flush();
	}

	public async tapButton(btn: XboxButton, durationMs = 80): Promise<void> {
		this.pressButton(btn);
		await new Promise((r) => setTimeout(r, durationMs));
		this.releaseButton(btn);
	}

	/**
	 * Sets left thumbstick position with normalized values (-1.0 to +1.0).
	 */
	public setLeftStick(x: number, y: number): void {
		this.currentLx = Math.max(-32768, Math.min(32767, Math.round(x < 0 ? x * 32768 : x * 32767)));
		this.currentLy = Math.max(-32768, Math.min(32767, Math.round(y < 0 ? y * 32768 : y * 32767)));
		this.flush();
	}

	/**
	 * Sets right thumbstick position with normalized values (-1.0 to +1.0).
	 */
	public setRightStick(x: number, y: number): void {
		this.currentRx = Math.max(-32768, Math.min(32767, Math.round(x < 0 ? x * 32768 : x * 32767)));
		this.currentRy = Math.max(-32768, Math.min(32767, Math.round(y < 0 ? y * 32768 : y * 32767)));
		this.flush();
	}

	/**
	 * Sets analog triggers with normalized values (0.0 to 1.0).
	 */
	public setTriggers(lt: number, rt: number): void {
		this.currentLt = Math.max(0, Math.min(255, Math.round(lt * 255)));
		this.currentRt = Math.max(0, Math.min(255, Math.round(rt * 255)));
		this.flush();
	}

	public getCurrentState(): RawGamepadReport {
		return {
			buttons: this.currentButtons,
			leftTrigger: this.currentLt,
			rightTrigger: this.currentRt,
			thumbLX: this.currentLx,
			thumbLY: this.currentLy,
			thumbRX: this.currentRx,
			thumbRY: this.currentRy,
		};
	}
}
