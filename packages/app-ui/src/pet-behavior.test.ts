// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { PET } from "@aphrody/identity/pet";
import { gazeToward, idleDelay, trackFor, walkDirection, walkDuration } from "./pet-behavior";

describe("pet behaviour", () => {
  test("maps modes to existing identity tracks", () => {
    for (const [mode, hovering] of [["idle", false], ["walk-left", false], ["walk-right", false], ["idle", true]] as const) {
      expect(PET.tracks[trackFor(mode, hovering)]).toBeDefined();
    }
    expect(trackFor("walk-left", false)).toBe("running-left");
    expect(trackFor("idle", true)).toBe("waving");
  });

  test("schedules within bounds", () => {
    expect(idleDelay(() => 0)).toBe(8000);
    expect(idleDelay(() => 0.999)).toBeLessThan(20000);
    expect(walkDuration(() => 0)).toBe(2000);
    expect(walkDirection(() => 0.1)).toBe("walk-left");
    expect(walkDirection(() => 0.9)).toBe("walk-right");
  });

  test("looks only at a nearby pointer", () => {
    expect(gazeToward({ x: 10_000, y: 0 }, { x: 0, y: 0 })).toBeNull();
    const near = gazeToward({ x: 100, y: 0 }, { x: 0, y: 0 });
    if (PET.directions.length > 0) expect(near).not.toBeNull();
  });
});
