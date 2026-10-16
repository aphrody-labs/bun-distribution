// SPDX-License-Identifier: Apache-2.0
// Rust <-> web parity: crates/aphrody-identity writes tests/fixtures/parite-web.json from its own
// clock (pets.rs); this file replays every tick through src/runtime.ts and must agree exactly.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { findWorkspaceRoot } from "@aphrody/paths";
import { Ambient, gaze, PET_WEB, resolve, type WebTrack } from "./runtime";

const crate = join(findWorkspaceRoot(import.meta.dir), "crates/aphrody-identity");

type TickRow = [number, string, string | null, number | null, number | null];
interface Fixture {
  schema: number;
  gazeDeadzone: number;
  cases: { id: string; tracks: Record<string, WebTrack>; ticks: TickRow[] }[];
  ambient: {
    op: "voir" | "poser" | "effacer";
    state: string | null;
    now: number;
    animation: string;
    elapsed: number;
    sprite: number | null;
    delay: number | null;
  }[];
  gaze: [number, number, number | null][];
}

const fixture: Fixture = await Bun.file(join(crate, "tests/fixtures/parite-web.json")).json();

describe("parity with the crate clock", () => {
  test("fixture schema", () => {
    expect(fixture.schema).toBe(1);
    expect(fixture.cases.map(c => c.id)).toEqual(["aphrody", "synthetique"]);
  });

  for (const c of fixture.cases) {
    test(`${c.id}: ${c.ticks.length} ticks`, () => {
      const got = c.ticks.map(([elapsed, name]): TickRow => {
        const r = resolve(c.tracks, name, elapsed);
        return [elapsed, name, r?.track ?? null, r?.tick.sprite ?? null, r?.tick.delay ?? null];
      });
      expect(got).toEqual(c.ticks);
    });
  }

  test("the shipped tracks are the crate's Aphrody case", () => {
    const aphrody = fixture.cases[0];
    for (const [name, track] of Object.entries(aphrody?.tracks ?? {})) expect(PET_WEB.tracks[name]).toEqual(track);
  });

  test(`ambient script: ${fixture.ambient.length} steps`, () => {
    const first = fixture.ambient[0];
    if (!first) throw new Error("empty ambient script");
    const a = new Ambient(first.now, PET_WEB.states);
    const got = fixture.ambient.map(step => {
      if (step.op === "poser" && step.state) a.set(step.state, step.now);
      if (step.op === "effacer") a.clear();
      const [animation, elapsed] = a.animation(step.now);
      const r = resolve(PET_WEB.tracks, animation, elapsed);
      return {
        ...step,
        animation,
        elapsed,
        sprite: r?.tick.sprite ?? null,
        delay: r?.tick.delay ?? null,
      };
    });
    expect(got).toEqual(fixture.ambient);
  });

  test(`gaze rose: ${fixture.gaze.length} points`, () => {
    expect(PET_WEB.gazeDeadzone).toBe(fixture.gazeDeadzone);
    const got = fixture.gaze.map(([dx, dy]) => [dx, dy, gaze(dx, dy, fixture.gazeDeadzone, PET_WEB.directions.length)]);
    expect(got).toEqual(fixture.gaze);
  });
});

describe("generated data", () => {
  test("states carry Codex lifetimes and labels", () => {
    expect(PET_WEB.states.running).toEqual({
      lifetimeMs: 180_000,
      label: "Running",
    });
    expect(PET_WEB.states.waiting?.label).toBe("Needs input");
    expect(PET_WEB.directions).toHaveLength(16);
  });

  test("unknown states are refused, not silently ignored", () => {
    expect(() => new Ambient(0).set("sleeping", 0)).toThrow(RangeError);
  });

  test("sprite CSS covers every cell", () => {
    const { columns, rows } = PET_WEB.atlas;
    for (let i = 0; i < columns * rows; i++) expect(PET_WEB.css).toContain(`.nie-c${i} {`);
  });
});
