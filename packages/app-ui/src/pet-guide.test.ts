// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  admitMessage,
  type Box,
  decideGuide,
  GUIDE_MARGIN,
  guideForPath,
  HESITATION_MS,
  MESSAGE_MAX_PER_VISIT,
  MESSAGE_MIN_INTERVAL_MS,
  NO_MESSAGES,
  nearestRestingSpot,
  restingSpots,
  SCROLL_FAST,
  scrollSpeed,
} from "./pet-guide";

const viewport = { width: 1000, height: 800 };
const pet = { width: 100, height: 100 };
const bottomRight = {
  x: 1000 - 100 - GUIDE_MARGIN,
  y: 800 - 100 - GUIDE_MARGIN,
};
const base = {
  viewport,
  pet,
  position: bottomRight,
  obstacles: [] as Box[],
  typing: false,
  scrollSpeed: 0,
  idleMs: 0,
  hesitationTarget: null,
};

describe("resting spots", () => {
  test("offers the page margins when nothing is in the way", () => {
    const spots = restingSpots(viewport, pet, []);
    expect(spots).toContainEqual(bottomRight);
    for (const spot of spots) {
      expect(spot.x).toBeGreaterThanOrEqual(GUIDE_MARGIN);
      expect(spot.y).toBeGreaterThanOrEqual(GUIDE_MARGIN);
    }
  });

  test("skips spots that cover an obstacle", () => {
    const text: Box = { x: 800, y: 600, width: 200, height: 200 };
    expect(restingSpots(viewport, pet, [text])).not.toContainEqual(bottomRight);
  });

  test("nearest spot is the one closest to the current position", () => {
    expect(nearestRestingSpot({ x: 0, y: 0 }, viewport, pet, [])).toEqual({
      x: GUIDE_MARGIN,
      y: GUIDE_MARGIN,
    });
  });

  test("no spot when every margin is covered", () => {
    const everywhere: Box = { x: 0, y: 0, width: 1000, height: 800 };
    expect(
      nearestRestingSpot(bottomRight, viewport, pet, [everywhere]),
    ).toBeNull();
  });
});

describe("scroll speed", () => {
  test("is pixels per second between two samples", () => {
    expect(scrollSpeed({ y: 0, t: 0 }, { y: 300, t: 100 })).toBe(3000);
    expect(scrollSpeed({ y: 500, t: 0 }, { y: 400, t: 100 })).toBe(1000);
  });

  test("is zero when time does not advance", () => {
    expect(scrollSpeed({ y: 0, t: 5 }, { y: 300, t: 5 })).toBe(0);
  });
});

describe("decideGuide", () => {
  test("stays put when nothing is happening", () => {
    expect(decideGuide(base)).toEqual({ kind: "stay" });
  });

  test("steps aside while the user types, away from the field", () => {
    const field: Box = { x: 700, y: 700, width: 280, height: 60 };
    const action = decideGuide({ ...base, typing: true, obstacles: [field] });
    expect(action.kind).toBe("step-aside");
    if (action.kind === "step-aside")
      expect(action.to).not.toEqual(bottomRight);
  });

  test("steps aside during a fast scroll and stays for a slow one", () => {
    const middle = { x: 450, y: 350 };
    expect(
      decideGuide({ ...base, position: middle, scrollSpeed: SCROLL_FAST + 1 })
        .kind,
    ).toBe("step-aside");
    expect(
      decideGuide({ ...base, position: middle, scrollSpeed: SCROLL_FAST }).kind,
    ).toBe("stay");
  });

  test("stays when it already rests on the best spot", () => {
    expect(decideGuide({ ...base, scrollSpeed: SCROLL_FAST + 1 })).toEqual({
      kind: "stay",
    });
  });

  test("offers a hint beside a control only after a hesitation", () => {
    const button: Box = { x: 400, y: 300, width: 120, height: 40 };
    expect(
      decideGuide({
        ...base,
        hesitationTarget: button,
        idleMs: HESITATION_MS - 1,
      }).kind,
    ).toBe("stay");
    const action = decideGuide({
      ...base,
      hesitationTarget: button,
      idleMs: HESITATION_MS,
    });
    expect(action.kind).toBe("hint");
    if (action.kind === "hint") {
      expect(action.target).toEqual(button);
      expect(action.to).not.toEqual(bottomRight);
    }
  });

  test("moves off an element the layout placed under the pet", () => {
    const banner: Box = { x: 850, y: 650, width: 150, height: 150 };
    const action = decideGuide({ ...base, obstacles: [banner] });
    expect(action.kind).toBe("move");
  });

  test("typing outranks a hesitation", () => {
    const button: Box = { x: 400, y: 300, width: 120, height: 40 };
    const middle = { x: 450, y: 350 };
    expect(
      decideGuide({
        ...base,
        position: middle,
        typing: true,
        hesitationTarget: button,
        idleMs: HESITATION_MS,
      }).kind,
    ).toBe("step-aside");
  });
});

describe("guide routes", () => {
  test("maps routes to their guide on segment boundaries", () => {
    expect(guideForPath("/chat")).toBe("assistant");
    expect(guideForPath("/explorer/abc")).toBe("files");
    expect(guideForPath("/settings/appearance")).toBe("settings");
    expect(guideForPath("/chatbot")).toBe("home");
    expect(guideForPath("/")).toBe("home");
  });
});

describe("message admission", () => {
  test("respects the minimum interval", () => {
    const first = admitMessage(NO_MESSAGES, 1000);
    expect(first.allowed).toBe(true);
    expect(
      admitMessage(first.gate, 1000 + MESSAGE_MIN_INTERVAL_MS - 1).allowed,
    ).toBe(false);
    expect(
      admitMessage(first.gate, 1000 + MESSAGE_MIN_INTERVAL_MS).allowed,
    ).toBe(true);
  });

  test("caps messages per visit", () => {
    let gate = NO_MESSAGES;
    let now = 0;
    let allowed = 0;
    for (let i = 0; i < MESSAGE_MAX_PER_VISIT + 3; i++) {
      now += MESSAGE_MIN_INTERVAL_MS;
      const result = admitMessage(gate, now);
      gate = result.gate;
      if (result.allowed) allowed++;
    }
    expect(allowed).toBe(MESSAGE_MAX_PER_VISIT);
  });
});
