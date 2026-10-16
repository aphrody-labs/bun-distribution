// SPDX-License-Identifier: Apache-2.0
// Pure timeline, atlas UVs, fit rectangle and depth slicing for the pet renderers. No DOM and
// no GPU: everything here runs under `bun test`.
import { PET, frameAt, gazeFrame, type PetData, type PetFrame } from "../pet";

export interface AtlasUv {
  u0: number;
  v0: number;
  u1: number;
  v1: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PetPose {
  track: string;
  frame: PetFrame;
  uv: AtlasUv;
}

/** A backend that paints one pose into the canvas it was created for. */
export interface PetDrawer {
  readonly backend: "webgpu" | "canvas2d";
  draw(pose: PetPose, options: DrawOptions): void;
  dispose(): void;
}

export interface DrawOptions {
  mode: "2d" | "3d";
  /** Sway angle in radians, used by the 3d mode only. */
  yaw: number;
  /** Extrusion depth in pixels, used by the 3d mode only. */
  depth: number;
  /** Number of volume slices, used by the 3d mode only. */
  slices: number;
}

export function petStates(data: PetData = PET): string[] {
  return Object.keys(data.tracks);
}

export function atlasUv(frame: PetFrame, data: PetData = PET): AtlasUv {
  const { width, height } = data.atlas;
  return {
    u0: frame.x / width,
    v0: frame.y / height,
    u1: (frame.x + frame.w) / width,
    v1: (frame.y + frame.h) / height,
  };
}

/** Largest rectangle with the frame's aspect that fits in `width` x `height`, centred. */
export function fitRect(
  frame: PetFrame,
  width: number,
  height: number,
  padding = 0,
): Rect {
  const availW = Math.max(0, width - 2 * padding);
  const availH = Math.max(0, height - 2 * padding);
  const scale = Math.min(availW / frame.w, availH / frame.h);
  const w = frame.w * scale;
  const h = frame.h * scale;
  return { x: (width - w) / 2, y: (height - h) / 2, w, h };
}

/** Yaw in radians of the slow 3D sway, `amplitudeDeg` peak, one oscillation per `periodMs`. */
export function swayYaw(
  nowMs: number,
  amplitudeDeg = 12,
  periodMs = 6000,
): number {
  const amplitude = (amplitudeDeg * Math.PI) / 180;
  return amplitude * Math.sin((2 * Math.PI * nowMs) / periodMs);
}

/** Back-to-front depths of `count` slices centred on 0 and spanning `depth` pixels. */
export function sliceDepths(count: number, depth: number): number[] {
  if (!Number.isInteger(count) || count < 2)
    throw new RangeError("sliceDepths needs at least 2 slices");
  return Array.from(
    { length: count },
    (_, i) => (i / (count - 1) - 0.5) * depth,
  );
}

/**
 * Plays one track at a time and resolves the pose for a clock value. Times are caller-supplied
 * (`performance.now()` in the browser), so the timeline is deterministic under test.
 */
export class PetTimeline {
  readonly #data: PetData;
  #track: string;
  #startMs = 0;
  #loop = true;
  #gaze: PetFrame | null = null;

  constructor(initial = "idle", data: PetData = PET) {
    this.#data = data;
    this.#track = this.#require(initial);
  }

  get state(): string {
    return this.#track;
  }

  play(state: string, nowMs: number, loop = true): void {
    this.#track = this.#require(state);
    this.#startMs = nowMs;
    this.#loop = loop;
    this.#gaze = null;
  }

  /** Overrides the track with a gaze pose until the next `play`. Pointer offsets in pixels. */
  look(dx: number, dy: number, deadzone = 24): void {
    this.#gaze = gazeFrame(dx, dy, deadzone, this.#data);
  }

  pose(nowMs: number): PetPose {
    const track = this.#data.tracks[this.#track];
    if (!track) throw new Error(`unknown pet state: ${this.#track}`);
    const frame =
      this.#gaze ?? frameAt(track, nowMs - this.#startMs, this.#loop);
    return { track: this.#track, frame, uv: atlasUv(frame, this.#data) };
  }

  #require(state: string): string {
    if (!this.#data.tracks[state])
      throw new Error(`unknown pet state: ${state}`);
    return state;
  }
}
