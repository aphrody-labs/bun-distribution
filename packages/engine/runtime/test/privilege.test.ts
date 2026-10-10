// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import {
  canSudoNonInteractive,
  getElevationState,
  isElevated,
  wrapElevatedCommand,
} from "../../runtime/src/privilege";

describe("Native Privilege Layer (NHITL)", () => {
  it("queries elevation state cleanly", () => {
    const state = getElevationState();
    expect(state).toBeDefined();
    expect(typeof state.isElevated).toBe("boolean");
    expect(typeof state.canSudo).toBe("boolean");
    expect(state.platform).toBe(process.platform);
  });

  it("checks isElevated without throwing", () => {
    const elevated = isElevated();
    expect(typeof elevated).toBe("boolean");
  });

  it("checks canSudoNonInteractive without hanging or prompting", () => {
    const canSudo = canSudoNonInteractive();
    expect(typeof canSudo).toBe("boolean");
  });

  it("wraps commands appropriately according to elevation", () => {
    const wrapped = wrapElevatedCommand("ls", ["-la"]);
    if (isElevated()) {
      expect(wrapped.program).toBe("ls");
      expect(wrapped.args).toEqual(["-la"]);
    } else if (process.platform !== "win32") {
      expect(wrapped.program).toBe("sudo");
      expect(wrapped.args).toEqual(["-n", "ls", "-la"]);
    }
  });
});
