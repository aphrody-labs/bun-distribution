// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { PET } from "../pet";
import {
  atlasUv,
  fitRect,
  PetTimeline,
  petStates,
  sliceDepths,
  swayYaw,
} from "./frames";

describe("atlasUv", () => {
  test("normalises a frame rectangle against the atlas size", () => {
    const frame = { x: 192, y: 208, w: 192, h: 208, ms: 100 };
    const uv = atlasUv(frame, PET);
    expect(uv.u0).toBeCloseTo(192 / PET.atlas.width);
    expect(uv.v0).toBeCloseTo(208 / PET.atlas.height);
    expect(uv.u1).toBeCloseTo(384 / PET.atlas.width);
    expect(uv.v1).toBeCloseTo(416 / PET.atlas.height);
  });
});

describe("fitRect", () => {
  test("keeps the frame aspect and centres it", () => {
    const rect = fitRect({ x: 0, y: 0, w: 192, h: 208, ms: 0 }, 400, 400);
    expect(rect.h).toBeCloseTo(400);
    expect(rect.w).toBeCloseTo((192 / 208) * 400);
    expect(rect.x).toBeCloseTo((400 - rect.w) / 2);
    expect(rect.y).toBeCloseTo(0);
  });

  test("applies padding on each side", () => {
    const rect = fitRect({ x: 0, y: 0, w: 100, h: 100, ms: 0 }, 200, 200, 20);
    expect(rect.w).toBeCloseTo(160);
    expect(rect.x).toBeCloseTo(20);
  });
});

describe("swayYaw", () => {
  test("is zero at t=0 and peaks at the amplitude a quarter period later", () => {
    expect(swayYaw(0)).toBeCloseTo(0);
    expect(swayYaw(1500)).toBeCloseTo((12 * Math.PI) / 180);
  });
});

describe("sliceDepths", () => {
  test("spans the requested depth symmetrically", () => {
    const depths = sliceDepths(5, 40);
    expect(depths).toEqual([-20, -10, 0, 10, 20]);
  });

  test("rejects counts below 2 and non-integers", () => {
    expect(() => sliceDepths(1, 10)).toThrow(RangeError);
    expect(() => sliceDepths(2.5, 10)).toThrow(RangeError);
  });
});

describe("PetTimeline", () => {
  test("exposes every pet state", () => {
    expect(petStates()).toContain("idle");
    expect(petStates()).toContain("waving");
  });

  test("starts on the initial state and rejects unknown ones", () => {
    const timeline = new PetTimeline("idle");
    expect(timeline.state).toBe("idle");
    expect(() => timeline.play("nope", 0)).toThrow("unknown pet state: nope");
    expect(() => new PetTimeline("nope")).toThrow();
  });

  test("advances frames with the clock and returns a pose inside the atlas", () => {
    const timeline = new PetTimeline("idle");
    const first = timeline.pose(0);
    const later = timeline.pose(10_000);
    expect(first.track).toBe("idle");
    expect(first.uv.u1).toBeLessThanOrEqual(1);
    expect(first.uv.v1).toBeLessThanOrEqual(1);
    expect(later.frame).toBeDefined();
  });

  test("restarts the track from the play time", () => {
    const timeline = new PetTimeline("idle");
    timeline.play("waving", 1000);
    expect(timeline.state).toBe("waving");
    expect(timeline.pose(1000).frame).toEqual(PET.tracks.waving!.frames[0]!);
  });

  test("gaze overrides the track until the next play", () => {
    const timeline = new PetTimeline("idle");
    timeline.look(200, 0);
    const looking = timeline.pose(0);
    expect(looking.track).toBe("idle");
    timeline.play("idle", 0);
    expect(timeline.pose(0).frame).not.toBe(looking.frame);
  });
});
